<script setup lang="ts">
import {computed, nextTick, ref, watch, onMounted, onBeforeUnmount} from "vue";
import type {HighlightRange, RuleLevel} from "../types";
import {heatColor} from "../utils/contribute-workspace";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";

// 行内高亮编辑器（Grammarly 式）：一个文字透明、只显示命中底色的「背板」，
// 上面浮一个透明底、文字可见的 textarea。两者盒模型完全一致，滚动同步 → 底色恰好落在命中词下方。
const text = defineModel<string>({required: true});
const props = defineProps<{
    ranges: HighlightRange[];
    commentRanges?: Array<{start: number; end: number; active?: boolean; resolved?: boolean; stale?: boolean; index?: number}>;
    /** 当前 active 命中的定位轮廓区间；建议（未应用替换）不在正文预画，null=无 active 命中。 */
    activeIssueRange?: {start: number; end: number} | null;
    diffRanges?: Array<{start: number; end: number; deleted: string; inserted: string; source: "static" | "llm"; title: string; active?: boolean}>;
    /** 列表点命中时传入要定位的绝对偏移；变化即滚动+闪烁该处。null=不定位。 */
    locateOffset?: number | null;
    /** Task 17 A2 热力层（draft 坐标）：非空时背板铺 P(AI) 梯度底色，命中高亮转下划线（W1 约定）。null/空 = 关。 */
    heat?: Array<{from: number; to: number; pAi: number}> | null;
}>();
const emit = defineEmits<{
    (e: "caret-click", offset: number, meta?: {origin: "pointer" | "keyboard"; collapsed: boolean}): void;
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
    hasStaleComment: boolean;
    commentIndex: number | null;
    hasActiveIssue: boolean;
    hasDiffInsertion: boolean;
    hasActiveDiff: boolean;
    diffDeleted: string | null;
    diffTitle: string | null;
    /** 覆盖该段的热力块 P(AI)；null=无热力（Task 17 A2）。 */
    heatPai: number | null;
    start: number;
};

// 热力层开关（Task 17 A2）：宿主传非空 heat 即开——命中级别底色转下划线，底色让给热力梯度。
const heatOn = computed(() => (props.heat?.length ?? 0) > 0);

// 按合并后的高亮区间，把整段文本切成 [普通 | 高亮] 段，并记录每段起始偏移（供定位）。
const segments = computed<Segment[]>(() => {
    const value = text.value;
    const ranges = props.ranges;
    const commentRanges = props.commentRanges ?? [];
    const activeIssue = props.activeIssueRange ?? null;
    const diffRanges = props.diffRanges ?? [];
    const heatRanges = props.heat ?? [];
    if (ranges.length === 0 && commentRanges.length === 0 && !activeIssue && diffRanges.length === 0 && heatRanges.length === 0) {
        return [
            {text: value, level: null, hasComment: false, hasActiveComment: false, hasResolvedComment: false, hasStaleComment: false, commentIndex: null, hasActiveIssue: false, hasDiffInsertion: false, hasActiveDiff: false, diffDeleted: null, diffTitle: null, heatPai: null, start: 0},
            {text: "\n", level: null, hasComment: false, hasActiveComment: false, hasResolvedComment: false, hasStaleComment: false, commentIndex: null, hasActiveIssue: false, hasDiffInsertion: false, hasActiveDiff: false, diffDeleted: null, diffTitle: null, heatPai: null, start: value.length},
        ];
    }
    const out: Segment[] = [];
    const boundaries = new Set<number>([0, value.length]);
    for (const range of [...ranges, ...commentRanges, ...(activeIssue ? [activeIssue] : []), ...diffRanges]) {
        boundaries.add(Math.max(0, Math.min(value.length, range.start)));
        boundaries.add(Math.max(0, Math.min(value.length, range.end)));
    }
    // 热力块边界（from/to 命名，与其余 range 的 start/end 分开收口）。
    for (const chunk of heatRanges) {
        boundaries.add(Math.max(0, Math.min(value.length, chunk.from)));
        boundaries.add(Math.max(0, Math.min(value.length, chunk.to)));
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
        const hasStaleComment = commentRanges.some((range) => range.stale && start < range.end && end > range.start);
        const commentStart = commentRanges.find((range) => range.index && start === Math.max(0, Math.min(value.length, range.start)));
        const hasActiveIssue = Boolean(activeIssue && start < activeIssue.end && end > activeIssue.start);
        const diff = diffRanges.find((range) => start < range.end && end > range.start);
        const diffMarker = diffRanges.find((range) => start === Math.max(0, Math.min(value.length, range.start)) && range.deleted);
        const activeDiff = diffRanges.some((range) => range.active && (start < range.end && end > range.start || start === Math.max(0, Math.min(value.length, range.start))));
        const heatChunk = heatRanges.find((chunk) => start < chunk.to && end > chunk.from);
        out.push({
            text: value.slice(start, end),
            level,
            hasComment,
            hasActiveComment,
            hasResolvedComment,
            hasStaleComment,
            commentIndex: commentStart?.index ?? null,
            hasActiveIssue,
            hasDiffInsertion: Boolean(diff?.inserted),
            hasActiveDiff: activeDiff,
            diffDeleted: diffMarker?.deleted ?? null,
            diffTitle: diffMarker?.title ?? diff?.title ?? null,
            heatPai: heatChunk?.pAi ?? null,
            start,
        });
    }
    // 末尾补一个换行，保证背板尾行高度与 textarea 一致。
    const endDiffMarker = diffRanges.find((range) => value.length === Math.max(0, Math.min(value.length, range.start)) && range.deleted);
    out.push({text: "\n", level: null, hasComment: false, hasActiveComment: false, hasResolvedComment: false, hasStaleComment: false, commentIndex: null, hasActiveIssue: false, hasDiffInsertion: false, hasActiveDiff: endDiffMarker?.active === true, diffDeleted: endDiffMarker?.deleted ?? null, diffTitle: endDiffMarker?.title ?? null, heatPai: null, start: value.length});
    return out;
});

