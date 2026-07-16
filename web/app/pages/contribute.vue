<script setup lang="ts">
import {computed, nextTick, reactive, ref} from "vue";
import {useWindowSize} from "@vueuse/core";
// 分栏可拖拽（Task 19 D，照 playground 先例）：右栏宽度记忆到 settings.contributeReportWidth。
import {clampResizablePanelSize, useResizablePanel} from "../composables/useResizablePanel";
// taxonomy 单源（alias `evals`→../evals/lib）：上传自报三项的题材/体裁白名单，与服务端 DTO 同一份。
import {GENRES, TEXT_TYPES} from "evals/taxonomy";
// provenanceJson 逐 hunk 规范（W4）：与服务端 llm_fix 写入共用同一份类型。
import {aggregateProvenanceEdits, type RevisionProvenance} from "#shared/revision-provenance";
// transitionKind 分类（W7 纯函数：user > llm > static）。
import {classifyTransitionKind} from "../utils/repair-draft";
import {useLlmlint} from "../composables/useLlmlint";
import {useNotification} from "../composables/useNotification";
import {useWebSettings} from "../composables/useWebSettings";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
// Harness 风格持久化 Agent Chat：snapshot 恢复 + SSE 增量 + diff 审阅出口。
import {useAgentChat, type AgentSelection} from "../composables/useAgentChat";
import {resolveApiErrorMessage} from "../utils/api-error";
// 外部 LLM 优化指令构造（F3 降级路）：与 playground SummaryBar 共用同一份单源 util。
import {buildLlmOptimizationPrompt} from "../utils/llm-optimization-prompt";
// 工作台共享类型与派生纯函数（Task 15 P0-A/P1-C + Task 16 R8）：版本条目 / D5 各腿 / reveal DTO / 历史恢复 hydrate / 热力块 / 白话汇总。
import {computeD5Legs, hydrateWorkspace, sleep, summarizeScanHits, type BlindScores, type HeatChunk, type PostJudgment, type RevealResponse, type ScanHitsMeta, type WorkspacePayload, type WorkspaceRevision} from "../utils/contribute-workspace";
// 7a 批量应用与单条「应用」按钮同一口径的可自动替换判定。
import {isIssueAutoApplicable, isIssueReplacementApplicable} from "../utils/review-issue-ui";
import type {Issue, RegexRuleRecord, RuleGroup, UiFilters} from "../types";
import FormSelect, {type SelectOption} from "../components/common/FormSelect.vue";
import SwitchField from "../components/common/SwitchField.vue";
import Dialog from "../components/common/Dialog.vue";
import TextPanel from "../components/TextPanel.vue";
import LlmReviewBar from "../components/LlmReviewBar.vue";
import AiFixPanel from "../components/AiFixPanel.vue";
import AnnotatableRevisionText from "../components/AnnotatableRevisionText.vue";
import FlowStepper from "../components/FlowStepper.vue";
import StepGuideBar from "../components/StepGuideBar.vue";
import VersionBar from "../components/VersionBar.vue";
import ReportPanel from "../components/ReportPanel.vue";
import ContributeHistoryPanel from "../components/ContributeHistoryPanel.vue";
import ContributionSummary, {type SummaryVerdict} from "../components/ContributionSummary.vue";
import type {LineageEntry} from "../components/LineageStrip.vue";

type Provenance = "human" | "ai" | "mixed" | "unknown";
type Visibility = "private" | "public";
// 工作台状态机（Task 15 P0-A）：draft(上传) → workspace(版本化工作台) → done(总结卡)。
// 旧五步的 report/edit/verdict 三屏合并进 workspace；采集点全部保留（见「采集点落位表」）。
type SubmitStep = "draft" | "workspace" | "done";
// workspace 右侧 tab：report=检测报告（默认）；issues=命中列表；aiFix=AI 改写（Task 16 R7 自编辑工具行迁入）。
type RightTab = "report" | "issues" | "aiFix";

const {registry, baseRegistry, scan, applyFilters, summarize, groupByRule, issueRanges, offsetOf, issueAtOffset, autoFix, namespaceOptions} = useLlmlint();
const {settings, patch, setRuleOverride} = useWebSettings();
const {t} = useLlmlintI18n();
const notification = useNotification();

// ═══════════════ 步一：上传表单（自报三项全可选；盲评移入工作台报告 tab） ═══════════════

const provenanceOptions = computed<SelectOption[]>(() => [
    {value: "unknown", label: t("contribute.unknown")},
    {value: "human", label: t("contribute.humanWriting")},
    {value: "ai", label: t("contribute.aiGenerated")},
    {value: "mixed", label: t("contribute.mixedWriting")},
]);
const visibilityOptions = computed<SelectOption[]>(() => [
    {value: "private", label: t("contribute.privateExport")},
    {value: "public", label: t("contribute.publicReview")},
]);
// 自报三项（全可选，默认空 = 不上报）：值集来自 taxonomy 单源，label 即领域中文标签。
const genreOptions = computed<SelectOption[]>(() => [
    {value: "", label: t("contribute.notProvided")},
    ...GENRES.map((entry) => ({value: entry.key, label: entry.label})),
]);
const textTypeOptions = computed<SelectOption[]>(() => [
    {value: "", label: t("contribute.notProvided")},
    ...TEXT_TYPES.map((entry) => ({value: entry.key, label: entry.label})),
]);

const text = ref("");
const declaredProvenance = ref<Provenance>("unknown");
const visibility = ref<Visibility>("private");
const genre = ref("");
const textType = ref("");
const sourceNote = ref("");
// W9-D 用户拍板：内网私有部署默认信任，授权开关默认勾选（仍可手动关闭，DTO 校验不变）。
const consent = ref(true);
const loading = ref(false);

// ═══════════════ 工作台核心状态：版本数组 + 查看指针 + 揭示闸门 ═══════════════

const step = ref<SubmitStep>("draft");
const textId = ref("");
// 版本数组（版本条 / 只读正文 / 报告 tab 的统一数据源）：rev0 起，每次「再次检测」push 新条目。
const revisions = ref<WorkspaceRevision[]>([]);
// D2 揭示闸门的 UI 同步：false = rev0 未揭示，报告 tab 只渲染盲评卡、编辑器与命中 tab 不出现。
// （服务端 revealedAt 闸门本就强制，这里保证 UI 不偷跑。）
const revealed = ref(false);
// 当前查看版本（版本条 activeOrdinal）：= head → 编辑器视图；< head → 只读正文 + 该版报告。
const activeOrdinal = ref(0);
const rightTab = ref<RightTab>("report");
// 盲评两轴快照（rev0，blind=true）；null = 用户跳过打分，本篇无盲评基线（D5 人评腿不可判）。
const submittedScores = ref<BlindScores | null>(null);
// G6 标注条数轻量计数：AnnotatableRevisionText 的 annotated 事件 +1，重置归零。
const annotationCount = ref(0);
// 盲评/复评 POST 进行中（ReportPanel 按钮 loading）。
const submitting = ref(false);
// 「再次检测」（保存新版本 + 重新检测）进行中。
const committing = ref(false);

// 派生：head=最新版（编辑基底与提交 parent）、rev0=对比与 D5 恒定基线、active=当前查看版本。
const head = computed(() => revisions.value[revisions.value.length - 1] ?? null);
const rev0 = computed(() => revisions.value[0] ?? null);
const headOrdinal = computed(() => head.value?.ordinal ?? 0);
const headBody = computed(() => head.value?.body ?? "");
const active = computed(() => revisions.value.find((entry) => entry.ordinal === activeOrdinal.value) ?? null);
const isHeadView = computed(() => activeOrdinal.value === headOrdinal.value);
// head 只读标注模式已取消（Task 17 A3）：标注融合进编辑器——源码选区菜单「保存标注」，
// 坐标经 TextPanel.mapDraftSpanToSource 锚回 head.body 落库；旧版只读视图（AnnotatableRevisionText）保留。
// 编辑器只在「已揭示 + 查看 head」时可见（拍板②：编辑恒基于最新版；揭示前不进入编辑）。
const editorVisible = computed(() => revealed.value && isHeadView.value);
// 未提交草稿改动（版本条指示 +「再次检测」可用条件）。
const draftDirty = computed(() => revealed.value && editDraft.value !== headBody.value);
// 版本条数据源（LineageStrip 条目形状）。
const lineage = computed<LineageEntry[]>(() => revisions.value.map((entry) => ({ordinal: entry.ordinal, transitionKind: entry.transitionKind})));
// 引导条语境：draft=上传屏；blind=工作台未揭示（盲评）；workspace=head 编辑；viewing=只读正文（查看旧版）。
const guideScreen = computed<"draft" | "blind" | "workspace" | "viewing">(() => {
    if (step.value === "draft") {
        return "draft";
    }
    if (!revealed.value) {
        return "blind";
    }
    return editorVisible.value ? "workspace" : "viewing";
});

