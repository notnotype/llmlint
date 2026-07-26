<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, ref, watch} from "vue";
import type {AgentInvocationSnapshot, AgentSessionSnapshot} from "#shared/agent-harness";
import type {AgentChatMessage} from "../../utils/agent-chat-projection";
import {buildAgentFlowNodes, invocationErrorMessage, invocationPresentation} from "../../utils/agent-chat-flow";
import {useLlmlintI18n} from "../../composables/useLlmlintI18n";
import AgentMarkdownContent from "./AgentMarkdownContent.vue";
import AgentToolNode from "./AgentToolNode.vue";

const AUTO_SCROLL_THRESHOLD = 12;

const props = defineProps<{
    snapshot: AgentSessionSnapshot | null;
    messages: AgentChatMessage[];
    loading: boolean;
    unavailable: string | null;
}>();

const {t} = useLlmlintI18n();
const scrollRef = ref<HTMLDivElement | null>(null);
const stickToBottom = ref(true);
let scrollFrame: number | null = null;
let immediateScroll = true;
const nodes = computed(() => buildAgentFlowNodes(props.messages, props.snapshot?.invocations ?? []));
const scrollSignature = computed(() => {
    const last = props.messages.at(-1);
    const tool = last?.tools?.at(-1);
    const invocation = props.snapshot?.invocations.at(-1);
    return [props.snapshot?.sessionId, props.messages.length, last?.id, last?.content.length, last?.thinking?.length, last?.status, tool?.status, tool?.result?.length, invocation?.status, invocation?.turns].join(":");
});

/** 合并流式更新产生的滚动请求，避免每个 token 都触发布局读写。 */
function scheduleScroll(): void {
    if (scrollFrame !== null) return;
    if (typeof requestAnimationFrame !== "function") {
        scrollToBottom();
        return;
    }
    scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null;
        if (stickToBottom.value) scrollToBottom();
    });
}

function scrollToBottom(): void {
    if (!scrollRef.value) return;
    scrollRef.value.scrollTop = scrollRef.value.scrollHeight;
}

function onScroll(): void {
    const element = scrollRef.value;
    if (!element) return;
    stickToBottom.value = element.scrollHeight - element.scrollTop - element.clientHeight <= AUTO_SCROLL_THRESHOLD;
}

watch(scrollSignature, async () => {
    await nextTick();
    if (!stickToBottom.value) return;
    if (immediateScroll) {
        immediateScroll = false;
        scrollToBottom();
        return;
    }
    scheduleScroll();
}, {immediate: true});

watch(() => props.snapshot?.sessionId, () => {
    immediateScroll = true;
    stickToBottom.value = true;
});

