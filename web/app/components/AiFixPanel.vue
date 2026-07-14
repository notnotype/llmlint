<script setup lang="ts">
import {computed, nextTick, ref, watch} from "vue";
import type {AgentSelection} from "../composables/useAgentChat";
import type {AgentSessionSnapshot} from "#shared/agent-harness";
import type {AgentChatMessage} from "../utils/agent-chat-projection";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import Dropdown from "./common/Dropdown.vue";
import type {DropdownItem} from "./common/dropdown.types";

const props = defineProps<{
    snapshot: AgentSessionSnapshot | null;
    messages: AgentChatMessage[];
    running: boolean;
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
const scrollRef = ref<HTMLDivElement | null>(null);
const stickToBottom = ref(true);
watch(() => props.prefillVersion, () => { message.value = props.prefill; }, {immediate: true});
const scrollSignature = computed(() => {
    const last = props.messages.at(-1);
    const tool = last?.tools?.at(-1);
    return [props.messages.length, last?.id, last?.content.length, last?.thinking?.length, last?.status, tool?.status, tool?.result?.length].join(":");
});
watch(scrollSignature, () => {
    if (!stickToBottom.value) return;
    void nextTick(() => {
        if (scrollRef.value) scrollRef.value.scrollTop = scrollRef.value.scrollHeight;
    });
}, {immediate: true});

function onScroll(): void {
    const element = scrollRef.value;
    if (!element) return;
    stickToBottom.value = element.scrollHeight - element.scrollTop - element.clientHeight <= 12;
}

const externalLlmItems = computed<DropdownItem[]>(() => [
    {label: t("llm.copyPromptOnly"), value: "prompt-only", iconClass: "i-lucide-clipboard-list"},
    {label: t("llm.copyPromptWithText"), value: "prompt-with-text", iconClass: "i-lucide-file-input"},
    {label: t("llm.replaceFullFromClipboard"), value: "replace-text", iconClass: "i-lucide-clipboard-paste"},
]);
const sendDisabled = computed(() => props.running || props.loading || !props.editorActive || !props.snapshot || !message.value.trim());

function submit(): void {
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

function phaseLabel(): string {
    if (props.runPhase === "assistant_streaming") return t("contribute.agentPhaseStreaming");
    if (props.runPhase === "tool_running") return t("contribute.agentPhaseTool");
    if (props.runPhase === "finishing") return t("contribute.agentPhaseFinishing");
    return t("contribute.agentPhasePending");
}
</script>

<template>
    <!-- Harness Chat：timeline + 选区附件 + idle-only composer。 -->
    <div class="flex min-h-0 flex-1 flex-col text-sm">
        <div class="flex items-center justify-between gap-2 border-b border-[var(--border-color)] px-3 py-2">
            <div class="min-w-0">
                <div class="font-medium">{{ t("contribute.agentChatTitle") }}</div>
                <div class="truncate text-xs text-[var(--text-muted)]">{{ t("contribute.agentChatHint") }}</div>
            </div>
            <Dropdown :items="externalLlmItems" root-class="relative" menu-class="right-0 top-full mt-2 w-56" compact @select="(value: string) => emit('external-select', value)">
                <button type="button" class="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border-color)] px-2.5 hover:bg-[var(--bg-hover)]" :title="t('llm.menuTitle')">
                    <span class="i-lucide-wand-sparkles" /> {{ t("llm.menuLabel") }}
                </button>
            </Dropdown>
        </div>

        <div ref="scrollRef" class="min-h-0 flex-1 space-y-3 overflow-auto p-3" @scroll="onScroll">
            <div v-if="props.unavailable" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-3 text-xs text-[var(--text-muted)]">{{ props.unavailable }}</div>
            <div v-if="!props.snapshot && !props.unavailable" class="flex items-center gap-2 text-xs text-[var(--text-muted)]"><span class="i-lucide-loader-circle animate-spin" />{{ t("contribute.agentChatLoading") }}</div>
            <template v-for="entry in props.messages" :key="entry.id">
                <div v-if="entry.type === 'user'" class="ml-8 rounded-xl rounded-br-sm bg-[var(--accent-bg)] p-3">
                    <div class="text-xs font-medium text-[var(--accent-text)]">{{ t("contribute.agentChatYou") }}</div>
                    <div class="mt-1 whitespace-pre-wrap">{{ entry.content }}</div>
                </div>
                <div v-else-if="entry.type === 'assistant'" class="mr-5 grid gap-2 rounded-xl rounded-bl-sm border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
                    <div class="flex items-center gap-2 text-xs font-medium text-[var(--text-muted)]"><span>Agent</span><span v-if="entry.status === 'streaming'" class="i-lucide-loader-circle animate-spin" /></div>
                    <details v-if="entry.thinking" class="text-xs text-[var(--text-muted)]"><summary class="cursor-pointer">{{ t("contribute.agentThinking") }}</summary><div class="mt-1 whitespace-pre-wrap">{{ entry.thinking }}</div></details>
                    <div v-if="entry.content" class="whitespace-pre-wrap">{{ entry.content }}</div>
                    <div v-for="tool in entry.tools ?? []" :key="tool.id" class="grid gap-1 rounded-md bg-[var(--bg-subtle)] p-2 text-xs">
                        <div class="flex items-center gap-1 font-medium"><span :class="tool.status === 'running' || tool.status === 'streaming' ? 'i-lucide-loader-circle animate-spin' : tool.status === 'error' ? 'i-lucide-circle-x text-[var(--danger-text)]' : 'i-lucide-circle-check text-[var(--success-text)]'" />{{ tool.name }}</div>
                        <pre v-if="tool.args" class="max-h-32 overflow-auto whitespace-pre-wrap text-[10px] text-[var(--text-muted)]">{{ tool.args }}</pre>
                        <div v-if="tool.result" :class="tool.status === 'error' ? 'text-[var(--danger-text)]' : 'text-[var(--text-muted)]'">{{ tool.result }}</div>
                    </div>
                </div>
                <div v-else-if="entry.type === 'edit' && entry.edit" class="grid gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-3 text-xs">
                    <div class="flex items-center gap-1 font-medium"><span class="i-lucide-pencil-line" />{{ t("contribute.agentChatEdit") }}</div>
                    <div class="text-[var(--danger-text)] line-through">{{ entry.edit.oldText }}</div>
                    <div class="text-[var(--success-text)]">{{ entry.edit.newText }}</div>
                    <div v-if="entry.edit.reason" class="text-[var(--text-muted)]">{{ entry.edit.reason }}</div>
                </div>
                <div v-else-if="entry.type === 'report'" class="grid gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-3 text-xs">
                    <div class="font-medium">{{ t("contribute.agentChatReport") }}</div>
                    <div>{{ entry.content }}</div>
                </div>
                <div v-else-if="entry.type === 'system'" class="rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-xs text-[var(--danger-text)]">{{ entry.content }}</div>
            </template>
        </div>

        <div class="grid gap-2 border-t border-[var(--border-color)] p-3">
            <div v-if="props.selection" class="flex items-start gap-2 rounded-md bg-[var(--bg-subtle)] p-2 text-xs">
                <span class="i-lucide-quote mt-0.5 shrink-0" />
                <div class="min-w-0 flex-1">
                    <div class="font-medium">{{ t("contribute.agentChatSelection") }}</div>
                    <div class="line-clamp-3 text-[var(--text-muted)]">{{ props.selection.text }}</div>
                </div>
                <button type="button" class="i-lucide-x shrink-0" :title="t('common.clear')" @click="emit('clear-selection')" />
            </div>
            <textarea v-model="message" class="min-h-20 resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 outline-none focus:border-[var(--accent-main)] disabled:opacity-60" :placeholder="t('contribute.agentChatPlaceholder')" maxlength="4000" :disabled="props.running || !props.editorActive" @keydown.ctrl.enter.prevent="submit" @keydown.meta.enter.prevent="submit" />
            <div class="flex items-center justify-between gap-2">
                <span class="text-xs text-[var(--text-muted)]">{{ props.running ? phaseLabel() : t("contribute.agentChatShortcut") }} · {{ connectionLabel() }}</span>
                <div class="flex gap-2">
                    <button v-if="props.retryable && !props.running" type="button" class="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border-color)] px-3 hover:bg-[var(--bg-hover)]" @click="emit('retry')"><span class="i-lucide-rotate-ccw" />{{ t("common.retry") }}</button>
                    <button v-if="props.running" type="button" class="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border-color)] px-3 hover:bg-[var(--bg-hover)]" @click="emit('cancel')"><span class="i-lucide-square" />{{ t("common.cancel") }}</button>
                    <button v-else type="button" class="inline-flex h-8 items-center gap-1 rounded-md bg-[var(--accent-main)] px-3 font-medium text-white hover:brightness-105 disabled:opacity-60" :disabled="sendDisabled" @click="submit"><span class="i-lucide-send" />{{ t("contribute.agentChatSend") }}</button>
                </div>
            </div>
        </div>
    </div>
</template>