// ═══════════════ 过滤器（命中 tab 共用，随 settings 持久化） ═══════════════

const filters = reactive<UiFilters>({
    review: settings.value.review,
    minLevel: settings.value.minLevel,
    namespaces: [...settings.value.namespaces],
    scanAll: true,
});
const nsOptions = namespaceOptions();
const activeRule = ref<RegexRuleRecord | null>(null);

/** 更新过滤状态，并同步到本地设置中。 */
function updateFilters(next: UiFilters): void {
    Object.assign(filters, next);
    patch({
        review: next.review,
        minLevel: next.minLevel,
        namespaces: [...next.namespaces],
        scanAll: next.scanAll,
    });
}

// ═══════════════ head 编辑视图：TextPanel 草稿 + 本地扫描（展示层） ═══════════════

const editDraft = ref("");
const editScanAll = ref(true);
const editTextPanel = ref<InstanceType<typeof TextPanel> | null>(null);
const editActiveRuleId = ref<string | null>(null);
const editLocateOffset = ref<number | null>(null);
const creativeRuleIds = new Set(baseRegistry.creativeProfile.includedRuleIds);
const autoRuleIds = new Set(baseRegistry.regexRules.filter((rule) => rule.fixability === "auto").map((rule) => rule.id));
/** 创作工作台默认只展示 task profile 候选；安全机械规则不受 verdict 限制，始终可见。 */
function creativeIssues(issues: Issue[]): Issue[] {
    return issues.filter((issue) => creativeRuleIds.has(issue.rule.id) || autoRuleIds.has(issue.rule.id));
}
const editAllIssues = computed(() => editDraft.value.trim() ? scan(editDraft.value, editScanAll.value) : []);
const editIssues = computed(() => creativeIssues(editAllIssues.value));
const editFilteredIssues = computed(() => applyFilters(editIssues.value, filters));
const editGroups = computed<RuleGroup[]>(() => groupByRule(editFilteredIssues.value));
const editRanges = computed(() => issueRanges(editDraft.value, editFilteredIssues.value));
// 外部 LLM 优化指令的命中汇总（F3）：与命中 tab 同一份过滤视图。
const editSummary = computed(() => summarize(editFilteredIssues.value));
// 一键机械清理只走 fixability:auto；candidate 必须由用户显式确认，不受 report verdict 影响。
const editAutoFix = computed(() => autoFix(editDraft.value, editScanAll.value));
// 命中 tab（head 视图）头部行：草稿实时命中 vs rev0 基线（服务器扫描数，落库真相）。
const rev0Hits = computed(() => rev0.value?.scan?.hits.length ?? 0);
const editHits = computed(() => editAllIssues.value.length);
const hitsDown = computed(() => editHits.value < rev0Hits.value);

// 命中 tab（head 视图）→ 编辑器：定位 / 接受替换（走 TextPanel 的 piece-table）。
function onEditApplyIssue(issue: Issue): void {
    editTextPanel.value?.acceptIssueReplacement(issue);
}
/** 命中 tab（head 视图）→ 编辑器：定位闪烁。 */
function onEditLocate(issue: Issue): void {
    editActiveRuleId.value = issue.rule.id;
    editLocateOffset.value = offsetOf(editDraft.value, issue);
}

/**
 * Task 17 A3 编辑器内保存标注（取代独立「只读标注」模式）：
 * 选区来自编辑器草稿坐标 → mapDraftSpanToSource 映射回 head.body 坐标（采集红线：
 * 标注必须挂 head.revisionId、坐标锚落库正文，绝不能存草稿坐标）→ POST /api/annotations。
 * 选区跨已编辑段（映射不可靠）时提示改标未修改片段，不落库。
 */
async function saveEditorAnnotation(request: {from: number; to: number; text: string; note: string}): Promise<void> {
    const target = head.value;
    const panel = editTextPanel.value;
    if (!target || !panel) {
        return;
    }
    const mapped = panel.mapDraftSpanToSource(request.from, request.to);
    if (!mapped) {
        notification.info(t("contribute.annotationSpanEdited"));
        return;
    }
    try {
        await $fetch("/api/annotations", {
            method: "POST",
            body: {revisionId: target.revisionId, span: {start: mapped.start, end: mapped.end}, note: request.note},
        });
        annotationCount.value += 1;
        notification.success(t("contribute.annotationSaved"));
    } catch (caught) {
        notification.error(resolveApiErrorMessage(caught, "Save annotation failed"));
    }
}

// ═══════════════ 只读版本视图（查看旧版 / 揭示前的 rev0）：本地扫描高亮 + span 标注 ═══════════════

const viewBody = computed(() => active.value?.body ?? "");
// 揭示前不渲染任何机器结果（D2）：ranges 为空、命中 tab 不可用；本地扫描只在揭示后作展示层。
const viewAllIssues = computed(() => revealed.value && viewBody.value.trim() ? scan(viewBody.value, true) : []);
const viewIssues = computed(() => creativeIssues(viewAllIssues.value));
const viewFilteredIssues = computed(() => applyFilters(viewIssues.value, filters));
const viewGroups = computed<RuleGroup[]>(() => groupByRule(viewFilteredIssues.value));
const viewRanges = computed(() => issueRanges(viewBody.value, viewFilteredIssues.value));
const viewActiveRuleId = ref<string | null>(null);
const viewLocateOffset = ref<number | null>(null);

/** 只读正文点击：按偏移找覆盖命中，联动命中 tab 卡片激活态。 */
function onViewOffsetClick(offset: number): void {
    const issue = issueAtOffset(viewBody.value, viewFilteredIssues.value, offset);
    viewActiveRuleId.value = issue?.rule.id ?? null;
}
/** 命中 tab（只读视图）→ 正文定位闪烁。 */
function onViewLocate(issue: Issue): void {
    viewActiveRuleId.value = issue.rule.id;
    viewLocateOffset.value = offsetOf(viewBody.value, issue);
}

// ═══════════════ 热力图层（Task 15 P1-C，拍板：挂版本不挂草稿） ═══════════════

// 当前查看版本是否有热力数据（决定开关按钮是否出现）：取第一行检测结果的 chunks
// （checkedAt 升序首行；当前仅一个外部检测器在跑，多检测器并存时以首行为图层源）。
const viewHeatChunks = computed(() => active.value?.detects[0]?.chunks ?? []);
// 传给只读正文的热力块（开关记忆在 settings.heatmap）；未揭示恒 null（D2，detects 本就为空）。
const viewHeat = computed<HeatChunk[] | null>(() => {
    if (!revealed.value || !settings.value.heatmap || viewHeatChunks.value.length === 0) {
        return null;
    }
    return viewHeatChunks.value.map((chunk) => ({start: chunk.span.start, end: chunk.span.end, pAi: chunk.pAi}));
});

/** 热力图开关（记忆到浏览器设置；报告 tab 缩略条不受它控制）。 */
function toggleHeatmap(): void {
    patch({heatmap: !settings.value.heatmap});
}

// ═══════════════ Task 16：编辑器热力源（R6）/ verdict 映射（R4）/ 规则隐藏（R1）/ 白话汇总（R8） ═══════════════

// R6 编辑器热力数据源：head 版检测分块（块坐标锚 head.body = piece-table 的 plan.source）。
// 草稿坐标投影由 TextPanel 内 projectHeatChunks 做；开关（settings.editorHeatmap）在编辑器工具栏。
const editorHeat = computed<HeatChunk[] | null>(() => {
    const chunks = head.value?.detects[0]?.chunks ?? [];
    if (!revealed.value || chunks.length === 0) {
        return null;
    }
    return chunks.map((chunk) => ({start: chunk.span.start, end: chunk.span.end, pAi: chunk.pAi}));
});

// R4 命中卡 verdict 徽标映射（ruleId → verdict）；报告缺失时 undefined = 卡片降级不显示（D-D 口径）。
const issueVerdicts = computed<Record<string, string> | undefined>(() => {
    const verdicts = baseRegistry.ruleVerdicts;
    if (verdicts === undefined) {
        return undefined;
    }
    return Object.fromEntries(Object.entries(verdicts).map(([ruleId, entry]) => [ruleId, entry.verdict]));
});

