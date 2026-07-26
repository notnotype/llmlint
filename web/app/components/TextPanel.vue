<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";
import type {AutoFixChange} from "llmlint/fix";
import type {HighlightRange, Issue} from "../types";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import {useNotification} from "../composables/useNotification";
import {useWebSettings} from "../composables/useWebSettings";
import {useRepairDraft} from "../composables/useRepairDraft";
import {useLlmlint} from "../composables/useLlmlint";
import {SAMPLE_TEXT} from "../utils/sample-text";
import {computeLlmHunks} from "../utils/llm-merge";
import type {HeatChunk} from "../utils/contribute-workspace";
import ReviewEditor from "./ReviewEditor.vue";
import {
    buildReviewIssueMarks,
    issueId,
    issueStartOffset,
    type ReviewAnnotation,
    type ReviewComment,
    type ReviewEditorMode,
    type ReviewIssueMark,
    type ReviewTextDiff,
} from "../utils/review-ranges";
import {annotationAnchorFromDraft, draftToSource, projectAnnotations, projectHeatChunks, type ProjectedHeatChunk, type RepairEditKind, type RepairPlan} from "../utils/repair-draft";
import {loadStoredReviewAnnotations, saveStoredReviewAnnotations} from "../utils/review-comment-storage";

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
    /** 嵌入采集改文流程时置真：隐藏 playground 专属的「示例 / 清空」按钮。 */
    embedded?: boolean;
    /** W7 F2：选区菜单「AI 改写选区」入口开关——宿主接了 llm-rewrite-selection 发起链才置真（playground 未接则隐藏）。 */
    llmRewrite?: boolean;
    /** R5：AI 改写审阅横幅打开时宿主强开编辑器 diff 层（透传 ReviewEditor.forceDiffs）。 */
    forceDiffs?: boolean;
    /** R6：检测器热力块（坐标锚 originalText = head.body）；null/缺省 = 无热力数据（编辑器不显示热力开关）。 */
    heat?: HeatChunk[] | null;
    /** Task 17 A3：源码选区菜单「保存标注」入口开关（contribute 接了 save-annotation 落库链才置真；playground 不接则隐藏）。 */
    annotate?: boolean;
    /** Agent 运行期间锁定所有用户正文修改入口。 */
    readonly?: boolean;
}>();
// 选区 AI 改写请求（W7 F2）：draft 坐标 + 选中文本 + 前后文窗，由 ReviewEditor 组装、本组件原样上抛。
type LlmSelectionRewriteRequest = {from: number; to: number; text: string; contextBefore: string; contextAfter: string};
// Task 17 A3 保存标注请求：draft 坐标选区 + 选中文本 + 标注正文；坐标映射（mapDraftSpanToSource）与落库在宿主侧做。
type SaveAnnotationRequest = {from: number; to: number; text: string; note: string};
const emit = defineEmits<{
    (e: "caret-click", offset: number): void;
    (e: "navigate-issue", direction: "previous" | "next"): void;
    (e: "rebase-original", value: string): void;
    (e: "replacement-applied", from: number): void;
    (e: "llm-rewrite-selection", request: LlmSelectionRewriteRequest): void;
    (e: "save-annotation", request: SaveAnnotationRequest): void;
}>();
const {settings, patch, setRuleOverride} = useWebSettings();
const {t} = useLlmlintI18n();
const notification = useNotification();
// 规则判别裁决（R2，构建期烘焙的静态数据）：ruleId → verdict，供 inline 规则菜单显示徽标；
// 构建缺 report.json 时 ruleVerdicts 缺省 → 空表，菜单全部显示「未测」。
const {baseRegistry} = useLlmlint();
const ruleVerdicts: Record<string, string> = Object.fromEntries(
    Object.entries(baseRegistry.ruleVerdicts ?? {}).map(([id, entry]) => [id, entry.verdict]),
);
// 批注（源锚定）：唯一持久态是 annotations（锚不可变原文坐标）；
// 草稿坐标 + stale 由 plan 投影现算（commentViews），文本怎么改都无需搬运。
const annotations = ref<ReviewAnnotation[]>([]);
const commentSequence = ref(0);

