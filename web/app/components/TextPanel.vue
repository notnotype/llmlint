<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";
import type {AutoFixChange} from "llmlint/fix";
import type {HighlightRange, Issue} from "../types";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import {useNotification} from "../composables/useNotification";
import {useWebSettings} from "../composables/useWebSettings";
import {SAMPLE_TEXT} from "../utils/sample-text";
import {
    applyIssueReplacement,
    buildLineDiffRangesForTextReplacement,
    buildReviewIssueMarks,
    issueId,
    issueStartOffset,
    transformReviewCommentsForTextChange,
    transformReviewDiffsForTextChange,
    type ReviewComment,
    type ReviewEditorMode,
    type ReviewIssueMark,
    type ReviewTextDiff,
} from "../utils/review-ranges";
import {loadStoredReviewComments, saveStoredReviewComments} from "../utils/review-comment-storage";

// 左侧输入面板：文本 + 行内高亮开关 + Markdown 遮罩开关
const text = defineModel<string>({required: true});
const scanAll = defineModel<boolean>("scanAll", {default: false});
const props = defineProps<{
    ranges: HighlightRange[];
    issues: Issue[];
    locateOffset?: number | null;
    autoFixCount?: number;
    autoFixText?: string;
    autoFixChanges?: AutoFixChange[];
    activeIssue?: Issue | null;
    originalText?: string;
}>();
const emit = defineEmits<{
    (e: "caret-click", offset: number): void;
    (e: "navigate-issue", direction: "previous" | "next"): void;
    (e: "rebase-original", value: string): void;
    (e: "replacement-applied", from: number): void;
}>();
const {settings, patch} = useWebSettings();
const {t} = useLlmlintI18n();
const notification = useNotification();
const comments = ref<ReviewComment[]>([]);
const diffs = ref<ReviewTextDiff[]>([]);
const commentSequence = ref(0);
const diffSequence = ref(0);
const restoringSnapshot = ref(false);
const pendingDiffs = ref<ReviewTextDiff[]>([]);

type IssueNavigationShortcut = "previous" | "next";

// 行内高亮开关保存在浏览器设置里。关掉时传空区间给背板 → 纯文本编辑。
const shownRanges = computed<HighlightRange[]>(() => (settings.value.highlight ? props.ranges : []));
const editorText = computed<string>({
    get: () => text.value,
    set: (value) => updateText(value),
});
const issueMarks = computed<ReviewIssueMark[]>(() => buildReviewIssueMarks(text.value, props.issues));
const activeIssueMark = computed<ReviewIssueMark | null>(() => {
    if (props.activeIssue) {
        const from = issueStartOffset(text.value, props.activeIssue);
        const active = issueMarks.value.find((mark) => mark.ruleId === props.activeIssue?.rule.id && mark.from === from);
        if (active) {
            return active;
        }
    }
    if (props.locateOffset !== null && props.locateOffset !== undefined) {
        return issueMarks.value.find((mark) => mark.from === props.locateOffset) ?? null;
    }
    return null;
});
const editorMode = computed<ReviewEditorMode>({
    get: () => settings.value.reviewEditorMode,
    set: (mode) => patch({reviewEditorMode: mode}),
});
const activeIssueIndex = computed(() => {
    if (!props.activeIssue) {
        return -1;
    }
    const activeId = issueId(props.activeIssue);
    return props.issues.findIndex((issue) => issueId(issue) === activeId);
});
const activeIssueLabel = computed(() => props.issues.length > 0
    ? `${activeIssueIndex.value >= 0 ? activeIssueIndex.value + 1 : 0}/${props.issues.length}`
    : "0/0");