/**
 * R1 隐藏规则（命中卡按钮上抛；编辑器 inline 菜单的隐藏由 TextPanel 消化，同一 settings 语义）：
 * enabled:false 使 materializeRules 把规则从扫描集合整体剔除——高亮/校对符号/命中列表自动消失；
 * 撤销 = 清除 enabled 覆盖（保留 level/review/fixability 等其余覆盖），空则整条删除。
 */
function hideRule(ruleId: string): void {
    const existing = settings.value.ruleOverrides[ruleId];
    setRuleOverride(ruleId, {...existing, enabled: false});
    // 激活规则被隐藏后组会消失，联动指针归零（selectedBatchGroups 是 computed filter，自然退出无需清）。
    if (editActiveRuleId.value === ruleId) {
        editActiveRuleId.value = null;
    }
    if (viewActiveRuleId.value === ruleId) {
        viewActiveRuleId.value = null;
    }
    notification.success(t("notify.ruleHidden"), {
        label: t("common.undo"),
        run: () => {
            const rest = {...settings.value.ruleOverrides[ruleId]};
            delete rest.enabled;
            setRuleOverride(ruleId, Object.keys(rest).length > 0 ? rest : null);
        },
    });
}

// R8 白话汇总的规则元数据：strong join 用烘焙 verdicts；autoFixable 只统计真正无需判断的 auto；
// 隐藏判据 = ∈默认生效集合（baseRegistry.regexRules）且 ∉用户生效集合（materialized registry）。
const scanMeta = computed<ScanHitsMeta>(() => ({
    verdicts: baseRegistry.ruleVerdicts,
    autoRuleIds: new Set(baseRegistry.regexRules.filter((rule) => rule.fixability === "auto" && rule.action.type === "replace").map((rule) => rule.id)),
    activeRuleIds: new Set(registry.value.regexRules.map((rule) => rule.id)),
    catalogRuleIds: new Set(baseRegistry.regexRules.map((rule) => rule.id)),
}));
// 当前查看版本的汇总统计（scan 未到 = null，汇总卡不渲染）。
const activeScanSummary = computed(() => (active.value?.scan ? summarizeScanHits(active.value.scan.hits, scanMeta.value) : null));

// ═══════════════ 外部检测器轮询（异步落库，逐版本）═══════════════

// detect 在服务端响应后异步跑（HF 分块×节流 30–120s）；4s × 30 ≈ 120s 对齐服务端整次 detect 总超时。
const DETECT_POLL_INTERVAL_MS = 4000;
const DETECT_POLL_MAX = 30;
// 全局代数：resetFlow 推进一次即令全部在途轮询过期（每个版本只轮询一次，无需逐版本代数）。
let detectEpoch = 0;

/** 轮询某版本的机器结果直到 detects 非空或超限（fire-and-forget，用 void 调用）。 */
async function pollDetects(revisionId: string): Promise<void> {
    const epoch = detectEpoch;
    const entry = revisions.value.find((item) => item.revisionId === revisionId);
    if (!entry) {
        return;
    }
    // 外部检测器缺数据才亮「轮询中」；只缺 llmReview 时不动 detectState（检测器行已是完成态）。
    if (entry.detects.length === 0) {
        entry.detectState = "polling";
    }
    for (let attempt = 0; attempt < DETECT_POLL_MAX; attempt += 1) {
        await sleep(DETECT_POLL_INTERVAL_MS);
        if (epoch !== detectEpoch) {
            return;
        }
        try {
            const machine = await $fetch<RevealResponse>(`/api/revisions/${revisionId}/machine`);
            if (epoch !== detectEpoch) {
                return;
            }
            // LLM 规则评审与 detect 同为异步落库：轮询顺带补拉；detect 先到时不提前退出，
            // 继续等 llmReview（约 2 分钟）直到两路都到或上限（Task 17 工单 C 申报的轮询缺口修复）。
            entry.llmReview = machine.llmReview;
            entry.analysis = machine.analysis;
            if (machine.detects.length > 0) {
                entry.detects = machine.detects;
                entry.detectState = "idle";
            }
            const detectorSettled = ["completed", "failed", "cancelled", "interrupted", "unavailable"].includes(machine.analysis.detector.status);
            const llmSettled = ["completed", "failed", "cancelled", "interrupted", "unavailable"].includes(machine.analysis.llm.status);
            if (detectorSettled && llmSettled) {
                return;
            }
        } catch {
            // 网络抖动等瞬时失败：按一次未命中计，继续下一轮（上限兜底）
        }
    }
    // 超限只把「外部检测器」置为暂不可用；llmReview 缺失不改 detectState
    // （LLM 评审卡有自己的等待/未接入展示态，且通道未配置时本就永远无行）。
    if (epoch === detectEpoch && entry.detects.length === 0) {
        entry.detectState = "exhausted";
    }
}

/** 单次刷新某版本机器投影，供取消/重试动作立即更新卡片。 */
async function refreshMachine(revisionId: string): Promise<void> {
    const entry = revisions.value.find((item) => item.revisionId === revisionId);
    if (!entry) return;
    const machine = await $fetch<RevealResponse>(`/api/revisions/${revisionId}/machine`);
    entry.scan = machine.scan;
    entry.detects = machine.detects;
    entry.llmReview = machine.llmReview;
    entry.analysis = machine.analysis;
    entry.detectState = machine.analysis.detector.status === "running" ? "polling" : "idle";
}

async function retryDetector(): Promise<void> {
    const target = active.value;
    if (!target) return;
    try {
        await $fetch(`/api/revisions/${target.revisionId}/detector-runs`, {method: "POST"});
        await refreshMachine(target.revisionId);
        void pollDetects(target.revisionId);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "外部检测重试失败"));
    }
}

async function cancelDetector(): Promise<void> {
    const target = active.value;
    const runId = target?.analysis?.detector.runId;
    if (!target || !runId) return;
    try {
        await $fetch(`/api/detector-runs/${runId}`, {method: "DELETE"});
        await refreshMachine(target.revisionId);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "取消外部检测失败"));
    }
}

async function retryLlmAnalysis(): Promise<void> {
    const target = active.value;
    const sessionId = target?.analysis?.llm.sessionId;
    if (!target || !sessionId) return;
    try {
        if (target.analysis?.llm.status === "completed") {
            await $fetch(`/api/agent/sessions/${sessionId}/invoke`, {method: "POST", body: {mode: "prompt", phase: "analysis", body: target.body}});
        } else {
            await $fetch(`/api/agent/sessions/${sessionId}/retry`, {method: "POST"});
        }
        await refreshMachine(target.revisionId);
        void pollDetects(target.revisionId);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "LLM Agent 重试失败"));
    }
}

async function cancelLlmAnalysis(): Promise<void> {
    const target = active.value;
    const sessionId = target?.analysis?.llm.sessionId;
    if (!target || !sessionId) return;
    try {
        await $fetch(`/api/agent/sessions/${sessionId}/abort`, {method: "POST"});
        await refreshMachine(target.revisionId);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "取消 LLM Agent 失败"));
    }
}

// ═══════════════ 上传 → 进工作台（盲评卡）→ 揭示 ═══════════════

/**
 * 上传正文（服务器建 Text + rev0 并同步扫描、先算后藏）→ 进工作台。
 * 响应不带任何机器结果（D2）；盲评/跳过在工作台报告 tab 的盲评卡上做，之后才 reveal。
 */
async function submitDraft(): Promise<void> {
    if (!consent.value) {
        notification.error(t("contribute.consentRequired"));
        return;
    }
    loading.value = true;
    try {
        const created = await $fetch<{textId: string; revisionId: string; charCount: number}>("/api/texts", {
            method: "POST",
            body: {
                text: text.value,
                declaredProvenance: declaredProvenance.value,
                genre: genre.value || undefined,
                textType: textType.value || undefined,
                sourceNote: sourceNote.value.trim() || undefined,
                visibility: visibility.value,
                consent: consent.value,
            },
        });
        textId.value = created.textId;
        revisions.value = [{revisionId: created.revisionId, ordinal: 0, transitionKind: "upload", body: text.value, scan: null, detects: [], llmReview: null, analysis: null, detectState: "idle", judgment: null}];
        revealed.value = false;
        activeOrdinal.value = 0;
        rightTab.value = "report";
        submittedScores.value = null;
        // 编辑草稿基底预置为 rev0 正文（编辑器在揭示后出现）。
        editDraft.value = text.value;
        step.value = "workspace";
    } catch (caught) {
        notification.error(resolveApiErrorMessage(caught, "Submission failed"));
    } finally {
        loading.value = false;
    }
}