// 修复草稿（piece-table）：唯一 mutable 状态是 plan；draft / diffs 全部派生。
// source = 原文（originalText）；text（v-model）作为 draft 的镜像输出（下方 mirror watch 维护）。
const repair = useRepairDraft(props.originalText ?? text.value);
// 极少数情况下挂载时 text 已带草稿（非等于原文）：补一次 splice 让 draft 对齐 text。
if (props.originalText !== undefined && text.value !== props.originalText) {
    repair.setDraft(text.value, "user", "");
}

// 编辑器实例引用：AI 改写审阅横幅（宿主渲染）经本组件转调 ReviewEditor 的 diff 激活/滚动能力。
const reviewEditor = ref<InstanceType<typeof ReviewEditor> | null>(null);

type IssueNavigationShortcut = "previous" | "next";

// 行内高亮开关保存在浏览器设置里。关掉时传空区间给背板 → 纯文本编辑。
const shownRanges = computed<HighlightRange[]>(() => (settings.value.highlight ? props.ranges : []));
const editorText = computed<string>({
    get: () => text.value,
    set: (value) => updateText(value),
});
const issueMarks = computed<ReviewIssueMark[]>(() => buildReviewIssueMarks(text.value, props.issues, ruleVerdicts));
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
// Task 17 拍板①：预览视图禁用待删除——mode 恒为 "source"（settings.reviewEditorMode 忽略、不写回）。
// 恢复预览时把这里换回 settings 读写即可（web-settings 的键与 normalize 原样保留）。
const editorMode = computed<ReviewEditorMode>({
    get: (): ReviewEditorMode => "source",
    set: () => {
        // 预览禁用期间不写回偏好（UI 上切换入口已隐藏，此 setter 仅防御性 no-op）。
    },
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

// diff 全部从 plan 派生（原文 vs 草稿），取代原「命令式 diffs + 派生 repairBaselineDiffs」两套机制。
// RepairEditKind 的 user 归到 ReviewTextDiff 的 llm 桶（着色一致，非静态即非确定性替换）。
const diffs = computed<ReviewTextDiff[]>(() => repair.diffs.value.map((diff) => ({
    id: diff.id,
    from: diff.from,
    to: diff.to,
    deleted: diff.deleted,
    inserted: diff.inserted,
    source: diff.kind === "static" ? "static" : "llm",
    title: diff.title,
})));
const repairDraftChanged = computed(() => repair.changed.value);
const repairNetDelta = computed(() => repair.netDelta.value);
const repairDeltaLabel = computed(() => repairDraftChanged.value
    ? t("repair.changed", {delta: formatSignedCount(repairNetDelta.value)})
    : t("repair.unchanged"));

// 批注投影视图：源锚定批注 → 当前草稿坐标 + stale（原句已改）。传给编辑器渲染与 prompt 导出。
const commentViews = computed(() => projectAnnotations(repair.plan.value, annotations.value));

// R6：head 锚定的热力块经 piece-table 投影成当前草稿坐标传给编辑器
// （位置随编辑跟随；pAi 数值锚定 head 检测、编辑后渐陈旧属预期）。
const projectedHeat = computed<ProjectedHeatChunk[] | null>(() => {
    if (!props.heat || props.heat.length === 0) {
        return null;
    }
    return projectHeatChunks(repair.plan.value, props.heat);
});

/**
 * R2：消化编辑器 inline 规则菜单的「隐藏此规则」——写 ruleOverrides enabled:false
 * （本浏览器持久，重扫后该规则不再命中），并发带「撤销」动作的通知；
 * 撤销 = 恢复隐藏前的 override 原值（原本没有 override 就清除该键）。
 */
function hideRule(ruleId: string): void {
    const previous = settings.value.ruleOverrides[ruleId];
    const title = issueMarks.value.find((mark) => mark.ruleId === ruleId)?.title ?? ruleId;
    setRuleOverride(ruleId, {...(previous ?? {}), enabled: false});
    notification.info(t("review.ruleHiddenNotice", {title}), {
        label: t("common.undo"),
        run: () => setRuleOverride(ruleId, previous ?? null),
    });
}

function loadSample(): void {
    repair.resetSource(SAMPLE_TEXT);
    restoreAnnotationsForSource(SAMPLE_TEXT);
    emit("rebase-original", SAMPLE_TEXT);
}
function clearText(): void {
    repair.resetSource("");
    annotations.value = [];
    emit("rebase-original", "");
}

// 自由打字：整串回传折算成一次 user splice 并入 plan（mirror watch 会把 draft 推回 text）。
function updateText(value: string): void {
    if (props.readonly) return;
    repair.setDraft(value, "user", "");
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
        "[data-review-source-annotation-input='true']",
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

/** 换源 / 挂载时恢复该原文的 sidecar 批注（源锚定，草稿坐标随投影自动回位）。 */
function restoreAnnotationsForSource(source: string): void {
    annotations.value = loadStoredReviewAnnotations(source);
}

// 新建批注：编辑器给的是草稿选区坐标，这里反推最小原文锚点入库；此后坐标全靠投影。
function addComment(comment: Omit<ReviewComment, "id" | "source">): void {
    const anchor = annotationAnchorFromDraft(repair.plan.value, comment.from, comment.to);
    commentSequence.value += 1;
    annotations.value.push({
        id: `comment-${Date.now()}-${commentSequence.value}`,
        sourceFrom: anchor.sourceFrom,
        sourceTo: anchor.sourceTo,
        quote: comment.quote,
        body: comment.body,
        source: "user",
        resolved: false,
    });
}

function deleteComment(id: string): void {
    const index = annotations.value.findIndex((annotation) => annotation.id === id);
    const deleted = annotations.value[index];
    if (!deleted) {
        return;
    }
    annotations.value = annotations.value.filter((annotation) => annotation.id !== id);
    notification.info(t("notify.commentDeleted"), {
        label: t("common.undo"),
        run: () => {
            // 源锚定锚点不随后续编辑失效，原样放回即可。
            const next = [...annotations.value];
            next.splice(Math.min(index, next.length), 0, {...deleted});
            annotations.value = next;
        },
    });
}

function clearComments(): void {
    if (annotations.value.length === 0) {
        return;
    }
    const previousAnnotations = annotations.value.map((annotation) => ({...annotation}));
    annotations.value = [];
    notification.info(t("notify.commentsCleared", {count: previousAnnotations.length}), {
        label: t("common.undo"),
        run: () => {
            annotations.value = previousAnnotations.map((annotation) => ({...annotation}));
        },
    });
}

// 逐条清除某处差异：从 plan 移除对应 edit，该处回到原文。diff id 即 edit id。
function clearDiff(id: string): void {
    const beforePlan = repair.plan.value;
    repair.reject(id);
    if (repair.plan.value === beforePlan) {
        return;
    }
    notification.info(t("notify.diffCleared"), {
        label: t("common.undo"),
        run: () => restoreSnapshot(beforePlan),
    });
}

// 清除全部差异：草稿回到原文。
function clearDiffs(): void {
    const beforePlan = repair.plan.value;
    if (beforePlan.edits.length === 0) {
        return;
    }
    repair.clear();
    notification.info(t("notify.diffsCleared", {count: beforePlan.edits.length}), {
        label: t("common.undo"),
        run: () => restoreSnapshot(beforePlan),
    });
}

function updateComment(id: string, body: string): void {
    const previous = annotations.value.find((annotation) => annotation.id === id);
    if (!previous || previous.body === body) {
        return;
    }
    annotations.value = annotations.value.map((annotation) => annotation.id === id ? {...annotation, body} : annotation);
    notification.success(t("notify.commentUpdated"), {
        label: t("common.undo"),
        run: () => {
            if (!annotations.value.some((annotation) => annotation.id === id)) {
                notification.notify({message: t("notify.commentRestoreSkipped"), tone: "warning"});
                return;
            }
            annotations.value = annotations.value.map((annotation) => annotation.id === id ? {...annotation, body: previous.body} : annotation);
        },
    });
}

function toggleCommentResolved(id: string): void {
    annotations.value = annotations.value.map((annotation) => annotation.id === id ? {...annotation, resolved: !annotation.resolved} : annotation);
}

// 接受某命中的替换：mark.from/to 是 draft 坐标（issueMarks 建在草稿上），走 draft splice，携带 ruleId 溯源。
function acceptReplacement(mark: ReviewIssueMark): void {
    if (mark.replacement === null) {
        return;
    }
    const beforePlan = repair.plan.value;
    repair.spliceDraft(mark.from, mark.to, mark.replacement, "static", mark.title, mark.ruleId);
    if (repair.plan.value === beforePlan) {
        return;
    }
    emit("replacement-applied", mark.from);
    notification.success(t("notify.replacementDone"), {
        label: t("common.undo"),
        run: () => restoreSnapshot(beforePlan),
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

/**
 * 7a 批量接受多条命中的替换（规则组「应用全部」/ 多规则批量共用，Task 15 P1-C）：
 * 取调用时 issueMarks 快照，按 from **从后往前** splice（后方替换不影响前方坐标，
 * 先例：applyLlmRewrite / cleanMechanical），每条仍是独立 static 编辑（携带 ruleId
 * 溯源、可在 diff 里单独 reject）；整批单通知 + 单快照撤销（逐条通知会刷屏）。
 * 返回实际应用条数；不可自动替换、或与后方已应用替换重叠而坐标错位的命中跳过。
 */
function acceptIssueReplacements(issues: Issue[]): number {
    const wanted = new Set(issues.map((issue) => issueId(issue)));
    const marks = issueMarks.value
        .filter((mark) => wanted.has(mark.id) && mark.replacement !== null)
        .sort((left, right) => right.from - left.from);
    const beforePlan = repair.plan.value;
    let applied = 0;
    for (const mark of marks) {
        const replacement = mark.replacement;
        // 实文校验（同 cleanMechanical 口径）：与后方已应用替换重叠的命中会错位，跳过不硬替。
        if (replacement === null || repair.draft.value.slice(mark.from, mark.to) !== mark.match) {
            continue;
        }
        repair.spliceDraft(mark.from, mark.to, replacement, "static", mark.title, mark.ruleId);
        applied += 1;
    }
    if (applied === 0) {
        return 0;
    }
    notification.success(t("notify.batchReplacementDone", {count: applied}), {
        label: t("common.undo"),
        run: () => restoreSnapshot(beforePlan),
    });
    return applied;
}

// 选区替换 / 格式化：payload.from/to 是 draft 坐标。source 决定 provenance（static / llm）。
// notify 决定成功通知文案：clipboard（缺省）/ format / llmSelection（W7 F2 选区 AI 改写并入）。
function replaceSelection(payload: {from: number; to: number; replacement: string; title?: string; source?: "static" | "llm"; notify?: "clipboard" | "format" | "llmSelection"}): void {
    const from = Math.max(0, Math.min(text.value.length, payload.from));
    const to = Math.max(from, Math.min(text.value.length, payload.to));
    if (`${text.value.slice(0, from)}${payload.replacement}${text.value.slice(to)}` === text.value) {
        return;
    }
    const beforePlan = repair.plan.value;
    repair.spliceDraft(from, to, payload.replacement, payload.source ?? "llm", payload.title ?? t("review.clipboardDiffTitle"));
    notification.success(t(payload.notify === "format" ? "notify.selectionFormatted" : payload.notify === "llmSelection" ? "notify.selectionLlmRewritten" : "notify.selectionReplaced"), {
        label: t("common.undo"),
        run: () => restoreSnapshot(beforePlan),
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
    if (clipboardText === text.value) {
        return;
    }
    const beforePlan = repair.plan.value;
    const hadComments = annotations.value.length > 0;
    repair.spliceDraft(0, text.value.length, clipboardText, "llm", t("review.fullTextClipboardDiffTitle"));
    notification.success(t(hadComments ? "notify.fullTextReplacedWithComments" : "notify.fullTextReplaced"), {
        label: t("common.undo"),
        run: () => restoreSnapshot(beforePlan),
    });
}

// —— AI 整篇改写并入 + llm diff 审阅能力（Task 13 W7 F1，宿主审阅横幅消费）——

/** 供审阅横幅消费的一处 llm diff：id = plan 里的 edit id，from/to 为当前草稿坐标。 */
type LlmDiffView = {id: string; from: number; to: number; title: string};

// llm 来源编辑（AI 改写 hunk、剪贴板整篇替换等）的 diff 队列，按草稿位置升序。
// 注意基于 repair.diffs 的真实 kind 过滤——上面 diffs computed 已把 user 归入 llm 着色桶，不可复用。
const llmDiffQueue = computed<LlmDiffView[]>(() => repair.diffs.value
    .filter((diff) => diff.kind === "llm")
    .map((diff) => ({id: diff.id, from: diff.from, to: diff.to, title: diff.title}))
    .sort((left, right) => left.from - right.from || left.id.localeCompare(right.id)));

/**
 * 并入整篇 AI 改写结果：对（当前草稿 × rewritten）做 dmp diff 细化，逐 hunk **从后往前**
 * splice 成多条 llm 编辑（每处可单独巡检 / 拒绝；先例：cleanMechanical 的反向应用）。
 * 整批共用一个 plan 快照撤销通知。hunk 落在既有手改区被吸收为 llm 编辑是正确语义
 * （AI 确实改写了该处，内容来源如实变为 llm）。
 * 返回 hunk 数；0 = 与当前草稿无差异（未产生编辑与通知）。
 * 注意：横幅展示的「共 N 处」建议读 getLlmDiffs().length（吸收合并/改回原文可能让可见 diff 数 ≠ hunk 数）。
 */
function applyLlmRewrite(rewritten: string, title: string): number {
    const beforePlan = repair.plan.value;
    const hunks = computeLlmHunks(repair.draft.value, rewritten);
    if (hunks.length === 0) {
        return 0;
    }
    for (const hunk of [...hunks].reverse()) {
        repair.spliceDraft(hunk.from, hunk.to, hunk.replacement, "llm", title);
    }
    notification.success(t("notify.llmRewriteApplied", {count: hunks.length}), {
        label: t("common.undo"),
        run: () => restoreSnapshot(beforePlan),
    });
    return hunks.length;
}

/**
 * 实时应用 Agent durable workspace。与终态改写使用同一逐 hunk diff 语义，但不逐次通知；
 * readonly 只约束用户输入，程序化 workspace 同步始终允许。
 */
function applyAgentWorkspace(body: string, title: string): number {
    const hunks = computeLlmHunks(repair.draft.value, body);
    for (const hunk of [...hunks].reverse()) {
        repair.spliceDraft(hunk.from, hunk.to, hunk.replacement, "llm", title);
    }
    return hunks.length;
}

/** 当前 llm diff 列表（id + 草稿坐标 + 标题）。在宿主 computed 内调用即可响应式追踪。 */
function getLlmDiffs(): LlmDiffView[] {
    return llmDiffQueue.value.map((diff) => ({...diff}));
}

/** 当前激活 diff 的 id（任意来源，含 static；无激活为 null）。宿主可据此判定巡检位置。 */
function getActiveDiffId(): string | null {
    return reviewEditor.value?.activeDiffId ?? null;
}

/**
 * 跳到下 / 上一处 llm diff（激活 + 滚动定位，语义同 ReviewEditor 的 Ctrl+Alt+N/P 但只在
 * llm 队列内循环）。当前激活不是 llm diff 时：next 从第一处起、previous 从最后一处起。
 * 返回被激活的 diff id；无 llm diff 返回 null。
 */
function navigateLlmDiff(direction: "previous" | "next"): string | null {
    const queue = llmDiffQueue.value;
    if (queue.length === 0) {
        return null;
    }
    const activeId = reviewEditor.value?.activeDiffId ?? null;
    const currentIndex = activeId === null ? -1 : queue.findIndex((diff) => diff.id === activeId);
    const nextIndex = direction === "next"
        ? currentIndex >= 0 ? (currentIndex + 1) % queue.length : 0
        : currentIndex >= 0 ? (currentIndex - 1 + queue.length) % queue.length : queue.length - 1;
    const target = queue[nextIndex];
    if (!target) {
        return null;
    }
    void reviewEditor.value?.activateDiff(target.id);
    return target.id;
}

/**
 * 拒绝当前激活的 llm diff：该处回到原文（走既有 clearDiff，带撤销通知），随后自动激活
 * 相邻的下一处 llm diff（若有）。当前激活不存在或不是 llm diff 时不动作。
 * 返回被拒绝的 diff id；未动作返回 null。
 */
function rejectActiveLlmDiff(): string | null {
    const activeId = reviewEditor.value?.activeDiffId ?? null;
    const queue = llmDiffQueue.value;
    const index = activeId === null ? -1 : queue.findIndex((diff) => diff.id === activeId);
    if (activeId === null || index < 0) {
        return null;
    }
    const follower = queue[index + 1] ?? queue[index - 1] ?? null;
    clearDiff(activeId);
    if (follower) {
        void nextTick(() => {
            if (llmDiffQueue.value.some((diff) => diff.id === follower.id)) {
                void reviewEditor.value?.activateDiff(follower.id);
            }
        });
    }
    return activeId;
}

// 导出当前批注的草稿投影（含 stale），供 prompt 构建等按当前草稿坐标消费。
function getReviewComments(): ReviewComment[] {
    return commentViews.value.map((view) => ({...view}));
}

// —— 修复计划快照（W7 F1 快照校验的「应用（放弃期间修改）」分支）——
// RepairPlan 不可变（一切变更返回新计划），宿主持有引用即有效快照，可跨异步任务长期留存。

/** 当前修复计划快照：宿主发起整篇 AI 改写时留存，配合 restoreRepairPlan 做「回置发起时状态」。 */
function getRepairPlan(): RepairPlan {
    return repair.plan.value;
}

/** 回置修复计划到指定快照（封口打字 burst；批注源锚定不受影响）。与撤销走同一条 restoreSnapshot 路径。 */
function restoreRepairPlan(plan: RepairPlan): void {
    restoreSnapshot(plan);
}

/**
 * Task 17 A3：草稿选区坐标 → 原文（plan.source = head.body）坐标。
 * 采集红线：数据集标注必须锚定落库正文坐标，绝不能存草稿坐标。
 * 校验：映射回原文后 slice 与草稿选区文本逐字一致才算可靠；选区跨已编辑段（edit 段内
 * draftToSource 只能贴边近似）时不一致 → 返回 null，宿主提示改标未修改片段、不落库。
 */
function mapDraftSpanToSource(from: number, to: number): {start: number; end: number} | null {
    const plan = repair.plan.value;
    const start = draftToSource(plan, Math.min(from, to));
    const end = draftToSource(plan, Math.max(from, to));
    if (start >= end || plan.source.slice(start, end) !== repair.draft.value.slice(Math.min(from, to), Math.max(from, to))) {
        return null;
    }
    return {start, end};
}

// 当前草稿相对基线的全部编辑（Task 13 W2/W4：contribute 提交修订时既做 transitionKind 粗分，
// 又聚合成 provenanceJson 逐规则记录——static 编辑携带触发 ruleId）。plan 是唯一真相，无需影子记账。
function getRepairEdits(): Array<{kind: RepairEditKind; ruleId?: string}> {
    return repair.plan.value.edits.map((edit) => ({kind: edit.kind, ruleId: edit.ruleId}));
}

// 机械清理（auto 桶）：把每条 AutoFixChange 逐一并入 plan（W4：携带 ruleId 溯源、供 provenance
// 逐规则记录；逐条编辑也让每处清理可在 diff 里单独 reject）。change 坐标在「修复后文本」上，
// 先按顺序累计长度差反算回当前草稿坐标，再从后往前 splice——后面的替换不影响前面的坐标。
function cleanMechanical(): void {
    const count = props.autoFixCount ?? 0;
    const changes = props.autoFixChanges ?? [];
    if (!count) {
        return;
    }
    const beforePlan = repair.plan.value;
    let applied = 0;
    if (changes.length > 0) {
        // 反算：按修复后坐标升序走一遍，delta = 之前替换造成的累计长度差 → 当前草稿坐标。
        const sorted = [...changes].sort((left, right) => left.from - right.from);
        const draftChanges: Array<{from: number; to: number; inserted: string; deleted: string; ruleId: string; title: string}> = [];
        let delta = 0;
        for (const change of sorted) {
            const from = change.from - delta;
            draftChanges.push({from, to: from + change.deleted.length, inserted: change.inserted, deleted: change.deleted, ruleId: change.ruleId, title: change.title});
            delta += change.inserted.length - change.deleted.length;
        }
        // 顺序应用的 auto 规则可能互相影响（fix.ts 对重叠 change 有丢弃逻辑）→ 反算错位的条目
        // 与草稿实文比对后跳过，剩余命中可再点一次清理收敛；正常情况全部吻合。
        for (const change of draftChanges.reverse()) {
            if (repair.draft.value.slice(change.from, change.to) !== change.deleted) {
                continue;
            }
            repair.spliceDraft(change.from, change.to, change.inserted, "static", change.title, change.ruleId);
            applied += 1;
        }
    } else if (props.autoFixText !== undefined && props.autoFixText !== repair.draft.value) {
        // 兜底：调用方没传逐条 changes 时退回整体替换（单条 static 编辑，无逐规则溯源）。
        repair.spliceDraft(0, repair.draft.value.length, props.autoFixText, "static", t("text.cleanMechanical"));
        applied = count;
    }
    if (applied === 0) {
        return;
    }
    notification.success(t("notify.cleanDone", {count: applied}), {
        label: t("common.undo"),
        run: () => restoreSnapshot(beforePlan),
    });
}

// 重置为原文：清空全部编辑。批注锚定原文坐标，无需搬运，投影自动回到原文位置。
function resetToOriginal(): void {
    if (!props.originalText || props.originalText === text.value) {
        return;
    }
    const beforePlan = repair.plan.value;
    repair.clear();
    notification.success(t("notify.repairDraftReset"), {
        label: t("common.undo"),
        run: () => restoreSnapshot(beforePlan),
    });
}

// 撤销：恢复 plan 快照，并封口打字 burst（防 base 陈旧）。批注源锚定，不随 plan 回滚失效。
function restoreSnapshot(previousPlan: RepairPlan): void {
    repair.sealDraft();
    repair.plan.value = previousPlan;
}

onMounted(() => {
    restoreAnnotationsForSource(repair.plan.value.source);
    document.addEventListener("keydown", handleDocumentKeyDown);
});

onBeforeUnmount(() => {
    document.removeEventListener("keydown", handleDocumentKeyDown);
});

// 把派生草稿镜像回 v-model（这是唯一写 text 的地方）。
watch(() => repair.draft.value, (draft) => {
    if (text.value !== draft) {
        text.value = draft;
    }
}, {immediate: true});

// 原文（基线）从外部变更（换文档 / rebase）时，重挂 plan 的 source 并恢复该原文的批注。
watch(() => props.originalText, (next) => {
    if (next !== undefined && next !== repair.plan.value.source) {
        repair.resetSource(next);
        restoreAnnotationsForSource(next);
    }
});

// 批注持久化：按原文 key 存源锚定批注。换源时 source 与 annotations 同步变更，落盘幂等。
watch([() => repair.plan.value.source, annotations], ([source, nextAnnotations]) => {
    saveStoredReviewAnnotations(source, nextAnnotations);
}, {deep: true, flush: "post"});

defineExpose({
    acceptIssueReplacement,
    // 7a：按规则批量应用（坐标从后往前、单通知单撤销；与 acceptIssueReplacement 同一 mark 语义）。
    acceptIssueReplacements,
    getReviewComments,
    getRepairEdits,
    replaceTextFromClipboard,
    // W7 F2：宿主在选区 AI 改写返回后做快照校验，再经此把结果按坐标并入（source:"llm" 成可审阅 diff）。
    replaceSelection,
    // W7 F1：AI 整篇改写并入 + llm diff 审阅横幅所需的导航 / 拒绝 / 列表能力。
    applyLlmRewrite,
    applyAgentWorkspace,
    getLlmDiffs,
    getActiveDiffId,
    navigateLlmDiff,
    rejectActiveLlmDiff,
    // W7 F1：plan 快照获取 / 回置（整篇改写返回时草稿已变的「应用（放弃期间修改）」分支）。
    getRepairPlan,
    restoreRepairPlan,
    // Task 17 A3：草稿选区 → head.body 坐标映射（不可靠时 null），供宿主把编辑器标注锚回落库正文。
    mapDraftSpanToSource,
    // Task 17 需求 5：「静态修复」按钮（编辑工具行）直调机械清理——逐条 static splice、携带 ruleId 溯源、单撤销。
    cleanMechanical,
});
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <!-- 工具条（统一口径：h-7 控件 / text-xs / gap-2；Task 19）——
             toolbar-leading：宿主注入主操作（工作台的机械修复/一键修到底），状态留在宿主免搬迁 -->
        <div class="flex flex-wrap items-center gap-2 border-b border-[var(--border-color)] px-3 py-1.5 text-xs">
            <slot name="toolbar-leading" />
            <button v-if="!embedded" class="rounded bg-[var(--bg-subtle)] px-2 py-1 hover:bg-[var(--bg-hover)] disabled:opacity-60" :disabled="readonly" @click="loadSample">{{ t("text.sample") }}</button>
            <button v-if="!embedded" class="inline-flex items-center gap-1 rounded bg-[var(--bg-subtle)] px-2 py-1 hover:bg-[var(--bg-hover)] disabled:opacity-60" :disabled="readonly" @click="clearText">
                <span class="i-lucide-trash-2" /> {{ t("text.clear") }}
            </button>
            <!-- 旧「一键清理」（D-D strong 口径）：工作台（embedded）已由宿主注入的「机械修复」取代（口径更全），
                 只在 playground 独立模式保留，避免两个清理入口并存（Task 19 拍板） -->
            <button
                v-if="autoFixCount && !embedded"
                class="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-1 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
                :title="t('text.cleanMechanicalTitle')"
                :disabled="readonly"
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
                    v-if="repairDraftChanged && !readonly"
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
            <div v-if="issues.length > 0" class="inline-flex h-7 items-center overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] text-xs text-[var(--text-secondary)]">
                <button
                    type="button"
                    class="inline-flex h-full w-7 items-center justify-center hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    :aria-label="t('text.previousIssueTitle')"
                    :title="t('text.previousIssueTitle')"
                    @click="emit('navigate-issue', 'previous')"
                >
                    <span class="i-lucide-chevron-up h-3.5 w-3.5" />
                </button>
                <span class="min-w-11 border-x border-[var(--border-color)] px-2 text-center tabular-nums">{{ activeIssueLabel }}</span>
                <button
                    type="button"
                    class="inline-flex h-full w-7 items-center justify-center hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
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
        <!-- 输入区（带行内高亮背板）；失焦封口当前打字 burst -->
        <div class="min-h-0 flex-1" @focusout="repair.sealDraft()">
            <ReviewEditor
                ref="reviewEditor"
                v-model="editorText"
                v-model:mode="editorMode"
                :ranges="shownRanges"
                :issue-marks="issueMarks"
                :comments="commentViews"
                :diffs="diffs"
                :locate-offset="locateOffset"
                :active-issue-mark="activeIssueMark"
                :placeholder="t('text.placeholder')"
                :llm-rewrite-enabled="llmRewrite"
                :force-diffs="forceDiffs"
                :heat="projectedHeat"
                :annotate-enabled="annotate"
                :readonly="readonly"
                @caret-click="(offset) => emit('caret-click', offset)"
                @add-comment="addComment"
                @update-comment="updateComment"
                @toggle-comment-resolved="toggleCommentResolved"
                @delete-comment="deleteComment"
                @clear-comments="clearComments"
                @clear-diff="clearDiff"
                @clear-diffs="clearDiffs"
                @accept-replacement="acceptReplacement"
                @hide-rule="hideRule"
                @replace-selection="replaceSelection"
                @llm-rewrite-selection="(request) => emit('llm-rewrite-selection', request)"
                @save-annotation="(request) => emit('save-annotation', request)"
            />
        </div>
    </div>
</template>

<style scoped>
.repair-draft-status {
    display: inline-flex;
    min-height: 1.75rem; /* h-7 口径（Task 19 工具行统一） */
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