const hasOriginalBaseline = computed(() => Boolean(props.originalText));
const repairBaselineDiffs = computed<ReviewTextDiff[]>(() => {
    if (!props.originalText || props.originalText === text.value) {
        return [];
    }
    return buildLineDiffRangesForTextReplacement(props.originalText, text.value).map((range, index) => ({
        id: `repair-baseline-${index}-${range.from}-${range.to}`,
        ...range,
        source: "static",
        title: t("review.repairBaselineDiffTitle"),
    }));
});
const repairDraftChanged = computed(() => repairBaselineDiffs.value.length > 0);
const repairNetDelta = computed(() => text.value.length - (props.originalText?.length ?? text.value.length));
const repairDeltaLabel = computed(() => repairDraftChanged.value
    ? t("repair.changed", {delta: formatSignedCount(repairNetDelta.value)})
    : t("repair.unchanged"));

function loadSample() {
    text.value = SAMPLE_TEXT;
    comments.value = [];
    diffs.value = [];
    emit("rebase-original", SAMPLE_TEXT);
}
function clearText() {
    text.value = "";
    comments.value = [];
    diffs.value = [];
    emit("rebase-original", "");
}

function updateText(value: string): void {
    text.value = value;
}

function formatSignedCount(value: number): string {
    return value > 0 ? `+${value}` : String(value);
}

function issueNavigationShortcut(event: KeyboardEvent): IssueNavigationShortcut | null {
    if (event.defaultPrevented || (!event.ctrlKey && !event.metaKey) || !event.altKey || event.shiftKey) {
        return null;
    }
    if (event.key === "ArrowDown") {
        return "next";
    }
    if (event.key === "ArrowUp") {
        return "previous";
    }
    return null;
}

function isReviewInput(target: HTMLElement | null): boolean {
    return Boolean(target?.closest([
        "[data-review-comment-input='true']",
        "[data-review-source-comment-input='true']",
        "[data-review-active-issue-comment-input='true']",
        "[data-review-link-input='true']",
        "[data-review-source-link-input='true']",
        "[data-comment-edit-id]",
    ].join(",")));
}

function handleDocumentKeyDown(event: KeyboardEvent): void {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const direction = issueNavigationShortcut(event);
    if (!direction || isReviewInput(target) || props.issues.length === 0) {
        return;
    }
    event.preventDefault();
    emit("navigate-issue", direction);
}

function restoreStoredCommentsForText(value: string): boolean {
    const storedComments = loadStoredReviewComments(value);
    if (storedComments.length === 0) {
        return false;
    }
    comments.value = storedComments;
    return true;
}

function addComment(comment: Omit<ReviewComment, "id" | "source">): void {
    commentSequence.value += 1;
    comments.value.push({
        ...comment,
        id: `comment-${Date.now()}-${commentSequence.value}`,
        source: "user",
        resolved: false,
    });
}

function deleteComment(id: string): void {
    const index = comments.value.findIndex((comment) => comment.id === id);
    const deleted = comments.value[index];
    if (!deleted) {
        return;
    }
    const deletedAtText = text.value;
    comments.value = comments.value.filter((comment) => comment.id !== id);
    notification.info(t("notify.commentDeleted"), {
        label: t("common.undo"),
        run: () => {
            const [restoredComment] = transformReviewCommentsForTextChange(deletedAtText, text.value, [{...deleted}]);
            if (!restoredComment) {
                notification.notify({message: t("notify.commentRestoreSkipped"), tone: "warning"});
                return;
            }
            const nextComments = [...comments.value];
            nextComments.splice(Math.min(index, nextComments.length), 0, restoredComment);
            comments.value = nextComments;
        },
    });
}

function clearComments(): void {
    if (comments.value.length === 0) {
        return;
    }
    const previousComments = comments.value.map((comment) => ({...comment}));
    comments.value = [];
    notification.info(t("notify.commentsCleared", {count: previousComments.length}), {
        label: t("common.undo"),
        run: () => {
            comments.value = previousComments.map((comment) => ({...comment}));
        },
    });
}

function clearDiffs(): void {
    if (diffs.value.length === 0) {
        return;
    }
    const previousDiffs = diffs.value.map((diff) => ({...diff}));
    diffs.value = [];
    notification.info(t("notify.diffsCleared", {count: previousDiffs.length}), {
        label: t("common.undo"),
        run: () => {
            diffs.value = previousDiffs.map((diff) => ({...diff}));
        },
    });
}

