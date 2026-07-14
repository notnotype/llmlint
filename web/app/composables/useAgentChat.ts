import {computed, nextTick, onBeforeUnmount, ref, watch, type Ref} from "vue";
import type {AgentInvocationSnapshot, AgentSessionSnapshot} from "#shared/agent-harness";
import type {AgentSessionConnected, AgentSessionEvent} from "#shared/agent-harness";
import type TextPanel from "../components/TextPanel.vue";
import type {RepairPlan} from "../utils/repair-draft";
import {resolveApiErrorMessage} from "../utils/api-error";
import {useLlmlintI18n} from "./useLlmlintI18n";
import {useNotification} from "./useNotification";
import {applyAgentEvent, messagesFromSnapshot, type AgentChatMessage} from "../utils/agent-chat-projection";

type TextPanelInstance = InstanceType<typeof TextPanel>;

export type AgentSelection = {from: number; to: number; text: string; contextBefore: string; contextAfter: string};

export type AgentChatOptions = {
    panel: Ref<TextPanelInstance | null>;
    editDraft: Ref<string>;
    sessionId: Ref<string | null>;
    editorActive: () => boolean;
};

/**
 * 持久化 Agent Chat 的前端投影 Module。
 * snapshot 是恢复真相源，SSE 只触发增量刷新；所有改写结果仍经 TextPanel diff 审阅进入草稿。
 */
