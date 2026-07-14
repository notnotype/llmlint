<script setup lang="ts">
import {computed, nextTick, ref, watch, onMounted, onBeforeUnmount} from "vue";
import type {HighlightRange, RuleLevel} from "../types";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";

// 行内高亮编辑器（Grammarly 式）：一个文字透明、只显示命中底色的「背板」，
// 上面浮一个透明底、文字可见的 textarea。两者盒模型完全一致，滚动同步 → 底色恰好落在命中词下方。
const text = defineModel<string>({required: true});
const props = defineProps<{
    ranges: HighlightRange[];
    commentRanges?: Array<{start: number; end: number; active?: boolean; resolved?: boolean; index?: number}>;
    replacementRanges?: Array<{start: number; end: number; label: string; isDelete?: boolean; active?: boolean}>;
    diffRanges?: Array<{start: number; end: number; deleted: string; deletedCount: number; inserted: string; source: "static" | "llm"; title: string; active?: boolean}>;
    /** 列表点命中时传入要定位的绝对偏移；变化即滚动+闪烁该处。null=不定位。 */
    locateOffset?: number | null;
}>();
const emit = defineEmits<{
    (e: "caret-click", offset: number): void;
    (e: "selection-change", selection: {start: number; end: number; text: string; anchor: {left: number; top: number; height: number; containerWidth: number; containerHeight: number; absoluteTop: number}} | null): void;
    (e: "source-format-command", payload: {command: "list-indent" | "list-outdent"; selection: {start: number; end: number; text: string; anchor: {left: number; top: number; height: number; containerWidth: number; containerHeight: number; absoluteTop: number}}; caretOffset: number}): void;
}>();
const {t} = useLlmlintI18n();

const backdrop = ref<HTMLDivElement | null>(null);
const textareaEl = ref<HTMLTextAreaElement | null>(null);
const textareaContentWidth = ref<number | null>(null);

function updateWidth() {
    if (textareaEl.value) {
        textareaContentWidth.value = textareaEl.value.clientWidth;
    }
}

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
    updateWidth();
    if (typeof ResizeObserver !== "undefined" && textareaEl.value) {
        resizeObserver = new ResizeObserver(() => {
            updateWidth();
        });
        resizeObserver.observe(textareaEl.value);
    }
});

onBeforeUnmount(() => {
    resizeObserver?.disconnect();
});

watch(text, () => {
    nextTick(updateWidth);
});

type Segment = {
    text: string;
    level: RuleLevel | null;
    hasComment: boolean;
    hasActiveComment: boolean;
    hasResolvedComment: boolean;
    commentIndex: number | null;
    hasReplacement: boolean;
    hasActiveReplacement: boolean;
    hasReplacementDelete: boolean;
    replacementLabel: string | null;
    hasDiffInsertion: boolean;
    hasActiveDiff: boolean;
    diffDeleted: string | null;
    diffDeletedBadge: string | null;
    diffTitle: string | null;
    start: number;
};

