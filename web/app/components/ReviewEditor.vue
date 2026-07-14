<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onBeforeUpdate, onMounted, ref, watch, type ComponentPublicInstance} from "vue";
import {useWindowSize} from "@vueuse/core";
import {EditorContent, useEditor} from "@tiptap/vue-3";
import {Extension, type Editor} from "@tiptap/core";
import {Markdown} from "@tiptap/markdown";
import {StarterKit} from "@tiptap/starter-kit";
import {Placeholder} from "@tiptap/extension-placeholder";
import {Plugin, PluginKey, TextSelection} from "@tiptap/pm/state";
import {Decoration, DecorationSet} from "@tiptap/pm/view";
import type {HighlightRange} from "../types";
import type {ReviewComment, ReviewEditorMode, ReviewIssueMark, ReviewTextDiff, ReviewTextSelection} from "../utils/review-ranges";
import type {ProjectedHeatChunk} from "../utils/repair-draft";
import {heatColor, pAiPercent} from "../utils/contribute-workspace";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import {useNotification} from "../composables/useNotification";
import {useWebSettings} from "../composables/useWebSettings";
import {clampResizablePanelSize, useResizablePanel} from "../composables/useResizablePanel";
import {buildIssueOptimizationPrompt, buildSelectionOptimizationPrompt} from "../utils/llm-optimization-prompt";
import type {MarkdownFormatCommand} from "../utils/markdown-format-command";
import {markdownInferredLinkHref, markdownLinkCandidateText, markdownLinkRangeAtSelection} from "../utils/markdown-selection-state";
import {reviewReplacementActionLabel, reviewReplacementTitle} from "../utils/review-issue-ui";
import HighlightedTextarea from "./HighlightedTextarea.vue";
import ReviewSelectionMenu from "./ReviewSelectionMenu.vue";
import ReviewSourceSelectionMenu from "./ReviewSourceSelectionMenu.vue";
import RuleInlineMenu from "./RuleInlineMenu.vue";
import SegmentedControl, {type SegmentedOption} from "./common/SegmentedControl.vue";

const REVIEW_DECORATION_KEY = new PluginKey<DecorationSet>("llmlint-review-decorations");

const props = withDefaults(defineProps<{
    modelValue: string;
    mode: ReviewEditorMode;
    ranges: HighlightRange[];
    issueMarks: ReviewIssueMark[];
    comments: ReviewComment[];
    diffs?: ReviewTextDiff[];
    locateOffset?: number | null;
    activeIssueMark?: ReviewIssueMark | null;
    placeholder?: string;
    /** W7 F2：选区菜单「AI 改写选区」入口开关（宿主接了 llm-rewrite-selection 发起链才置真）。 */
    llmRewriteEnabled?: boolean;
    /** R5：AI 改写审阅横幅打开等场景由宿主强开 diff 层（无视 settings.draftDiff 开关）。 */
    forceDiffs?: boolean;
    /** R6：检测器热力块（**draft 坐标**，宿主经 projectHeatChunks 投影后传入）；null/缺省 = 无热力数据（开关也不显示）。 */
    heat?: ProjectedHeatChunk[] | null;
    /** Task 17 A3：源码选区菜单「保存标注」入口开关（宿主接了 save-annotation 落库链才置真）。 */
    annotateEnabled?: boolean;
}>(), {
    locateOffset: null,
    activeIssueMark: null,
    placeholder: "",
    llmRewriteEnabled: false,
    forceDiffs: false,
    heat: null,
    annotateEnabled: false,
});

// Task 17 拍板①：预览视图禁用待删除（代码保留）。工具栏隐藏「源码/预览」切换、Ctrl/Cmd+Alt+T
// 快捷键停用；宿主（TextPanel）强制 mode 恒为 "source"。预览相关代码不删，等后续拍板删除时一起清。
const previewDisabled = true;

type SelectionReplacement = {from: number; to: number; replacement: string};
type MarkdownBlockRange = {from: number; to: number; block: string};
type DiffReviewShortcut = "previous" | "next" | "clear";
type CommentReviewShortcut = "previous" | "next";
type SourceListFormatPayload = {
    command: "list-indent" | "list-outdent";
    selection: {start: number; end: number; text: string; anchor: {left: number; top: number; height: number; containerWidth: number; containerHeight: number; absoluteTop: number}};
    caretOffset: number;
};

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "update:mode", mode: ReviewEditorMode): void;
    (e: "caret-click", offset: number): void;
    (e: "add-comment", comment: Omit<ReviewComment, "id" | "source">): void;
    (e: "update-comment", id: string, body: string): void;
    (e: "toggle-comment-resolved", id: string): void;
    (e: "delete-comment", id: string): void;
    (e: "clear-comments"): void;
    (e: "clear-diff", id: string): void;
    (e: "clear-diffs"): void;
    (e: "accept-replacement", mark: ReviewIssueMark): void;
    (e: "hide-rule", ruleId: string): void;
    (e: "replace-selection", payload: {from: number; to: number; replacement: string; title?: string; source?: "static" | "llm"; notify?: "clipboard" | "format"}): void;
    (e: "llm-rewrite-selection", payload: {from: number; to: number; text: string; contextBefore: string; contextAfter: string}): void;
    (e: "save-annotation", payload: {from: number; to: number; text: string; note: string}): void;
}>();

const selected = ref<ReviewTextSelection | null>(null);
const activeCommentId = ref<string | null>(null);
const activeDiffId = ref<string | null>(null);
const editingCommentId = ref<string | null>(null);
const editingCommentBody = ref("");
const editingCommentInputs = new Map<string, HTMLTextAreaElement>();
const sourceEditor = ref<InstanceType<typeof HighlightedTextarea> | null>(null);
const commentResizeHandle = ref<HTMLElement | null>(null);
const pendingSourceOffset = ref<number | null>(null);
const commentsOpen = ref(true);
const activeIssueCommentOpen = ref(false);
const activeIssueCommentBody = ref("");
const activeIssueCommentInput = ref<HTMLTextAreaElement | null>(null);
const linkShortcutToken = ref(0);
const commentShortcutToken = ref(0);
// inline 规则菜单（R2）：点击命中高亮 / 校对符号后记录 mark + 锚元素，二者齐备才渲染菜单。
// Task 17 A2：源码模式点击命中段没有可锚 DOM 节点，锚放宽为 floating-ui 虚拟锚点。
const inlineMenuMark = ref<ReviewIssueMark | null>(null);
const inlineMenuAnchor = ref<HTMLElement | {getBoundingClientRect: () => DOMRect} | null>(null);
const {t} = useLlmlintI18n();
const notification = useNotification();
const {settings, patch} = useWebSettings();
const {width: viewportWidth} = useWindowSize();

const modeOptions = computed<SegmentedOption[]>(() => [
    {value: "source", label: t("review.modeSource"), title: t("review.modeSourceTitle")},
    {value: "preview", label: t("review.modePreview"), title: t("review.modePreviewTitle")},
]);

const activeReplacement = computed(() => props.activeIssueMark && props.activeIssueMark.replacement !== null ? props.activeIssueMark : null);
const selectionReplacement = computed(() => {
    const selection = selected.value;
    if (!selection?.mappable) {
        return null;
    }
    return bestIntersectingIssueMark(selection, (mark) => mark.replacement !== null);
});
const selectionIssueMark = computed(() => {
    const selection = selected.value;
    if (!selection?.mappable) {
        return null;
    }
    return bestIntersectingIssueMark(selection);
});
const sourceCommentRanges = computed(() => props.comments.map((comment) => ({
    start: comment.from,
    end: comment.to,
    active: comment.id === activeCommentId.value,
    resolved: comment.resolved === true,
    stale: comment.stale === true,
    index: commentIndexMap.value.get(comment.id) ?? 0,
})));
// 建议与已应用编辑显式分层：正文不再常驻画未应用替换（那会伪装成已应用改动），
// 只给 active 命中一个定位轮廓；替换预览文本走工具条按钮与选区菜单（按需可供性）。
const sourceActiveIssueRange = computed(() => props.activeIssueMark
    ? {start: props.activeIssueMark.from, end: props.activeIssueMark.to}
    : null);
// diff 层开关（R5）：settings.draftDiff（用户偏好）或 forceDiffs（宿主强开，AI 改写审阅期）
// 任一为真才消费 props.diffs；关闭时全部 diff 消费点（渲染/计数/巡检队列）读到空表。
const effectiveDiffs = computed<ReviewTextDiff[]>(() => (settings.value.draftDiff || props.forceDiffs) ? (props.diffs ?? []) : []);
// 编辑器热力层开关（R6）：偏好开 + 宿主传了非空热力块才生效。
const heatActive = computed(() => settings.value.editorHeatmap && (props.heat?.length ?? 0) > 0);
const sourceDiffRanges = computed(() => effectiveDiffs.value.map((diff) => ({
    start: diff.from,
    end: diff.to,
    deleted: diffTextLabel(diff.deleted),
    inserted: diff.inserted,
    source: diff.source,
    title: diff.title,
    active: diff.id === activeDiffId.value,
})));
const unresolvedCommentCount = computed(() => props.comments.filter((comment) => comment.resolved !== true).length);
const diffCount = computed(() => effectiveDiffs.value.length);
const diffReviewQueue = computed(() => [...effectiveDiffs.value].sort((left, right) => left.from - right.from || left.id.localeCompare(right.id)));
const activeDiffIndex = computed(() => activeDiffId.value ? diffReviewQueue.value.findIndex((diff) => diff.id === activeDiffId.value) : -1);
const diffReviewLabel = computed(() => {
    const queue = diffReviewQueue.value;
    if (queue.length === 0) {
        return "0/0";
    }
    if (activeDiffIndex.value < 0) {
        return `0/${queue.length}`;
    }
    return `${activeDiffIndex.value + 1}/${queue.length}`;
});
const commentIndexMap = computed(() => new Map(props.comments.map((comment, index) => [comment.id, index + 1])));
const replaceableIssueCount = computed(() => props.issueMarks.filter((mark) => mark.replacement !== null).length);
const replacementIssueCount = computed(() => props.issueMarks.filter((mark) => mark.replacement !== null && mark.replacement !== "").length);
const deleteIssueCount = computed(() => props.issueMarks.filter((mark) => mark.replacement === "").length);
// 校对批注层开关（Task 15 P2-E 7b）：偏好记忆在 settings.proofreadMarks；只影响 preview 装饰渲染。
const proofreadEnabled = computed(() => settings.value.proofreadMarks);
const selectedLength = computed(() => selected.value?.mappable ? selected.value.end - selected.value.start : 0);
const commentReviewQueue = computed(() => {
    const unresolved = props.comments.filter((comment) => comment.resolved !== true);
    return unresolved.length > 0 ? unresolved : props.comments;
});
const activeQueueIndex = computed(() => activeCommentId.value ? commentReviewQueue.value.findIndex((comment) => comment.id === activeCommentId.value) : -1);
const commentReviewLabel = computed(() => {
    const queue = commentReviewQueue.value;
    if (queue.length === 0) {
        return "0/0";
    }
    if (activeQueueIndex.value < 0) {
        return `0/${queue.length}`;
    }
    return `${activeQueueIndex.value + 1}/${queue.length}`;
});
const previousCommentTitle = computed(() => t(unresolvedCommentCount.value > 0 ? "review.previousUnresolvedCommentTitle" : "review.previousCommentTitle"));
const nextCommentTitle = computed(() => t(unresolvedCommentCount.value > 0 ? "review.nextUnresolvedCommentTitle" : "review.nextCommentTitle"));
const previousDiffTitle = computed(() => t("review.previousDiffTitle"));
const nextDiffTitle = computed(() => t("review.nextDiffTitle"));
const clearCurrentDiffTitle = computed(() => activeDiffId.value ? t("review.clearCurrentDiffTitle") : t("review.selectDiffFirstTitle"));
const copyCurrentDiffTitle = computed(() => activeDiffId.value ? t("review.copyDiffContextTitle") : t("review.selectDiffFirstTitle"));
const canResizeComments = computed(() => viewportWidth.value >= 768 && commentsOpen.value && props.comments.length > 0);
const commentPanelMinWidth = computed(() => Math.min(280, Math.max(240, viewportWidth.value - 96)));
const commentPanelMaxWidth = computed(() => Math.max(commentPanelMinWidth.value, Math.min(560, Math.floor(viewportWidth.value * 0.42))));
const commentPanelResizeStep = 24;
const {isResizing: isCommentPanelResizing, panelStyle: commentPanelStyle} = useResizablePanel(commentResizeHandle, {
    size: computed(() => settings.value.reviewCommentPanelWidth),
    minSize: commentPanelMinWidth,
    maxSize: commentPanelMaxWidth,
    edge: "left",
    enabled: canResizeComments,
    syncDuringResize: true,
    onResize: (value) => patch({reviewCommentPanelWidth: value}),
    onResizeEnd: (value) => patch({reviewCommentPanelWidth: value}),
});

/**
 * 提交批注栏宽度，和拖拽路径共用当前视口下的尺寸边界。
 */
function commitCommentPanelWidth(value: number): void {
    patch({
        reviewCommentPanelWidth: clampResizablePanelSize(value, commentPanelMinWidth.value, commentPanelMaxWidth.value),
    });
}

/**
 * 支持键盘调整批注栏宽度：方向键移动分隔线，Home/End 快速收放。
 */
function handleCommentResizeKeydown(event: KeyboardEvent): void {
    if (!canResizeComments.value) {
        return;
    }

    const currentWidth = settings.value.reviewCommentPanelWidth;
    const step = event.shiftKey ? commentPanelResizeStep * 3 : commentPanelResizeStep;
    if (event.key === "ArrowLeft") {
        event.preventDefault();
        commitCommentPanelWidth(currentWidth + step);
        return;
    }
    if (event.key === "ArrowRight") {
        event.preventDefault();
        commitCommentPanelWidth(currentWidth - step);
        return;
    }
    if (event.key === "Home") {
        event.preventDefault();
        commitCommentPanelWidth(commentPanelMinWidth.value);
        return;
    }
    if (event.key === "End") {
        event.preventDefault();
        commitCommentPanelWidth(commentPanelMaxWidth.value);
    }
}

function diffTextLabel(value: string): string {
    const visible = value
        .replaceAll("\u200b", t("review.zeroWidthSpace"))
        .replaceAll("\u200c", t("review.zeroWidthNonJoiner"))
        .replaceAll("\u200d", t("review.zeroWidthJoiner"))
        .replaceAll("\ufeff", t("review.byteOrderMark"))
        .replaceAll(" ", "␠")
        .replaceAll("\n", "↵");
    return visible || t("review.emptyText");
}

function compactReviewLabel(value: string): string {
    const visible = value
        .replaceAll("\u200b", t("review.zeroWidthSpace"))
        .replaceAll("\u200c", t("review.zeroWidthNonJoiner"))
        .replaceAll("\u200d", t("review.zeroWidthJoiner"))
        .replaceAll("\ufeff", t("review.byteOrderMark"))
        .replace(/\s+/g, " ")
        .trim() || t("review.emptyText");
    return visible.length > 42 ? `${visible.slice(0, 42)}...` : visible;
}

function commentActionTitle(base: string, comment: ReviewComment): string {
    return `${base}: ${compactReviewLabel(comment.quote)}`;
}

function replacementLabel(mark: ReviewIssueMark): string {
    return mark.replacement === "" ? t("review.delete") : mark.replacement ?? "";
}

function replacementTitle(mark: ReviewIssueMark): string {
    return reviewReplacementTitle(mark, t);
}

function activeReplacementTitle(mark: ReviewIssueMark): string {
    return `${replacementTitle(mark)} · ${t("review.activeReplacementTitle")}`;
}

function replacementActionLabel(mark: ReviewIssueMark, applyPrefix = false): string {
    return reviewReplacementActionLabel(mark, t, {applyPrefix});
}

function diffTitle(diff: ReviewTextDiff): string {
    return `${diff.title} · ${t("review.selectDiffTitle")}`;
}