/** 显式揭示 rev0：取回服务器扫描/检测（reveal 幂等），打开工作台全部能力。 */
async function revealRev0(): Promise<void> {
    const target = rev0.value;
    if (!target) {
        return;
    }
    const response = await $fetch<RevealResponse>(`/api/revisions/${target.revisionId}/reveal`, {method: "POST"});
    target.scan = response.scan;
    target.detects = response.detects;
    target.llmReview = response.llmReview;
    target.analysis = response.analysis;
    revealed.value = true;
    // W3：外部检测/LLM 评审均异步落库，reveal 时多半未到 → 轮询 machine 端点补拉（超限=暂不可用）。
    if (response.detects.length === 0 || response.llmReview === null) {
        void pollDetects(target.revisionId);
    }
}

/** 盲评卡「提交盲评」：先 POST 盲评两轴（blind=true，先于揭示，D2 采集点）→ 再 reveal。 */
async function onBlindSubmit(scores: BlindScores): Promise<void> {
    const target = rev0.value;
    if (!target || submitting.value) {
        return;
    }
    submitting.value = true;
    try {
        await $fetch("/api/judgments", {
            method: "POST",
            body: {revisionId: target.revisionId, aiFlavor: scores.aiFlavor, wantReadOn: scores.wantReadOn},
        });
        submittedScores.value = scores;
        await revealRev0();
        notification.success(t("contribute.blindReviewSaved"));
    } catch (caught) {
        notification.error(resolveApiErrorMessage(caught, "Submission failed"));
    } finally {
        submitting.value = false;
    }
}

/** 盲评卡「跳过打分」：不 POST judgment 直接 reveal（本篇无盲评基线，D5 人评腿不可判）。 */
async function onBlindSkip(): Promise<void> {
    if (submitting.value) {
        return;
    }
    submitting.value = true;
    try {
        submittedScores.value = null;
        await revealRev0();
        notification.success(t("contribute.uploadRevealed"));
    } catch (caught) {
        notification.error(resolveApiErrorMessage(caught, "Submission failed"));
    } finally {
        submitting.value = false;
    }
}

// ═══════════════ 版本切换 + 再次检测（原 commitRevision 重命名迁位） ═══════════════

/**
 * 版本条点击切换查看版本：旧版 → 左侧只读正文 + 右侧该版报告；head → 回编辑器。
 * 离开 head 时若有未提交草稿：编辑器组件 v-show 保活（最小方案），草稿与 diff/批注现场不丢——
 * 提示一句让用户知道改动还在（拍板②：不丢弃）。
 */
function selectVersion(ordinal: number): void {
    if (!revealed.value || ordinal === activeOrdinal.value) {
        return;
    }
    if (editorVisible.value && draftDirty.value) {
        notification.info(t("contribute.draftKeptNotice", {ordinal: headOrdinal.value}));
    }
    activeOrdinal.value = ordinal;
}

/**
 * W4 provenanceJson 逐 hunk 规范：把编辑面 plan 聚合成 {version:1, edits:[...]}。
 * 拿不到编辑面状态时不编造，返回 undefined 不上报。
 */
function buildProvenanceJson(): string | undefined {
    const edits = editTextPanel.value?.getRepairEdits() ?? null;
    if (edits === null || edits.length === 0) {
        return undefined;
    }
    const provenance: RevisionProvenance = {version: 1, edits: aggregateProvenanceEdits(edits)};
    return JSON.stringify(provenance);
}

/**
 * 「再次检测」（版本条主按钮）= 原「提交改后版本」的重命名迁位：
 * 保存草稿为新 revision（parent=head，服务器同步扫描先算后藏）→ reveal 取回该版扫描 →
 * 版本条追加、查看指针移到新版（报告 tab 刷新为新版）。transitionKind/provenance 采集照旧（W7 口径）。
 */
async function commitRevision(): Promise<void> {
    const parent = head.value;
    if (!parent || committing.value || !editDraft.value.trim() || editDraft.value === parent.body) {
        return;
    }
    committing.value = true;
    try {
        // transitionKind 先取出：POST 成功后还要写进版本条目（内容来源口径 user > llm > static）。
        const transitionKind = classifyTransitionKind(editTextPanel.value?.getRepairEdits().map((edit) => edit.kind) ?? null);
        const created = await $fetch<{revisionId: string; ordinal: number}>("/api/revisions", {
            method: "POST",
            body: {textId: textId.value, parentId: parent.revisionId, body: editDraft.value, transitionKind, provenanceJson: buildProvenanceJson()},
        });
        const response = await $fetch<RevealResponse>(`/api/revisions/${created.revisionId}/reveal`, {method: "POST"});
        revisions.value = [...revisions.value, {revisionId: created.revisionId, ordinal: created.ordinal, transitionKind, body: editDraft.value, scan: response.scan, detects: response.detects, llmReview: response.llmReview, analysis: response.analysis, detectState: "idle", judgment: null}];
        // 查看指针推进到新 head（报告 tab 刷新为新版；编辑器随 :key 换代重挂、基底=新 head）。
        activeOrdinal.value = created.ordinal;
        rightTab.value = "report";
        // 审阅横幅/stale 状态清场（TextPanel 已随 :key 重挂，diff 队列清零）；批量多选随草稿换代清空。
        resetReviewState();
        selectedBatchRuleIds.value = new Set();
        // 新版检测轮询（detect / llmReview 任一缺即发起）；rev0 端若仍无数据顺带补拉（避开在途轮询重复发起）。
        if (response.detects.length === 0 || response.llmReview === null) {
            void pollDetects(created.revisionId);
        }
        const base = rev0.value;
        if (base && (base.detects.length === 0 || base.llmReview === null) && base.detectState !== "polling") {
            void pollDetects(base.revisionId);
        }
    } catch (caught) {
        notification.error(resolveApiErrorMessage(caught, t("contribute.commitFailed")));
    } finally {
        committing.value = false;
    }
}

// ═══════════════ 复评四维（报告 tab，rev_k；reveal 先行 → blind=false 自洽） ═══════════════

/** 提交当前查看 rev_k 的复评四维（improvementScore 仅 rev_k 合法，rev0 由 ReportPanel 天然不出表单）。 */
async function onJudgmentSubmit(payload: PostJudgment): Promise<void> {
    const target = active.value;
    if (!target || target.ordinal === 0 || submitting.value) {
        return;
    }
    submitting.value = true;
    try {
        await $fetch("/api/judgments", {
            method: "POST",
            body: {
                revisionId: target.revisionId,
                aiFlavor: payload.aiFlavor,
                wantReadOn: payload.wantReadOn,
                improvementScore: payload.improvementScore,
                comment: payload.comment.trim() || undefined,
            },
        });
        // 写回该版条目：ReportPanel 表单锁定为已提交值，D5 结果框随之出现。
        target.judgment = payload;
        notification.success(t("contribute.postJudgmentSaved"));
    } catch (caught) {
        notification.error(resolveApiErrorMessage(caught, t("contribute.postJudgmentFailed")));
    } finally {
        submitting.value = false;
    }
}

// ═══════════════ AI 改写：分析 session 复用于持久化 Chat Flow ═══════════════

const agentSessionId = computed(() => head.value?.analysis?.llm.sessionId ?? null);
const {
    snapshot: agentSnapshot, messages: agentMessages, running: llmFixRunning, loading: agentChatLoading, unavailable: llmFixUnavailable,
    selection: agentSelection, composerPrefill, composerVersion, latestRetryable,
    stale: llmFixStale, connectionStatus: agentConnectionStatus, runPhase: agentRunPhase,
    llmReviewOpen, llmDiffs, llmVisitedCount,
    send: sendAgentMessage, startFull: startLlmFix, prepareSelection, abort: cancelLlmFix, retry: retryAgent,
    applyStale: applyStaleLlmFix, discardStale: discardStaleLlmFix,
    onLlmReviewNavigate, onLlmReviewReject, resetReviewState, abandonAll,
} = useAgentChat({
    panel: editTextPanel,
    editDraft,
    sessionId: agentSessionId,
    // 编辑器在场 = 工作台已揭示（旧版只读期间编辑器 v-show 保活，实例恒在，重试结果并入草稿不丢）。
    editorActive: () => step.value === "workspace" && revealed.value,
});

// ═══════════════ 静态修复 / 一键修复（Task 17 需求 5，编辑工具行） ═══════════════

