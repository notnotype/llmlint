<script setup lang="ts">
import {ref} from "vue";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import {useNotification} from "../composables/useNotification";
import {resolveApiErrorMessage} from "../utils/api-error";
import type {HighlightRange} from "../types";
import type {HeatChunk} from "../utils/contribute-workspace";

// 可选中标注的修订正文（Task 13 五步②/⑤）：只读高亮正文 + DOM 选区反算 UTF-16 span +
// 标注小表单（POST /api/annotations，note 原样存，D3）。report 屏（rev0）与 verdict 屏
// （rev_k，「哪里没改好」）共用；标注挂到哪一版由 revisionId prop 决定。
const props = defineProps<{
    /** 展示与选区反算的正文；必须与 revisionId 指向的 revision body 逐字一致（否则 span 越界被服务器 400）。 */
    text: string;
    /** 行内高亮区间（展示层，本地扫描口径即可；落库真相是服务器 MachineScan）。 */
    ranges: HighlightRange[];
    /** span 标注挂载的目标 revision id。 */
    revisionId: string;
    /** 列表→正文定位闪烁（透传 ReadOnlyHighlightedText）。 */
    locateOffset?: number | null;
    /** 热力块（Task 15 P1-C，坐标锚定该版 body；透传 ReadOnlyHighlightedText 铺梯度底色）。 */
    heat?: HeatChunk[] | null;
}>();
const emit = defineEmits<{
    /** 点击正文时上抛 UTF-16 偏移（report 屏用它联动右侧命中卡片激活态）。 */
    (e: "offset-click", offset: number): void;
    /** 一条标注提交成功（W8 G6：宿主用它做本次流程的标注条数轻量计数）。 */
    (e: "annotated"): void;
}>();

const {t} = useLlmlintI18n();
const notification = useNotification();

const host = ref<HTMLElement | null>(null);
const selectedSpan = ref<{start: number; end: number; text: string} | null>(null);
const note = ref("");
const loading = ref(false);

/**
 * 从 DOM Selection 的 (node, innerOffset) 反算正文 UTF-16 偏移：按文本节点顺序累加长度。
 */
function offsetInHost(node: Node, innerOffset: number): number | null {
    if (!host.value) {
        return null;
    }
    const walker = document.createTreeWalker(host.value, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let current = walker.nextNode();
    while (current) {
        if (current === node) {
            return offset + innerOffset;
        }
        offset += current.textContent?.length ?? 0;
        current = walker.nextNode();
    }
    return null;
}

/**
 * mouseup 时捕获当前选区为待提交 span（半开区间，起终点归一化）。
 */
function captureSelection(): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return;
    }
    const range = selection.getRangeAt(0);
    if (!host.value || !host.value.contains(range.commonAncestorContainer)) {
        return;
    }
    const start = offsetInHost(range.startContainer, range.startOffset);
    const end = offsetInHost(range.endContainer, range.endOffset);
    if (start === null || end === null || start === end) {
        return;
    }
    const normalized = {start: Math.min(start, end), end: Math.max(start, end)};
    selectedSpan.value = {...normalized, text: props.text.slice(normalized.start, normalized.end)};
}

/**
 * 点正文：先捕获选区，再把光标偏移上抛给宿主做命中联动。
 */
function onClick(): void {
    captureSelection();
    const selection = window.getSelection();
    const node = selection?.focusNode;
    if (!node) {
        return;
    }
    const offset = offsetInHost(node, selection?.focusOffset ?? 0);
    if (offset !== null) {
        emit("offset-click", offset);
    }
}

/**
 * 提交当前选段的自然语言标注（原样发送）；成功后清空表单。
 */
async function submitAnnotation(): Promise<void> {
    if (!selectedSpan.value || !note.value.trim()) {
        return;
    }
    loading.value = true;
    try {
        await $fetch("/api/annotations", {
            method: "POST",
            body: {
                revisionId: props.revisionId,
                span: {start: selectedSpan.value.start, end: selectedSpan.value.end},
                note: note.value,
            },
        });
        notification.success(t("contribute.annotationSaved"));
        selectedSpan.value = null;
        note.value = "";
        emit("annotated");
    } catch (caught) {
        notification.error(resolveApiErrorMessage(caught, "Save annotation failed"));
    } finally {
        loading.value = false;
    }
}
</script>

<template>
    <div class="flex min-h-0 flex-1 flex-col">
        <!-- 只读高亮正文（选区反算宿主） -->
        <div ref="host" class="min-h-0 flex-1" @mouseup="captureSelection" @click="onClick">
            <ReadOnlyHighlightedText :text="text" :ranges="ranges" :locate-offset="locateOffset" :heat="props.heat ?? null" />
        </div>
        <!-- 选段标注表单 -->
        <div v-if="selectedSpan" class="grid gap-2 border-t border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <div class="line-clamp-2 text-xs text-[var(--text-muted)]">{{ t("contribute.selectedSpan", {text: selectedSpan.text}) }}</div>
            <textarea v-model="note" class="min-h-20 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-sm outline-none focus:border-[var(--accent-main)]" :placeholder="t('contribute.annotationPlaceholder')" maxlength="2000" />
            <div class="flex justify-end gap-2">
                <button class="h-8 rounded-md px-3 text-sm hover:bg-[var(--bg-hover)]" type="button" @click="selectedSpan = null">{{ t("contribute.cancel") }}</button>
                <button class="inline-flex h-8 items-center gap-2 rounded-md bg-[var(--accent-main)] px-3 text-sm font-medium text-white disabled:opacity-60" type="button" :disabled="loading || !note.trim()" @click="submitAnnotation">
                    <span class="i-lucide-message-square-plus" />
                    <span>{{ t("contribute.saveAnnotation") }}</span>
                </button>
            </div>
        </div>
    </div>
</template>