function issuePriority(mark: ReviewIssueMark): number {
    if (mark.level === "high") {
        return 3;
    }
    if (mark.level === "medium") {
        return 2;
    }
    return 1;
}

function overlapSize(selection: ReviewTextSelection, mark: ReviewIssueMark): number {
    return Math.max(0, Math.min(selection.end, mark.to) - Math.max(selection.start, mark.from));
}

function bestIntersectingIssueMark(
    selection: ReviewTextSelection,
    predicate: (mark: ReviewIssueMark) => boolean = () => true,
): ReviewIssueMark | null {
    return [...props.issueMarks]
        .filter((mark) => predicate(mark) && selection.start < mark.to && selection.end > mark.from)
        .sort((left, right) => {
            const levelDelta = issuePriority(right) - issuePriority(left);
            if (levelDelta !== 0) {
                return levelDelta;
            }
            const overlapDelta = overlapSize(selection, right) - overlapSize(selection, left);
            if (overlapDelta !== 0) {
                return overlapDelta;
            }
            return left.from - right.from;
        })[0] ?? null;
}

const reviewDecorationExtension = Extension.create({
    name: "llmlintReviewDecorations",
    addProseMirrorPlugins() {
        return [
            new Plugin<DecorationSet>({
                key: REVIEW_DECORATION_KEY,
                state: {
                    init: () => DecorationSet.empty,
                    apply(transaction, previous) {
                        const next = transaction.getMeta(REVIEW_DECORATION_KEY) as DecorationSet | undefined;
                        if (next) {
                            return next;
                        }
                        return transaction.docChanged ? previous.map(transaction.mapping, transaction.doc) : previous;
                    },
                },
                props: {
                    decorations(state) {
                        return REVIEW_DECORATION_KEY.getState(state) ?? DecorationSet.empty;
                    },
                },
            }),
        ];
    },
});

const editor = useEditor({
    content: props.modelValue,
    contentType: "markdown",
    editable: false,
    extensions: [
        Markdown,
        StarterKit.configure({
            trailingNode: false,
        }),
        Placeholder.configure({
            placeholder: props.placeholder,
            emptyEditorClass: "is-editor-empty",
        }),
        reviewDecorationExtension,
    ],
    editorProps: {
        attributes: {
            class: "llmlint-review-preview min-h-full outline-none",
            spellcheck: "false",
        },
        handleClick: (_view, _position, event) => {
            const target = event.target as HTMLElement | null;
            // 校对批注符号（7b + R2 行为反转）：点击建议文本 / 删除角标打开 inline 规则菜单（应用/隐藏在菜单里做）。
            const proofreadNode = target?.closest<HTMLElement>("[data-proofread-issue-id]");
            if (proofreadNode?.dataset.proofreadIssueId) {
                const mark = props.issueMarks.find((item) => item.id === proofreadNode.dataset.proofreadIssueId);
                if (mark) {
                    openRuleMenu(mark, proofreadNode);
                }
                return true;
            }
            const commentNode = target?.closest<HTMLElement>(".llmlint-comment-mark");
            if (commentNode?.dataset.commentId) {
                void activateComment(commentNode.dataset.commentId);
                return true;
            }
            const diffNode = target?.closest<HTMLElement>("[data-diff-id]");
            if (diffNode?.dataset.diffId) {
                void activateDiff(diffNode.dataset.diffId);
                return true;
            }
            const issueNode = target?.closest<HTMLElement>(".llmlint-issue-mark");
            if (!issueNode) {
                return false;
            }
            const from = Number(issueNode.dataset.reviewFrom ?? NaN);
            if (Number.isFinite(from)) {
                // 保留 caret-click（命中列表联动），同时打开 inline 规则菜单（R2）。
                emit("caret-click", from);
                const mark = props.issueMarks.find((item) => item.from === from && item.ruleId === issueNode.dataset.ruleId);
                if (mark) {
                    openRuleMenu(mark, issueNode);
                }
                return true;
            }
            return false;
        },
        handleDOMEvents: {
            mouseup: () => {
                window.requestAnimationFrame(() => {
                    const currentEditor = editor.value;
                    if (currentEditor) {
                        syncPreviewDomSelection(currentEditor);
                    }
                });
                return false;
            },
            keydown: (_view, event) => {
                if (event.key !== "Escape" || selected.value?.source !== "preview") {
                    return false;
                }
                event.preventDefault();
                clearSelectionState();
                return true;
            },
        },
    },
    onCreate: ({editor: currentEditor}) => {
        refreshDecorations(currentEditor);
    },
    onSelectionUpdate: ({editor: currentEditor}) => {
        selected.value = selectionFromPreview(currentEditor);
    },
});

watch(() => props.modelValue, (value) => {
    const currentEditor = editor.value;
    if (!currentEditor || value === currentEditor.getMarkdown()) {
        return;
    }
    currentEditor.commands.setContent(value, {contentType: "markdown", emitUpdate: false});
    nextTick(() => refreshDecorations());
});

watch(() => [props.issueMarks, props.comments, effectiveDiffs.value, props.modelValue, props.activeIssueMark] as const, () => {
    if (activeCommentId.value && !props.comments.some((comment) => comment.id === activeCommentId.value)) {
        activeCommentId.value = null;
    }
    if (activeDiffId.value && !effectiveDiffs.value.some((diff) => diff.id === activeDiffId.value)) {
        activeDiffId.value = null;
    }
    if (editingCommentId.value && !props.comments.some((comment) => comment.id === editingCommentId.value)) {
        editingCommentId.value = null;
        editingCommentBody.value = "";
    }
    refreshDecorations();
}, {deep: true});

// 正文或命中集变更（应用替换 / 重扫 / 隐藏规则）→ inline 规则菜单立即失效关闭（R2）。
// 不并入上面的 deep watch：那里还监听 activeIssueMark，而 caret-click 联动会改它——菜单会刚开就被关。
watch(() => [props.modelValue, props.issueMarks] as const, () => {
    closeRuleMenu();
});

// 热力层开关 / 热力块数据变化时重建预览装饰（R6）。
watch(() => [heatActive.value, props.heat] as const, () => {
    refreshDecorations();
});

watch(() => props.comments.map((comment) => comment.id), (ids, previousIds) => {
    const previous = new Set(previousIds);
    const added = ids.filter((id) => !previous.has(id));
    const latest = added[added.length - 1];
    if (latest) {
        activateNewComment(latest);
    }
});

watch(() => [props.mode, props.locateOffset, props.activeIssueMark?.id] as const, () => {
    if (props.mode === "preview") {
        void refreshPreviewDecorationsAfterMount();
    }
    void scrollLocatedIssueIntoView();
}, {flush: "post"});

watch(() => props.activeIssueMark?.id, () => {
    closeActiveIssueComment();
});

watch(activeDiffId, () => {
    refreshDecorations();
});

// 校对批注开关变化时重建装饰（装饰集里含校对删除线与建议 widget）。
watch(proofreadEnabled, () => {
    refreshDecorations();
});

watch(() => props.mode, async (mode) => {
    if (mode !== "source" || pendingSourceOffset.value === null) {
        return;
    }
    const offset = pendingSourceOffset.value;
    pendingSourceOffset.value = null;
    await nextTick();
    sourceEditor.value?.revealOffset(offset);
});

onMounted(() => {
    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    document.addEventListener("keydown", handleDocumentKeyDown);
});

onBeforeUnmount(() => {
    document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
    document.removeEventListener("keydown", handleDocumentKeyDown);
});

onBeforeUpdate(() => {
    editingCommentInputs.clear();
});

function updateMode(value: string | number | boolean): void {
    const sourceOffset = selected.value?.source === "source" ? selected.value.end : undefined;
    clearSelectionState(sourceOffset);
    closeRuleMenu();
    emit("update:mode", value === "preview" ? "preview" : "source");
}

/** 打开 inline 规则菜单（R2 preview 装饰点击 / Task 17 A2 源码命中点击——后者传虚拟锚点）。 */
function openRuleMenu(mark: ReviewIssueMark, anchor: HTMLElement | {getBoundingClientRect: () => DOMRect}): void {
    inlineMenuMark.value = mark;
    inlineMenuAnchor.value = anchor;
}

/** 关闭 inline 规则菜单。 */
function closeRuleMenu(): void {
    inlineMenuMark.value = null;
    inlineMenuAnchor.value = null;
}

/** 菜单「应用替换」：走既有 acceptReplacement（static splice / provenance 语义不变）。 */
function handleRuleMenuApply(mark: ReviewIssueMark): void {
    closeRuleMenu();
    if (mark.replacement !== null) {
        acceptReplacement(mark);
    }
}

/** 菜单「隐藏此规则」：向宿主上抛 ruleId（TextPanel 写 ruleOverrides 并给撤销通知）。 */
function handleRuleMenuHide(ruleId: string): void {
    closeRuleMenu();
    emit("hide-rule", ruleId);
}

/** 切换 diff 层显示（R5，偏好记忆；forceDiffs 强开期间开关不影响显隐）。 */
function toggleDraftDiff(): void {
    patch({draftDiff: !settings.value.draftDiff});
}

/** 切换编辑器热力层（R6，偏好记忆；watch 会随之重建预览装饰）。 */
function toggleEditorHeatmap(): void {
    patch({editorHeatmap: !settings.value.editorHeatmap});
}

/** 切换校对批注层（偏好记忆；watch 会随之重建预览装饰）。 */
function toggleProofreadMarks(): void {
    patch({proofreadMarks: !settings.value.proofreadMarks});
}

function updateSource(value: string): void {
    emit("update:modelValue", value);
}

async function scrollLocatedIssueIntoView(): Promise<void> {
    if (props.mode !== "preview") {
        return;
    }
    const offset = props.activeIssueMark?.from ?? props.locateOffset;
    if (offset === null || offset === undefined) {
        return;
    }
    await nextTick();
    await waitForFrame();
    await waitForFrame();
    const host = editor.value?.view.dom;
    const mark = host?.querySelector<HTMLElement>(`[data-review-from="${String(offset)}"]`);
    const container = host?.closest<HTMLElement>(".llmlint-review-editor");
    if (!mark || !container) {
        return;
    }
    const markRect = mark.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const target = container.scrollTop + markRect.top - containerRect.top - container.clientHeight / 2 + markRect.height / 2;
    container.scrollTo({top: Math.max(0, target), behavior: "auto"});
}

function waitForFrame(): Promise<void> {
    return new Promise((resolve) => {
        window.requestAnimationFrame(() => resolve());
    });
}

function syncPreviewDomSelection(currentEditor: Editor): void {
    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0 || domSelection.isCollapsed) {
        return;
    }
    const anchorNode = domSelection.anchorNode;
    const focusNode = domSelection.focusNode;
    if (!anchorNode || !focusNode || !currentEditor.view.dom.contains(anchorNode) || !currentEditor.view.dom.contains(focusNode)) {
        return;
    }
    try {
        const anchorPosition = currentEditor.view.posAtDOM(anchorNode, domSelection.anchorOffset);
        const focusPosition = currentEditor.view.posAtDOM(focusNode, domSelection.focusOffset);
        const from = Math.min(anchorPosition, focusPosition);
        const to = Math.max(anchorPosition, focusPosition);
        if (from === to || (from === currentEditor.state.selection.from && to === currentEditor.state.selection.to)) {
            return;
        }
        currentEditor.view.dispatch(currentEditor.state.tr.setSelection(TextSelection.create(currentEditor.state.doc, from, to)));
        selected.value = selectionFromPreview(currentEditor);
    } catch {
        // Some browser selections, especially around inline atoms, cannot be mapped by ProseMirror.
    }
}

async function refreshPreviewDecorationsAfterMount(): Promise<void> {
    await nextTick();
    await waitForFrame();
    refreshDecorations();
}

function handleSourceSelection(selection: {start: number; end: number; text: string; anchor: {left: number; top: number; height: number; containerWidth: number; containerHeight: number; absoluteTop: number}} | null): void {
    selected.value = selection
        ? {...selection, source: "source", mappable: true}
        : null;
}

function handleSourceFormatCommand(payload: SourceListFormatPayload): void {
    const change = formatMarkdownBlock(props.modelValue, payload.selection.start, payload.selection.end, payload.command);
    if (!change || props.modelValue.slice(change.from, change.to) === change.replacement) {
        return;
    }
    const targetOffset = adjustedSourceCaretOffset(props.modelValue, change, payload.caretOffset);
    emit("replace-selection", {
        from: change.from,
        to: change.to,
        replacement: change.replacement,
        source: "static",
        title: t("review.formatDiffTitle"),
        notify: "format",
    });
    selected.value = null;
    nextTick(() => {
        sourceEditor.value?.collapseSelection(targetOffset);
    });
    emit("caret-click", targetOffset);
}

function handleSourceCaretClick(offset: number, meta?: {origin: "pointer" | "keyboard"; collapsed: boolean}): void {
    emit("caret-click", offset);
    const diff = diffAtSourceOffset(offset);
    if (diff) {
        activeDiffId.value = diff.id;
    }
    const comment = props.comments.find((item) => offset >= item.from && offset < item.to);
    if (comment) {
        void activateComment(comment.id);
        return;
    }
    // Task 17 A2「点到什么开什么」：批注 > diff > 命中菜单——有 diff 时保留 diff 激活语义，不叠开菜单。
    if (diff) {
        return;
    }
    // 只有指针点击且光标折叠才开 inline 规则菜单（键盘移动 / 拖选不触发）；锚点用镜像法算出的虚拟光标矩形。
    if (meta?.origin !== "pointer" || !meta.collapsed) {
        return;
    }
    const mark = props.issueMarks.find((item) => offset >= item.from && offset < item.to);
    if (!mark) {
        closeRuleMenu();
        return;
    }
    const rect = sourceEditor.value?.caretViewportRect(offset);
    if (rect) {
        openRuleMenu(mark, {getBoundingClientRect: () => rect});
    }
}

function diffAtSourceOffset(offset: number): ReviewTextDiff | null {
    return diffReviewQueue.value.find((diff) => {
        if (diff.from === diff.to) {
            return offset === diff.from;
        }
        return offset >= diff.from && offset <= diff.to;
    }) ?? null;
}

function handleDocumentPointerDown(event: PointerEvent): void {
    if (!selected.value) {
        return;
    }
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) {
        return;
    }
    if (selected.value.source === "source") {
        if (target.closest(".llmlint-source-editor-surface") || target.closest(".review-source-selection-menu")) {
            return;
        }
        clearSelectionState(selected.value.end);
        return;
    }
    if (target.closest(".llmlint-review-editor") || target.closest(".review-selection-menu")) {
        return;
    }
    clearSelectionState();
}

