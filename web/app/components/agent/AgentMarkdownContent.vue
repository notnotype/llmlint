<script setup lang="ts">
import {computed} from "vue";
import {renderAgentMarkdown} from "../../utils/agent-markdown";

const props = defineProps<{
    content: string;
}>();

/** 仅浏览器渲染；所有 v-html 内容都先通过 Markdown allow-list 和 DOMPurify。 */
const html = computed(() => import.meta.client ? renderAgentMarkdown(props.content, window) : "");
</script>

<template>
    <!-- Agent Markdown：html 已在 renderAgentMarkdown 内完成清理。 -->
    <div class="agent-markdown min-w-0 break-words" v-html="html" />
</template>

<style scoped>
.agent-markdown :deep(p) { margin: 0.45rem 0; }
.agent-markdown :deep(p:first-child) { margin-top: 0; }
.agent-markdown :deep(p:last-child) { margin-bottom: 0; }
.agent-markdown :deep(ul),
.agent-markdown :deep(ol) { margin: 0.5rem 0; padding-left: 1.35rem; }
.agent-markdown :deep(ul) { list-style: disc; }
.agent-markdown :deep(ol) { list-style: decimal; }
.agent-markdown :deep(li + li) { margin-top: 0.2rem; }
.agent-markdown :deep(blockquote) { margin: 0.65rem 0; border-left: 2px solid var(--border-color); padding-left: 0.75rem; color: var(--text-muted); }
.agent-markdown :deep(pre) { margin: 0.65rem 0; max-width: 100%; overflow: auto; border: 1px solid var(--border-color); border-radius: 0.5rem; background: var(--bg-subtle); padding: 0.75rem; font-size: 0.75rem; line-height: 1.55; }
.agent-markdown :deep(code) { border-radius: 0.25rem; background: var(--bg-subtle); padding: 0.08rem 0.28rem; font-size: 0.85em; }
.agent-markdown :deep(pre code) { background: transparent; padding: 0; font-size: inherit; }
.agent-markdown :deep(a) { color: var(--accent-text); text-decoration: underline; text-underline-offset: 2px; }
.agent-markdown :deep(h1),
.agent-markdown :deep(h2),
.agent-markdown :deep(h3),
.agent-markdown :deep(h4) { margin: 0.8rem 0 0.35rem; font-weight: 600; line-height: 1.35; }
.agent-markdown :deep(h1) { font-size: 1.1rem; }
.agent-markdown :deep(h2) { font-size: 1rem; }
.agent-markdown :deep(h3),
.agent-markdown :deep(h4) { font-size: 0.9rem; }
.agent-markdown :deep(table) { margin: 0.65rem 0; width: 100%; border-collapse: collapse; font-size: 0.75rem; }
.agent-markdown :deep(th),
.agent-markdown :deep(td) { border: 1px solid var(--border-color); padding: 0.35rem 0.5rem; text-align: left; }
</style>