function clearDiff(id: string): void {
    const index = diffs.value.findIndex((diff) => diff.id === id);
    const cleared = diffs.value[index];
    if (!cleared) {
        return;
    }
    const clearedAtText = text.value;
    diffs.value = diffs.value.filter((diff) => diff.id !== id);
    notification.info(t("notify.diffCleared"), {
        label: t("common.undo"),
        run: () => {
            const [restoredDiff] = transformReviewDiffsForTextChange(clearedAtText, text.value, [{...cleared}]);
            if (!restoredDiff) {
                notification.notify({message: t("notify.diffRestoreSkipped"), tone: "warning"});
                return;
            }
            if (diffs.value.some((diff) => diff.id === restoredDiff.id)) {
                return;
            }
            const nextDiffs = [...diffs.value];
            nextDiffs.splice(Math.min(index, nextDiffs.length), 0, restoredDiff);
            diffs.value = nextDiffs;
        },
    });
}

function updateComment(id: string, body: string): void {
    const previous = comments.value.find((comment) => comment.id === id);
    if (!previous || previous.body === body) {
        return;
    }
    comments.value = comments.value.map((comment) => comment.id === id ? {...comment, body} : comment);
    notification.success(t("notify.commentUpdated"), {
        label: t("common.undo"),
        run: () => {
            if (!comments.value.some((comment) => comment.id === id)) {
                notification.notify({message: t("notify.commentRestoreSkipped"), tone: "warning"});
                return;
            }
            comments.value = comments.value.map((comment) => comment.id === id ? {...comment, body: previous.body} : comment);
        },
    });
}

function toggleCommentResolved(id: string): void {
    comments.value = comments.value.map((comment) => comment.id === id ? {...comment, resolved: !comment.resolved} : comment);
}

function acceptReplacement(mark: ReviewIssueMark): void {
    const beforeText = text.value;
    const beforeComments = comments.value.map((comment) => ({...comment}));
    const beforeDiffs = diffs.value.map((diff) => ({...diff}));
    const nextText = applyIssueReplacement(text.value, mark);
    if (nextText === beforeText) {
        return;
    }
    diffSequence.value += 1;
    pendingDiffs.value = [{
        id: `diff-${Date.now()}-${diffSequence.value}`,
        from: mark.from,
        to: mark.from + (mark.replacement ?? "").length,
        deleted: beforeText.slice(mark.from, mark.to),
        inserted: mark.replacement ?? "",
        source: "static",
        title: mark.title,
    }];
    text.value = nextText;
    emit("replacement-applied", mark.from);
    notification.success(t("notify.replacementDone"), {
        label: t("common.undo"),
        run: () => restoreSnapshot(beforeText, beforeComments, beforeDiffs),
    });
}

function acceptIssueReplacement(issue: Issue): boolean {
    const id = issueId(issue);
    const mark = issueMarks.value.find((item) => item.id === id);
    if (!mark || mark.replacement === null) {
        return false;
    }
    acceptReplacement(mark);
    return true;
}

function replaceSelection(payload: {from: number; to: number; replacement: string; title?: string; source?: "static" | "llm"; notify?: "clipboard" | "format"}): void {
    const from = Math.max(0, Math.min(text.value.length, payload.from));
    const to = Math.max(from, Math.min(text.value.length, payload.to));
    const beforeText = text.value;
    const beforeComments = comments.value.map((comment) => ({...comment}));
    const beforeDiffs = diffs.value.map((diff) => ({...diff}));
    const nextText = `${beforeText.slice(0, from)}${payload.replacement}${beforeText.slice(to)}`;
    if (nextText === beforeText) {
        return;
    }
    diffSequence.value += 1;
    pendingDiffs.value = [{
        id: `diff-${Date.now()}-${diffSequence.value}`,
        from,
        to: from + payload.replacement.length,
        deleted: beforeText.slice(from, to),
        inserted: payload.replacement,
        source: payload.source ?? "llm",
        title: payload.title ?? t("review.clipboardDiffTitle"),
    }];
    text.value = nextText;
    notification.success(t(payload.notify === "format" ? "notify.selectionFormatted" : "notify.selectionReplaced"), {
        label: t("common.undo"),
        run: () => restoreSnapshot(beforeText, beforeComments, beforeDiffs),
    });
}