function handleDocumentKeyDown(event: KeyboardEvent): void {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const diffShortcut = diffReviewShortcut(event);
    if (diffShortcut && !isReviewTextInput(target)) {
        if ((diffShortcut === "clear" && !activeDiffId.value) || (diffShortcut !== "clear" && diffCount.value === 0)) {
            return;
        }
        event.preventDefault();
        if (diffShortcut === "clear") {
            clearActiveDiff();
            return;
        }
        navigateDiff(diffShortcut);
        return;
    }
    if (isDiffContextShortcut(event) && !isReviewTextInput(target)) {
        if (!activeDiffId.value) {
            return;
        }
        event.preventDefault();
        void copyActiveDiffContext();
        return;
    }
    const commentReviewCommand = commentReviewShortcut(event);
    if (commentReviewCommand && !isReviewTextInput(target)) {
        if (commentReviewQueue.value.length === 0) {
            return;
        }
        event.preventDefault();
        commentsOpen.value = true;
        navigateComment(commentReviewCommand);
        return;
    }
    if (isCommentResolveShortcut(event) && !isReviewTextInput(target)) {
        const activeComment = activeCommentId.value ? props.comments.find((comment) => comment.id === activeCommentId.value) : null;
        if (!activeComment) {
            return;
        }
        event.preventDefault();
        commentsOpen.value = true;
        toggleCommentResolvedFromRail(activeComment);
        return;
    }
    if (isCommentEditShortcut(event) && !isReviewTextInput(target)) {
        const activeComment = activeCommentId.value ? props.comments.find((comment) => comment.id === activeCommentId.value) : null;
        if (!activeComment) {
            return;
        }
        event.preventDefault();
        commentsOpen.value = true;
        startEditComment(activeComment);
        return;
    }
    if (isCommentContextShortcut(event) && !isReviewTextInput(target)) {
        const activeComment = activeCommentId.value ? props.comments.find((comment) => comment.id === activeCommentId.value) : null;
        if (!activeComment) {
            return;
        }
        event.preventDefault();
        commentsOpen.value = true;
        void copyCommentContext(activeComment);
        return;
    }
    if (isCommentShortcut(event) && !isReviewTextInput(target)) {
        if (selected.value?.mappable) {
            event.preventDefault();
            commentShortcutToken.value += 1;
            return;
        }
        if (!selected.value && props.activeIssueMark) {
            event.preventDefault();
            openActiveIssueComment();
            return;
        }
    }
    if (isActiveIssuePromptShortcut(event) && !isReviewTextInput(target)) {
        if (selected.value?.mappable) {
            event.preventDefault();
            void copySelectedOptimizationPrompt();
            return;
        }
        if (props.activeIssueMark) {
            event.preventDefault();
            void copyActiveIssuePrompt();
            return;
        }
    }
    if (isActiveReplacementShortcut(event) && activeReplacement.value && !isReviewTextInput(target)) {
        event.preventDefault();
        acceptReplacement(activeReplacement.value);
        return;
    }
    if (isSelectionClipboardReplaceShortcut(event) && selected.value?.mappable && !isReviewTextInput(target)) {
        event.preventDefault();
        void replaceSelectionWithClipboard();
        return;
    }
    if (isModeToggleShortcut(event) && !isReviewTextInput(target)) {
        // Task 17 拍板①：预览禁用期间源码/预览切换快捷键停用（吞掉事件避免落到浏览器默认行为之外的旧语义）。
        if (previewDisabled) {
            return;
        }
        event.preventDefault();
        updateMode(props.mode === "source" ? "preview" : "source");
        return;
    }
    if (isLinkShortcut(event) && selected.value?.mappable && !isReviewTextInput(target)) {
        event.preventDefault();
        linkShortcutToken.value += 1;
        return;
    }
    const formatCommand = formatCommandFromShortcut(event);
    if (formatCommand && selected.value?.mappable && !isReviewTextInput(target)) {
        event.preventDefault();
        formatSelection(formatCommand);
        return;
    }
    if (event.key === "Escape" && activeIssueCommentOpen.value) {
        event.preventDefault();
        closeActiveIssueComment();
        return;
    }
    if (event.key !== "Escape" || event.defaultPrevented || selected.value?.source !== "preview") {
        return;
    }
    if (target?.closest(".review-selection-menu")) {
        return;
    }
    event.preventDefault();
    clearSelectionState();
}

function diffReviewShortcut(event: KeyboardEvent): DiffReviewShortcut | null {
    if (event.defaultPrevented || (!event.ctrlKey && !event.metaKey) || !event.altKey || event.shiftKey) {
        return null;
    }
    const key = event.key.toLowerCase();
    if (key === "n") {
        return "next";
    }
    if (key === "p") {
        return "previous";
    }
    if (event.key === "Enter") {
        return "clear";
    }
    return null;
}

function isDiffContextShortcut(event: KeyboardEvent): boolean {
    return !event.defaultPrevented
        && (event.ctrlKey || event.metaKey)
        && event.altKey
        && event.shiftKey
        && event.key.toLowerCase() === "c";
}

function commentReviewShortcut(event: KeyboardEvent): CommentReviewShortcut | null {
    if (event.defaultPrevented || (!event.ctrlKey && !event.metaKey) || !event.altKey || event.shiftKey) {
        return null;
    }
    const key = event.key.toLowerCase();
    if (key === "j") {
        return "next";
    }
    if (key === "k") {
        return "previous";
    }
    return null;
}

function isCommentShortcut(event: KeyboardEvent): boolean {
    return !event.defaultPrevented
        && (event.ctrlKey || event.metaKey)
        && event.altKey
        && !event.shiftKey
        && event.key.toLowerCase() === "m";
}

function isCommentResolveShortcut(event: KeyboardEvent): boolean {
    return !event.defaultPrevented
        && (event.ctrlKey || event.metaKey)
        && event.altKey
        && !event.shiftKey
        && event.key.toLowerCase() === "d";
}

function isCommentEditShortcut(event: KeyboardEvent): boolean {
    return !event.defaultPrevented
        && (event.ctrlKey || event.metaKey)
        && event.altKey
        && !event.shiftKey
        && event.key.toLowerCase() === "e";
}

function isCommentContextShortcut(event: KeyboardEvent): boolean {
    return !event.defaultPrevented
        && (event.ctrlKey || event.metaKey)
        && event.altKey
        && !event.shiftKey
        && event.key.toLowerCase() === "c";
}

function isActiveIssuePromptShortcut(event: KeyboardEvent): boolean {
    return !event.defaultPrevented
        && (event.ctrlKey || event.metaKey)
        && event.altKey
        && !event.shiftKey
        && event.key.toLowerCase() === "l";
}

function isActiveReplacementShortcut(event: KeyboardEvent): boolean {
    return !event.defaultPrevented
        && (event.ctrlKey || event.metaKey)
        && event.altKey
        && !event.shiftKey
        && event.key.toLowerCase() === "r";
}

function isSelectionClipboardReplaceShortcut(event: KeyboardEvent): boolean {
    return !event.defaultPrevented
        && (event.ctrlKey || event.metaKey)
        && event.altKey
        && !event.shiftKey
        && event.key.toLowerCase() === "v";
}

function isModeToggleShortcut(event: KeyboardEvent): boolean {
    return !event.defaultPrevented
        && (event.ctrlKey || event.metaKey)
        && event.altKey
        && !event.shiftKey
        && event.key.toLowerCase() === "t";
}

function isLinkShortcut(event: KeyboardEvent): boolean {
    return !event.defaultPrevented
        && (event.ctrlKey || event.metaKey)
        && !event.altKey
        && !event.shiftKey
        && event.key.toLowerCase() === "k";
}

function formatCommandFromShortcut(event: KeyboardEvent): MarkdownFormatCommand | null {
    if (event.defaultPrevented || (!event.ctrlKey && !event.metaKey)) {
        return null;
    }
    const key = event.key.toLowerCase();
    if (event.altKey && !event.shiftKey) {
        if (event.code === "Digit0" || key === "0") {
            return "paragraph";
        }
        if (event.code === "Digit1" || key === "1") {
            return "heading-1";
        }
        if (event.code === "Digit2" || key === "2") {
            return "heading-2";
        }
        if (event.code === "Digit3" || key === "3") {
            return "heading-3";
        }
        return null;
    }
    if (event.shiftKey && !event.altKey) {
        if (key === "x") {
            return "strike";
        }
        if (event.code === "Digit7" || key === "7") {
            return "ordered-list";
        }
        if (event.code === "Digit8" || key === "8") {
            return "bullet-list";
        }
        return null;
    }
    if (event.altKey) {
        return null;
    }
    if (key === "b") {
        return "bold";
    }
    if (key === "i") {
        return "italic";
    }
    if (event.key === "`" || event.code === "Backquote") {
        return "code";
    }
    if (event.key === "\\" || event.code === "Backslash") {
        return "clear-formatting";
    }
    return null;
}

function isReviewTextInput(target: HTMLElement | null): boolean {
    return Boolean(target?.closest([
        "[data-review-comment-input='true']",
        "[data-review-source-comment-input='true']",
        "[data-review-source-annotation-input='true']",
        "[data-review-active-issue-comment-input='true']",
        "[data-review-link-input='true']",
        "[data-review-source-link-input='true']",
        "[data-comment-edit-id]",
    ].join(",")));
}

function addInlineComment(body: string): void {
    if (!selected.value?.mappable) {
        return;
    }
    const selection = selected.value;
    emit("add-comment", {
        from: selection.start,
        to: selection.end,
        quote: selection.text,
        body,
        resolved: false,
    });
    clearSelectionState(selection.end);
}

function openActiveIssueComment(): void {
    if (!props.activeIssueMark) {
        return;
    }
    clearSelectionState();
    activeIssueCommentOpen.value = true;
    commentsOpen.value = true;
    nextTick(() => {
        activeIssueCommentInput.value?.focus();
    });
}

function submitActiveIssueComment(): void {
    const mark = props.activeIssueMark;
    const body = activeIssueCommentBody.value.trim();
    if (!mark || !body) {
        return;
    }
    emit("add-comment", {
        from: mark.from,
        to: mark.to,
        quote: props.modelValue.slice(mark.from, mark.to) || mark.match,
        body,
        resolved: false,
    });
    closeActiveIssueComment();
}

function closeActiveIssueComment(): void {
    activeIssueCommentOpen.value = false;
    activeIssueCommentBody.value = "";
}

async function copyActiveIssuePrompt(): Promise<void> {
    const mark = props.activeIssueMark;
    if (!mark) {
        return;
    }
    const prompt = buildIssueOptimizationPrompt({
        text: props.modelValue,
        issueMark: mark,
        comments: props.comments,
    });
    try {
        await navigator.clipboard.writeText(prompt);
        notification.success(t("notify.optimizationPromptCopied"));
    } catch {
        notification.error(t("notify.copyFailed"));
    }
}

async function copySelectedOptimizationPrompt(): Promise<void> {
    const selection = selected.value;
    if (!selection?.mappable) {
        return;
    }
    const prompt = buildSelectionOptimizationPrompt({
        selection,
        issueMark: selectionIssueMark.value,
        replacementMark: selectionReplacement.value,
        text: props.modelValue,
        comments: props.comments,
    });
    try {
        await navigator.clipboard.writeText(prompt);
        notification.success(t("notify.optimizationPromptCopied"));
    } catch {
        notification.error(t("notify.copyFailed"));
    }
}

async function copyCommentContext(comment: ReviewComment): Promise<void> {
    const status = comment.resolved ? t("review.commentResolved") : t("review.commentUnresolved");
    const text = [
        `${t("review.commentQuoteLabel")}: ${comment.quote}`,
        `${t("review.commentBodyLabel")}: ${comment.body}`,
        `${t("review.commentStatusLabel")}: ${status}`,
    ].join("\n");
    try {
        await navigator.clipboard.writeText(text);
        notification.success(t("notify.commentContextCopied"));
    } catch {
        notification.error(t("notify.copyFailed"));
    }
}

function diffContextValue(value: string): string {
    return value
        .replaceAll("\u200b", `[${t("review.zeroWidthSpace")}]`)
        .replaceAll("\u200c", `[${t("review.zeroWidthNonJoiner")}]`)
        .replaceAll("\u200d", `[${t("review.zeroWidthJoiner")}]`)
        .replaceAll("\ufeff", `[${t("review.byteOrderMark")}]`) || t("review.emptyText");
}

async function copyActiveDiffContext(): Promise<void> {
    const diff = activeDiffId.value ? effectiveDiffs.value.find((item) => item.id === activeDiffId.value) : null;
    if (!diff) {
        return;
    }
    const text = [
        `${t("review.diffTitleLabel")}: ${diff.title}`,
        `${t("review.diffSourceLabel")}: ${diff.source === "static" ? t("review.diffSourceStatic") : t("review.diffSourceLlm")}`,
        `${t("review.diffDeletedLabel")}: ${diffContextValue(diff.deleted)}`,
        `${t("review.diffInsertedLabel")}: ${diffContextValue(diff.inserted)}`,
    ].join("\n");
    try {
        await navigator.clipboard.writeText(text);
        notification.success(t("notify.diffContextCopied"));
    } catch {
        notification.error(t("notify.copyFailed"));
    }
}

function locateSelectionInSource(): void {
    if (!selected.value?.mappable) {
        return;
    }
    const offset = selected.value.start;
    pendingSourceOffset.value = offset;
    clearSelectionState();
    emit("update:mode", "source");
    emit("caret-click", offset);
}

function acceptReplacement(mark: ReviewIssueMark): void {
    clearSelectionState(mark.from + (mark.replacement?.length ?? 0));
    emit("accept-replacement", mark);
}

function replaceSelectionWithText(replacementText: string): void {
    const selection = selected.value;
    if (!selection?.mappable) {
        return;
    }
    const targetOffset = selection.start + replacementText.length;
    emit("replace-selection", {
        from: selection.start,
        to: selection.end,
        replacement: replacementText,
    });
    if (props.mode === "source") {
        selected.value = null;
        nextTick(() => {
            sourceEditor.value?.collapseSelection(targetOffset);
        });
    } else {
        clearSelectionState();
    }
    emit("caret-click", targetOffset);
}

async function replaceSelectionWithClipboard(): Promise<void> {
    if (!selected.value?.mappable) {
        return;
    }
    try {
        const clipboardText = await navigator.clipboard.readText();
        if (!clipboardText) {
            notification.info(t("notify.clipboardEmpty"));
            return;
        }
        replaceSelectionWithText(clipboardText);
    } catch {
        notification.error(t("notify.clipboardReadFailed"));
    }
}

// W7 F2 选区 AI 改写的上下文窗：前后各约 300 字（UTF-16 码元），与 Task 07「复制选区优化指令」
// 的局部语境思路一致——只给模型理解语境所需的邻近文本，不整篇随行。
const LLM_SELECTION_CONTEXT_CHARS = 300;

/**
 * 选区菜单「AI 改写选区」动作：把当前选区（draft 坐标）连同选中文本与前后文窗上抛给宿主
 * （contribute 据此发起 selection 模式 job）。text 用 modelValue 按坐标切出（mappable 选区
 * 满足 slice(start,end)===text，与宿主返回时的快照校验同口径）；发出后收起选区菜单，编辑不锁。
 */
function requestLlmSelectionRewrite(): void {
    const selection = selected.value;
    if (!selection?.mappable) {
        return;
    }
    const from = selection.start;
    const to = selection.end;
    emit("llm-rewrite-selection", {
        from,
        to,
        text: props.modelValue.slice(from, to),
        contextBefore: props.modelValue.slice(Math.max(0, from - LLM_SELECTION_CONTEXT_CHARS), from),
        contextAfter: props.modelValue.slice(to, Math.min(props.modelValue.length, to + LLM_SELECTION_CONTEXT_CHARS)),
    });
    clearSelectionState(selection.end);
}

/**
 * Task 17 A3 选区菜单「保存标注」：把当前选区（draft 坐标）+ 选中文本 + 标注正文上抛给宿主
 * （contribute 经 TextPanel 的 draft→source 映射把坐标锚回 head.body 再落库）。发出后收起选区菜单。
 */
function saveSelectionAnnotation(note: string): void {
    const selection = selected.value;
    if (!selection?.mappable) {
        return;
    }
    emit("save-annotation", {
        from: selection.start,
        to: selection.end,
        text: props.modelValue.slice(selection.start, selection.end),
        note,
    });
    clearSelectionState(selection.end);
}