// 静态修复口径 = 真正无需上下文判断的 auto 命中；candidate 留给命中列表或 LLM 逐条判断。
const staticFixIssues = computed(() => editAllIssues.value.filter(isIssueAutoApplicable));

/** 「静态修复」：一次应用全部可自动替换命中（坐标从后往前、逐条溯源、单撤销）。 */
function runStaticFix(): void {
    const applied = editTextPanel.value?.acceptIssueReplacements(staticFixIssues.value) ?? 0;
    if (applied === 0) {
        notification.info(t("notify.issueNotAutoReplaceable"));
    }
}

/**
 * 「一键修复」= 静态修复 → 随即发起 LLM 整篇改写：
 * 先同步 splice 全部静态替换，等草稿 v-model 回流一拍后再捕获快照发起（startLlmFix 用当前草稿
 * 快照——不等回流会把静态修复前的旧稿送给模型）。改写结果照旧以 diff 并入、审阅横幅逐处巡检。
 */
async function runOneClickFix(): Promise<void> {
    if (llmFixRunning.value || llmFixUnavailable.value || !agentSessionId.value) {
        return;
    }
    if (staticFixIssues.value.length > 0) {
        editTextPanel.value?.acceptIssueReplacements(staticFixIssues.value);
        await nextTick();
    }
    startLlmFix();
}

// 一键修复按钮 title：session 尚未建立/加载失败时给出原因，常态说明完整流程。
const oneClickFixTitle = computed(() => llmFixUnavailable.value ?? (!agentSessionId.value ? t("contribute.processLlmJudgeNote") : t("contribute.oneClickFixTitle")));

/** 选区改写改为 Chat 引用附件：切换 tab、预填要求，等待用户确认发送。 */
function startLlmFixSelection(request: AgentSelection): void {
    prepareSelection(request);
    rightTab.value = "aiFix";
}

// ═══════════════ 历史恢复（Task 15 P1-C：draft 屏「我的检测历史」→ hydrateWorkspace 直入工作台） ═══════════════

// 恢复请求进行中（历史列表禁点防连点；恢复是全局状态覆盖，不允许并发两篇）。
const restoring = ref(false);

/**
 * 从历史列表点开某篇：拉工作台恢复端点（一次全量）→ hydrateWorkspace 重建全部流程状态直入
 * workspace（lineage/head/rev0/scans/detects/盲评快照/复评均恢复；恢复后再次检测/复评/标注照常）。
 * 换篇纪律与 resetFlow 同款：先废弃在途 AI 改写与检测轮询，再整体覆盖。
 */
async function openHistoryText(historyTextId: string): Promise<void> {
    if (restoring.value) {
        return;
    }
    restoring.value = true;
    try {
        const payload = await $fetch<WorkspacePayload>(`/api/texts/${historyTextId}/workspace`);
        const hydrated = hydrateWorkspace(payload);
        // —— 跨篇清场：AI 改写代数作废 + 检测轮询代数推进（A 篇在途结果绝不进 B 篇）——
        abandonAll();
        detectEpoch += 1;
        // —— 按 hydrate 产物整体覆盖工作台状态 ——
        textId.value = hydrated.textId;
        revisions.value = hydrated.revisions;
        revealed.value = hydrated.revealed;
        submittedScores.value = hydrated.submittedScores;
        activeOrdinal.value = hydrated.activeOrdinal;
        annotationCount.value = hydrated.annotationCount;
        editDraft.value = hydrated.editDraft;
        rightTab.value = "report";
        editActiveRuleId.value = null;
        editLocateOffset.value = null;
        viewActiveRuleId.value = null;
        viewLocateOffset.value = null;
        selectedBatchRuleIds.value = new Set();
        step.value = "workspace";
        // 残局兜底：head 已建但未揭示（上次「再次检测」在 reveal 前中断）→ reveal 幂等补拉该版扫描。
        const headEntry = head.value;
        if (revealed.value && headEntry && headEntry.scan === null) {
            const response = await $fetch<RevealResponse>(`/api/revisions/${headEntry.revisionId}/reveal`, {method: "POST"});
            headEntry.scan = response.scan;
            headEntry.detects = response.detects;
            headEntry.llmReview = response.llmReview;
            headEntry.analysis = response.analysis;
        }
        // 外部检测/LLM 评审异步落库可能未到：head 与 rev0 任一缺数据时补轮询（其余旧版早已尘埃落定，不轮询）。
        for (const entry of [head.value, rev0.value]) {
            if (revealed.value && entry && (entry.detects.length === 0 || entry.llmReview === null) && entry.detectState !== "polling") {
                void pollDetects(entry.revisionId);
            }
        }
    } catch (caught) {
        notification.error(resolveApiErrorMessage(caught, t("contribute.historyOpenFailed")));
    } finally {
        restoring.value = false;
    }
}

// ═══════════════ 7a 按规则批量应用（命中 tab，仅 head 编辑视图） ═══════════════

// 参与批量应用的多选规则 id 集合（整体替换引用保证响应式）。
const selectedBatchRuleIds = ref<Set<string>>(new Set());
// 当前过滤视图下仍在选中集合里的规则组（规则被过滤掉/命中清零后自然退出统计）。
const selectedBatchGroups = computed(() => editGroups.value.filter((group) => selectedBatchRuleIds.value.has(group.rule.id) && group.issues.some(isIssueReplacementApplicable)));
const selectedBatchIssueCount = computed(() => selectedBatchGroups.value.reduce((sum, group) => sum + group.issues.filter(isIssueReplacementApplicable).length, 0));

/** 勾选/取消某规则参与批量（IssueCard checkbox 上抛）。 */
function onToggleBatchRule(ruleId: string, checked: boolean): void {
    const next = new Set(selectedBatchRuleIds.value);
    if (checked) {
        next.add(ruleId);
    } else {
        next.delete(ruleId);
    }
    selectedBatchRuleIds.value = next;
}

/** 批量应用一组命中（TextPanel 内坐标从后往前、单通知单撤销）；0 条实际应用时给出提示。 */
function applyIssuesBatch(issues: Issue[]): void {
    const applied = editTextPanel.value?.acceptIssueReplacements(issues) ?? 0;
    if (applied === 0) {
        notification.info(t("notify.issueNotAutoReplaceable"));
    }
}

/** 规则组「应用全部」（IssueCard 上抛的该规则全部可自动替换命中）。 */
function onApplyGroup(issues: Issue[]): void {
    applyIssuesBatch(issues);
}

/** 底部「应用所选规则」：所选规则的全部可自动替换命中一次并入，随后清空选择。 */
function applySelectedBatchRules(): void {
    applyIssuesBatch(selectedBatchGroups.value.flatMap((group) => group.issues.filter(isIssueReplacementApplicable)));
    selectedBatchRuleIds.value = new Set();
}

// ═══════════════ F3 外部 LLM 降级路（复制指令 / 复制指令+正文 / 剪贴板替换全文） ═══════════════

const replaceFullTextConfirmOpen = ref(false);

/** 外部 LLM 菜单分发（菜单本体在 AiFixPanel，Task 16 R7）：替换全文先过确认弹窗，两个复制项直接执行。 */
function onExternalLlmSelect(value: string): void {
    if (value === "replace-text") {
        replaceFullTextConfirmOpen.value = true;
        return;
    }
    void copyEditOptimizationPrompt(value === "prompt-with-text");
}

/** 复制编辑器的外部 LLM 优化指令（可带当前草稿正文）：命中/汇总用命中 tab 同一份过滤视图，批注带草稿投影。 */
async function copyEditOptimizationPrompt(includeText: boolean): Promise<void> {
    const prompt = buildLlmOptimizationPrompt({
        text: editDraft.value,
        issues: editFilteredIssues.value,
        summary: editSummary.value,
        filters,
        comments: editTextPanel.value?.getReviewComments() ?? [],
        includeText,
    });
    try {
        await navigator.clipboard.writeText(prompt);
        notification.success(t(includeText ? "notify.optimizationPromptWithTextCopied" : "notify.optimizationPromptCopied"));
    } catch {
        notification.error(t("notify.copyFailed"));
    }
}

/**
 * 确认后用剪贴板替换全文：走 TextPanel 既有 replaceTextFromClipboard（产出单条 llm diff，
 * 撤销通知内置）；成功替换后打开审阅横幅并激活该处——外部 LLM 改稿与内置 AI 改写共用同一条巡检出口。
 */