async function replaceTextFromClipboard(): Promise<void> {
    let clipboardText = "";
    try {
        clipboardText = await navigator.clipboard.readText();
    } catch {
        notification.error(t("notify.clipboardReadFailed"));
        return;
    }
    if (!clipboardText) {
        notification.info(t("notify.clipboardEmpty"));
        return;
    }
    const beforeText = text.value;
    if (clipboardText === beforeText) {
        return;
    }
    const beforeComments = comments.value.map((comment) => ({...comment}));
    const beforeDiffs = diffs.value.map((diff) => ({...diff}));
    pendingDiffs.value = buildLineDiffRangesForTextReplacement(beforeText, clipboardText).map((range) => {
        diffSequence.value += 1;
        return {
            id: `diff-${Date.now()}-${diffSequence.value}`,
            ...range,
            source: "llm" as const,
            title: t("review.fullTextClipboardDiffTitle"),
        };
    });
    text.value = clipboardText;
    notification.success(t(beforeComments.length > 0 ? "notify.fullTextReplacedWithComments" : "notify.fullTextReplaced"), {
        label: t("common.undo"),
        run: () => restoreSnapshot(beforeText, beforeComments, beforeDiffs),
    });
}

function getReviewComments(): ReviewComment[] {
    return comments.value.map((comment) => ({...comment}));
}

function cleanMechanical(): void {
    const nextText = props.autoFixText ?? text.value;
    const count = props.autoFixCount ?? 0;
    if (!count || nextText === text.value) {
        return;
    }
    const beforeText = text.value;
    const beforeComments = comments.value.map((comment) => ({...comment}));
    const beforeDiffs = diffs.value.map((diff) => ({...diff}));
    const nextDiffs = (props.autoFixChanges ?? []).map((change) => {
        diffSequence.value += 1;
        return {
            id: `diff-${Date.now()}-${diffSequence.value}`,
            from: change.from,
            to: change.to,
            deleted: change.deleted,
            inserted: change.inserted,
            source: "static" as const,
            title: change.title,
        };
    });
    pendingDiffs.value = nextDiffs;
    text.value = nextText;
    notification.success(t("notify.cleanDone", {count}), {
        label: t("common.undo"),
        run: () => restoreSnapshot(beforeText, beforeComments, beforeDiffs),
    });
}

function resetToOriginal(): void {
    if (!props.originalText || props.originalText === text.value) {
        return;
    }
    const beforeText = text.value;
    const beforeComments = comments.value.map((comment) => ({...comment}));
    const beforeDiffs = diffs.value.map((diff) => ({...diff}));
    restoringSnapshot.value = true;
    text.value = props.originalText;
    comments.value = transformReviewCommentsForTextChange(beforeText, props.originalText, beforeComments);
    diffs.value = [];
    pendingDiffs.value = [];
    queueMicrotask(() => {
        restoringSnapshot.value = false;
    });
    notification.success(t("notify.repairDraftReset"), {
        label: t("common.undo"),
        run: () => restoreSnapshot(beforeText, beforeComments, beforeDiffs),
    });
}

function restoreSnapshot(previousText: string, previousComments: ReviewComment[], previousDiffs: ReviewTextDiff[] = []): void {
    restoringSnapshot.value = true;
    text.value = previousText;
    comments.value = previousComments.map((comment) => ({...comment}));
    diffs.value = previousDiffs.map((diff) => ({...diff}));
    pendingDiffs.value = [];
    queueMicrotask(() => {
        restoringSnapshot.value = false;
    });
}