// 按合并后的高亮区间，把整段文本切成 [普通 | 高亮] 段，并记录每段起始偏移（供定位）。
const segments = computed<Segment[]>(() => {
    const value = text.value;
    const ranges = props.ranges;
    const commentRanges = props.commentRanges ?? [];
    const replacementRanges = props.replacementRanges ?? [];
    const diffRanges = props.diffRanges ?? [];
    if (ranges.length === 0 && commentRanges.length === 0 && replacementRanges.length === 0 && diffRanges.length === 0) {
        return [
            {text: value, level: null, hasComment: false, hasActiveComment: false, hasResolvedComment: false, commentIndex: null, hasReplacement: false, hasActiveReplacement: false, hasReplacementDelete: false, replacementLabel: null, hasDiffInsertion: false, hasActiveDiff: false, diffDeleted: null, diffDeletedBadge: null, diffTitle: null, start: 0},
            {text: "\n", level: null, hasComment: false, hasActiveComment: false, hasResolvedComment: false, commentIndex: null, hasReplacement: false, hasActiveReplacement: false, hasReplacementDelete: false, replacementLabel: null, hasDiffInsertion: false, hasActiveDiff: false, diffDeleted: null, diffDeletedBadge: null, diffTitle: null, start: value.length},
        ];
    }
    const out: Segment[] = [];
    const boundaries = new Set<number>([0, value.length]);
    for (const range of [...ranges, ...commentRanges, ...replacementRanges, ...diffRanges]) {
        boundaries.add(Math.max(0, Math.min(value.length, range.start)));
        boundaries.add(Math.max(0, Math.min(value.length, range.end)));
    }
    const points = [...boundaries].sort((a, b) => a - b);
    for (let index = 0; index < points.length - 1; index++) {
        const start = points[index] ?? 0;
        const end = points[index + 1] ?? start;
        if (end <= start) {
            continue;
        }
        const level = ranges.find((range) => start >= range.start && end <= range.end)?.level ?? null;
        const hasComment = commentRanges.some((range) => start < range.end && end > range.start);
        const hasActiveComment = commentRanges.some((range) => range.active && start < range.end && end > range.start);
        const hasResolvedComment = commentRanges.some((range) => range.resolved && start < range.end && end > range.start);
        const commentStart = commentRanges.find((range) => range.index && start === Math.max(0, Math.min(value.length, range.start)));
        const replacement = replacementRanges.find((range) => start < range.end && end > range.start);
        const replacementStart = replacementRanges.find((range) => start === Math.max(0, Math.min(value.length, range.start)));
        const diff = diffRanges.find((range) => start < range.end && end > range.start);
        const diffMarker = diffRanges.find((range) => start === Math.max(0, Math.min(value.length, range.start)) && range.deleted);
        const activeDiff = diffRanges.some((range) => range.active && (start < range.end && end > range.start || start === Math.max(0, Math.min(value.length, range.start))));
        out.push({
            text: value.slice(start, end),
            level,
            hasComment,
            hasActiveComment,
            hasResolvedComment,
            commentIndex: commentStart?.index ?? null,
            hasReplacement: Boolean(replacement),
            hasActiveReplacement: replacement?.active === true,
            hasReplacementDelete: replacement?.isDelete === true,
            replacementLabel: replacementStart?.label ?? null,
            hasDiffInsertion: Boolean(diff?.inserted),
            hasActiveDiff: activeDiff,
            diffDeleted: diffMarker?.deleted ?? null,
            diffDeletedBadge: diffMarker?.deleted ? `-${diffMarker.deletedCount}` : null,
            diffTitle: diffMarker?.title ?? diff?.title ?? null,
            start,
        });
    }
    // 末尾补一个换行，保证背板尾行高度与 textarea 一致。
    const endDiffMarker = diffRanges.find((range) => value.length === Math.max(0, Math.min(value.length, range.start)) && range.deleted);
    out.push({text: "\n", level: null, hasComment: false, hasActiveComment: false, hasResolvedComment: false, commentIndex: null, hasReplacement: false, hasActiveReplacement: false, hasReplacementDelete: false, replacementLabel: null, hasDiffInsertion: false, hasActiveDiff: endDiffMarker?.active === true, diffDeleted: endDiffMarker?.deleted ?? null, diffDeletedBadge: endDiffMarker?.deleted ? `-${endDiffMarker.deletedCount}` : null, diffTitle: endDiffMarker?.title ?? null, start: value.length});
    return out;
});

const MARK_CLASS: Record<RuleLevel, string> = {
    high: "bg-red-400/45",
    medium: "bg-amber-400/45",
    low: "bg-zinc-400/45",
};

// 当前闪烁的段下标（列表定位时短暂高亮）。
const flashIndex = ref<number | null>(null);

function syncScroll(event: Event) {
    const textarea = event.target as HTMLTextAreaElement;
    updateWidth();
    if (backdrop.value) {
        backdrop.value.scrollTop = textarea.scrollTop;
        backdrop.value.scrollLeft = textarea.scrollLeft;
    }
    emitSelection();
}