export function useAgentChat(options: AgentChatOptions) {
    const {t} = useLlmlintI18n();
    const notification = useNotification();
    const snapshot = ref<AgentSessionSnapshot | null>(null);
    const messages = ref<AgentChatMessage[]>([]);
    const connectionStatus = ref<"idle" | "connecting" | "connected" | "reconnecting" | "recovering" | "disconnected">("idle");
    const runPhase = ref<"idle" | "model_pending" | "assistant_streaming" | "tool_running" | "finishing">("idle");
    const loading = ref(false);
    const selection = ref<AgentSelection | null>(null);
    const composerPrefill = ref("");
    const composerVersion = ref(0);
    const unavailable = ref<string | null>(null);
    const stale = ref<{rewritten: string; planSnapshot: RepairPlan} | null>(null);
    const llmReviewOpen = ref(false);
    const llmVisitedIds = ref(new Set<string>());
    const handledInvocations = new Set<string>();
    const initializedSessions = new Set<string>();
    const invocationPlans = new Map<string, RepairPlan>();
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let eventEpoch: string | null = null;
    let lastSeq = 0;
    const liveInvocationId = ref<string | null>(null);
    let refreshGeneration = 0;

    const running = computed(() => liveInvocationId.value !== null || snapshot.value?.status === "aborting");
    const llmDiffs = computed(() => options.panel.value?.getLlmDiffs() ?? []);
    const llmVisitedCount = computed(() => llmDiffs.value.filter((diff) => llmVisitedIds.value.has(diff.id)).length);
    const latestRetryable = computed(() => snapshot.value?.invocations.findLast((item) => ["failed", "aborted", "interrupted"].includes(item.status)) ?? null);

    watch(() => options.panel.value?.getActiveDiffId() ?? null, (id) => {
        if (id && llmDiffs.value.some((diff) => diff.id === id) && !llmVisitedIds.value.has(id)) {
            llmVisitedIds.value = new Set([...llmVisitedIds.value, id]);
        }
    });
    watch(() => llmDiffs.value.length, (count) => {
        if (count === 0) llmReviewOpen.value = false;
    });

    /** 拉取完整 snapshot，并吸收尚未处理的 optimize 终态结果。 */
    async function refresh(): Promise<void> {
        const id = options.sessionId.value;
        if (!id) {
            snapshot.value = null;
            return;
        }
        const generation = refreshGeneration;
        try {
            const next = await $fetch<AgentSessionSnapshot>(`/api/agent/sessions/${id}`);
            if (generation !== refreshGeneration || id !== options.sessionId.value) return;
            snapshot.value = next;
            messages.value = messagesFromSnapshot(next);
            eventEpoch = next.eventCursor.eventEpoch;
            lastSeq = next.eventCursor.after;
            liveInvocationId.value = next.activeInvocation?.id ?? null;
            runPhase.value = liveInvocationId.value ? "model_pending" : "idle";
            unavailable.value = null;
            // 页面刷新恢复只展示历史，不把已完成的旧改写再次并入当前草稿。
            if (!initializedSessions.has(id)) {
                for (const invocation of next.invocations) {
                    if (invocation.phase === "optimize" && invocation.result) handledInvocations.add(invocation.id);
                }
                initializedSessions.add(id);
            }
            await absorbResults(next.invocations);
        } catch (error) {
            if (generation === refreshGeneration) unavailable.value = resolveApiErrorMessage(error, "Agent session 加载失败");
        }
    }

    /** terminal optimize 的完整/部分结果只吸收一次；草稿已变化时进入既有 stale 决策。 */
    async function absorbResults(invocations: AgentInvocationSnapshot[]): Promise<void> {
        for (const invocation of invocations) {
            if (invocation.phase !== "optimize" || !invocation.result || handledInvocations.has(invocation.id)) continue;
            handledInvocations.add(invocation.id);
            const panel = options.panel.value;
            if (!panel || invocation.result.edits.length === 0) continue;
            if (options.editDraft.value === invocation.input.body) {
                mergeRewrite(invocation.result.body);
            } else {
                stale.value = {rewritten: invocation.result.body, planSnapshot: invocationPlans.get(invocation.id) ?? panel.getRepairPlan()};
            }
            invocationPlans.delete(invocation.id);
            if (invocation.status === "aborted") notification.info("Agent 已取消，已完成的修改已进入 diff 审阅");
        }
    }

    /** 连接 NeuroBook 风格 cursor SSE；正常增量只走 reducer，不再逐事件 GET snapshot。 */
    function connect(): void {
        source?.close();
        source = null;
        const id = options.sessionId.value;
        if (!id || !import.meta.client) return;
        connectionStatus.value = connectionStatus.value === "idle" ? "connecting" : "reconnecting";
        const query = new URLSearchParams({after: String(lastSeq)});
        if (eventEpoch) query.set("eventEpoch", eventEpoch);
        source = new EventSource(`/api/agent/sessions/${id}/events?${query.toString()}`);
        source.addEventListener("connected", (raw) => {
            const connected = JSON.parse((raw as MessageEvent).data) as AgentSessionConnected;
            connectionStatus.value = "connected";
            if (connected.snapshotRequired || (eventEpoch !== null && connected.eventEpoch !== eventEpoch)) void recoverStream();
            else eventEpoch = connected.eventEpoch;
        });
        source.addEventListener("agent_event", (raw) => {
            const event = JSON.parse((raw as MessageEvent).data) as AgentSessionEvent;
            if (event.seq <= lastSeq) return;
            if (eventEpoch !== event.eventEpoch || event.seq !== lastSeq + 1) {
                void recoverStream();
                return;
            }
            lastSeq = event.seq;
            messages.value = applyAgentEvent(messages.value, event);
            projectRunState(event);
        });
        source.onerror = () => {
            source?.close();
            source = null;
            connectionStatus.value = "reconnecting";
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(connect, 800);
        };
    }

    async function recoverStream(): Promise<void> {
        if (connectionStatus.value === "recovering") return;
        connectionStatus.value = "recovering";
        source?.close();
        source = null;
        await refresh();
        connect();
    }

    function projectRunState(envelope: AgentSessionEvent): void {
        if (envelope.kind === "session") {
            if (envelope.event.type === "status" && envelope.event.status === "running") liveInvocationId.value = envelope.event.invocationId ?? liveInvocationId.value;
            if (envelope.event.type === "status" && envelope.event.status === "aborting") runPhase.value = "finishing";
            return;
        }
        const event = envelope.event;
        if (event.type === "agent_start") {
            liveInvocationId.value = envelope.invocationId ?? liveInvocationId.value;
            runPhase.value = "model_pending";
        } else if (event.type === "turn_start") runPhase.value = "model_pending";
        else if (event.type === "message_start" || event.type === "message_update") runPhase.value = "assistant_streaming";
        else if (event.type === "tool_execution_start") runPhase.value = "tool_running";
        else if (event.type === "tool_execution_end" || event.type === "turn_end") runPhase.value = "finishing";
        else if (event.type === "agent_end") {
            liveInvocationId.value = null;
            runPhase.value = "idle";
            void refresh(); // terminal result/diff 只在此处补一次 snapshot
        }
    }

    watch(options.sessionId, () => {
        refreshGeneration += 1;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        eventEpoch = null;
        lastSeq = 0;
        liveInvocationId.value = null;
        snapshot.value = null;
        messages.value = [];
        selection.value = null;
        composerPrefill.value = "";
        void (async () => {
            await refresh();
            connect();
        })();
    }, {immediate: true});
    onBeforeUnmount(() => {
        source?.close();
        if (reconnectTimer) clearTimeout(reconnectTimer);
    });

    /** 发送整篇或选区改写要求；运行中由前后端共同拒绝。 */
    async function send(message: string): Promise<void> {
        const id = options.sessionId.value;
        const panel = options.panel.value;
        if (!id || !panel || !options.editorActive() || running.value || !message.trim()) return;
        loading.value = true;
        try {
            const attached = selection.value;
            const planSnapshot = panel.getRepairPlan();
            const response = await $fetch<{invocationId: string}>(`/api/agent/sessions/${id}/invoke`, {
                method: "POST",
                body: {
                    mode: "prompt",
                    phase: "optimize",
                    message: message.trim(),
                    body: options.editDraft.value,
                    selection: attached ? {from: attached.from, to: attached.to, text: attached.text} : undefined,
                },
            });
            invocationPlans.set(response.invocationId, planSnapshot);
            selection.value = null;
            composerPrefill.value = "";
            await refresh();
        } catch (error) {
            notification.error(resolveApiErrorMessage(error, "Agent 改写启动失败"));
        } finally {
            loading.value = false;
        }
    }

    /** 工具栏“一键修到底”仍可直接发起一个默认 Chat invocation。 */
    async function startFull(): Promise<void> {
        await send("优化全文，降低明显的 AI 写作痕迹，保持原意、叙事信息和人物语气。逐处修改并说明理由。");
    }

    /** 选区入口只切入 Chat 并预填，不自动发送。 */
    function prepareSelection(request: AgentSelection): void {
        selection.value = request;
        composerPrefill.value = "优化这段文字，保持原意和上下文衔接";
        composerVersion.value += 1;
    }

    async function abort(): Promise<void> {
        const id = options.sessionId.value;
        if (!id || !running.value) return;
        try {
            await $fetch(`/api/agent/sessions/${id}/abort`, {method: "POST"});
            await refresh();
        } catch (error) {
            notification.error(resolveApiErrorMessage(error, "取消 Agent 失败"));
        }
    }

    async function retry(): Promise<void> {
        const id = options.sessionId.value;
        const retryable = latestRetryable.value;
        if (!id || running.value || !retryable) return;
        if (retryable.phase === "optimize" && options.editDraft.value !== retryable.input.body) {
            notification.error("当前草稿已不同于失败 invocation 的输入快照，请直接发送一条新消息重新校准正文。");
            return;
        }
        try {
            const response = await $fetch<{invocationId: string}>(`/api/agent/sessions/${id}/retry`, {method: "POST"});
            if (retryable.phase === "optimize" && options.panel.value) invocationPlans.set(response.invocationId, options.panel.value.getRepairPlan());
            await refresh();
        } catch (error) {
            notification.error(resolveApiErrorMessage(error, "重试 Agent 失败"));
        }
    }

    function mergeRewrite(rewritten: string): void {
        const count = options.panel.value?.applyLlmRewrite(rewritten, t("contribute.llmFixDiffTitle")) ?? 0;
        if (count === 0) {
            notification.info(t("contribute.llmFixNoChanges"));
            return;
        }
        llmVisitedIds.value = new Set<string>();
        llmReviewOpen.value = true;
        void nextTick(() => options.panel.value?.navigateLlmDiff("next"));
    }

    function applyStale(): void {
        const value = stale.value;
        if (!value || !options.panel.value) return;
        options.panel.value.restoreRepairPlan(value.planSnapshot);
        mergeRewrite(value.rewritten);
        stale.value = null;
    }

    function discardStale(): void {
        if (!stale.value) return;
        stale.value = null;
        notification.info(t("contribute.llmFixDiscarded"));
    }

    function onLlmReviewNavigate(direction: "previous" | "next"): void {
        options.panel.value?.navigateLlmDiff(direction);
    }

    function onLlmReviewReject(): void {
        const panel = options.panel.value;
        if (panel && panel.rejectActiveLlmDiff() === null) panel.navigateLlmDiff("next");
    }

    function resetReviewState(): void {
        stale.value = null;
        llmReviewOpen.value = false;
        llmVisitedIds.value = new Set<string>();
    }

    function abandonAll(): void {
        refreshGeneration += 1;
        source?.close();
        source = null;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        snapshot.value = null;
        messages.value = [];
        selection.value = null;
        resetReviewState();
    }

    return {
        snapshot, messages, running, loading, unavailable, selection, composerPrefill, composerVersion, latestRetryable, connectionStatus, runPhase,
        stale, llmReviewOpen, llmDiffs, llmVisitedCount,
        refresh, send, startFull, prepareSelection, abort, retry, applyStale, discardStale,
        onLlmReviewNavigate, onLlmReviewReject, resetReviewState, abandonAll,
    };
}