function formatSelection(command: MarkdownFormatCommand): void {
    const selection = selected.value;
    if (!selection?.mappable) {
        return;
    }
    const change = command === "clear-formatting"
        ? formatMarkdownClear(props.modelValue, selection.start, selection.end)
        : command === "remove-link"
        ? formatMarkdownRemoveLink(props.modelValue, selection.start, selection.end)
        : isBlockFormatCommand(command)
        ? formatMarkdownBlock(props.modelValue, selection.start, selection.end, command)
        : formatMarkdownInline(props.modelValue, selection.start, selection.end, command);
    if (!change || props.modelValue.slice(change.from, change.to) === change.replacement) {
        return;
    }
    const targetOffset = change.from + change.replacement.length;
    if (props.mode === "preview") {
        clearSelectionState();
        void nextTick(() => {
            emit("replace-selection", {
                from: change.from,
                to: change.to,
                replacement: change.replacement,
                source: "static",
                title: t("review.formatDiffTitle"),
                notify: "format",
            });
            emit("caret-click", targetOffset);
        });
        return;
    }
    emit("replace-selection", {
        from: change.from,
        to: change.to,
        replacement: change.replacement,
        source: "static",
        title: t("review.formatDiffTitle"),
        notify: "format",
    });
    if (props.mode === "source") {
        selected.value = null;
        nextTick(() => {
            sourceEditor.value?.collapseSelection(targetOffset);
        });
    }
    emit("caret-click", targetOffset);
}

function linkSelection(href: string): void {
    const selection = selected.value;
    const trimmedHref = href.trim();
    if (!selection?.mappable || !trimmedHref) {
        return;
    }
    const change = formatMarkdownLink(props.modelValue, selection.start, selection.end, trimmedHref);
    if (!change || props.modelValue.slice(change.from, change.to) === change.replacement) {
        return;
    }
    const targetOffset = change.from + change.replacement.length;
    emit("replace-selection", {
        from: change.from,
        to: change.to,
        replacement: change.replacement,
        source: "static",
        title: t("review.linkDiffTitle"),
        notify: "format",
    });
    if (props.mode === "source") {
        selected.value = null;
        nextTick(() => {
            sourceEditor.value?.collapseSelection(targetOffset);
        });
    } else {
        clearSelectionState();
    }
    emit("caret-click", targetOffset);
}

function isBlockFormatCommand(command: MarkdownFormatCommand): command is "paragraph" | "heading-1" | "heading-2" | "heading-3" | "blockquote" | "bullet-list" | "ordered-list" | "list-indent" | "list-outdent" | "code-block" {
    return command === "paragraph"
        || command === "heading-1"
        || command === "heading-2"
        || command === "heading-3"
        || command === "blockquote"
        || command === "bullet-list"
        || command === "ordered-list"
        || command === "list-indent"
        || command === "list-outdent"
        || command === "code-block";
}

function formatMarkdownInline(source: string, from: number, to: number, command: "bold" | "italic" | "strike" | "code"): SelectionReplacement | null {
    const value = source.slice(from, to);
    const leading = value.match(/^\s*/)?.[0] ?? "";
    const trailing = value.match(/\s*$/)?.[0] ?? "";
    const core = value.slice(leading.length, value.length - trailing.length);
    if (!core) {
        return null;
    }
    const coreStart = from + leading.length;
    const coreEnd = to - trailing.length;
    if (command === "bold") {
        return toggleInlineWrapAtSelection(source, from, to, coreStart, coreEnd, core, [{prefix: "**", suffix: "**"}, {prefix: "__", suffix: "__"}], "**", "**", leading, trailing);
    }
    if (command === "italic") {
        return toggleInlineWrapAtSelection(source, from, to, coreStart, coreEnd, core, [{prefix: "*", suffix: "*"}, {prefix: "_", suffix: "_"}], "*", "*", leading, trailing);
    }
    if (command === "strike") {
        return toggleInlineWrapAtSelection(source, from, to, coreStart, coreEnd, core, [{prefix: "~~", suffix: "~~"}], "~~", "~~", leading, trailing);
    }
    const marker = core.includes("`") ? "``" : "`";
    return toggleInlineWrapAtSelection(source, from, to, coreStart, coreEnd, core, [{prefix: "``", suffix: "``"}, {prefix: "`", suffix: "`"}], marker, marker, leading, trailing);
}

function formatMarkdownBlock(source: string, from: number, to: number, command: "paragraph" | "heading-1" | "heading-2" | "heading-3" | "blockquote" | "bullet-list" | "ordered-list" | "list-indent" | "list-outdent" | "code-block"): SelectionReplacement | null {
    const {from: blockStart, to: blockEnd, block} = markdownBlockRange(source, from, to);
    if (!block.trim()) {
        return null;
    }
    const lines = block.split("\n");
    if (command === "list-indent") {
        return {from: blockStart, to: blockEnd, replacement: indentListBlock(lines).join("\n")};
    }
    if (command === "list-outdent") {
        return {from: blockStart, to: blockEnd, replacement: outdentListBlock(lines).join("\n")};
    }
    if (command === "code-block") {
        return {from: blockStart, to: blockEnd, replacement: toggleCodeFenceBlock(block)};
    }
    if (command === "paragraph") {
        return {from: blockStart, to: blockEnd, replacement: setParagraphBlock(block)};
    }
    if (command === "heading-1" || command === "heading-2" || command === "heading-3") {
        return {from: blockStart, to: blockEnd, replacement: setHeadingLevel(lines, Number(command.slice(-1)) as 1 | 2 | 3).join("\n")};
    }
    if (command === "blockquote") {
        return {from: blockStart, to: blockEnd, replacement: toggleBlockPrefix(lines, /^(\s*)>\s?/, (line) => line.replace(/^(\s*)/, "$1> ")).join("\n")};
    }
    if (command === "bullet-list") {
        return {from: blockStart, to: blockEnd, replacement: toggleBlockPrefix(lines, /^(\s*)[-*+]\s+/, (line) => line.replace(/^(\s*)/, "$1- ")).join("\n")};
    }
    return {from: blockStart, to: blockEnd, replacement: toggleOrderedList(lines).join("\n")};
}

function adjustedSourceCaretOffset(source: string, change: SelectionReplacement, caretOffset: number): number {
    if (caretOffset < change.from || caretOffset > change.to) {
        return change.from + change.replacement.length;
    }
    const originalBlock = source.slice(change.from, change.to);
    const originalRelativeOffset = Math.max(0, Math.min(originalBlock.length, caretOffset - change.from));
    const lineStart = originalBlock.lastIndexOf("\n", Math.max(0, originalRelativeOffset - 1)) + 1;
    const lineIndex = originalBlock.slice(0, lineStart).split("\n").length - 1;
    const lineEndIndex = originalBlock.indexOf("\n", lineStart);
    const originalLine = originalBlock.slice(lineStart, lineEndIndex >= 0 ? lineEndIndex : originalBlock.length);
    const replacementLineStart = lineStartOffset(change.replacement, lineIndex);
    const replacementLineEndIndex = change.replacement.indexOf("\n", replacementLineStart);
    const replacementLine = change.replacement.slice(replacementLineStart, replacementLineEndIndex >= 0 ? replacementLineEndIndex : change.replacement.length);
    const originalIndent = originalLine.match(/^\s*/)?.[0].length ?? 0;
    const replacementIndent = replacementLine.match(/^\s*/)?.[0].length ?? 0;
    const originalColumn = originalRelativeOffset - lineStart;
    const nextColumn = originalColumn > originalIndent
        ? originalColumn + replacementIndent - originalIndent
        : Math.min(originalColumn, replacementIndent);
    return change.from + replacementLineStart + Math.max(0, Math.min(replacementLine.length, nextColumn));
}

function lineStartOffset(value: string, lineIndex: number): number {
    let offset = 0;
    for (let index = 0; index < lineIndex; index += 1) {
        const nextBreak = value.indexOf("\n", offset);
        if (nextBreak < 0) {
            return value.length;
        }
        offset = nextBreak + 1;
    }
    return offset;
}

function formatMarkdownClear(source: string, from: number, to: number): SelectionReplacement | null {
    const {from: blockStart, to: blockEnd, block} = markdownBlockRange(source, from, to);
    if (!block.trim()) {
        return null;
    }
    const selectionSpansLines = source.slice(from, to).includes("\n");
    if (selectionSpansLines || selectedBlockHasMarkdownSyntax(block)) {
        return {from: blockStart, to: blockEnd, replacement: clearMarkdownFormatting(block)};
    }
    return clearInlineMarkdownSelection(source, from, to);
}

function markdownBlockRange(source: string, from: number, to: number): MarkdownBlockRange {
    const fencedRange = enclosingCodeFenceRange(source, from, to);
    if (fencedRange) {
        return fencedRange;
    }
    const blockStart = source.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
    const normalizedTo = to > from && source[to - 1] === "\n" ? to - 1 : to;
    const nextBreak = source.indexOf("\n", Math.max(blockStart, normalizedTo));
    const blockEnd = nextBreak >= 0 ? nextBreak : source.length;
    return {from: blockStart, to: blockEnd, block: source.slice(blockStart, blockEnd)};
}

function enclosingCodeFenceRange(source: string, from: number, to: number): MarkdownBlockRange | null {
    let lineStart = 0;
    let open: {marker: "```" | "~~~"; from: number} | null = null;
    const normalizedTo = Math.max(from, to);
    while (lineStart <= source.length) {
        const breakIndex = source.indexOf("\n", lineStart);
        const lineEnd = breakIndex >= 0 ? breakIndex : source.length;
        const line = source.slice(lineStart, lineEnd).trim();
        const marker = line.startsWith("```") ? "```" : line.startsWith("~~~") ? "~~~" : null;
        if (!open && marker) {
            open = {marker, from: lineStart};
        } else if (open && line === open.marker) {
            const blockEnd = lineEnd;
            if (from >= open.from && normalizedTo <= blockEnd) {
                return {from: open.from, to: blockEnd, block: source.slice(open.from, blockEnd)};
            }
            open = null;
        }
        if (breakIndex < 0) {
            break;
        }
        lineStart = breakIndex + 1;
    }
    return null;
}

function formatMarkdownLink(source: string, from: number, to: number, href: string): SelectionReplacement | null {
    const value = source.slice(from, to);
    const leading = value.match(/^\s*/)?.[0] ?? "";
    const trailing = value.match(/\s*$/)?.[0] ?? "";
    const core = value.slice(leading.length, value.length - trailing.length);
    if (!core) {
        return null;
    }
    const coreStart = from + leading.length;
    const coreEnd = to - trailing.length;
    const existingLink = markdownLinkRangeAtSelection(source, coreStart, coreEnd);
    if (existingLink) {
        const label = unescapeMarkdownLinkLabel(existingLink.label);
        return {
            from: existingLink.fullStart,
            to: existingLink.fullEnd,
            replacement: `${existingLink.image ? "!" : ""}[${escapeMarkdownLinkLabel(label)}](${formatMarkdownLinkDestination(href)}${formatMarkdownLinkTitle(existingLink.rawTitle)})`,
        };
    }
    return {
        from,
        to,
        replacement: formatNewMarkdownLinkReplacement(leading, core, trailing, href),
    };
}

function formatNewMarkdownLinkReplacement(leading: string, core: string, trailing: string, href: string): string {
    const candidate = markdownInferredLinkHref(core) === null ? core : markdownLinkCandidateText(core);
    const candidateTrailing = core.slice(candidate.length);
    return `${leading}[${escapeMarkdownLinkLabel(candidate)}](${formatMarkdownLinkDestination(href)})${candidateTrailing}${trailing}`;
}

function escapeMarkdownLinkLabel(label: string): string {
    return label.replace(/([\\\[\]])/g, "\\$1");
}

function unescapeMarkdownLinkLabel(label: string): string {
    return label.replace(/\\([\\\[\]])/g, "$1");
}

function formatMarkdownLinkDestination(href: string): string {
    if (/[\s()]/.test(href)) {
        return `<${href.replace(/[<>]/g, "")}>`;
    }
    return href;
}

function formatMarkdownLinkTitle(rawTitle: string | null): string {
    return rawTitle ? ` ${rawTitle}` : "";
}

function toggleBlockPrefix(lines: string[], pattern: RegExp, addPrefix: (line: string) => string): string[] {
    const nonEmptyLines = lines.filter((line) => line.trim());
    const shouldRemove = nonEmptyLines.length > 0 && nonEmptyLines.every((line) => pattern.test(line));
    return lines.map((line) => {
        if (!line.trim()) {
            return line;
        }
        return shouldRemove ? line.replace(pattern, "$1") : addPrefix(stripBlockPrefix(line));
    });
}

function toggleOrderedList(lines: string[]): string[] {
    const pattern = /^(\s*)\d+[.)]\s+/;
    const nonEmptyLines = lines.filter((line) => line.trim());
    const shouldRemove = nonEmptyLines.length > 0 && nonEmptyLines.every((line) => pattern.test(line));
    let index = 1;
    return lines.map((line) => {
        if (!line.trim()) {
            return line;
        }
        if (shouldRemove) {
            return line.replace(pattern, "$1");
        }
        const formatted = stripBlockPrefix(line).replace(/^(\s*)/, `$1${index}. `);
        index += 1;
        return formatted;
    });
}

function indentListBlock(lines: string[]): string[] {
    return lines.map((line) => isListLine(line) ? `    ${line}` : line);
}

function outdentListBlock(lines: string[]): string[] {
    return lines.map((line) => {
        if (!isListLine(line)) {
            return line;
        }
        if (line.startsWith("\t")) {
            return line.slice(1);
        }
        return line.replace(/^ {1,4}/, "");
    });
}

function isListLine(line: string): boolean {
    return /^\s*(?:[-*+]|\d+[.)])\s+/.test(line);
}

function setHeadingLevel(lines: string[], level: 0 | 1 | 2 | 3): string[] {
    const headingPattern = /^(\s*)#{1,6}\s+/;
    const nonEmptyLines = lines.filter((line) => line.trim());
    const shouldRemove = level > 0
        && nonEmptyLines.length > 0
        && nonEmptyLines.every((line) => new RegExp(`^(\\s*)#{${level}}\\s+`).test(line));
    return lines.map((line) => {
        if (!line.trim()) {
            return line;
        }
        if (level === 0 || shouldRemove) {
            return line.replace(headingPattern, "$1");
        }
        const prefix = "#".repeat(level);
        return stripBlockPrefix(line).replace(/^(\s*)/, `$1${prefix} `);
    });
}

function stripBlockPrefix(line: string): string {
    let result = line.replace(/^(\s*)#{1,6}\s+/, "$1");
    while (/^(\s*)>\s?/.test(result)) {
        result = result.replace(/^(\s*)>\s?/, "$1");
    }
    return result.replace(/^(\s*)(?:[-*+]|\d+[.)])\s+/, "$1");
}

function setParagraphBlock(block: string): string {
    return unwrapCodeFence(block.split("\n"))
        .map((line) => stripBlockPrefix(line))
        .join("\n");
}

function clearMarkdownFormatting(block: string): string {
    const lines = unwrapCodeFence(block.split("\n"));
    return lines.map((line) => clearInlineMarkdown(clearMarkdownLinePrefix(line))).join("\n");
}