// textarea 光标落点 → 上抛偏移，供正文→列表定位。
function emitCaret() {
    const el = textareaEl.value;
    if (el) {
        emit("caret-click", el.selectionStart);
        emitSelection();
    }
}

function emitSelection() {
    const el = textareaEl.value;
    if (!el) {
        emit("selection-change", null);
        return;
    }
    const start = Math.min(el.selectionStart, el.selectionEnd);
    const end = Math.max(el.selectionStart, el.selectionEnd);
    emit("selection-change", start === end ? null : {start, end, text: text.value.slice(start, end), anchor: textareaSelectionAnchor(el, end)});
}

function clearSelectionByEscape(): void {
    const el = textareaEl.value;
    if (!el) {
        emit("selection-change", null);
        return;
    }
    const end = Math.max(el.selectionStart, el.selectionEnd);
    el.setSelectionRange(end, end);
    emit("selection-change", null);
    emit("caret-click", end);
}

function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) {
        return;
    }
    const el = textareaEl.value;
    if (!el) {
        return;
    }
    const start = Math.min(el.selectionStart, el.selectionEnd);
    const end = Math.max(el.selectionStart, el.selectionEnd);
    const range = selectedListLineRange(text.value, start, end);
    if (!range) {
        return;
    }
    event.preventDefault();
    const selection = {
        start: range.start,
        end: range.end,
        text: text.value.slice(range.start, range.end),
        anchor: textareaSelectionAnchor(el, end),
    };
    emit("selection-change", selection);
    emit("source-format-command", {
        command: event.shiftKey ? "list-outdent" : "list-indent",
        selection,
        caretOffset: el.selectionEnd,
    });
}

function selectedListLineRange(value: string, start: number, end: number): {start: number; end: number} | null {
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const normalizedEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
    const nextBreak = value.indexOf("\n", Math.max(lineStart, normalizedEnd));
    const lineEnd = nextBreak >= 0 ? nextBreak : value.length;
    const block = value.slice(lineStart, lineEnd);
    const hasListLine = block.split("\n").some((line) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(line));
    return hasListLine ? {start: lineStart, end: lineEnd} : null;
}

function textareaSelectionAnchor(el: HTMLTextAreaElement, offset: number): {left: number; top: number; height: number; containerWidth: number; containerHeight: number; absoluteTop: number} {
    const style = window.getComputedStyle(el);
    const mirror = document.createElement("div");
    const caret = document.createElement("span");
    const copiedStyles = [
        "boxSizing",
        "borderTopWidth",
        "borderRightWidth",
        "borderBottomWidth",
        "borderLeftWidth",
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
        "fontFamily",
        "fontSize",
        "fontStyle",
        "fontWeight",
        "letterSpacing",
        "lineHeight",
        "textTransform",
        "textIndent",
        "wordSpacing",
        "tabSize",
    ] as const;
    for (const key of copiedStyles) {
        mirror.style[key] = style[key];
    }
    mirror.style.position = "absolute";
    mirror.style.left = "-9999px";
    mirror.style.top = "0";
    mirror.style.width = `${el.clientWidth}px`;
    mirror.style.minHeight = "0";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.overflowWrap = "break-word";
    mirror.style.wordBreak = "break-word";
    mirror.style.visibility = "hidden";
    mirror.textContent = text.value.slice(0, offset);
    caret.textContent = text.value.slice(offset, offset + 1) || ".";
    mirror.appendChild(caret);
    document.body.appendChild(mirror);
    const left = caret.offsetLeft - el.scrollLeft;
    const absoluteTop = caret.offsetTop;
    const top = absoluteTop - el.scrollTop;
    const height = caret.offsetHeight || parseFloat(style.lineHeight) || 20;
    mirror.remove();
    return {left, top, height, containerWidth: el.clientWidth, containerHeight: el.clientHeight, absoluteTop};
}

