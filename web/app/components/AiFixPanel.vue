<script setup lang="ts">
import type {AgentSessionSnapshot} from "#shared/agent-harness";
import type {AgentSelection} from "../composables/useAgentChat";
import type {AgentChatMessage} from "../utils/agent-chat-projection";
import AgentChatFlow from "./agent/AgentChatFlow.vue";
import AgentComposer from "./agent/AgentComposer.vue";

const props = defineProps<{
    snapshot: AgentSessionSnapshot | null;
    messages: AgentChatMessage[];
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
</script>

<template>
    <!-- AiFixPanel 只负责编排：Flow 与 Composer 分别承载历史和输入。 -->
    <div class="flex min-h-0 flex-1 flex-col bg-[var(--bg-panel)] text-sm">
        <AgentChatFlow :snapshot="props.snapshot" :messages="props.messages" :loading="props.loading" :unavailable="props.unavailable" />
        <AgentComposer
            :snapshot="props.snapshot"
            :running="props.running"
            :aborting="props.aborting"
            :loading="props.loading"
            :unavailable="props.unavailable"
            :selection="props.selection"
            :prefill="props.prefill"
            :prefill-version="props.prefillVersion"
            :editor-active="props.editorActive"
            :retryable="props.retryable"
            :connection-status="props.connectionStatus"
            :run-phase="props.runPhase"
            @send="emit('send', $event)"
            @cancel="emit('cancel')"
            @retry="emit('retry')"
            @clear-selection="emit('clear-selection')"
            @external-select="emit('external-select', $event)"
        />
    </div>
</template>
