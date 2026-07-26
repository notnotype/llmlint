<script setup lang="ts">
import {computed} from "vue";
import type {AgentChatTool} from "../../utils/agent-chat-projection";
import {toolPresentation, type AgentToolPresentation} from "../../utils/agent-chat-flow";
import {useLlmlintI18n} from "../../composables/useLlmlintI18n";
import AgentMarkdownContent from "./AgentMarkdownContent.vue";

const props = defineProps<{
    tool: AgentChatTool;
}>();

const {t} = useLlmlintI18n();
const presentation = computed(() => toolPresentation(props.tool));
const running = computed(() => props.tool.status === "running" || props.tool.status === "streaming");
const hasArgs = computed(() => props.tool.args.trim() !== "" && props.tool.args.trim() !== "{}");
const summary = computed(() => presentation.value.summary);

/** 将稳定工具种类映射为本地化文案，未知工具保留 provider 名称。 */
function toolLabel(value: AgentToolPresentation): string {
    if (value.kind === "read") return t("contribute.agentToolRead");
    if (value.kind === "edit") return t("contribute.agentToolEdit");
    if (value.kind === "lint_check") return t("contribute.agentToolLintCheck");
    if (value.kind === "lint_fix") return t("contribute.agentToolLintFix");
    if (value.kind === "get_revision_detections") return t("contribute.agentToolDetections");
    if (value.kind === "finish") return t("contribute.agentToolFinish");
    if (value.kind === "record_rule_hit") return t("contribute.agentToolRecordHit");
    if (value.kind === "report_result") return t("contribute.agentToolReport");
    return value.fallbackLabel;
}

function statusLabel(): string {
    if (running.value) return t("contribute.agentToolRunning");
    if (props.tool.status === "error") return t("contribute.agentToolError");
    return t("contribute.agentToolSuccess");
}
</script>

<template>
    <!-- Tool 节点：默认折叠原始参数与结果，只把动作和摘要留在主时间线。 -->
    <details class="group ml-5 overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-subtle)] text-xs" :open="running || props.tool.status === 'error'">
        <summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2 hover:bg-[var(--bg-hover)]">
            <span :class="running ? 'i-lucide-loader-circle animate-spin text-[var(--accent-text)]' : props.tool.status === 'error' ? 'i-lucide-circle-x text-[var(--danger-text)]' : 'i-lucide-circle-check text-[var(--success-text)]'" class="h-3.5 w-3.5 shrink-0" />
            <span class="shrink-0 font-medium text-[var(--text-main)]">{{ toolLabel(presentation) }}</span>
            <span v-if="summary" class="min-w-0 flex-1 truncate text-[var(--text-muted)]" :title="summary">{{ summary }}</span>
            <span v-else class="flex-1" />
            <span class="shrink-0 text-[10px] text-[var(--text-muted)]">{{ statusLabel() }}</span>
            <span class="i-lucide-chevron-right h-3 w-3 shrink-0 text-[var(--text-muted)] transition-transform group-open:rotate-90" />
        </summary>
        <div v-if="hasArgs || props.tool.result" class="grid gap-2 border-t border-[var(--border-color)] px-3 py-2.5">
            <div v-if="hasArgs" class="grid gap-1">
                <span class="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{{ t("contribute.agentToolArgs") }}</span>
                <pre class="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--bg-panel)] p-2 text-[10px] leading-relaxed text-[var(--text-secondary)]">{{ props.tool.args }}</pre>
            </div>
            <div v-if="props.tool.result" class="grid gap-1">
                <span class="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{{ t("contribute.agentToolResult") }}</span>
                <AgentMarkdownContent :content="props.tool.result" :class="props.tool.status === 'error' ? 'text-[var(--danger-text)]' : 'text-[var(--text-secondary)]'" />
            </div>
        </div>
    </details>
</template>