function collapseSelection(offset: number): void {
    const el = textareaEl.value;
    if (!el) {
        return;
    }
    const nextOffset = Math.max(0, Math.min(text.value.length, offset));
    el.setSelectionRange(nextOffset, nextOffset);
    emit("selection-change", null);
    emit("caret-click", nextOffset);
}

function revealOffset(offset: number): void {
    const el = textareaEl.value;
    if (!el) {
        return;
    }
    const nextOffset = Math.max(0, Math.min(text.value.length, offset));
    const anchor = textareaSelectionAnchor(el, nextOffset);
    const target = Math.max(0, anchor.absoluteTop - el.clientHeight / 2 + anchor.height / 2);
    el.scrollTop = target;
    if (backdrop.value) {
        backdrop.value.scrollTop = target;
        backdrop.value.scrollLeft = el.scrollLeft;
    }
    collapseSelection(nextOffset);
}

defineExpose({
    collapseSelection,
    revealOffset,
});

// 列表点命中 → 找覆盖该偏移的段，滚动到视口中部并闪烁；同步 textarea 滚动。
watch(
    () => props.locateOffset,
    async (offset) => {
        if (offset === null || offset === undefined) {
            return;
        }
        const index = segments.value.findIndex((seg) => offset >= seg.start && offset < seg.start + seg.text.length);
        if (index < 0) {
            return;
        }
        flashIndex.value = index;
        await nextTick();
        const span = backdrop.value?.querySelector<HTMLElement>(`[data-seg="${index}"]`);
        if (span && backdrop.value && textareaEl.value) {
            const target = Math.max(0, span.offsetTop - backdrop.value.clientHeight / 2);
            backdrop.value.scrollTop = target;
            textareaEl.value.scrollTop = target;
        }
        window.setTimeout(() => {
            if (flashIndex.value === index) {
                flashIndex.value = null;
            }
        }, 1100);
    },
);

// 背板与 textarea 必须共用同一套排版盒模型（padding / 字体 / 行高 / 换行），字符才能对齐。
const boxClass = "border-0 p-3 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words";
</script>

<template>
    <div class="relative h-full min-h-0 w-full overflow-hidden">
        <!-- 高亮背板：文字透明，只显示 <span> 底色；指针穿透，滚动跟随 textarea -->
        <div
            ref="backdrop"
            aria-hidden="true"
            class="pointer-events-none absolute inset-y-0 left-0 overflow-hidden text-transparent"
            :class="boxClass"
            :style="{ width: textareaContentWidth ? textareaContentWidth + 'px' : '100%' }"
        ><span
            v-for="(seg, index) in segments"
            :key="index"
            :data-seg="index"
            :data-comment-index="seg.commentIndex ?? undefined"
            :data-replacement-label="seg.replacementLabel ?? undefined"
            :data-diff-deleted="seg.diffDeleted ?? undefined"
            :data-diff-deleted-badge="seg.diffDeletedBadge ?? undefined"
            :title="seg.diffTitle ?? undefined"
            :class="[
                seg.level ? `rounded ${MARK_CLASS[seg.level]}` : '',
                seg.hasReplacement ? 'llmlint-source-replacement-mark rounded' : '',
                seg.hasActiveReplacement ? 'llmlint-source-replacement-mark--active' : '',
                seg.hasReplacementDelete ? 'llmlint-source-replacement-mark--delete' : '',
                seg.hasDiffInsertion ? 'llmlint-source-diff-inserted rounded' : '',
                seg.diffDeleted ? 'llmlint-source-diff-marker' : '',
                seg.hasActiveDiff ? 'llmlint-source-diff-active' : '',
                seg.hasComment ? 'llmlint-source-comment-mark rounded border-b-2 border-[var(--accent-main)] bg-[var(--accent-bg)]' : '',
                seg.hasResolvedComment ? 'border-dashed opacity-65' : '',
                seg.hasActiveComment ? 'outline outline-2 outline-[var(--accent-main)]/60' : '',
                flashIndex === index ? 'rounded bg-amber-400/80 outline outline-2 outline-amber-500' : '',
            ]"
        >{{ seg.text }}</span></div>
        <!-- 可编辑 textarea：透明底、文字可见，浮在背板上 -->
        <textarea
            ref="textareaEl"
            v-model="text"
            class="absolute inset-0 h-full w-full resize-none bg-transparent text-[var(--text-main)] caret-[var(--accent-main)] outline-none placeholder:text-[var(--text-muted)]"
            :class="boxClass"
            :placeholder="t('text.placeholder')"
            spellcheck="false"
            @scroll="syncScroll"
            @click="emitCaret"
            @keyup="emitCaret"
            @keydown="handleKeydown"
            @keydown.esc.prevent="clearSelectionByEscape"
            @select="emitSelection"
            @mouseup="emitSelection"
        />
    </div>