async function confirmReplaceFullText(): Promise<void> {
    replaceFullTextConfirmOpen.value = false;
    const panel = editTextPanel.value;
    if (!panel) {
        return;
    }
    const beforePlan = panel.getRepairPlan();
    await panel.replaceTextFromClipboard();
    // plan 引用未变 = 剪贴板为空/读取失败/与全文一致（TextPanel 内已各自提示），不动横幅。
    if (panel.getRepairPlan() !== beforePlan && llmDiffs.value.length > 0) {
        llmReviewOpen.value = true;
        // 等 ReviewEditor 的 props.diffs 异步 flush 后再激活（与并入路径同因）。
        void nextTick(() => {
            editTextPanel.value?.navigateLlmDiff("next");
        });
    }
}

// ═══════════════ 完成态（G6 总结卡数据折算） ═══════════════

// 终评两轴（总结卡「盲评 vs 终评」右列）：head 版的已提交复评；未复评 = null。
const finalScores = computed<BlindScores | null>(() => {
    const judgment = head.value?.judgment ?? null;
    return judgment ? {aiFlavor: judgment.aiFlavor, wantReadOn: judgment.wantReadOn} : null;
});
// D5 结论折算（总结卡）：none=head 未复评（含 rev0 直接完成）；其余按 D5 各腿口径折算。
const summaryVerdict = computed<SummaryVerdict>(() => {
    const headEntry = head.value;
    const base = rev0.value;
    if (!headEntry || !base || headEntry.ordinal === 0 || headEntry.judgment === null) {
        return "none";
    }
    const legs = computeD5Legs(base, headEntry, submittedScores.value, headEntry.judgment);
    if (legs.wantReadOnKept === null) {
        return "noBaseline";
    }
    if (legs.machineLegPass && legs.wantReadOnKept) {
        return legs.detectorDown !== null ? "pass" : "passDegraded";
    }
    return "fail";
});

/**
 * G6「再传一篇」：原地重置全部流程状态回 draft 屏。
 * 逐项对照本文件的 ref 声明清单覆盖；有意不重置的项见函数尾注。
 */
function resetFlow(): void {
    // —— 上传表单 ——
    text.value = "";
    declaredProvenance.value = "unknown";
    visibility.value = "private";
    genre.value = "";
    textType.value = "";
    sourceNote.value = "";
    consent.value = true;
    // —— 工作台核心状态（版本数组 / 揭示闸门 / 查看指针 / 盲评快照 / 标注计数）——
    textId.value = "";
    revisions.value = [];
    revealed.value = false;
    activeOrdinal.value = 0;
    rightTab.value = "report";
    submittedScores.value = null;
    annotationCount.value = 0;
    // —— 检测轮询：推进全局代数使全部在途轮询失效 ——
    detectEpoch += 1;
    // —— 编辑器（草稿 + 扫描开关 + 命中联动；TextPanel 实例随工作台卸载自行销毁）——
    editDraft.value = "";
    editScanAll.value = true;
    editActiveRuleId.value = null;
    editLocateOffset.value = null;
    // —— 只读视图联动 / 规则弹窗 / 7a 批量多选 ——
    viewActiveRuleId.value = null;
    viewLocateOffset.value = null;
    activeRule.value = null;
    selectedBatchRuleIds.value = new Set();
    // —— AI 改写：整体废弃（跨篇纪律）——推进 llm-fix 代数令牌使在途 job 轮询立即过期，
    // A 篇改写结果绝不并入/转 stale 到 B 篇；同时收运行位并清审阅横幅/stale 暂存。 ——
    abandonAll();
    replaceFullTextConfirmOpen.value = false;
    // 有意不重置：loading / submitting / committing——请求生命周期状态由各自 finally 收尾；
    // llmFixUnavailable——503 = 服务端配置态，换一篇不会自愈（修配置重启后刷新页面恢复）；
    // filters / nsOptions——用户过滤偏好，随 settings 持久化，不属于单篇流程。
    step.value = "draft";
}

// ─── 左右分栏可拖拽（Task 19 D，照 playground.vue 同款边界与键盘微调） ───
const {width: viewportWidth} = useWindowSize();
const reportResizeHandle = ref<HTMLElement | null>(null);
const reportPanelMinWidth = computed(() => Math.min(380, Math.max(320, viewportWidth.value - 80)));
const reportPanelMaxWidth = computed(() => Math.max(reportPanelMinWidth.value, Math.min(960, Math.floor(viewportWidth.value * 0.68))));
const canResizeWorkbench = computed(() => viewportWidth.value >= 768);
const reportPanelResizeStep = 32;
const {isResizing: isReportPaneResizing, panelStyle: reportPanelStyle} = useResizablePanel(reportResizeHandle, {
    size: computed(() => settings.value.contributeReportWidth),
    minSize: reportPanelMinWidth,
    maxSize: reportPanelMaxWidth,
    edge: "left",
    enabled: canResizeWorkbench,
    syncDuringResize: true,
    onResize: (value) => patch({contributeReportWidth: value}),
    onResizeEnd: (value) => patch({contributeReportWidth: value}),
});

/** 提交右栏宽度（键盘微调路径），与拖拽共用同一组尺寸边界。 */
function commitReportPanelWidth(value: number): void {
    patch({contributeReportWidth: clampResizablePanelSize(value, reportPanelMinWidth.value, reportPanelMaxWidth.value)});
}

/** 键盘微调分隔线：方向键 ±32px（Shift ×3），Home/End 快速收放。 */
function handleReportResizeKeydown(event: KeyboardEvent): void {
    if (!canResizeWorkbench.value) {
        return;
    }
    const currentWidth = settings.value.contributeReportWidth;
    const step = event.shiftKey ? reportPanelResizeStep * 3 : reportPanelResizeStep;
    if (event.key === "ArrowLeft") {
        event.preventDefault();
        commitReportPanelWidth(currentWidth + step);
    } else if (event.key === "ArrowRight") {
        event.preventDefault();
        commitReportPanelWidth(currentWidth - step);
    } else if (event.key === "Home") {
        event.preventDefault();
        commitReportPanelWidth(reportPanelMaxWidth.value);
    } else if (event.key === "End") {
        event.preventDefault();
        commitReportPanelWidth(reportPanelMinWidth.value);
    }
}
</script>