const MARK_CLASS: Record<RuleLevel, string> = {
    high: "bg-red-400/45",
    medium: "bg-amber-400/45",
    low: "bg-zinc-400/45",
};

// 热力开时命中段转下划线（Task 17 A2，对齐 W1「底色 vs 下划线」约定）：底色让给热力梯度。
const HEAT_MARK_CLASS: Record<RuleLevel, string> = {
    high: "llmlint-source-heat-hit llmlint-source-heat-hit--high",
    medium: "llmlint-source-heat-hit llmlint-source-heat-hit--medium",
    low: "llmlint-source-heat-hit llmlint-source-heat-hit--low",
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
// origin 区分指针点击 / 键盘移动（Task 17 A2：只有指针点击且光标折叠才允许宿主开 inline 规则菜单）。
function emitCaret(origin: "pointer" | "keyboard"): void {
    const el = textareaEl.value;
    if (el) {
        emit("caret-click", el.selectionStart, {origin, collapsed: el.selectionStart === el.selectionEnd});
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

/**
 * 某偏移处光标的视口矩形（Task 17 A2）：inline 规则菜单在源码模式没有可锚的 DOM 节点，
 * 用镜像法算出光标坐标 + textarea 视口位置合成 floating-ui 虚拟锚点用的 DOMRect。
 * textarea 未挂载或偏移越界收敛后仍算不出时返回 null（宿主放弃开菜单）。
 */
function caretViewportRect(offset: number): DOMRect | null {
    const el = textareaEl.value;
    if (!el) {
        return null;
    }
    const clamped = Math.max(0, Math.min(text.value.length, offset));
    const anchor = textareaSelectionAnchor(el, clamped);
    const host = el.getBoundingClientRect();
    return new DOMRect(host.left + anchor.left, host.top + anchor.top, 1, anchor.height);
}

defineExpose({
    collapseSelection,
    revealOffset,
    caretViewportRect,
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
            :data-diff-deleted="seg.diffDeleted ?? undefined"
            :title="seg.diffTitle ?? undefined"
            :style="seg.heatPai !== null ? {backgroundColor: heatColor(seg.heatPai)} : undefined"
            :class="[
                seg.level ? `rounded ${heatOn ? HEAT_MARK_CLASS[seg.level] : MARK_CLASS[seg.level]}` : '',
                seg.hasActiveIssue ? 'llmlint-source-active-issue rounded' : '',
                seg.hasDiffInsertion ? 'llmlint-source-diff-inserted rounded' : '',
                seg.diffDeleted ? 'llmlint-source-diff-marker' : '',
                seg.hasActiveDiff ? 'llmlint-source-diff-active' : '',
                seg.hasComment ? 'llmlint-source-comment-mark rounded border-b-2 border-[var(--accent-main)] bg-[var(--accent-bg)]' : '',
                seg.hasStaleComment ? 'llmlint-source-comment-mark--stale' : '',
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
            @click="emitCaret('pointer')"
            @keyup="emitCaret('keyboard')"
            @keydown="handleKeydown"
            @keydown.esc.prevent="clearSelectionByEscape"
            @select="emitSelection"
            @mouseup="emitSelection"
        />
    </div>
</template>

<style scoped>
/* 热力开时的命中下划线（Task 17 A2）：背板文字透明但 text-decoration 单独着色可见，
   与 preview 热力模式（.is-heat）的「底色 vs 下划线」口径一致。 */
.llmlint-source-heat-hit {
    text-decoration-line: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 2px;
    text-decoration-skip-ink: none;
}

.llmlint-source-heat-hit--high {
    text-decoration-color: rgb(239, 68, 68);
}

.llmlint-source-heat-hit--medium {
    text-decoration-color: rgb(245, 158, 11);
}

.llmlint-source-heat-hit--low {
    text-decoration-color: rgb(161, 161, 170);
}

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

/* active 命中定位轮廓：只标注「当前命中在这里」，不在正文预画任何未应用的替换。 */
.llmlint-source-active-issue {
    outline: 2px solid color-mix(in srgb, var(--accent-main) 62%, transparent);
    outline-offset: 1px;
}

/* stale 批注：锚定的原句已被改写，点状橙色下划线区分（双类名压过 utility 边框色）。 */
.llmlint-source-comment-mark.llmlint-source-comment-mark--stale {
    border-bottom-style: dotted;
    border-bottom-color: #f97316;
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

.llmlint-source-diff-marker[data-diff-deleted]::before {
    content: attr(data-diff-deleted);
    position: absolute;
    left: 0;
    top: 0;
    z-index: 3;
    display: inline-block;
    max-width: 18rem;
    overflow: hidden;
    background: transparent;
    color: #dc2626;
    font-size: inherit;
    font-weight: 700;
    line-height: inherit;
    padding: 0;
    text-decoration-line: line-through;
    text-decoration-thickness: 2px;
    text-decoration-skip-ink: none;
    text-overflow: ellipsis;
    transform: none;
    white-space: nowrap;
}
</style>