</template>

<style scoped>
.llmlint-source-comment-mark {
    position: relative;
}

.llmlint-source-comment-mark[data-comment-index]::after {
    content: attr(data-comment-index);
    position: absolute;
    right: -0.5em;
    top: -0.68em;
    z-index: 1;
    display: inline-flex;
    min-width: 0.82rem;
    height: 0.82rem;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--accent-main);
    border-radius: 999px;
    background: var(--bg-panel);
    color: var(--accent-text);
    font-size: 0.52rem;
    font-weight: 700;
    line-height: 1;
}

.llmlint-source-comment-mark.outline[data-comment-index]::after {
    background: var(--accent-main);
    color: #fff;
}

.llmlint-source-replacement-mark {
    position: relative;
    box-shadow: inset 0 -2px 0 color-mix(in srgb, #10b981 72%, transparent);
}

.llmlint-source-replacement-mark--active {
    outline: 2px solid color-mix(in srgb, #10b981 58%, transparent);
}

.llmlint-source-replacement-mark--delete {
    border-radius: 0;
    background: transparent !important;
    box-shadow: none;
    color: #dc2626 !important;
    text-decoration-line: line-through;
    text-decoration-color: #dc2626;
    text-decoration-thickness: 2px;
    text-decoration-skip-ink: none;
}

.llmlint-source-replacement-mark[data-replacement-label]::after {
    content: "-> " attr(data-replacement-label);
    position: absolute;
    left: 100%;
    top: -0.78em;
    z-index: 2;
    display: inline-flex;
    max-width: 12rem;
    align-items: center;
    border-radius: 4px;
    background: color-mix(in srgb, #10b981 16%, var(--bg-panel));
    color: rgb(5, 150, 105);
    font-size: 0.72rem;
    font-weight: 700;
    line-height: 1.25;
    padding: 0.05rem 0.25rem;
    white-space: nowrap;
}

.llmlint-source-replacement-mark--delete[data-replacement-label]::after {
    content: none;
}

.llmlint-source-diff-inserted {
    background: color-mix(in srgb, #10b981 16%, transparent);
    box-shadow: inset 0 -2px 0 color-mix(in srgb, #10b981 70%, transparent);
}

.llmlint-source-diff-active {
    outline: 2px solid color-mix(in srgb, #10b981 58%, transparent);
    outline-offset: 1px;
}

.llmlint-source-diff-marker {
    position: relative;
}

.llmlint-source-diff-marker[data-diff-deleted-badge]::before {
    content: attr(data-diff-deleted-badge);
    position: absolute;
    left: 0;
    top: -0.78em;
    z-index: 3;
    display: inline-flex;
    min-width: 1rem;
    height: 1rem;
    align-items: center;
    justify-content: center;
    border: 1px solid color-mix(in srgb, #dc2626 72%, var(--bg-panel));
    border-radius: 999px;
    background: #dc2626;
    color: #fff;
    font-size: 0.625rem;
    font-weight: 700;
    line-height: 1;
    padding: 0 0.2rem;
    box-shadow: 0 1px 2px rgb(0 0 0 / 28%);
    white-space: nowrap;
}
</style>
