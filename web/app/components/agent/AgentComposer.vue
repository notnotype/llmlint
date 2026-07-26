<script setup lang="ts">
import {computed, ref, watch} from "vue";
import type {AgentSessionSnapshot} from "#shared/agent-harness";
import type {AgentSelection} from "../../composables/useAgentChat";
import {useLlmlintI18n} from "../../composables/useLlmlintI18n";
import Dropdown from "../common/Dropdown.vue";
import type {DropdownItem} from "../common/dropdown.types";

const props = defineProps<{
    snapshot: AgentSessionSnapshot | null;
    running: boolean;
    aborting: boolean;
    loading: boolean;
    unavailable: string | null;
    selection: AgentSelection | null;
    prefill: string;
    prefillVersion: number;
    editorActive: boolean;
    retryable: boolean;
    connectionStatus: "idle" | "connecting" | "connected" | "reconnecting" | "recovering" | "disconnected";
    runPhase: "idle" | "model_pending" | "assistant_streaming" | "tool_running" | "finishing";
}>();

const emit = defineEmits<{
    (e: "send", message: string): void;
    (e: "cancel"): void;
    (e: "retry"): void;
    (e: "clear-selection"): void;
    (e: "external-select", value: string): void;
}>();

const {t} = useLlmlintI18n();
const message = ref("");
const expanded = ref(false);
watch(() => props.prefillVersion, () => { message.value = props.prefill; }, {immediate: true});

const externalLlmItems = computed<DropdownItem[]>(() => [
    {label: t("llm.copyPromptOnly"), value: "prompt-only", iconClass: "i-lucide-clipboard-list"},
    {label: t("llm.copyPromptWithText"), value: "prompt-with-text", iconClass: "i-lucide-file-input"},
    {label: t("llm.replaceFullFromClipboard"), value: "replace-text", iconClass: "i-lucide-clipboard-paste"},
]);
const sendDisabled = computed(() => props.running ? props.aborting : props.loading || !props.editorActive || !props.snapshot || !!props.unavailable || !message.value.trim());
const textareaDisabled = computed(() => props.running || props.loading || !props.editorActive || !props.snapshot || !!props.unavailable);

function submit(): void {
    if (props.running) {
        emit("cancel");
        return;
    }
    if (sendDisabled.value) return;
    emit("send", message.value);
    message.value = "";
}

function connectionLabel(): string {
    if (props.connectionStatus === "connected") return t("contribute.agentConnectionConnected");
    if (props.connectionStatus === "reconnecting") return t("contribute.agentConnectionReconnecting");
    if (props.connectionStatus === "recovering") return t("contribute.agentConnectionRecovering");
    if (props.connectionStatus === "disconnected") return t("contribute.agentConnectionDisconnected");
    return t("contribute.agentConnectionConnecting");
}

function connectionIcon(): string {
    if (props.connectionStatus === "connected") return "i-lucide-wifi";
    if (props.connectionStatus === "disconnected") return "i-lucide-wifi-off";
    return "i-lucide-loader-circle animate-spin";
}

function connectionClass(): string {
    if (props.connectionStatus === "connected") return "text-[var(--text-muted)]";
    if (props.connectionStatus === "disconnected") return "text-[var(--danger-text)]";
    return "text-[var(--warning-text)]";
}

function phaseLabel(): string {
    if (props.runPhase === "assistant_streaming") return t("contribute.agentPhaseStreaming");
    if (props.runPhase === "tool_running") return t("contribute.agentPhaseTool");
    if (props.runPhase === "finishing") return t("contribute.agentPhaseFinishing");
    return t("contribute.agentPhasePending");
}
</script>

<template>
    <!-- Agent Composer：附件、输入和运行控制统一在一个输入卡片内。 -->
    <div class="relative shrink-0 bg-[var(--bg-panel)] px-2 pb-2 pt-1">
        <div class="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] shadow-sm transition-colors focus-within:border-[var(--accent-main)] focus-within:ring-1 focus-within:ring-[var(--accent-main)]">
            <div v-if="props.selection" class="flex items-start gap-2 border-b border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 py-2 text-xs">
                <span class="i-lucide-quote mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent-text)]" />
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 font-medium text-[var(--text-main)]"><span>{{ t("contribute.agentChatSelection") }}</span><span class="text-[10px] font-normal text-[var(--text-muted)]">{{ t("contribute.agentSelectionChars", {count: props.selection.text.length}) }}</span></div>
                    <div class="mt-1 line-clamp-3 whitespace-pre-wrap text-[var(--text-muted)]">{{ props.selection.text }}</div>
                </div>
                <button type="button" class="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('common.clear')" @click="emit('clear-selection')"><span class="i-lucide-x h-3.5 w-3.5" /></button>
            </div>

            <textarea
                v-model="message"
                class="block w-full resize-none bg-transparent px-3 py-3 text-sm leading-relaxed text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                :class="expanded ? 'min-h-44' : 'min-h-24'"
                :placeholder="props.running ? t('contribute.agentChatRunning') : t('contribute.agentChatPlaceholder')"
                maxlength="4000"
                :disabled="textareaDisabled"
                @keydown.ctrl.enter.prevent="submit"
                @keydown.meta.enter.prevent="submit"
            />

            <div class="flex items-center justify-between gap-2 border-t border-[var(--border-color)]/60 px-2 py-2">
                <div class="flex min-w-0 items-center gap-1">
                    <Dropdown :items="externalLlmItems" root-class="relative" menu-class="bottom-full left-0 mb-2 w-60" compact @select="(value: string) => emit('external-select', value)">
                        <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('llm.menuTitle')"><span class="i-lucide-wand-sparkles h-3.5 w-3.5" />{{ t("llm.menuLabel") }}</button>
                    </Dropdown>
                    <button type="button" class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="expanded ? t('contribute.agentComposerCollapse') : t('contribute.agentComposerExpand')" @click="expanded = !expanded"><span :class="expanded ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'" class="h-3.5 w-3.5" /></button>
                    <button v-if="props.retryable && !props.running" type="button" class="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('retry')"><span class="i-lucide-rotate-ccw h-3.5 w-3.5" />{{ t("common.retry") }}</button>
                </div>
                <button type="button" class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-bg)] text-[var(--accent-text)] transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50" :disabled="sendDisabled" :title="props.running ? t('common.cancel') : t('contribute.agentChatSend')" @click="submit">
                    <span :class="props.running ? 'i-lucide-square' : props.loading ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-send'" class="h-4 w-4" />
                </button>
            </div>
        </div>

        <div class="mt-1.5 flex min-h-5 flex-wrap items-center justify-center gap-x-2 gap-y-1 px-1 text-[10px] text-[var(--text-muted)]" aria-live="polite">
            <span class="inline-flex items-center gap-1" :class="connectionClass()"><span :class="connectionIcon()" class="h-3 w-3" />{{ connectionLabel() }}</span>
            <span v-if="props.running" class="inline-flex items-center gap-1 text-[var(--accent-text)]"><span class="i-lucide-loader-circle h-3 w-3 animate-spin" />{{ phaseLabel() }}</span>
            <span v-else>{{ t("contribute.agentChatShortcut") }}</span>
        </div>
    </div>
</template>