function selectedBlockHasMarkdownSyntax(block: string): boolean {
    const lines = block.split("\n");
    if (isFencedCodeBlock(lines)) {
        return true;
    }
    return lines.some((line) => /^(\s*)(#{1,6}\s+|>\s?|(?:[-*+]|\d+[.)])\s+)/.test(line));
}

function unwrapCodeFence(lines: string[]): string[] {
    const firstContentIndex = lines.findIndex((line) => line.trim());
    const lastContentIndex = findLastNonEmptyLineIndex(lines);
    if (firstContentIndex < 0 || lastContentIndex < firstContentIndex) {
        return lines;
    }
    if (isFencedCodeBlock(lines)) {
        return [
            ...lines.slice(0, firstContentIndex),
            ...lines.slice(firstContentIndex + 1, lastContentIndex),
            ...lines.slice(lastContentIndex + 1),
        ];
    }
    return lines;
}

function isFencedCodeBlock(lines: string[]): boolean {
    const firstContentIndex = lines.findIndex((line) => line.trim());
    const lastContentIndex = findLastNonEmptyLineIndex(lines);
    if (firstContentIndex < 0 || lastContentIndex < firstContentIndex) {
        return false;
    }
    const firstLine = lines[firstContentIndex]?.trim() ?? "";
    const lastLine = lines[lastContentIndex]?.trim() ?? "";
    return (firstLine.startsWith("```") && lastLine === "```") || (firstLine.startsWith("~~~") && lastLine === "~~~");
}

function clearMarkdownLinePrefix(line: string): string {
    return stripBlockPrefix(line);
}

function clearInlineMarkdown(line: string): string {
    return line
        .replace(/!\[([^\]\n]*)\]\((?:<[^>\n]*>|[^)\n]*)\)/g, "$1")
        .replace(/\[([^\]\n]+)\]\((?:<[^>\n]*>|[^)\n]*)\)/g, "$1")
        .replace(/``([^\n]*?)``/g, "$1")
        .replace(/`([^`\n]+)`/g, "$1")
        .replace(/~~([^~\n]+)~~/g, "$1")
        .replace(/\*\*([^*\n]+)\*\*/g, "$1")
        .replace(/__([^_\n]+)__/g, "$1")
        .replace(/\*([^*\n]+)\*/g, "$1")
        .replace(/_([^_\n]+)_/g, "$1");
}

function clearInlineMarkdownSelection(source: string, from: number, to: number): SelectionReplacement | null {
    if (from >= to) {
        return null;
    }
    const linkRange = enclosingMarkdownLinkRange(source, from, to);
    if (linkRange) {
        return linkRange;
    }
    const wrapRange = enclosingMarkdownWrapRange(source, from, to);
    if (wrapRange) {
        return wrapRange;
    }
    const replacement = clearInlineMarkdown(source.slice(from, to));
    return {from, to, replacement};
}

function enclosingMarkdownLinkRange(source: string, from: number, to: number): SelectionReplacement | null {
    const link = markdownLinkRangeAtSelection(source, from, to);
    if (link) {
        return {from: link.fullStart, to: link.fullEnd, replacement: unescapeMarkdownLinkLabel(link.label)};
    }
    return null;
}

function formatMarkdownRemoveLink(source: string, from: number, to: number): SelectionReplacement | null {
    return enclosingMarkdownLinkRange(source, from, to);
}

function enclosingMarkdownWrapRange(source: string, from: number, to: number): SelectionReplacement | null {
    const wraps: Array<{prefix: string; suffix: string}> = [
        {prefix: "~~", suffix: "~~"},
        {prefix: "**", suffix: "**"},
        {prefix: "__", suffix: "__"},
        {prefix: "``", suffix: "``"},
        {prefix: "`", suffix: "`"},
        {prefix: "*", suffix: "*"},
        {prefix: "_", suffix: "_"},
    ];
    const selected = source.slice(from, to);
    for (const wrap of wraps) {
        if (source.slice(from - wrap.prefix.length, from) === wrap.prefix
            && source.slice(to, to + wrap.suffix.length) === wrap.suffix) {
            return {
                from: from - wrap.prefix.length,
                to: to + wrap.suffix.length,
                replacement: clearInlineMarkdown(selected),
            };
        }
    }
    return null;
}

function toggleCodeFenceBlock(block: string): string {
    const lines = block.split("\n");
    const firstContentIndex = lines.findIndex((line) => line.trim());
    const lastContentIndex = findLastNonEmptyLineIndex(lines);
    if (firstContentIndex >= 0 && lastContentIndex >= firstContentIndex) {
        const firstLine = lines[firstContentIndex]?.trim() ?? "";
        const lastLine = lines[lastContentIndex]?.trim() ?? "";
        const marker = firstLine.startsWith("```") ? "```" : firstLine.startsWith("~~~") ? "~~~" : null;
        if (marker && lastLine === marker) {
            return [
                ...lines.slice(0, firstContentIndex),
                ...lines.slice(firstContentIndex + 1, lastContentIndex),
                ...lines.slice(lastContentIndex + 1),
            ].join("\n");
        }
    }
    return `\`\`\`\n${block}\n\`\`\``;
}

function findLastNonEmptyLineIndex(lines: string[]): number {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (lines[index]?.trim()) {
            return index;
        }
    }
    return -1;
}

function toggleInlineWrapAtSelection(
    source: string,
    from: number,
    to: number,
    coreStart: number,
    coreEnd: number,
    core: string,
    activeWrappers: Array<{prefix: string; suffix: string}>,
    defaultPrefix: string,
    defaultSuffix: string,
    leading: string,
    trailing: string,
): SelectionReplacement {
    for (const wrapper of activeWrappers) {
        if (hasInlineWrapper(source, coreStart, coreEnd, wrapper.prefix, wrapper.suffix)) {
            return {
                from: coreStart - wrapper.prefix.length,
                to: coreEnd + wrapper.suffix.length,
                replacement: core,
            };
        }
        if (core.startsWith(wrapper.prefix) && core.endsWith(wrapper.suffix) && core.length > wrapper.prefix.length + wrapper.suffix.length) {
            return {
                from,
                to,
                replacement: `${leading}${core.slice(wrapper.prefix.length, core.length - wrapper.suffix.length)}${trailing}`,
            };
        }
    }
    return {from, to, replacement: `${leading}${defaultPrefix}${core}${defaultSuffix}${trailing}`};
}

function hasInlineWrapper(source: string, coreStart: number, coreEnd: number, prefix: string, suffix: string): boolean {
    const prefixStart = coreStart - prefix.length;
    const suffixEnd = coreEnd + suffix.length;
    if (prefixStart < 0 || suffixEnd > source.length) {
        return false;
    }
    if (source.slice(prefixStart, coreStart) !== prefix || source.slice(coreEnd, suffixEnd) !== suffix) {
        return false;
    }
    return isStandaloneInlineMarker(source, prefixStart, prefix.length)
        && isStandaloneInlineMarker(source, coreEnd, suffix.length);
}

function isStandaloneInlineMarker(source: string, start: number, length: number): boolean {
    const marker = source[start];
    if (!marker || !["*", "_", "`"].includes(marker)) {
        return true;
    }
    return source[start - 1] !== marker && source[start + length] !== marker;
}

function clearSelectionState(sourceOffset?: number): void {
    if (props.mode === "source" && sourceOffset !== undefined) {
        sourceEditor.value?.collapseSelection(sourceOffset);
    }
    if (props.mode === "preview") {
        editor.value?.commands.blur();
        window.getSelection()?.removeAllRanges();
    }
    selected.value = null;
}

async function activateComment(id: string, options: {clearSelection?: boolean} = {}): Promise<void> {
    if (options.clearSelection !== false) {
        clearSelectionState();
    }
    activeCommentId.value = id;
    commentsOpen.value = true;
    const comment = props.comments.find((item) => item.id === id);
    if (props.mode === "source") {
        await nextTick();
        if (comment) {
            sourceEditor.value?.revealOffset(comment.from);
        }
        document.querySelector<HTMLElement>(`[data-comment-card-id="${CSS.escape(id)}"]`)?.scrollIntoView({block: "nearest", behavior: "smooth"});
        return;
    }
    if (props.mode !== "preview") {
        emit("update:mode", "preview");
        await nextTick();
    }
    await nextTick();
    editor.value?.view.dom.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(id)}"]`)?.scrollIntoView({block: "center", behavior: "smooth"});
    document.querySelector<HTMLElement>(`[data-comment-card-id="${CSS.escape(id)}"]`)?.scrollIntoView({block: "nearest", behavior: "smooth"});
    refreshDecorations();
}

function activateNewComment(id: string): void {
    activeCommentId.value = id;
    commentsOpen.value = true;
    refreshDecorations();
    window.setTimeout(() => {
        const comment = props.comments.find((item) => item.id === id);
        if (props.mode === "source" && comment) {
            sourceEditor.value?.revealOffset(comment.from);
        }
        if (props.mode === "preview") {
            editor.value?.view.dom.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(id)}"]`)?.scrollIntoView({block: "center", behavior: "smooth"});
        }
        document.querySelector<HTMLElement>(`[data-comment-card-id="${CSS.escape(id)}"]`)?.scrollIntoView({block: "nearest", behavior: "smooth"});
        refreshDecorations();
    }, 0);
}

async function activateDiff(id: string): Promise<void> {
    const diff = effectiveDiffs.value.find((item) => item.id === id);
    if (!diff) {
        return;
    }
    activeDiffId.value = id;
    clearSelectionState();
    if (props.mode === "source") {
        await nextTick();
        sourceEditor.value?.revealOffset(diff.from);
        return;
    }
    await nextTick();
    refreshDecorations();
    await waitForFrame();
    await waitForFrame();
    const node = editor.value?.view.dom.querySelector<HTMLElement>(`[data-diff-id="${CSS.escape(id)}"]`);
    const container = editor.value?.view.dom.closest<HTMLElement>(".llmlint-review-editor");
    if (!node || !container) {
        return;
    }
    const nodeRect = node.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const target = container.scrollTop + nodeRect.top - containerRect.top - container.clientHeight / 2 + nodeRect.height / 2;
    container.scrollTo({top: Math.max(0, target), behavior: "smooth"});
}

function navigateDiff(direction: "previous" | "next"): void {
    const queue = diffReviewQueue.value;
    if (queue.length === 0) {
        return;
    }
    const currentIndex = activeDiffIndex.value;
    const nextIndex = direction === "next"
        ? currentIndex >= 0 ? (currentIndex + 1) % queue.length : 0
        : currentIndex >= 0 ? (currentIndex - 1 + queue.length) % queue.length : queue.length - 1;
    const nextDiff = queue[nextIndex];
    if (nextDiff) {
        void activateDiff(nextDiff.id);
    }
}

function clearActiveDiff(): void {
    const id = activeDiffId.value;
    if (!id) {
        return;
    }
    const queue = diffReviewQueue.value;
    const currentIndex = queue.findIndex((diff) => diff.id === id);
    const nextDiff = queue.length > 1
        ? queue[currentIndex + 1] ?? queue[currentIndex - 1] ?? null
        : null;
    emit("clear-diff", id);
    if (nextDiff) {
        nextTick(() => {
            if (effectiveDiffs.value.some((diff) => diff.id === nextDiff.id)) {
                void activateDiff(nextDiff.id);
            }
        });
    }
}

function navigateComment(direction: "previous" | "next"): void {
    const queue = commentReviewQueue.value;
    if (queue.length === 0) {
        return;
    }
    const currentIndex = activeQueueIndex.value;
    const nextIndex = direction === "next"
        ? currentIndex >= 0 ? (currentIndex + 1) % queue.length : 0
        : currentIndex >= 0 ? (currentIndex - 1 + queue.length) % queue.length : queue.length - 1;
    const nextComment = queue[nextIndex];
    if (nextComment) {
        void activateComment(nextComment.id);
    }
}

function nextCommentAfter(currentId: string, queue: ReviewComment[]): ReviewComment | null {
    if (queue.length <= 1) {
        return null;
    }
    const currentIndex = queue.findIndex((comment) => comment.id === currentId);
    const startIndex = currentIndex >= 0 ? currentIndex : -1;
    for (let step = 1; step <= queue.length; step += 1) {
        const candidate = queue[(startIndex + step + queue.length) % queue.length];
        if (candidate && candidate.id !== currentId) {
            return candidate;
        }
    }
    return null;
}

function toggleCommentResolvedFromRail(comment: ReviewComment): void {
    const nextUnresolved = activeCommentId.value === comment.id && comment.resolved !== true
        ? nextCommentAfter(comment.id, commentReviewQueue.value)
        : null;
    emit("toggle-comment-resolved", comment.id);
    if (nextUnresolved) {
        nextTick(() => {
            if (props.comments.some((item) => item.id === nextUnresolved.id && item.resolved !== true)) {
                void activateComment(nextUnresolved.id);
            }
        });
    }
}

function deleteCommentFromRail(comment: ReviewComment): void {
    const nextComment = activeCommentId.value === comment.id
        ? nextCommentAfter(comment.id, props.comments)
        : null;
    emit("delete-comment", comment.id);
    if (nextComment) {
        nextTick(() => {
            if (props.comments.some((item) => item.id === nextComment.id)) {
                void activateComment(nextComment.id);
            }
        });
    }
}

function setEditingCommentInput(id: string, el: Element | ComponentPublicInstance | null): void {
    if (el instanceof HTMLTextAreaElement) {
        editingCommentInputs.set(id, el);
        return;
    }
    editingCommentInputs.delete(id);
}

function startEditComment(comment: ReviewComment): void {
    activeCommentId.value = comment.id;
    editingCommentId.value = comment.id;
    editingCommentBody.value = comment.body;
    nextTick(() => {
        editingCommentInputs.get(comment.id)?.focus();
    });
}

function cancelEditComment(): void {
    editingCommentId.value = null;
    editingCommentBody.value = "";
}

function saveEditComment(): void {
    const id = editingCommentId.value;
    const body = editingCommentBody.value.trim();
    if (!id || !body) {
        return;
    }
    emit("update-comment", id, body);
    cancelEditComment();
}

function refreshDecorations(targetEditor?: Editor): void {
    const currentEditor = targetEditor ?? editor.value;
    if (!currentEditor) {
        return;
    }
    const decorations = buildPreviewDecorations(currentEditor, props.modelValue, props.issueMarks, props.comments, effectiveDiffs.value, heatActive.value ? (props.heat ?? []) : []);
    currentEditor.view.dispatch(currentEditor.state.tr
        .setMeta(REVIEW_DECORATION_KEY, decorations)
        .setMeta("addToHistory", false));
}

function buildPreviewDecorations(currentEditor: Editor, source: string, issues: ReviewIssueMark[], comments: ReviewComment[], diffs: ReviewTextDiff[], heat: ProjectedHeatChunk[]): DecorationSet {
    const decorations: Decoration[] = [];
    const textMap = buildTextMap(currentEditor);
    // —— 热力层（R6）先写：块底色 = P(AI) 梯度（heatColor，alpha 与只读视图同款）。
    // 坐标口径：heat 为 draft 坐标（宿主经 projectHeatChunks 从 head.body 投影而来），
    // 位置由 piece-table 映射跟随编辑，但 pAi 数值锚定 head 检测、编辑后渐陈旧属预期。
    // 热力块常几百字跨段落，而 preview 文本图把段落间多个换行折叠为单个 \n——整块 needle
    // 定位必失配，故按源文本行切成子段逐行定位（同块共享 pAi）。
    // diff 装饰在热力之后写入：待审改动底色优先覆盖热力（.is-heat 下配套 CSS 保证）。
    for (const chunk of heat) {
        const heatStyle = `background-color: ${heatColor(chunk.pAi)};`;
        const heatTitle = `P(AI) ${pAiPercent(chunk.pAi)}%`;
        let lineStart = chunk.from;
        while (lineStart < chunk.to) {
            const breakIndex = source.indexOf("\n", lineStart);
            const lineEnd = breakIndex >= 0 && breakIndex < chunk.to ? breakIndex : chunk.to;
            if (lineEnd > lineStart) {
                const range = locateSourceRangeInPreview(textMap, source, lineStart, lineEnd);
                if (range && range.from < range.to) {
                    decorations.push(Decoration.inline(range.from, range.to, {
                        class: "llmlint-heat-chunk",
                        style: heatStyle,
                        title: heatTitle,
                    }));
                }
            }
            lineStart = lineEnd + 1;
        }
    }
    for (const diff of diffs) {
        const range = diff.inserted
            ? locateSourceRangeInPreview(textMap, source, diff.from, diff.to)
            : locateSourcePointInPreview(textMap, source, diff.from);
        if (!range) {
            continue;
        }
        if (diff.deleted) {
            decorations.push(Decoration.widget(range.from, () => {
                const node = document.createElement("del");
                node.className = [
                    "llmlint-diff-deleted",
                    activeDiffId.value === diff.id ? "is-active" : "",
                ].filter(Boolean).join(" ");
                node.textContent = diffTextLabel(diff.deleted);
                node.title = diffTitle(diff);
                node.dataset.diffId = diff.id;
                return node;
            }, {side: -1}));
        }
        if (diff.inserted && range.from < range.to) {
            decorations.push(Decoration.inline(range.from, range.to, {
                class: [
                    "llmlint-diff-inserted",
                    activeDiffId.value === diff.id ? "is-active" : "",
                ].filter(Boolean).join(" "),
                title: diffTitle(diff),
                "data-diff-id": diff.id,
            }));
        }
    }
    for (const issue of issues) {
        const range = locateSourceRangeInPreview(textMap, source, issue.from, issue.to);
        // 校对批注层（7b）：只对携带 replacement 的命中追加校对符号；复用本循环已算好的定位，
        // 不引入第二遍字符串扫描（几百命中时定位是主开销，实测 400 命中 × 40k 字约 17ms）。
        const proofread = proofreadEnabled.value && issue.replacement !== null;
        if (!range) {
            // 纯插入型命中（from===to，无原文可删）：范围定位必空，退化为点定位只放插入符号。
            if (proofread && issue.from === issue.to && issue.replacement) {
                const point = locateSourcePointInPreview(textMap, source, issue.from);
                if (point) {
                    decorations.push(Decoration.widget(point.from, () => buildProofreadWidget(issue), {side: 1, key: `proofread-${issue.id}`}));
                }
            }
            continue;
        }
        decorations.push(Decoration.inline(range.from, range.to, {
            class: [
                "llmlint-issue-mark",
                `llmlint-issue-${issue.level}`,
                props.activeIssueMark?.id === issue.id ? "is-active" : "",
                issue.replacement !== null ? "llmlint-issue-replaceable" : "",
                issue.replacement === "" ? "llmlint-issue-delete-replacement" : "",
                proofread ? "llmlint-proofread-original" : "",
            ].filter(Boolean).join(" "),
            "data-review-from": String(issue.from),
            "data-rule-id": issue.ruleId,
            "data-replacement-label": replacementLabel(issue),
            title: issue.replacement !== null ? replacementTitle(issue) : issue.title,
        }));
        if (proofread) {
            decorations.push(Decoration.widget(range.to, () => buildProofreadWidget(issue), {side: 1, key: `proofread-${issue.id}`}));
        }
    }
    for (const comment of comments) {
        const range = locateSourceRangeInPreview(textMap, source, comment.from, comment.to);
        if (!range) {
            continue;
        }
        decorations.push(Decoration.inline(range.from, range.to, {
            class: [
                "llmlint-comment-mark",
                activeCommentId.value === comment.id ? "is-active" : "",
                comment.resolved === true ? "is-resolved" : "",
                comment.stale === true ? "is-stale" : "",
            ].filter(Boolean).join(" "),
            "data-comment-id": comment.id,
            "data-comment-index": String(commentIndexMap.value.get(comment.id) ?? ""),
            title: comment.body,
        }));
    }
    return DecorationSet.create(currentEditor.state.doc, decorations);
}

