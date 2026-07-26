import {computed, nextTick, onBeforeUnmount, ref, watch, type Ref} from "vue";
import type {AgentInvocationSnapshot, AgentSessionSnapshot} from "#shared/agent-harness";
import type {AgentSessionConnected, AgentSessionEvent} from "#shared/agent-harness";
import type TextPanel from "../components/TextPanel.vue";
import type {RepairPlan} from "../utils/repair-draft";
import {resolveApiErrorMessage} from "../utils/api-error";
import {useLlmlintI18n} from "./useLlmlintI18n";
import {useNotification} from "./useNotification";
import {applyAgentEvent, messagesFromSnapshot, type AgentChatMessage} from "../utils/agent-chat-projection";
import {latestRetryableInvocation} from "../utils/agent-chat-flow";
import {ONE_CLICK_FIX_INSTRUCTION} from "../utils/agent-one-click-fix";
import {abortNeedsRecovery, type AgentAbortResponse} from "../utils/agent-abort-state";

type TextPanelInstance = InstanceType<typeof TextPanel>;

export type AgentSelection = {from: number; to: number; text: string; contextBefore: string; contextAfter: string};

export type AgentChatOptions = {
    panel: Ref<TextPanelInstance | null>;
    editDraft: Ref<string>;
    sessionId: Ref<string | null>;
    revisionId: Ref<string | null>;
    editorActive: () => boolean;
    /** 一键风险润色启动前，由宿主同步应用当前 fixability:auto 静态修复。 */
    applyOneClickAutoFixes: () => void;
    /** terminal 或 snapshot 恢复终态时通知宿主刷新业务投影。 */
    onTerminal?: (invocation: AgentInvocationSnapshot) => Promise<void>;
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
    const workspaceBodies = new Map<string, string>();
    const liveAppliedInvocations = new Set<string>();
    const staleInvocations = new Set<string>();
    const observedTerminalInvocations = new Set<string>();
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let eventEpoch: string | null = null;
    let lastSeq = 0;
    const liveInvocationId = ref<string | null>(null);
    const abortRequested = ref(false);
    let refreshGeneration = 0;

    const running = computed(() => liveInvocationId.value !== null || abortRequested.value || snapshot.value?.status === "aborting");
    const aborting = computed(() => abortRequested.value);
    const llmDiffs = computed(() => options.panel.value?.getLlmDiffs() ?? []);
    const llmVisitedCount = computed(() => llmDiffs.value.filter((diff) => llmVisitedIds.value.has(diff.id)).length);
    const latestRetryable = computed(() => latestRetryableInvocation(snapshot.value?.invocations ?? []));

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
            if (!liveInvocationId.value) abortRequested.value = false;
            runPhase.value = liveInvocationId.value ? "model_pending" : "idle";
            unavailable.value = null;
            // 页面刷新恢复只展示历史，不把已完成的旧改写再次并入当前草稿。
            if (!initializedSessions.has(id)) {
                for (const invocation of next.invocations) {
                    if (invocation.phase === "optimize" && invocation.result) handledInvocations.add(invocation.id);
                }
                initializedSessions.add(id);
            }
            if (next.activeWorkspace) applyWorkspace(next.activeWorkspace.invocationId, next.activeWorkspace.body, next);
            await absorbResults(next.invocations);
            await notifyTerminals(next.invocations);
        } catch (error) {
            if (generation === refreshGeneration) unavailable.value = resolveApiErrorMessage(error, "Agent session 加载失败");
        }
    }

    /** terminal optimize 的完整/部分结果只吸收一次；草稿已变化时进入既有 stale 决策。 */
    async function absorbResults(invocations: AgentInvocationSnapshot[]): Promise<void> {
        for (const invocation of invocations) {
            if (invocation.phase !== "optimize" || invocation.input.phase !== "optimize" || !invocation.result || handledInvocations.has(invocation.id)) continue;
            handledInvocations.add(invocation.id);
            const panel = options.panel.value;
            if (!panel || invocation.result.edits.length === 0) continue;
            if (liveAppliedInvocations.has(invocation.id)) {
                invocationPlans.delete(invocation.id);
                workspaceBodies.delete(invocation.id);
                notifyOptimizeTerminal(invocation);
                continue;
            }
            if (options.editDraft.value === invocation.input.body) {
                mergeRewrite(invocation.result.body);
            } else {
                stale.value = {rewritten: invocation.result.body, planSnapshot: invocationPlans.get(invocation.id) ?? panel.getRepairPlan()};
            }
            invocationPlans.delete(invocation.id);
            notifyOptimizeTerminal(invocation);
        }
    }

    /** 每个 optimize 终态只随 absorbResults 反馈一次，不随每条 workspace 刷屏。 */
    function notifyOptimizeTerminal(invocation: AgentInvocationSnapshot): void {
        if (invocation.status === "completed") {
            notification.success(invocation.result?.partial ? "Agent 已部分完成，修改已进入 diff 审阅" : "Agent 已完成，修改已进入 diff 审阅");
        } else if (invocation.status === "aborted") {
            notification.info("Agent 已取消，已完成的修改已保留在 diff 审阅中");
        } else if (invocation.status === "failed") {
            notification.notify({message: "Agent 运行失败，已完成的修改已保留在 diff 审阅中", tone: "warning"});
        }
    }

    /** durable workspace 必须严格衔接上一份正文；发现草稿漂移即停止覆盖并进入 stale。 */
    function applyWorkspace(invocationId: string, body: string, currentSnapshot = snapshot.value): void {
        if (staleInvocations.has(invocationId)) return;
        const invocation = currentSnapshot?.invocations.find((item) => item.id === invocationId)
            ?? (currentSnapshot?.activeInvocation?.id === invocationId ? currentSnapshot.activeInvocation : null);
        if (!invocation || invocation.phase !== "optimize" || invocation.input.phase !== "optimize") return;
        const panel = options.panel.value;
        if (!panel) return;
        const expected = workspaceBodies.get(invocationId) ?? invocation.input.body;
        if (options.editDraft.value !== expected) {
            staleInvocations.add(invocationId);
            stale.value = {rewritten: body, planSnapshot: invocationPlans.get(invocationId) ?? panel.getRepairPlan()};
            return;
        }
        panel.applyAgentWorkspace(body, t("contribute.llmFixDiffTitle"));
        workspaceBodies.set(invocationId, body);
        liveAppliedInvocations.add(invocationId);
        llmVisitedIds.value = new Set<string>();
        llmReviewOpen.value = panel.getLlmDiffs().length > 0;
    }

    /** invocation ID 级幂等 terminal 通知，覆盖 live SSE 丢失后的 snapshot 恢复。 */
    async function notifyTerminals(invocations: AgentInvocationSnapshot[]): Promise<void> {
        for (const invocation of invocations) {
            if (!invocation.finishedAt || observedTerminalInvocations.has(invocation.id)) continue;
            observedTerminalInvocations.add(invocation.id);
            await options.onTerminal?.(invocation);
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
            if (event.kind === "session" && event.event.type === "workspace") {
                applyWorkspace(event.event.invocationId, event.event.body);
            }
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
            abortRequested.value = false;
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
        abortRequested.value = false;
        snapshot.value = null;
        messages.value = [];
        selection.value = null;
        workspaceBodies.clear();
        liveAppliedInvocations.clear();
        staleInvocations.clear();
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

    /** 按显式 scope 发送 optimize，避免全文动作意外继承 Composer 残留选区。 */
    async function invokeOptimize(message: string, intent: {objective?: "polish_ai_risk"; selection: AgentSelection | null; applyAutoFixes: boolean}): Promise<void> {
        const id = options.sessionId.value;
        const revisionId = options.revisionId.value;
        const panel = options.panel.value;
        if (!id || !revisionId || !panel || !options.editorActive() || running.value || !message.trim()) return;
        loading.value = true;
        try {
            const attached = intent.selection;
            if (intent.applyAutoFixes) options.applyOneClickAutoFixes();
            const planSnapshot = panel.getRepairPlan();
            const response = await $fetch<{invocationId: string}>(`/api/agent/sessions/${id}/invoke`, {
                method: "POST",
                body: {
                    mode: "prompt",
                    phase: "optimize",
                    revisionId,
                    ...(intent.objective ? {objective: intent.objective} : {}),
                    message: message.trim(),
                    body: options.editDraft.value,
                    ...(attached ? {selection: {from: attached.from, to: attached.to, text: attached.text}} : {}),
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

    /** 发送普通整篇或选区改写要求；运行中由前后端共同拒绝。 */
    async function send(message: string): Promise<void> {
        await invokeOptimize(message, {selection: selection.value, applyAutoFixes: false});
    }

    /** 工具栏“一键修到底”声明全文风险润色目标，绝不携带 Composer 残留选区。 */
    async function startFull(): Promise<void> {
        await invokeOptimize(ONE_CLICK_FIX_INSTRUCTION, {objective: "polish_ai_risk", selection: null, applyAutoFixes: true});
    }

    /** 选区入口只切入 Chat 并预填，不自动发送。 */
    function prepareSelection(request: AgentSelection): void {
        selection.value = request;
        composerPrefill.value = "优化这段文字，保持原意和上下文衔接";
        composerVersion.value += 1;
    }

    /** 在当前 head Session 中为指定 Revision 启动新的 Analysis Invocation。 */
    async function startAnalysis(revisionId: string): Promise<void> {
        const id = options.sessionId.value;
        if (!id || !revisionId || running.value) return;
        loading.value = true;
        try {
            await $fetch(`/api/agent/sessions/${id}/invoke`, {method: "POST", body: {mode: "prompt", phase: "analysis", revisionId}});
            await refresh();
        } catch (error) {
            notification.error(resolveApiErrorMessage(error, "LLM Agent 重试失败"));
        } finally {
            loading.value = false;
        }
    }

    /** 发送绑定 Invocation ID 的幂等取消请求。 */
    async function requestAbort(id: string, invocationId: string): Promise<void> {
        if (abortRequested.value) return;
        abortRequested.value = true;
        runPhase.value = "finishing";
        try {
            const response = await $fetch<AgentAbortResponse>(`/api/agent/sessions/${id}/abort`, {method: "POST", body: {invocationId}});
            if (abortNeedsRecovery(response)) await refresh();
        } catch (error) {
            abortRequested.value = false;
            notification.error(resolveApiErrorMessage(error, "取消 Agent 失败"));
        }
    }

    async function abort(): Promise<void> {
        const id = options.sessionId.value;
        const invocationId = liveInvocationId.value ?? snapshot.value?.activeInvocation?.id ?? null;
        if (!id || !invocationId) return;
        await requestAbort(id, invocationId);
    }

    /** 历史恢复时重新读取 durable 状态，并主动终止该 Session 当前运行。 */
    async function abortRestored(): Promise<void> {
        const id = options.sessionId.value;
        if (!id) return;
        await refresh();
        const active = snapshot.value?.activeInvocation;
        if (!active) return;
        await requestAbort(id, active.id);
    }

    /** 只取消与报告卡 Revision 匹配的 Analysis，绝不误伤当前 Optimize。 */
    async function abortAnalysis(revisionId: string): Promise<void> {
        const id = options.sessionId.value;
        if (!id || !revisionId) return;
        await refresh();
        const active = snapshot.value?.activeInvocation;
        if (!active || active.phase !== "analysis" || active.input.phase !== "analysis" || active.input.revisionId !== revisionId) return;
        await requestAbort(id, active.id);
    }

    async function retry(): Promise<void> {
        const id = options.sessionId.value;
        const retryable = latestRetryable.value;
        if (!id || running.value || !retryable) return;
        if (retryable.input.phase === "optimize" && options.editDraft.value !== retryable.input.body) {
            notification.error("当前草稿已不同于失败 invocation 的输入快照，请直接发送一条新消息重新校准正文。");
            return;
        }
        try {
            const response = await $fetch<{invocationId: string}>(`/api/agent/sessions/${id}/retry`, {method: "POST"});
            if (retryable.input.phase === "optimize" && options.panel.value) invocationPlans.set(response.invocationId, options.panel.value.getRepairPlan());
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
        liveInvocationId.value = null;
        abortRequested.value = false;
        runPhase.value = "idle";
        snapshot.value = null;
        messages.value = [];
        selection.value = null;
        workspaceBodies.clear();
        liveAppliedInvocations.clear();
        staleInvocations.clear();
        resetReviewState();
    }

    return {
        snapshot, messages, running, aborting, loading, unavailable, selection, composerPrefill, composerVersion, latestRetryable, connectionStatus, runPhase,
        stale, llmReviewOpen, llmDiffs, llmVisitedCount,
        refresh, send, startFull, prepareSelection, startAnalysis, abort, abortRestored, abortAnalysis, retry, applyStale, discardStale,
        onLlmReviewNavigate, onLlmReviewReject, resetReviewState, abandonAll,
    };
}