<template>
    <div class="flex h-screen flex-col bg-[var(--bg-main)] text-[var(--text-main)]">
        <AppHeader />
        <!-- 顶栏单行（Task 19 C 压缩）：阶段指示 + 版本条 + 引导条（内联，默认折叠成罗盘按钮） -->
        <div class="flex flex-wrap items-center gap-x-6 gap-y-1.5 border-b border-[var(--border-color)] px-4 py-2">
            <FlowStepper :current="step" />
            <VersionBar v-if="step === 'workspace' && revealed" class="min-w-0 flex-1" :entries="lineage" :head-ordinal="headOrdinal" :active-ordinal="activeOrdinal" :draft-dirty="draftDirty" :committing="committing" :commit-disabled="llmFixRunning" @select="selectVersion" @commit="commitRevision" />
            <!-- 引导条（完成态不渲染）：draft / blind / workspace / viewing 四语境 -->
            <StepGuideBar v-if="step !== 'done'" class="min-w-0 basis-full md:ml-auto md:basis-auto md:max-w-[40%]" :screen="guideScreen" />
        </div>
        <!-- ═══ 上传屏：正文 + 自报三项 + 授权（盲评卡在工作台报告 tab）+ 检测历史入口 ═══ -->
        <main v-if="step === 'draft'" class="min-h-0 flex-1 overflow-auto">
            <form class="mx-auto grid max-w-5xl gap-5 px-4 py-5" @submit.prevent="submitDraft">
                <section class="grid gap-2">
                    <div class="flex items-center justify-between gap-3">
                        <h1 class="text-lg font-semibold">{{ t("contribute.title") }}</h1>
                        <span class="text-xs text-[var(--text-muted)]">{{ t("contribute.charCount", {count: text.length}) }}</span>
                    </div>
                    <textarea v-model="text" class="min-h-[38vh] resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3 font-mono text-sm leading-relaxed outline-none focus:border-[var(--accent-main)]" :placeholder="t('contribute.textPlaceholder')" required maxlength="60000" />
                </section>
                <!-- 自报区：来源 / 可见性 / 题材 / 体裁 / 作品名（全可选） -->
                <section class="grid gap-4 md:grid-cols-2">
                    <FormSelect v-model="declaredProvenance" :label="t('contribute.sourceLabel')" :options="provenanceOptions" />
                    <FormSelect v-model="visibility" :label="t('contribute.visibilityLabel')" :options="visibilityOptions" />
                    <FormSelect v-model="genre" :label="t('contribute.genreLabel')" :options="genreOptions" />
                    <FormSelect v-model="textType" :label="t('contribute.textTypeLabel')" :options="textTypeOptions" />
                    <label class="grid gap-1.5 md:col-span-2">
                        <span class="text-xs font-medium text-[var(--text-muted)]">{{ t("contribute.sourceNoteLabel") }}</span>
                        <input v-model="sourceNote" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-sm outline-none focus:border-[var(--accent-main)]" :placeholder="t('contribute.sourceNotePlaceholder')" maxlength="200">
                    </label>
                </section>
                <div class="flex items-center justify-between gap-3">
                    <SwitchField v-model="consent" :label="t('contribute.consentText')" />
                    <!-- G3 主 CTA 纪律：本屏唯一主按钮 = 上传进工作台 -->
                    <button type="submit" class="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-[var(--accent-main)] px-4 text-sm font-medium text-white hover:brightness-105 disabled:opacity-60" :disabled="loading || !text.trim()">
                        <span class="i-lucide-send" />
                        <span>{{ loading ? t("contribute.submitting") : t("contribute.uploadButton") }}</span>
                    </button>
                </div>
            </form>
            <!-- 检测历史入口（Task 15 P1-C）：当前登录或本地开发身份的历史文本，点开恢复工作台 -->
            <div class="mx-auto max-w-5xl px-4 pb-8">
                <ContributeHistoryPanel :busy="restoring" @open="openHistoryText" />
            </div>
        </main>
        <!-- ═══ 工作台：左 编辑器（head）/ 只读正文（旧版·未揭示），右 报告/命中 双 tab（Task 19 D：分栏可拖拽） ═══ -->
        <main v-else-if="step === 'workspace'" class="flex min-h-0 flex-1 flex-col md:flex-row" :class="isReportPaneResizing ? 'select-none' : ''">
            <!-- 左栏 -->
            <section class="flex min-h-0 min-w-0 flex-1 flex-col border-b border-[var(--border-color)] md:border-b-0">
                <!-- head 编辑视图（v-show 保活：切旧版查看时草稿/diff/批注现场不丢，拍板②的最小方案） -->
                <div v-if="revealed" v-show="editorVisible" class="flex min-h-0 flex-1 flex-col">
                    <!-- G5 AI 改写审阅横幅：llm diff 逐处巡检 / 拒绝该处 / 已巡检 k/N（清零自动收起） -->
                    <LlmReviewBar v-if="llmReviewOpen && llmDiffs.length > 0" :total="llmDiffs.length" :visited="llmVisitedCount" @navigate="onLlmReviewNavigate" @reject="onLlmReviewReject" @close="llmReviewOpen = false" />
                    <!-- 编辑器：:key 随 head 换代重挂（「再次检测」后基底=新 head）；llm-rewrite 随通道可用性；
                         heat=head 版检测分块（Task 16 R6，面板内投影草稿坐标）；force-diffs=审阅横幅打开时强制显示 diff 层（R5）；
                         annotate=选区菜单「保存标注」（Task 17 A3，坐标经映射锚回 head.body 落库） -->
                    <TextPanel
                        :key="head?.revisionId ?? 'head'"
                        ref="editTextPanel"
                        v-model="editDraft"
                        v-model:scan-all="editScanAll"
                        :ranges="editRanges"
                        :issues="editFilteredIssues"
                        :locate-offset="editLocateOffset"
                        :auto-fix-count="editAutoFix.count"
                        :auto-fix-text="editAutoFix.fixed"
                        :auto-fix-changes="editAutoFix.changes"
                        :original-text="headBody"
                        :llm-rewrite="!!agentSessionId"
                        :heat="editorHeat"
                        :force-diffs="llmReviewOpen"
                        annotate
                        embedded
                        @llm-rewrite-selection="startLlmFixSelection"
                        @save-annotation="saveEditorAnnotation"
                    >
                        <!-- 主操作注入 TextPanel 工具行（Task 19 A：原独立按钮行删除，状态仍在宿主）：
                             「机械修复」= 应用全部可自动替换命中（口径白话进 title）；
                             「一键修到底」= 机械修复 → 随即发起 LLM 整篇改写（diff 审阅照旧） -->
                        <template #toolbar-leading>
                            <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-color)] px-2.5 hover:bg-[var(--bg-hover)] disabled:opacity-60" :disabled="staticFixIssues.length === 0" :title="`${t('contribute.staticFixTitle')}\n${t('contribute.strongFixScope')}`" @click="runStaticFix">
                                <span class="i-lucide-eraser" /> {{ t("contribute.staticFixButton", {count: staticFixIssues.length}) }}
                            </button>
                            <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--accent-main)] px-2.5 font-medium text-white hover:brightness-105 disabled:opacity-60" :disabled="llmFixRunning || !!llmFixUnavailable || !agentSessionId" :title="oneClickFixTitle" @click="runOneClickFix">
                                <span class="i-lucide-sparkles" /> {{ llmFixRunning ? t("contribute.llmFixRunning") : t("contribute.oneClickFixButton") }}
                            </button>
                        </template>
                    </TextPanel>
                </div>
                <!-- 只读版本视图：查看旧版 / 揭示前的 rev0（无任何机器高亮，D2）。
                     正文恒为该版落库 body，span 标注坐标锚定 revisionId 对应正文（历史版本仍走此处标注） -->
                <div v-if="!editorVisible" class="flex min-h-0 flex-1 flex-col">
                    <div class="flex items-center justify-between gap-3 border-b border-[var(--border-color)] px-4 py-2 text-xs">
                        <span>{{ t("contribute.viewingTitle", {ordinal: activeOrdinal}) }}</span>
                        <div class="flex items-center gap-2">
                            <!-- 热力图开关（Task 15 P1-C）：该版有检测分块数据才出现；状态记忆到浏览器设置 -->
                            <button v-if="revealed && viewHeatChunks.length > 0" type="button" class="inline-flex h-7 items-center gap-1 rounded-md border px-2.5" :class="settings.heatmap ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] hover:bg-[var(--bg-hover)]'" :title="t('contribute.heatmapToggleTitle')" @click="toggleHeatmap">
                                <span class="i-lucide-thermometer" /> {{ t("contribute.heatmapToggle") }}
                            </button>
                        </div>
                    </div>
                    <AnnotatableRevisionText :text="viewBody" :ranges="revealed ? viewRanges : []" :heat="viewHeat" :revision-id="active?.revisionId ?? ''" :locate-offset="viewLocateOffset" @offset-click="onViewOffsetClick" @annotated="annotationCount += 1" />
                </div>
            </section>
            <!-- 分栏拖拽手柄（≥md；照 playground 同款交互：拖拽/键盘微调/焦点态） -->
            <div
                ref="reportResizeHandle"
                class="contribute-resize-handle hidden md:flex"
                :class="isReportPaneResizing ? 'is-active' : ''"
                role="separator"
                aria-orientation="vertical"
                :tabindex="canResizeWorkbench ? 0 : -1"
                :aria-valuenow="Math.round(settings.contributeReportWidth)"
                :aria-valuemin="Math.round(reportPanelMinWidth)"
                :aria-valuemax="Math.round(reportPanelMaxWidth)"
                :title="t('layout.resizeReportPanelTitle')"
                @keydown="handleReportResizeKeydown"
            >
                <span />
            </div>
            <!-- 右栏：报告 tab（默认）/ 命中 tab -->
            <section class="flex min-h-0 flex-col md:shrink-0" :style="canResizeWorkbench ? reportPanelStyle : undefined">
                <!-- tab 条：未揭示时命中 tab 禁用（D2：盲评前不渲染任何机器结果） -->
                <div class="flex items-center gap-1 border-b border-[var(--border-color)] px-2 py-1.5 text-xs">
                    <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md px-3" :class="rightTab === 'report' ? 'bg-[var(--bg-subtle)] font-medium' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'" @click="rightTab = 'report'">
                        <span class="i-lucide-clipboard-check h-3.5 w-3.5" /> {{ t("contribute.tabReport") }}
                    </button>
                    <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md px-3 disabled:opacity-50" :class="rightTab === 'issues' ? 'bg-[var(--bg-subtle)] font-medium' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'" :disabled="!revealed" @click="rightTab = 'issues'">
                        <span class="i-lucide-list h-3.5 w-3.5" /> {{ t("contribute.tabIssues") }}
                    </button>
                    <!-- AI 改写 tab（Task 16 R7）：运行中显 spinner；未揭示禁用（D2 同 issues 口径） -->
                    <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md px-3 disabled:opacity-50" :class="rightTab === 'aiFix' ? 'bg-[var(--bg-subtle)] font-medium' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'" :disabled="!revealed" @click="rightTab = 'aiFix'">
                        <span class="h-3.5 w-3.5" :class="llmFixRunning ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-bot'" /> {{ t("contribute.tabAiFix") }}
                    </button>
                </div>
                <!-- ① 报告 tab：盲评卡（未揭示）→ 白话汇总 + 检测进程 + 多维卡 +（rev_k）对比/复评/D5 + 完成出口（AI 改写等待期锁 finish，W7 离场纪律） -->
                <ReportPanel v-if="rightTab === 'report'" :revealed="revealed" :active="active" :rev0="rev0" :blind-scores="submittedScores" :scan-summary="activeScanSummary" :submitting="submitting" :llm-fix-running="llmFixRunning" @blind-submit="onBlindSubmit" @blind-skip="onBlindSkip" @judgment-submit="onJudgmentSubmit" @detector-retry="retryDetector" @detector-cancel="cancelDetector" @llm-retry="retryLlmAnalysis" @llm-cancel="cancelLlmAnalysis" @finish="step = 'done'" />
                <!-- ③ AI 改写 tab（R7 自编辑工具行迁入）：整篇发起/取消/外部 LLM 菜单/流式预览；审阅横幅与 diff 仍在左侧编辑器 -->
                <AiFixPanel v-else-if="rightTab === 'aiFix'" :snapshot="agentSnapshot" :messages="agentMessages" :running="llmFixRunning" :loading="agentChatLoading" :unavailable="llmFixUnavailable" :selection="agentSelection" :prefill="composerPrefill" :prefill-version="composerVersion" :editor-active="editorVisible" :retryable="latestRetryable !== null" :connection-status="agentConnectionStatus" :run-phase="agentRunPhase" @send="sendAgentMessage" @cancel="cancelLlmFix" @retry="retryAgent" @clear-selection="agentSelection = null" @external-select="onExternalLlmSelect" />
                <!-- ② 命中 tab：FilterControls + IssueList 迁入（head 编辑视图可应用替换；只读视图——旧版或 head 只读标注——仅定位） -->
                <template v-else>
                    <div v-if="editorVisible" class="flex flex-wrap items-center gap-2 border-b border-[var(--border-color)] px-4 py-2 text-xs">
                        <span class="font-medium">{{ t("contribute.editHits", {count: editHits}) }}</span>
                        <span class="text-[var(--text-muted)]">{{ t("contribute.baseHits", {count: rev0Hits}) }}</span>
                        <span v-if="draftDirty" :class="hitsDown ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-600'">{{ hitsDown ? t("contribute.hitsDown") : t("contribute.hitsNotDown") }}</span>
                    </div>
                    <FilterControls :filters="filters" :namespace-options="nsOptions" @update:filters="updateFilters" />
                    <!-- 7a 多规则批量工具条（head 编辑视图，勾选 ≥1 规则时出现）：一次应用所选规则的全部可自动替换命中 -->
                    <div v-if="editorVisible && selectedBatchGroups.length > 0" class="flex flex-wrap items-center gap-2 border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-4 py-2 text-xs">
                        <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--accent-main)] px-3 text-xs font-medium text-white hover:brightness-105" @click="applySelectedBatchRules">
                            <span class="i-lucide-check-check" /> {{ t("contribute.batchApplySelected", {rules: selectedBatchGroups.length, count: selectedBatchIssueCount}) }}
                        </button>
                        <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-color)] px-2.5 text-xs hover:bg-[var(--bg-hover)]" @click="selectedBatchRuleIds = new Set()">{{ t("contribute.batchApplyClear") }}</button>
                    </div>
                    <div class="min-h-0 flex-1">
                        <IssueList
                            v-if="editorVisible"
                            :groups="editGroups"
                            :has-text="editDraft.trim().length > 0"
                            :active-rule-id="editActiveRuleId"
                            :verdicts="issueVerdicts"
                            batch-apply
                            :selected-rule-ids="[...selectedBatchRuleIds]"
                            @open-rule="(rule) => (activeRule = rule)"
                            @locate-issue="onEditLocate"
                            @apply-issue="onEditApplyIssue"
                            @apply-group="onApplyGroup"
                            @toggle-select="onToggleBatchRule"
                            @hide-rule="hideRule"
                        />
                        <IssueList
                            v-else
                            :groups="viewGroups"
                            :has-text="viewBody.trim().length > 0"
                            :active-rule-id="viewActiveRuleId"
                            :verdicts="issueVerdicts"
                            @open-rule="(rule) => (activeRule = rule)"
                            @locate-issue="onViewLocate"
                            @hide-rule="hideRule"
                        />
                    </div>
                </template>
            </section>
        </main>
        <!-- ═══ 完成态：贡献总结卡（rev 链 + 盲评 vs 终评 + D5 结论 + 标注数 + 再传一篇/查看数据集） ═══ -->
        <main v-else class="min-h-0 flex-1 overflow-auto">
            <ContributionSummary :lineage="lineage" :head-ordinal="headOrdinal" :blind-scores="submittedScores" :final-scores="finalScores" :verdict="summaryVerdict" :annotation-count="annotationCount" @restart="resetFlow" />
        </main>
        <RuleDetailDialog :rule="activeRule" @close="activeRule = null" />
        <!-- W7 stale 确认：AI 改写返回时草稿已被改过——应用（回置发起时快照再并入）或丢弃；X/Esc 关闭视同丢弃 -->
        <Dialog :model-value="llmFixStale !== null" :title="t('contribute.llmFixStaleTitle')" :close-on-overlay="false" @update:model-value="(value: boolean) => { if (!value) discardStaleLlmFix(); }">
            <div class="grid gap-4 text-sm">
                <p class="text-[var(--text-muted)]">{{ t("contribute.llmFixStaleBody") }}</p>
                <div class="flex justify-end gap-2">
                    <button type="button" class="h-8 rounded-md border border-[var(--border-color)] px-3 hover:bg-[var(--bg-hover)]" @click="discardStaleLlmFix">{{ t("contribute.llmFixStaleDiscard") }}</button>
                    <button type="button" class="h-8 rounded-md bg-[var(--accent-main)] px-3 font-medium text-white hover:brightness-105" @click="applyStaleLlmFix">{{ t("contribute.llmFixStaleApply") }}</button>
                </div>
            </div>
        </Dialog>
        <!-- F3 剪贴板替换全文确认（playground 同款文案与按钮）：外部 LLM 改稿贴回来，替换后以 llm diff 进审阅横幅 -->
        <Dialog v-model="replaceFullTextConfirmOpen" :title="t('llm.replaceFullTitle')" show-footer :close-on-overlay="false" width="min(520px, calc(100vw - 32px))" @confirm="confirmReplaceFullText">
            <p class="text-sm leading-6 text-[var(--text-secondary)]">{{ t("llm.replaceFullBody") }}</p>
            <template #footer="{ close }">
                <button type="button" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-sm hover:bg-[var(--bg-hover)]" @click="close">{{ t("common.cancel") }}</button>
                <button type="button" class="h-8 rounded-md bg-[var(--accent-main)] px-3 text-sm font-medium text-white hover:opacity-90" @click="confirmReplaceFullText">{{ t("llm.replaceFullConfirm") }}</button>
            </template>
        </Dialog>
    </div>
</template>

<style scoped>
/* 分栏拖拽手柄（Task 19 D，样式照 playground 的 analysis-resize-handle）：
   10px 竖条 + 中央指示线，hover/拖拽中变 accent；承担原 md:border-r 的分隔线职责 */
.contribute-resize-handle {
    position: relative;
    z-index: 5;
    width: 10px;
    flex: 0 0 10px;
    cursor: col-resize;
    align-items: stretch;
    justify-content: center;
    border-left: 1px solid var(--border-color);
    border-right: 1px solid var(--border-color);
    background: var(--bg-panel);
    touch-action: none;
}

.contribute-resize-handle span {
    width: 2px;
    margin: 10px 0;
    border-radius: 999px;
    background: color-mix(in srgb, var(--border-color) 78%, transparent);
    transition: background-color 0.15s ease, width 0.15s ease;
}

.contribute-resize-handle:hover span,
.contribute-resize-handle.is-active span {
    width: 3px;
    background: var(--accent-main);
}

.contribute-resize-handle:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent-main) 70%, transparent);
    outline-offset: -2px;
}
</style>