/**
 * 校对批注符号节点（7b）：替换型 = <ins> 建议文本（绿字虚线，区别于 diff-inserted 的绿底），
 * 纯删除型 = 红色 × 角标；点击由 handleClick 按 data-proofread-issue-id 找回命中并应用。
 * widget 带稳定 key（issue.id），装饰集重建时 ProseMirror 可复用 DOM 节点。
 */
function buildProofreadWidget(issue: ReviewIssueMark): HTMLElement {
    const applyTitle = `${replacementTitle(issue)} · ${t("review.proofreadApplyHint")}`;
    if (issue.replacement === "") {
        const badge = document.createElement("span");
        badge.className = "llmlint-proofread-delete-badge";
        badge.textContent = "×";
        badge.title = applyTitle;
        badge.dataset.proofreadIssueId = issue.id;
        return badge;
    }
    const node = document.createElement("ins");
    node.className = "llmlint-proofread-insert";
    node.textContent = proofreadInsertLabel(issue.replacement ?? "");
    node.title = applyTitle;
    node.dataset.proofreadIssueId = issue.id;
    return node;
}

/** 行内建议文本标签：换行折算为 ↵，超长截断（完整替换文本在 title 与应用动作里）。 */
function proofreadInsertLabel(replacement: string): string {
    const visible = replacement.replaceAll("\n", "↵");
    return visible.length > 48 ? `${visible.slice(0, 48)}…` : visible;
}

function locateSourcePointInPreview(textMap: {text: string; positions: Array<number | null>}, source: string, offset: number): {from: number; to: number} | null {
    const nextNeedle = source.slice(offset, Math.min(source.length, offset + 24)).trim();
    if (nextNeedle) {
        const nextRange = locateSourceRangeInPreview(textMap, source, offset, offset + nextNeedle.length);
        if (nextRange) {
            return {from: nextRange.from, to: nextRange.from};
        }
    }
    const previousNeedleStart = Math.max(0, offset - 24);
    const previousNeedle = source.slice(previousNeedleStart, offset).trim();
    if (previousNeedle) {
        const previousRange = locateSourceRangeInPreview(textMap, source, previousNeedleStart, offset);
        if (previousRange) {
            return {from: previousRange.to, to: previousRange.to};
        }
    }
    return null;
}

function buildTextMap(currentEditor: Editor): {text: string; positions: Array<number | null>} {
    const textParts: string[] = [];
    const positions: Array<number | null> = [];
    let firstBlock = true;
    currentEditor.state.doc.descendants((node, position) => {
        if (!node.isTextblock) {
            return;
        }
        if (!firstBlock) {
            textParts.push("\n");
            positions.push(null);
        }
        firstBlock = false;
        node.descendants((child, childPosition) => {
            if (!child.isText) {
                return;
            }
            const text = child.text ?? "";
            const absoluteStart = position + 1 + childPosition;
            for (let index = 0; index < text.length; index++) {
                textParts.push(text[index] ?? "");
                positions.push(absoluteStart + index);
            }
        });
    });
    return {text: textParts.join(""), positions};
}

function locateSourceRangeInPreview(textMap: {text: string; positions: Array<number | null>}, source: string, from: number, to: number): {from: number; to: number} | null {
    const needle = source.slice(from, to).trim();
    if (!needle) {
        return null;
    }
    const occurrenceIndex = sourceOccurrenceIndex(source, needle, from, to);
    const previewMatches = allIndexes(textMap.text, needle);
    const index = occurrenceIndex >= 0 && occurrenceIndex < previewMatches.length
        ? previewMatches[occurrenceIndex] ?? -1
        : nearestIndex(textMap.text, needle, from);
    if (index < 0) {
        return null;
    }
    const start = firstMappedPosition(textMap.positions, index, index + needle.length);
    const end = lastMappedPosition(textMap.positions, index, index + needle.length);
    return start !== null && end !== null && start < end ? {from: start, to: end} : null;
}

function sourceOccurrenceIndex(source: string, needle: string, from: number, to: number): number {
    const matches = allIndexes(source, needle);
    const contained = matches.findIndex((index) => index >= from && index + needle.length <= to);
    if (contained >= 0) {
        return contained;
    }
    const exact = matches.findIndex((index) => index === from);
    if (exact >= 0) {
        return exact;
    }
    return matches.findIndex((index) => Math.abs(index - from) === Math.min(...matches.map((match) => Math.abs(match - from))));
}

function occurrenceIndexNear(text: string, needle: string, near: number): number {
    const matches = allIndexes(text, needle);
    if (matches.length === 0) {
        return -1;
    }
    const exact = matches.findIndex((index) => index === near);
    if (exact >= 0) {
        return exact;
    }
    let bestIndex = 0;
    for (let index = 1; index < matches.length; index++) {
        if (Math.abs((matches[index] ?? 0) - near) < Math.abs((matches[bestIndex] ?? 0) - near)) {
            bestIndex = index;
        }
    }
    return bestIndex;
}

function allIndexes(text: string, needle: string): number[] {
    const indexes: number[] = [];
    let index = text.indexOf(needle);
    while (index >= 0) {
        indexes.push(index);
        index = text.indexOf(needle, index + Math.max(1, needle.length));
    }
    return indexes;
}

function renderedIndexFromPosition(positions: Array<number | null>, position: number): number {
    const index = positions.findIndex((item) => item !== null && item >= position);
    if (index >= 0) {
        return index;
    }
    for (let fallback = positions.length - 1; fallback >= 0; fallback--) {
        if (positions[fallback] !== null) {
            return fallback;
        }
    }
    return 0;
}

function nearestIndex(text: string, needle: string, sourceOffset: number): number {
    let best = -1;
    let index = text.indexOf(needle);
    while (index >= 0) {
        if (best < 0 || Math.abs(index - sourceOffset) < Math.abs(best - sourceOffset)) {
            best = index;
        }
        index = text.indexOf(needle, index + Math.max(1, needle.length));
    }
    return best;
}

function firstMappedPosition(positions: Array<number | null>, from: number, to: number): number | null {
    for (let index = from; index < to; index++) {
        const position = positions[index] ?? null;
        if (position !== null) {
            return position;
        }
    }
    return null;
}

function lastMappedPosition(positions: Array<number | null>, from: number, to: number): number | null {
    for (let index = to - 1; index >= from; index--) {
        const position = positions[index] ?? null;
        if (position !== null) {
            return position + 1;
        }
    }
    return null;
}

function selectionFromPreview(currentEditor: Editor): ReviewTextSelection | null {
    const {from, to} = currentEditor.state.selection;
    if (from === to) {
        return null;
    }
    const rawText = currentEditor.state.doc.textBetween(from, to, "\n");
    const text = rawText.trim();
    if (!text) {
        return null;
    }
    const textMap = buildTextMap(currentEditor);
    const sourceMatches = allIndexes(props.modelValue, text);
    const previewMatches = allIndexes(textMap.text, text);
    if (sourceMatches.length === 0 || previewMatches.length === 0) {
        return {
            start: 0,
            end: 0,
            text,
            source: "preview",
            mappable: false,
            disabledReason: t("review.previewMappingFailed"),
        };
    }
    const leadingTrimLength = rawText.length - rawText.trimStart().length;
    const renderedStart = renderedIndexFromPosition(textMap.positions, from) + leadingTrimLength;
    const occurrenceIndex = occurrenceIndexNear(textMap.text, text, renderedStart);
    if (sourceMatches.length === previewMatches.length && occurrenceIndex >= 0 && occurrenceIndex < sourceMatches.length) {
        const sourceIndex = sourceMatches[occurrenceIndex] ?? -1;
        return {start: sourceIndex, end: sourceIndex + text.length, text, source: "preview", mappable: true};
    }
    if (sourceMatches.length === 1) {
        const sourceIndex = sourceMatches[0] ?? -1;
        return {start: sourceIndex, end: sourceIndex + text.length, text, source: "preview", mappable: true};
    }
    if (sourceMatches.length !== previewMatches.length) {
        return {
            start: 0,
            end: 0,
            text,
            source: "preview",
            mappable: false,
            disabledReason: t("review.previewOccurrenceMismatch"),
        };
    }
    return {
        start: 0,
        end: 0,
        text,
        source: "preview",
        mappable: false,
        disabledReason: t("review.previewMappingFailed"),
    };
}