onBeforeUnmount(() => {
    if (scrollFrame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(scrollFrame);
});

function phaseLabel(invocation: AgentInvocationSnapshot): string {
    return invocation.phase === "analysis" ? t("contribute.agentInvocationAnalysis") : t("contribute.agentInvocationOptimize");
}

function statusLabel(invocation: AgentInvocationSnapshot): string {
    const status = invocationPresentation(invocation).status;
    if (status === "running") return t("contribute.agentInvocationRunning");
    if (status === "waiting") return t("contribute.agentInvocationWaiting");
    if (status === "failed") return t("contribute.agentInvocationFailed");
    if (status === "aborted") return t("contribute.agentInvocationAborted");
    if (status === "interrupted") return t("contribute.agentInvocationInterrupted");
    return status === "partial" ? t("contribute.agentInvocationPartial") : t("contribute.agentInvocationCompleted");
}

function invocationStatusClass(invocation: AgentInvocationSnapshot): string {
    const tone = invocationPresentation(invocation).tone;
    if (tone === "danger") return "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-text)]";
    if (tone === "warning") return "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-text)]";
    if (tone === "success") return "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-text)]";
    return "border-[var(--border-color)] bg-[var(--bg-subtle)] text-[var(--text-muted)]";
}

function confidenceLabel(value: number): string {
    return `${Math.round(value * 100)}%`;
}
</script>

<template>
    <!-- Agent Chat Flow：durable Invocation 分段 + 扁平 message/tool/edit/report 节点。 -->
    <div ref="scrollRef" class="min-h-0 flex-1 overflow-y-auto bg-[var(--bg-panel)] px-3 py-4" @scroll="onScroll">
        <div v-if="props.unavailable" class="mx-auto mt-8 max-w-sm rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] p-4 text-sm text-[var(--danger-text)]">
            <div class="flex items-center gap-2 font-medium"><span class="i-lucide-circle-alert h-4 w-4" />{{ t("contribute.agentUnavailableTitle") }}</div>
            <p class="mt-2 text-xs leading-relaxed">{{ props.unavailable }}</p>
        </div>
        <div v-else-if="props.loading && !props.snapshot" class="flex h-full min-h-52 flex-col items-center justify-center gap-3 text-center text-xs text-[var(--text-muted)]">
            <span class="i-lucide-loader-circle h-5 w-5 animate-spin" />
            <span>{{ t("contribute.agentChatLoading") }}</span>
        </div>
        <div v-else-if="nodes.length === 0" class="flex h-full min-h-64 flex-col items-center justify-center px-5 text-center">
            <div class="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--bg-input)] shadow-sm"><span class="i-lucide-bot h-6 w-6 text-[var(--text-muted)]" /></div>
            <h3 class="mt-4 text-sm font-medium text-[var(--text-main)]">{{ t("contribute.agentEmptyTitle") }}</h3>
            <p class="mt-2 max-w-sm text-xs leading-relaxed text-[var(--text-muted)]">{{ t("contribute.agentEmptyDescription") }}</p>
        </div>
        <div v-else class="mx-auto grid w-full max-w-3xl gap-3">
            <template v-for="node in nodes" :key="node.id">
                <!-- Invocation 分隔与终态。 -->
                <div v-if="node.kind === 'invocation'" class="mt-3 grid gap-1 first:mt-0">
                    <div class="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                        <span class="h-px flex-1 bg-[var(--border-color)]" />
                        <span :class="node.invocation.phase === 'analysis' ? 'i-lucide-scan-search' : 'i-lucide-wand-sparkles'" class="h-3 w-3" />
                        <span>{{ phaseLabel(node.invocation) }}</span>
                        <span>{{ t("contribute.agentInvocationTurns", {count: node.invocation.turns}) }}</span>
                        <span class="rounded-full border px-1.5 py-0.5 normal-case tracking-normal" :class="invocationStatusClass(node.invocation)">{{ statusLabel(node.invocation) }}</span>
                        <span class="h-px flex-1 bg-[var(--border-color)]" />
                    </div>
                    <div v-if="node.invocation.error" class="mx-5 rounded-md bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger-text)]">{{ invocationErrorMessage(node.invocation.error) }}</div>
                </div>

                <!-- System Prompt：完整保留但默认折叠，避免长提示词淹没对话。 -->
                <details v-else-if="node.kind === 'message' && node.message.type === 'system'" class="group mx-5 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-subtle)] text-xs">
                    <summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 font-medium text-[var(--accent-text)]">
                        <span class="i-lucide-shield-check h-3.5 w-3.5" />
                        <span>{{ t("contribute.agentChatSystem") }}</span>
                        <span class="flex-1" />
                        <span class="i-lucide-chevron-right h-3 w-3 transition-transform group-open:rotate-90" />
                    </summary>
                    <div class="border-t border-[var(--border-color)] px-3 py-2.5 whitespace-pre-wrap leading-relaxed text-[var(--text-secondary)]">{{ node.message.content }}</div>
                </details>

                <!-- 内部模型输入与真实用户输入使用不同事实标签，避免两个气泡都显示成“你”。 -->
                <div v-else-if="node.kind === 'message' && node.message.type === 'user' && node.message.source === 'model_input'" class="mx-5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-subtle)] px-3.5 py-2.5 text-xs text-[var(--text-secondary)]">
                    <div class="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]"><span class="i-lucide-message-square-code h-3 w-3" />{{ t("contribute.agentChatModelInput") }}</div>
                    <div class="whitespace-pre-wrap leading-relaxed">{{ node.message.content }}</div>
                </div>
                <div v-else-if="node.kind === 'message' && node.message.type === 'user'" class="ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-[var(--accent-bg)] px-3.5 py-2.5 text-sm text-[var(--text-main)]">
                    <div class="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--accent-text)]">{{ t("contribute.agentChatYou") }}</div>
                    <div class="whitespace-pre-wrap leading-relaxed">{{ node.message.content }}</div>
                </div>
                <div v-else-if="node.kind === 'message' && node.message.type === 'assistant'" class="grid gap-2">
                    <div class="flex items-center gap-2 pl-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                        <span class="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--accent-main)] bg-[var(--accent-bg)]"><span class="i-lucide-bot h-3 w-3 text-[var(--accent-text)]" /></span>
                        <span>Agent</span>
                        <span v-if="node.message.status === 'streaming'" class="i-lucide-loader-circle h-3 w-3 animate-spin" />
                    </div>
                    <details v-if="node.message.thinking" class="group ml-5 text-xs text-[var(--text-muted)]">
                        <summary class="flex cursor-pointer list-none items-center gap-1.5 py-1 hover:text-[var(--text-main)]"><span class="i-lucide-chevron-right h-3 w-3 transition-transform group-open:rotate-90" /><span class="i-lucide-brain-circuit h-3 w-3" />{{ t("contribute.agentThinking") }}</summary>
                        <div class="mt-1 border-l border-[var(--border-color)] pl-3 leading-relaxed"><AgentMarkdownContent :content="node.message.thinking" /></div>
                    </details>
                    <div v-if="node.message.content" class="mr-4 rounded-2xl rounded-bl-md border border-[var(--border-color)] bg-[var(--bg-input)] px-4 py-3 text-sm leading-relaxed text-[var(--text-main)] shadow-sm">
                        <AgentMarkdownContent :content="node.message.content" />
                    </div>
                </div>
                <div v-else-if="node.kind === 'message'" class="mx-5 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2.5 text-xs text-[var(--danger-text)]">{{ node.message.content }}</div>

                <AgentToolNode v-else-if="node.kind === 'tool'" :tool="node.tool" />

                <!-- 同一 Invocation 的连续修改压成一个可展开节点。 -->
                <details v-else-if="node.kind === 'edits'" class="group ml-5 overflow-hidden rounded-xl border border-[var(--success-border)] bg-[var(--success-bg)] text-xs" :open="node.edits.length <= 3">
                    <summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[var(--success-text)] hover:brightness-95">
                        <span class="i-lucide-pencil-line h-3.5 w-3.5" />
                        <span class="font-medium">{{ t("contribute.agentEditsCount", {count: node.edits.length}) }}</span>
                        <span class="flex-1" />
                        <span class="i-lucide-chevron-right h-3 w-3 transition-transform group-open:rotate-90" />
                    </summary>
                    <div class="grid gap-3 border-t border-[var(--success-border)] bg-[var(--bg-panel)] p-3">
                        <div v-for="(edit, index) in node.edits" :key="`${node.id}:${index}`" class="grid gap-1 rounded-lg bg-[var(--bg-subtle)] p-2.5">
                            <div class="text-[10px] font-medium text-[var(--text-muted)]">#{{ index + 1 }}</div>
                            <div class="whitespace-pre-wrap text-[var(--danger-text)] line-through">{{ edit.oldText }}</div>
                            <div class="whitespace-pre-wrap text-[var(--success-text)]">{{ edit.newText }}</div>
                            <div v-if="edit.reason" class="mt-1 text-[var(--text-muted)]">{{ edit.reason }}</div>
                        </div>
                    </div>
                </details>

                <!-- Analysis 业务投影。 -->
                <div v-else-if="node.kind === 'report'" class="ml-5 grid gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] p-3.5 text-xs shadow-sm">
                    <div class="flex items-center gap-2"><span class="i-lucide-clipboard-check h-4 w-4 text-[var(--accent-text)]" /><span class="font-medium text-[var(--text-main)]">{{ t("contribute.agentChatReport") }}</span></div>
                    <p class="text-sm leading-relaxed text-[var(--text-main)]">{{ node.message.content }}</p>
                    <div v-if="node.message.report" class="flex flex-wrap gap-2 text-[10px]">
                        <span class="rounded-full bg-[var(--bg-subtle)] px-2 py-1 text-[var(--text-secondary)]">{{ t("contribute.agentReportScore", {score: node.message.report.score}) }}</span>
                        <span class="rounded-full bg-[var(--bg-subtle)] px-2 py-1 text-[var(--text-secondary)]">{{ t("contribute.agentReportConfidence", {value: confidenceLabel(node.message.report.confidence)}) }}</span>
                    </div>
                    <div v-if="node.message.report?.suggestions.length" class="grid gap-1.5">
                        <span class="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{{ t("contribute.agentReportSuggestions") }}</span>
                        <ul class="grid list-disc gap-1 pl-4 text-[var(--text-secondary)]"><li v-for="suggestion in node.message.report.suggestions" :key="suggestion">{{ suggestion }}</li></ul>
                    </div>
                </div>
            </template>
        </div>
    </div>
</template>