onMounted(() => {
    restoreStoredCommentsForText(text.value);
    document.addEventListener("keydown", handleDocumentKeyDown);
});

onBeforeUnmount(() => {
    document.removeEventListener("keydown", handleDocumentKeyDown);
});

watch(text, (nextText, previousText) => {
    if (restoringSnapshot.value) {
        return;
    }
    const nextDiffs = transformReviewDiffsForTextChange(previousText, nextText, diffs.value);
    const diffsToAppend = pendingDiffs.value;
    pendingDiffs.value = [];
    diffs.value = diffsToAppend.length > 0 ? [...nextDiffs, ...diffsToAppend] : nextDiffs;
    if (!restoreStoredCommentsForText(nextText)) {
        comments.value = transformReviewCommentsForTextChange(previousText, nextText, comments.value);
    }
});

watch([text, comments], ([nextText, nextComments]) => {
    saveStoredReviewComments(nextText, nextComments);
}, {deep: true, flush: "post"});

defineExpose({
    acceptIssueReplacement,
    getReviewComments,
    replaceTextFromClipboard,
});
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <!-- 工具条 -->
        <div class="flex flex-wrap items-center gap-2 border-b border-[var(--border-color)] px-3 py-2 text-sm">
            <button class="rounded bg-[var(--bg-subtle)] px-2 py-1 hover:bg-[var(--bg-hover)]" @click="loadSample">{{ t("text.sample") }}</button>
            <button class="inline-flex items-center gap-1 rounded bg-[var(--bg-subtle)] px-2 py-1 hover:bg-[var(--bg-hover)]" @click="clearText">
                <span class="i-lucide-trash-2" /> {{ t("text.clear") }}
            </button>
            <button
                v-if="autoFixCount"
                class="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-1 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
                :title="t('text.cleanMechanicalTitle')"
                @click="cleanMechanical"
            >
                <span class="i-lucide-sparkles" /> {{ t("text.cleanMechanical") }} ({{ autoFixCount }})
            </button>
            <div v-if="hasOriginalBaseline" class="repair-draft-status">
                <span class="repair-draft-status__mode">
                    <span class="i-lucide-pencil-line h-3.5 w-3.5" />
                    <span>{{ t("repair.draft") }}</span>
                </span>
                <span>{{ t("repair.originalBaseline", {count: originalText?.length ?? 0}) }}</span>
                <span :class="repairDraftChanged ? 'text-emerald-700 dark:text-emerald-300' : 'text-[var(--text-muted)]'">{{ repairDeltaLabel }}</span>
                <button
                    v-if="repairDraftChanged"
                    type="button"
                    class="repair-draft-status__reset"
                    :aria-label="t('repair.resetToOriginal')"
                    :title="t('repair.resetToOriginalTitle')"
                    @click="resetToOriginal"
                >
                    <span class="i-lucide-rotate-ccw h-3.5 w-3.5" />
                    <span>{{ t("repair.resetToOriginal") }}</span>
                </button>
            </div>
            <div v-if="issues.length > 0" class="inline-flex h-8 items-center overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] text-xs text-[var(--text-secondary)]">
                <button
                    type="button"
                    class="inline-flex h-full w-8 items-center justify-center hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    :aria-label="t('text.previousIssueTitle')"
                    :title="t('text.previousIssueTitle')"
                    @click="emit('navigate-issue', 'previous')"
                >
                    <span class="i-lucide-chevron-up h-3.5 w-3.5" />
                </button>
                <span class="min-w-11 border-x border-[var(--border-color)] px-2 text-center tabular-nums">{{ activeIssueLabel }}</span>
                <button
                    type="button"
                    class="inline-flex h-full w-8 items-center justify-center hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    :aria-label="t('text.nextIssueTitle')"
                    :title="t('text.nextIssueTitle')"
                    @click="emit('navigate-issue', 'next')"
                >
                    <span class="i-lucide-chevron-down h-3.5 w-3.5" />
                </button>
            </div>
            <label class="ml-auto inline-flex items-center gap-1.5 text-[var(--text-secondary)]" :title="t('text.highlightTitle')">
                <input :checked="settings.highlight" type="checkbox" @change="patch({highlight: ($event.target as HTMLInputElement).checked})" >
                {{ t("text.highlight") }}
            </label>
            <label class="inline-flex items-center gap-1.5 text-[var(--text-secondary)]" :title="t('text.maskTitle')">
                <input type="checkbox" :checked="!scanAll" @change="scanAll = !($event.target as HTMLInputElement).checked" >
                {{ t("text.mask") }}
            </label>
            <span class="text-xs text-[var(--text-muted)]">{{ t("text.wordCount", {count: text.length}) }}</span>
        </div>
        <!-- 光标处命中规则速览 -->
        <Transition name="slide-down">
            <div
                v-if="activeIssue"
                class="flex items-center gap-2 border-b border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 py-1.5 text-xs text-[var(--text-secondary)]"
            >
                <span
                    class="rounded px-1.5 py-0.5 font-semibold text-[10px] uppercase"
                    :class="{
                        'bg-red-500/15 text-red-600 dark:text-red-400': activeIssue.rule.level === 'high',
                        'bg-amber-500/15 text-amber-600 dark:text-amber-400': activeIssue.rule.level === 'medium',
                        'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400': activeIssue.rule.level === 'low',
                    }"
                >
                    {{ t(`common.${activeIssue.rule.level}`) }}
                </span>
                <span class="truncate font-medium text-[var(--text-main)]">
                    {{ activeIssue.rule.title }}
                </span>
                <span class="ml-auto font-mono text-[10px] text-[var(--text-muted)]">
                    {{ activeIssue.rule.id }}
                </span>
            </div>
        </Transition>
        <!-- 输入区（带行内高亮背板） -->
        <div class="min-h-0 flex-1">
            <ReviewEditor
                v-model="editorText"
                v-model:mode="editorMode"
                :ranges="shownRanges"
                :issue-marks="issueMarks"
                :comments="comments"
                :diffs="diffs"
                :repair-diffs="repairBaselineDiffs"
                :locate-offset="locateOffset"
                :active-issue-mark="activeIssueMark"
                :placeholder="t('text.placeholder')"
                @caret-click="(offset) => emit('caret-click', offset)"
                @add-comment="addComment"
                @update-comment="updateComment"
                @toggle-comment-resolved="toggleCommentResolved"
                @delete-comment="deleteComment"
                @clear-comments="clearComments"
                @clear-diff="clearDiff"
                @clear-diffs="clearDiffs"
                @accept-replacement="acceptReplacement"
                @replace-selection="replaceSelection"
            />
        </div>
    </div>
</template>

<style scoped>
.repair-draft-status {
    display: inline-flex;
    min-height: 2rem;
    max-width: min(100%, 34rem);
    align-items: center;
    gap: 0.5rem;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-subtle);
    padding: 0 0.5rem;
    color: var(--text-secondary);
    font-size: 0.75rem;
    white-space: nowrap;
}

.repair-draft-status__mode,
.repair-draft-status__reset {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
}

.repair-draft-status__mode {
    color: var(--text-main);
    font-weight: 600;
}

.repair-draft-status__reset {
    height: 1.5rem;
    border-radius: 5px;
    padding: 0 0.35rem;
    color: var(--accent-text);
}

.repair-draft-status__reset:hover {
    background: var(--bg-hover);
}

.slide-down-enter-active,
.slide-down-leave-active {
    transition: all 0.2s cubic-bezier(0.22, 1, 0.36, 1);
    max-height: 40px;
    opacity: 1;
}

.slide-down-enter-from,
.slide-down-leave-to {
    max-height: 0;
    opacity: 0;
    padding-top: 0;
    padding-bottom: 0;
    border-bottom-width: 0;
    overflow: hidden;
}
</style>