// W7 F1：向宿主（TextPanel）暴露 diff 激活状态与激活动作——AI 改写审阅横幅经 TextPanel
// 转调这里做「跳到下/上一处 llm diff」定位；键盘 Ctrl+Alt+N/P 与 clear-diff 机制不变。
defineExpose({
    activateDiff,
    activeDiffId,
});
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <div class="review-editor-toolbar flex flex-wrap items-center gap-2 border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2 text-sm">
            <!-- 源码/预览切换（Task 17 拍板①：预览禁用待删除，切换隐藏；mode 由宿主强制 source） -->
            <SegmentedControl v-if="!previewDisabled" :model-value="mode" :options="modeOptions" @update:model-value="updateMode" />
            <div class="review-editor-toolbar__status min-w-0 flex-1">
                <span class="review-editor-toolbar__chip">
                    <span class="i-lucide-scan-text h-3.5 w-3.5" />
                    <span>{{ t("review.hitCount", {count: issueMarks.length}) }}</span>
                </span>
                <span class="review-editor-toolbar__chip">
                    <span class="i-lucide-wand-sparkles h-3.5 w-3.5" />
                    <span>{{ t("review.fixActionCount", {replace: replacementIssueCount, delete: deleteIssueCount, total: replaceableIssueCount}) }}</span>
                </span>
                <span
                    v-if="comments.length > 0"
                    class="review-editor-toolbar__chip"
                    :class="unresolvedCommentCount > 0 ? 'is-attention' : ''"
                >
                    <span class="i-lucide-message-square-text h-3.5 w-3.5" />
                    <span>{{ t("review.commentsCount", {open: unresolvedCommentCount, total: comments.length}) }}</span>
                </span>
                <div v-if="diffCount > 0" class="review-editor-toolbar__diff-nav">
                    <button
                        type="button"
                        class="review-editor-toolbar__diff-button"
                        :aria-label="previousDiffTitle"
                        :title="previousDiffTitle"
                        @click="navigateDiff('previous')"
                    >
                        <span class="i-lucide-chevron-up h-3.5 w-3.5" />
                    </button>
                    <span class="review-editor-toolbar__diff-label">{{ diffReviewLabel }}</span>
                    <button
                        type="button"
                        class="review-editor-toolbar__diff-button"
                        :aria-label="nextDiffTitle"
                        :title="nextDiffTitle"
                        @click="navigateDiff('next')"
                    >
                        <span class="i-lucide-chevron-down h-3.5 w-3.5" />
                    </button>
                    <button
                        type="button"
                        class="review-editor-toolbar__diff-button"
                        :disabled="!activeDiffId"
                        :aria-label="clearCurrentDiffTitle"
                        :title="clearCurrentDiffTitle"
                        @click="clearActiveDiff"
                    >
                        <span class="i-lucide-circle-check h-3.5 w-3.5" />
                    </button>
                    <button
                        type="button"
                        class="review-editor-toolbar__diff-button"
                        :disabled="!activeDiffId"
                        :aria-label="copyCurrentDiffTitle"
                        :title="copyCurrentDiffTitle"
                        @click="void copyActiveDiffContext()"
                    >
                        <span class="i-lucide-copy h-3.5 w-3.5" />
                    </button>
                    <button
                        type="button"
                        class="review-editor-toolbar__diff-clear"
                        :aria-label="t('review.clearDiffsTitle')"
                        :title="t('review.clearDiffsTitle')"
                        @click="emit('clear-diffs')"
                    >
                        <span class="i-lucide-file-diff h-3.5 w-3.5" />
                        <span>{{ t("review.diffCount", {count: diffCount}) }}</span>
                        <span class="i-lucide-x h-3 w-3 text-[var(--text-muted)]" />
                    </button>
                </div>
                <span
                    v-if="selected"
                    class="review-editor-toolbar__selection"
                    :class="selected.mappable ? 'is-ready' : 'is-blocked'"
                    :title="selected.mappable ? t('review.selectionReadyTitle') : selected.disabledReason"
                >
                    <span :class="selected.mappable ? 'i-lucide-text-select' : 'i-lucide-circle-alert'" class="h-3.5 w-3.5" />
                    <span>{{ selected.mappable ? t("review.selectedChars", {count: selectedLength}) : selected.disabledReason }}</span>
                </span>
                <span v-else class="review-editor-toolbar__hint">{{ t("review.selectionHint") }}</span>
            </div>
            <!-- 修改痕迹开关（R5）：草稿 vs 原文的未提交 diff 层，source/preview 双模式；AI 改写审阅期由宿主 forceDiffs 强开 -->
            <button
                type="button"
                class="review-editor-toolbar__icon-button"
                :class="(settings.draftDiff || forceDiffs) ? 'is-active' : ''"
                :aria-pressed="settings.draftDiff || forceDiffs"
                :aria-label="(settings.draftDiff || forceDiffs) ? t('review.draftDiffOnTitle') : t('review.draftDiffOffTitle')"
                :title="(settings.draftDiff || forceDiffs) ? t('review.draftDiffOnTitle') : t('review.draftDiffOffTitle')"
                @click="toggleDraftDiff"
            >
                <span class="i-lucide-git-compare h-3.5 w-3.5" />
            </button>
            <!-- 编辑器热力开关（R6 + Task 17 A2 移植镜像层）：source/preview 双模式，宿主传了热力块才显示 -->
            <button
                v-if="(heat?.length ?? 0) > 0"
                type="button"
                class="review-editor-toolbar__icon-button"
                :class="settings.editorHeatmap ? 'is-active' : ''"
                :aria-pressed="settings.editorHeatmap"
                :aria-label="settings.editorHeatmap ? t('review.editorHeatmapOnTitle') : t('review.editorHeatmapOffTitle')"
                :title="settings.editorHeatmap ? t('review.editorHeatmapOnTitle') : t('review.editorHeatmapOffTitle')"
                @click="toggleEditorHeatmap"
            >
                <span class="i-lucide-thermometer h-3.5 w-3.5" />
            </button>
            <!-- 校对批注开关（7b）：仅预览模式生效——源码模式是 textarea 镜像层，无法行内插入建议文本 -->
            <button
                v-if="mode === 'preview'"
                type="button"
                class="review-editor-toolbar__icon-button"
                :class="proofreadEnabled ? 'is-active' : ''"
                :aria-pressed="proofreadEnabled"
                :aria-label="proofreadEnabled ? t('review.proofreadOnTitle') : t('review.proofreadOffTitle')"
                :title="proofreadEnabled ? t('review.proofreadOnTitle') : t('review.proofreadOffTitle')"
                @click="toggleProofreadMarks"
            >
                <span class="i-lucide-pencil-ruler h-3.5 w-3.5" />
            </button>
            <button
                v-if="comments.length > 0"
                type="button"
                class="review-editor-toolbar__icon-button"
                :class="commentsOpen ? 'is-active' : ''"
                :aria-label="commentsOpen ? t('review.collapseCommentsTitle') : t('review.expandCommentsTitle')"
                :title="commentsOpen ? t('review.collapseCommentsTitle') : t('review.expandCommentsTitle')"
                @click="commentsOpen = !commentsOpen"
            >
                <span class="i-lucide-panel-right h-3.5 w-3.5" />
            </button>
            <button
                v-if="activeIssueMark"
                type="button"
                class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                :class="activeIssueCommentOpen ? 'border-[var(--accent-main)] text-[var(--accent-text)]' : ''"
                :aria-label="t('review.addIssueCommentTitle', {text: activeIssueMark.match})"
                :title="t('review.addIssueCommentTitle', {text: activeIssueMark.match})"
                @click="activeIssueCommentOpen ? closeActiveIssueComment() : openActiveIssueComment()"
            >
                <span class="i-lucide-message-square-plus h-3.5 w-3.5" />
                <span>{{ t("review.addIssueComment") }}</span>
            </button>
            <button
                v-if="activeIssueMark"
                type="button"
                class="review-editor-toolbar__icon-button"
                :aria-label="t('review.copyIssuePromptTitle')"
                :title="t('review.copyIssuePromptTitle')"
                @click="void copyActiveIssuePrompt()"
            >
                <span class="i-lucide-wand-sparkles h-3.5 w-3.5" />
                <span class="sr-only">{{ t("review.copyIssuePrompt") }}</span>
            </button>
            <button
                v-if="activeReplacement"
                type="button"
                class="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium"
                :class="activeReplacement.fixability === 'candidate' ? 'bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300' : 'bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300'"
                :aria-label="activeReplacementTitle(activeReplacement)"
                :title="activeReplacementTitle(activeReplacement)"
                @click="acceptReplacement(activeReplacement)"
            >
                <span class="i-lucide-check h-3.5 w-3.5" />
                <span>{{ replacementActionLabel(activeReplacement, true) }}</span>
            </button>
        </div>

        <form v-if="activeIssueCommentOpen && activeIssueMark" data-review-active-issue-comment-form="true" class="review-editor-active-comment" @submit.prevent="submitActiveIssueComment">
            <div class="review-editor-active-comment__target">
                <span class="i-lucide-scan-text h-3.5 w-3.5 text-[var(--accent-text)]" />
                <span class="truncate">{{ activeIssueMark.title }}</span>
                <span class="truncate font-mono text-[11px] text-[var(--text-muted)]">「{{ activeIssueMark.match }}」</span>
            </div>
            <textarea
                ref="activeIssueCommentInput"
                v-model="activeIssueCommentBody"
                data-review-active-issue-comment-input="true"
                class="review-editor-active-comment__input"
                rows="2"
                :aria-label="t('review.commentBodyLabel')"
                :placeholder="t('review.activeIssueCommentPlaceholder')"
                @keydown.esc.prevent.stop="closeActiveIssueComment"
                @keydown.ctrl.enter.prevent.stop="submitActiveIssueComment"
                @keydown.meta.enter.prevent.stop="submitActiveIssueComment"
            ></textarea>
            <div class="review-editor-active-comment__actions">
                <button type="button" data-review-active-issue-comment-cancel="true" class="review-editor-active-comment__cancel" :aria-label="t('common.cancel')" :title="t('common.cancel')" @click="closeActiveIssueComment">
                    <span class="i-lucide-x h-3.5 w-3.5" />
                    <span>{{ t("common.cancel") }}</span>
                </button>
                <button type="submit" data-review-active-issue-comment-submit="true" class="review-editor-active-comment__submit" :disabled="!activeIssueCommentBody.trim()" :aria-label="t('review.saveComment')" :title="t('review.saveComment')">
                    <span class="i-lucide-check h-3.5 w-3.5" />
                    <span>{{ t("review.saveComment") }}</span>
                </button>
            </div>
        </form>

        <div
            class="grid min-h-0 flex-1"
            :class="[
                comments.length > 0 && commentsOpen ? 'grid-rows-[minmax(0,1fr)_minmax(8rem,12rem)] md:grid-cols-[minmax(0,1fr)_8px_auto] md:grid-rows-none' : '',
                isCommentPanelResizing ? 'is-comment-resizing' : '',
            ]"
        >
            <div class="min-h-0">
                <div v-if="mode === 'source'" class="llmlint-source-editor-surface relative h-full min-h-0">
                    <HighlightedTextarea
                        ref="sourceEditor"
                        :model-value="modelValue"
                        :ranges="ranges"
                        :comment-ranges="sourceCommentRanges"
                        :active-issue-range="sourceActiveIssueRange"
                        :diff-ranges="sourceDiffRanges"
                        :locate-offset="locateOffset"
                        :heat="heatActive ? heat : null"
                        @update:model-value="updateSource"
                        @caret-click="handleSourceCaretClick"
                        @selection-change="handleSourceSelection"
                        @source-format-command="handleSourceFormatCommand"
                    />
                    <ReviewSourceSelectionMenu
                        v-if="selected?.source === 'source' && selected.mappable"
                        :selection="selected"
                        :issue-mark="selectionIssueMark"
                        :replacement-mark="selectionReplacement"
                        :document-text="modelValue"
                        :comments="comments"
                        :link-request-token="linkShortcutToken"
                        :comment-request-token="commentShortcutToken"
                        :llm-rewrite-enabled="llmRewriteEnabled"
                        :annotate-enabled="annotateEnabled"
                        @add-comment="addInlineComment"
                        @accept-replacement="acceptReplacement"
                        @replace-selection="replaceSelectionWithText"
                        @format-selection="formatSelection"
                        @link-selection="linkSelection"
                        @llm-rewrite-selection="requestLlmSelectionRewrite"
                        @save-annotation="saveSelectionAnnotation"
                    />
                </div>
                <div v-else class="llmlint-review-editor h-full min-h-0 overflow-auto bg-[var(--bg-input)] px-5 py-4 text-[var(--text-main)]" :class="[proofreadEnabled ? 'is-proofread' : '', heatActive ? 'is-heat' : '']">
                    <EditorContent :editor="editor" @vue:mounted="void refreshPreviewDecorationsAfterMount()" />
                    <ReviewSelectionMenu
                        v-if="editor && selected"
                        :editor="editor"
                        :selection="selected"
                        :issue-mark="selectionIssueMark"
                        :replacement-mark="selectionReplacement"
                        :document-text="modelValue"
                        :comments="comments"
                        :link-request-token="linkShortcutToken"
                        :comment-request-token="commentShortcutToken"
                        :llm-rewrite-enabled="llmRewriteEnabled"
                        @add-comment="addInlineComment"
                        @locate-source="locateSelectionInSource"
                        @accept-replacement="acceptReplacement"
                        @replace-selection="replaceSelectionWithText"
                        @format-selection="formatSelection"
                        @link-selection="linkSelection"
                        @llm-rewrite-selection="requestLlmSelectionRewrite"
                    />
                </div>
            </div>

            <!-- inline 规则菜单（R2 + Task 17 A2）：preview 点命中装饰 / source 点命中段（虚拟锚点）共用；Teleport 到主题宿主 -->
            <RuleInlineMenu
                v-if="inlineMenuMark && inlineMenuAnchor"
                :mark="inlineMenuMark"
                :anchor="inlineMenuAnchor"
                @apply="handleRuleMenuApply"
                @hide="handleRuleMenuHide"
                @close="closeRuleMenu"
            />

            <div
                v-if="comments.length > 0 && commentsOpen"
                ref="commentResizeHandle"
                class="review-editor-comment-resize hidden md:flex"
                :class="isCommentPanelResizing ? 'is-active' : ''"
                role="separator"
                aria-orientation="vertical"
                :tabindex="canResizeComments ? 0 : -1"
                :aria-valuenow="Math.round(settings.reviewCommentPanelWidth)"
                :aria-valuemin="Math.round(commentPanelMinWidth)"
                :aria-valuemax="Math.round(commentPanelMaxWidth)"
                :aria-label="t('review.resizeCommentsTitle')"
                :title="t('review.resizeCommentsTitle')"
                @keydown="handleCommentResizeKeydown"
            >
                <span />
            </div>

            <aside v-if="comments.length > 0 && commentsOpen" class="flex min-h-0 flex-col border-t border-[var(--border-color)] bg-[var(--bg-panel)] md:border-t-0" :style="canResizeComments ? commentPanelStyle : undefined">
                <div class="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-color)] px-3 text-sm font-medium">
                    <span class="i-lucide-message-square-text h-4 w-4 text-[var(--accent-text)]" />
                    <span>{{ t("review.commentsPanelTitle") }}</span>
                    <div class="ml-auto flex items-center gap-1.5">
                        <div class="inline-flex h-7 items-center overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] text-[11px] text-[var(--text-secondary)]">
                            <button
                                type="button"
                                class="inline-flex h-full w-7 items-center justify-center hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                                :aria-label="previousCommentTitle"
                                :title="previousCommentTitle"
                                @click="navigateComment('previous')"
                            >
                                <span class="i-lucide-chevron-up h-3.5 w-3.5" />
                            </button>
                            <span class="min-w-9 border-x border-[var(--border-color)] px-1.5 text-center tabular-nums">{{ commentReviewLabel }}</span>
                            <button
                                type="button"
                                class="inline-flex h-full w-7 items-center justify-center hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                                :aria-label="nextCommentTitle"
                                :title="nextCommentTitle"
                                @click="navigateComment('next')"
                            >
                                <span class="i-lucide-chevron-down h-3.5 w-3.5" />
                            </button>
                        </div>
                        <span class="rounded-full bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{{ t("review.unresolvedCount", {open: unresolvedCommentCount, total: comments.length}) }}</span>
                        <button
                            type="button"
                            class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-red-500"
                            :aria-label="t('review.clearCommentsTitle')"
                            :title="t('review.clearCommentsTitle')"
                            @click="emit('clear-comments')"
                        >
                            <span class="i-lucide-trash-2 h-3.5 w-3.5" />
                            <span class="sr-only">{{ t("review.clearComments") }}</span>
                        </button>
                        <button
                            type="button"
                            class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                            :aria-label="t('review.collapseCommentsTitle')"
                            :title="t('review.collapseCommentsTitle')"
                            @click="commentsOpen = false"
                        >
                            <span class="i-lucide-x h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
                <div class="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                    <article
                        v-for="comment in comments"
                        :key="comment.id"
                        :data-comment-card-id="comment.id"
                        class="rounded-md border bg-[var(--bg-input)] p-2 text-xs transition-colors"
                        :class="[
                            activeCommentId === comment.id ? 'border-[var(--accent-main)] ring-2 ring-[var(--accent-bg)]' : 'border-[var(--border-color)] hover:border-[var(--accent-main)]/50',
                            comment.resolved ? 'opacity-65' : '',
                        ]"
                    >
                        <button
                            type="button"
                            class="flex w-full items-start gap-2 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-main)]/45"
                            :aria-label="commentActionTitle(t('review.locateCommentTitle'), comment)"
                            :title="commentActionTitle(t('review.locateCommentTitle'), comment)"
                            @click="void activateComment(comment.id)"
                        >
                            <span
                                class="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border border-[var(--accent-main)] bg-[var(--bg-panel)] px-1 text-[10px] font-bold text-[var(--accent-text)]"
                                :class="activeCommentId === comment.id ? 'bg-[var(--accent-main)] text-white' : ''"
                            >{{ commentIndexMap.get(comment.id) }}</span>
                            <div class="line-clamp-2 min-w-0 flex-1 text-[var(--text-muted)]">{{ comment.quote }}</div>
                            <span
                                v-if="comment.stale"
                                class="shrink-0 rounded-full bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-medium text-orange-700 dark:text-orange-300"
                                :title="t('review.commentStaleTitle')"
                            >{{ t("review.commentStale") }}</span>
                            <span
                                class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                                :class="comment.resolved ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/14 text-amber-700 dark:text-amber-300'"
                            >{{ comment.resolved ? t("review.commentResolved") : t("review.commentUnresolved") }}</span>
                        </button>
                        <form v-if="editingCommentId === comment.id" :data-comment-edit-form-id="comment.id" class="mt-2 space-y-2" @submit.prevent.stop="saveEditComment">
                            <textarea
                                :ref="(el) => setEditingCommentInput(comment.id, el)"
                                v-model="editingCommentBody"
                                :data-comment-edit-id="comment.id"
                                class="min-h-20 w-full resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-2 text-xs text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]"
                                :aria-label="t('review.commentBodyLabel')"
                                @keydown.esc.prevent.stop="cancelEditComment"
                                @keydown.ctrl.enter.prevent.stop="saveEditComment"
                                @keydown.meta.enter.prevent.stop="saveEditComment"
                            />
                            <div class="flex justify-end gap-1.5">
                                <button type="button" :data-comment-edit-cancel-id="comment.id" class="inline-flex h-7 items-center gap-1 rounded px-2 text-[var(--text-muted)] hover:bg-[var(--bg-hover)]" :aria-label="commentActionTitle(t('common.cancel'), comment)" :title="commentActionTitle(t('common.cancel'), comment)" @click.stop="cancelEditComment">
                                    <span class="i-lucide-x h-3.5 w-3.5" />
                                    <span>{{ t("common.cancel") }}</span>
                                </button>
                                <button type="submit" :data-comment-edit-submit-id="comment.id" class="inline-flex h-7 items-center gap-1 rounded bg-[var(--accent-main)] px-2 font-medium text-white disabled:opacity-50" :disabled="!editingCommentBody.trim()" :aria-label="commentActionTitle(t('review.saveComment'), comment)" :title="commentActionTitle(t('review.saveComment'), comment)">
                                    <span class="i-lucide-check h-3.5 w-3.5" />
                                    <span>{{ t("review.saveComment") }}</span>
                                </button>
                            </div>
                        </form>
                        <div v-else>
                            <div class="mt-2 whitespace-pre-wrap text-[var(--text-main)]">{{ comment.body }}</div>
                            <div class="mt-2 flex justify-end gap-1.5">
                                <button type="button" class="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :aria-label="commentActionTitle(t('review.copyCommentContextTitle'), comment)" :title="commentActionTitle(t('review.copyCommentContextTitle'), comment)" @click.stop="void copyCommentContext(comment)">
                                    <span class="i-lucide-copy h-3.5 w-3.5" />
                                    <span class="sr-only">{{ t("review.copyCommentContextTitle") }}</span>
                                </button>
                                <button type="button" class="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :aria-label="commentActionTitle(comment.resolved ? t('review.reopenCommentTitle') : t('review.completeCommentTitle'), comment)" :title="commentActionTitle(comment.resolved ? t('review.reopenCommentTitle') : t('review.completeCommentTitle'), comment)" @click.stop="toggleCommentResolvedFromRail(comment)">
                                    <span :class="comment.resolved ? 'i-lucide-rotate-ccw' : 'i-lucide-check-circle-2'" class="h-3.5 w-3.5" />
                                    <span>{{ comment.resolved ? t("review.reopen") : t("review.complete") }}</span>
                                </button>
                                <button type="button" class="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :aria-label="commentActionTitle(t('review.editCommentTitle'), comment)" :title="commentActionTitle(t('review.editCommentTitle'), comment)" @click.stop="startEditComment(comment)">
                                    <span class="i-lucide-pencil h-3.5 w-3.5" />
                                    <span>{{ t("review.edit") }}</span>
                                </button>
                                <button type="button" class="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-red-500" :aria-label="commentActionTitle(t('review.deleteCommentTitle'), comment)" :title="commentActionTitle(t('review.deleteCommentTitle'), comment)" @click.stop="deleteCommentFromRail(comment)">
                                    <span class="i-lucide-trash-2 h-3.5 w-3.5" />
                                    <span>{{ t("review.delete") }}</span>
                                </button>
                            </div>
                        </div>
                    </article>
                </div>
            </aside>
        </div>
    </div>
</template>

<style scoped>
.review-editor-toolbar {
    min-height: 45px;
}

.review-editor-toolbar__status {
    display: flex;
    min-width: 12rem;
    align-items: center;
    gap: 6px;
    overflow: hidden;
}

.review-editor-toolbar__chip,
.review-editor-toolbar__selection {
    display: inline-flex;
    height: 26px;
    min-width: 0;
    flex: 0 0 auto;
    align-items: center;
    gap: 5px;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--bg-subtle);
    padding: 0 8px;
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
}

.review-editor-toolbar__chip.is-attention {
    border-color: color-mix(in srgb, var(--accent-main) 38%, var(--border-color));
    color: var(--accent-text);
}

.review-editor-toolbar__diff-nav {
    display: inline-flex;
    height: 26px;
    flex: 0 0 auto;
    align-items: center;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--accent-main) 38%, var(--border-color));
    border-radius: 999px;
    background: var(--bg-subtle);
    color: var(--accent-text);
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
}

.review-editor-toolbar__diff-button {
    display: inline-flex;
    height: 100%;
    width: 26px;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
}

.review-editor-toolbar__diff-button:hover,
.review-editor-toolbar__diff-clear:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}

.review-editor-toolbar__diff-button:disabled {
    cursor: not-allowed;
    color: var(--text-muted);
    opacity: 0.5;
}

.review-editor-toolbar__diff-button:disabled:hover {
    background: transparent !important;
    color: var(--text-muted);
}

.review-editor-toolbar__diff-label {
    min-width: 2.25rem;
    border-inline: 1px solid var(--border-color);
    padding: 0 6px;
    text-align: center;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
}

.review-editor-toolbar__diff-clear {
    display: inline-flex;
    height: 100%;
    align-items: center;
    gap: 5px;
    padding: 0 8px;
}

.review-editor-comment-resize {
    position: relative;
    z-index: 3;
    cursor: col-resize;
    align-items: stretch;
    justify-content: center;
    border-left: 1px solid var(--border-color);
    border-right: 1px solid var(--border-color);
    background: var(--bg-panel);
    touch-action: none;
}

.review-editor-comment-resize span {
    width: 2px;
    margin: 8px 0;
    border-radius: 999px;
    background: color-mix(in srgb, var(--border-color) 78%, transparent);
    transition: background-color 0.15s ease, width 0.15s ease;
}

.review-editor-comment-resize:hover span,
.review-editor-comment-resize.is-active span {
    width: 3px;
    background: var(--accent-main);
}

.review-editor-comment-resize:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent-main) 70%, transparent);
    outline-offset: -2px;
}

.is-comment-resizing {
    user-select: none;
}

.is-comment-resizing :deep(.llmlint-source-editor-surface textarea) {
    pointer-events: none;
}

.review-editor-toolbar__selection {
    flex: 1 1 auto;
    max-width: 22rem;
    overflow: hidden;
}

.review-editor-toolbar__selection span:last-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}

.review-editor-toolbar__selection.is-ready {
    border-color: color-mix(in srgb, var(--accent-main) 42%, var(--border-color));
    background: color-mix(in srgb, var(--accent-bg) 70%, transparent);
    color: var(--accent-text);
}

.review-editor-toolbar__selection.is-blocked {
    border-color: color-mix(in srgb, #f59e0b 38%, var(--border-color));
    background: color-mix(in srgb, #f59e0b 12%, var(--bg-subtle));
    color: color-mix(in srgb, #d97706 82%, var(--text-main));
}

.review-editor-toolbar__hint {
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.review-editor-toolbar__icon-button {
    display: inline-flex;
    height: 30px;
    width: 30px;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    color: var(--text-muted);
    transition: background-color 0.15s ease, color 0.15s ease;
}

.review-editor-toolbar__icon-button:hover,
.review-editor-toolbar__icon-button.is-active {
    background: var(--bg-hover);
    color: var(--text-main);
}

.review-editor-active-comment {
    display: grid;
    grid-template-columns: minmax(9rem, 15rem) minmax(0, 1fr) auto;
    align-items: start;
    gap: 8px;
    border-bottom: 1px solid var(--border-color);
    background: color-mix(in srgb, var(--accent-bg) 42%, var(--bg-panel));
    padding: 8px 12px;
}

.review-editor-active-comment__target {
    display: flex;
    min-width: 0;
    height: 34px;
    align-items: center;
    gap: 6px;
    color: var(--text-secondary);
    font-size: 12px;
}

.review-editor-active-comment__input {
    min-height: 38px;
    max-height: 96px;
    resize: vertical;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-input);
    padding: 7px 9px;
    color: var(--text-main);
    font-size: 13px;
    line-height: 1.45;
    outline: none;
}

.review-editor-active-comment__input:focus {
    border-color: var(--accent-main);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-main) 14%, transparent);
}

.review-editor-active-comment__actions {
    display: flex;
    align-items: center;
    gap: 6px;
}

.review-editor-active-comment__cancel,
.review-editor-active-comment__submit {
    display: inline-flex;
    height: 34px;
    align-items: center;
    justify-content: center;
    gap: 5px;
    border-radius: 8px;
    padding: 0 10px;
    font-size: 12px;
    font-weight: 650;
    white-space: nowrap;
}

.review-editor-active-comment__cancel {
    color: var(--text-muted);
}

.review-editor-active-comment__cancel:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}

.review-editor-active-comment__submit {
    background: var(--accent-main);
    color: #fff;
}

.review-editor-active-comment__submit:disabled {
    cursor: default;
    opacity: 0.5;
}

@media (max-width: 720px) {
    .review-editor-toolbar__status {
        order: 3;
        width: 100%;
        min-width: 0;
    }

    .review-editor-toolbar__chip {
        display: none;
    }

    .review-editor-toolbar__diff-nav {
        max-width: 100%;
    }

    .review-editor-toolbar__selection,
    .review-editor-toolbar__hint {
        max-width: none;
    }

    .review-editor-active-comment {
        grid-template-columns: minmax(0, 1fr);
    }

    .review-editor-active-comment__target {
        height: auto;
    }

    .review-editor-active-comment__actions {
        justify-content: flex-end;
    }
}

:deep(.llmlint-review-preview) {
    margin: 0 auto;
    max-width: 820px;
    min-height: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
    font-size: 14px;
    line-height: 1.8;
}

:deep(.llmlint-review-preview h1) {
    margin: 0.5rem 0 0.75rem;
    font-size: 1.45rem;
    font-weight: 700;
}

:deep(.llmlint-review-preview h2) {
    margin: 0.75rem 0 0.5rem;
    font-size: 1.2rem;
    font-weight: 650;
}

:deep(.llmlint-review-preview p) {
    margin: 0.45rem 0;
}

:deep(.llmlint-review-preview ul),
:deep(.llmlint-review-preview ol) {
    margin: 0.5rem 0;
    padding-left: 1.5rem;
}

:deep(.llmlint-review-preview code) {
    border-radius: 4px;
    background: var(--bg-subtle);
    padding: 0.1rem 0.25rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

:deep(.llmlint-review-preview pre) {
    overflow: auto;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-subtle);
    padding: 0.75rem;
}

:deep(.llmlint-issue-mark) {
    border-radius: 3px;
    cursor: pointer;
}

:deep(.llmlint-issue-high) {
    background: rgba(248, 113, 113, 0.35);
}

:deep(.llmlint-issue-medium) {
    background: rgba(251, 191, 36, 0.38);
}

:deep(.llmlint-issue-low) {
    background: rgba(161, 161, 170, 0.34);
}

:deep(.llmlint-issue-mark.is-active) {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-main) 62%, transparent), 0 0 0 5px color-mix(in srgb, var(--accent-main) 16%, transparent);
}

/* 建议按需显示：替换预览标签与删除线只在 active 命中上出现，非 active 命中仅保留底色。 */
:deep(.llmlint-issue-replaceable.is-active)::after {
    content: " -> " attr(data-replacement-label);
    margin-left: 0.25rem;
    border-radius: 3px;
    background: rgba(16, 185, 129, 0.16);
    padding: 0 0.2rem;
    color: rgb(5, 150, 105);
    font-size: 0.88em;
}

:deep(.llmlint-issue-delete-replacement.is-active) {
    border-radius: 0;
    background: transparent;
    color: #b91c1c !important;
    text-decoration-line: line-through;
    text-decoration-color: #dc2626;
    text-decoration-thickness: 2px;
    text-decoration-skip-ink: none;
}

:deep(.llmlint-issue-delete-replacement.is-active)::after {
    content: none;
}

/* —— 校对批注层（Task 15 P2-E 7b）——
   与既有三层的视觉区分：命中高亮 = 级别底色（保留）；diff 已删除 = 红色纯文本 widget（内容已不在文中）；
   diff 已插入 = 绿底实块（已应用改动）。校对层表达「尚未应用的建议」：原文保留底色并叠中性删除线，
   建议文本用绿字 + 虚线下划线（非实底 → 一眼可辨未应用），纯删除用红色 × 角标。 */
:deep(.llmlint-proofread-original) {
    text-decoration-line: line-through;
    text-decoration-color: color-mix(in srgb, #dc2626 60%, transparent);
    text-decoration-thickness: 1.5px;
    text-decoration-skip-ink: none;
}

:deep(.llmlint-proofread-insert) {
    margin-left: 2px;
    border-bottom: 1px dashed rgb(5, 150, 105);
    border-radius: 2px;
    padding: 0 1px;
    color: rgb(5, 150, 105);
    cursor: pointer;
    font-size: 0.92em;
    text-decoration: none;
}

:deep(.llmlint-proofread-insert:hover) {
    background: rgba(16, 185, 129, 0.16);
}

:deep(.llmlint-proofread-delete-badge) {
    display: inline-flex;
    margin-left: 1px;
    min-width: 0.95em;
    align-items: center;
    justify-content: center;
    border: 1px solid color-mix(in srgb, #dc2626 55%, transparent);
    border-radius: 999px;
    vertical-align: super;
    color: #dc2626;
    cursor: pointer;
    font-size: 0.62em;
    font-weight: 700;
    line-height: 1.3;
}

:deep(.llmlint-proofread-delete-badge:hover) {
    background: rgba(220, 38, 38, 0.14);
}

/* 校对模式下 active 命中不再用 ::after 复读建议文本（widget 已常驻行内，避免双份）。 */
.llmlint-review-editor.is-proofread :deep(.llmlint-issue-replaceable.is-active)::after {
    content: none;
}

/* —— 编辑器热力层（Task 16 R6）——
   热力开时正文按检测分块铺 P(AI) 梯度底色（inline style，绿→红），规则命中的级别底色让位、
   改为下划线标注——「底色 vs 下划线」区分两种信号，对齐只读视图 ReadOnlyHighlightedText 的口径
   （high=红 / medium=琥珀 / low=灰，2px 下划线 + offset）。 */
.llmlint-review-editor.is-heat :deep(.llmlint-issue-mark) {
    background: transparent;
    text-decoration-line: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 2px;
    text-decoration-skip-ink: none;
}

.llmlint-review-editor.is-heat :deep(.llmlint-issue-high) {
    text-decoration-color: rgb(239, 68, 68);
}

.llmlint-review-editor.is-heat :deep(.llmlint-issue-medium) {
    text-decoration-color: rgb(245, 158, 11);
}

.llmlint-review-editor.is-heat :deep(.llmlint-issue-low) {
    text-decoration-color: rgb(161, 161, 170);
}

/* 校对删除线与热力下划线并存（text-decoration-line 支持多值，避免高优先级规则吃掉删除线）。 */
.llmlint-review-editor.is-heat :deep(.llmlint-issue-mark.llmlint-proofread-original),
.llmlint-review-editor.is-heat :deep(.llmlint-issue-delete-replacement.is-active) {
    text-decoration-line: underline line-through;
}

/* diff 已插入底色优先覆盖热力：热力块用 inline style 背景（优先级高于 class），
   这里用 !important 把待审改动的绿底抬回最上层（装饰写入顺序 heat → diff 与之配套）。 */
.llmlint-review-editor.is-heat :deep(.llmlint-diff-inserted) {
    background: color-mix(in srgb, #10b981 18%, transparent) !important;
}

:deep(.llmlint-comment-mark) {
    position: relative;
    cursor: pointer;
    border-bottom: 2px solid var(--accent-main);
    background: var(--accent-bg);
}

:deep(.llmlint-comment-mark.is-active) {
    border-radius: 3px;
    background: color-mix(in srgb, var(--accent-main) 22%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-main) 48%, transparent);
}

:deep(.llmlint-comment-mark.is-resolved) {
    border-bottom-style: dashed;
    opacity: 0.72;
}

/* stale：批注锚定的原句在草稿中已被改写，用点状橙色下划线提示。 */
:deep(.llmlint-comment-mark.is-stale) {
    border-bottom-style: dotted;
    border-bottom-color: #f97316;
}

:deep(.llmlint-comment-mark[data-comment-index])::after {
    content: attr(data-comment-index);
    position: absolute;
    right: -0.52em;
    top: -0.64em;
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
    font-size: 0.52em;
    font-weight: 700;
    line-height: 1;
    pointer-events: none;
}

:deep(.llmlint-comment-mark.is-active[data-comment-index])::after {
    background: var(--accent-main);
    color: #fff;
}

:deep(.llmlint-diff-deleted) {
    display: inline;
    margin-right: 0.18rem;
    border-radius: 0;
    background: transparent;
    color: #dc2626;
    cursor: pointer;
    text-decoration-line: line-through;
    text-decoration-thickness: 2px;
    text-decoration-skip-ink: none;
}

:deep(.llmlint-diff-deleted.is-active) {
    box-shadow: 0 0 0 2px color-mix(in srgb, #ef4444 42%, transparent);
}

:deep(.llmlint-diff-inserted) {
    border-radius: 3px;
    background: color-mix(in srgb, #10b981 18%, transparent);
    box-shadow: inset 0 -2px 0 color-mix(in srgb, #10b981 72%, transparent);
    cursor: pointer;
}

:deep(.llmlint-diff-inserted.is-active) {
    box-shadow: inset 0 -2px 0 color-mix(in srgb, #10b981 72%, transparent), 0 0 0 2px color-mix(in srgb, #10b981 42%, transparent);
}
</style>
