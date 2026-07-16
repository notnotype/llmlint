<script setup lang="ts">
import {computed, nextTick, reactive, ref, watch} from "vue";
import {useWindowSize} from "@vueuse/core";
import {useLlmlint} from "../composables/useLlmlint";
import {useNotification} from "../composables/useNotification";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import {useWebSettings} from "../composables/useWebSettings";
import {useRecentScans} from "../composables/useRecentScans";
import {clampResizablePanelSize, useResizablePanel} from "../composables/useResizablePanel";
import TextPanel from "../components/TextPanel.vue";
import Dialog from "../components/common/Dialog.vue";
import type {Issue, RegexRuleRecord, UiFilters} from "../types";
import {issueId} from "../utils/review-ranges";
import {buildLlmOptimizationPrompt} from "../utils/llm-optimization-prompt";

// 页面组合：输入 → 扫描 → 过滤 → 分组 → 展示。全部在浏览器本地跑。
const {registry, scan, scanDefault, applyFilters, summarize, groupByRule, issueRanges, offsetOf, issueAtOffset, autoFix, buildReport, namespaceOptions} = useLlmlint();
const notification = useNotification();
const {settings, patch, resetRuleOverrides} = useWebSettings();
const {t} = useLlmlintI18n();
const {addScan} = useRecentScans();
const {width: viewportWidth} = useWindowSize();

const text = ref("");
const originalText = ref("");
const hasStarted = ref(false);
const filters = reactive<UiFilters>({
    review: settings.value.review,
    minLevel: settings.value.minLevel,
    namespaces: [...settings.value.namespaces],
    scanAll: settings.value.scanAll,
});
const nsOptions = namespaceOptions();

// 全部命中（未过滤）→ 过滤后命中 → 汇总 / 分组 / 行内高亮区间
const allIssues = computed(() => scan(text.value, filters.scanAll));
const filteredIssues = computed(() => applyFilters(allIssues.value, filters));
const summary = computed(() => summarize(filteredIssues.value));
const groups = computed(() => groupByRule(filteredIssues.value));
const hidden = computed(() => allIssues.value.length - filteredIssues.value.length);
const hasRuleOverrides = computed(() => Object.keys(settings.value.namespaceOverrides).length > 0 || Object.keys(settings.value.ruleOverrides).length > 0);
const defaultIssues = computed(() => hasRuleOverrides.value ? scanDefault(text.value, filters.scanAll) : allIssues.value);
const hiddenByRuleSettings = computed(() => hasRuleOverrides.value ? Math.max(0, defaultIssues.value.length - allIssues.value.length) : 0);
// 行内高亮跟随「过滤后命中」，与右侧列表一致。
const highlightRanges = computed(() => issueRanges(text.value, filteredIssues.value));

const activeRule = ref<RegexRuleRecord | null>(null);

// 双向定位：locateOffset 驱动左侧滚动+闪烁；activeRuleId 驱动右侧卡片高亮+滚动。
const locateOffset = ref<number | null>(null);
const activeRuleId = ref<string | null>(null);
const activeCaretIssue = ref<Issue | null>(null);
const textPanel = ref<InstanceType<typeof TextPanel> | null>(null);
const reportResizeHandle = ref<HTMLElement | null>(null);
const replaceFullTextConfirmOpen = ref(false);
const isWorkbench = computed(() => hasStarted.value && text.value.trim().length > 0);
const activeIssueId = computed(() => activeCaretIssue.value ? issueId(activeCaretIssue.value) : null);
const lastVisibilityGuardKey = ref("");
const reportPanelMinWidth = computed(() => Math.min(380, Math.max(320, viewportWidth.value - 80)));
const reportPanelMaxWidth = computed(() => Math.max(reportPanelMinWidth.value, Math.min(960, Math.floor(viewportWidth.value * 0.68))));
const canResizeWorkbench = computed(() => viewportWidth.value >= 768);
const reportPanelResizeStep = 32;
const {isResizing: isReportPaneResizing, panelStyle: reportPanelStyle} = useResizablePanel(reportResizeHandle, {
    size: computed(() => settings.value.workbenchReportWidth),
    minSize: reportPanelMinWidth,
    maxSize: reportPanelMaxWidth,
    edge: "left",
    enabled: canResizeWorkbench,
    syncDuringResize: true,
    onResize: (value) => patch({workbenchReportWidth: value}),
    onResizeEnd: (value) => patch({workbenchReportWidth: value}),
});

/**
 * 提交右侧报告面板宽度，和拖拽路径共用同一组尺寸边界。
 */
function commitReportPanelWidth(value: number): void {
    patch({
        workbenchReportWidth: clampResizablePanelSize(value, reportPanelMinWidth.value, reportPanelMaxWidth.value),
    });
}

/**
 * 支持键盘微调左右分屏宽度：方向键移动分隔线，Home/End 快速收放。
 */
function handleReportResizeKeydown(event: KeyboardEvent): void {
    if (!canResizeWorkbench.value) {
        return;
    }

    const currentWidth = settings.value.workbenchReportWidth;
    const step = event.shiftKey ? reportPanelResizeStep * 3 : reportPanelResizeStep;
    if (event.key === "ArrowLeft") {
        event.preventDefault();
        commitReportPanelWidth(currentWidth + step);
        return;
    }
    if (event.key === "ArrowRight") {
        event.preventDefault();
        commitReportPanelWidth(currentWidth - step);
        return;
    }
    if (event.key === "Home") {
        event.preventDefault();
        commitReportPanelWidth(reportPanelMinWidth.value);
        return;
    }
    if (event.key === "End") {
        event.preventDefault();
        commitReportPanelWidth(reportPanelMaxWidth.value);
    }
}

/**
 * 从首页输入态进入左右分屏检测工作台。
 */
function startCheck(): void {
    if (!text.value.trim()) {
        return;
    }
    originalText.value = text.value;
    hasStarted.value = true;
    ensureScanVisible("submit");
    addScan(text.value, allIssues.value.length);
}

/**
 * 保护新文本扫描入口：如果当前过滤器把所有命中藏起来，自动放宽过滤器。
 * 规则覆盖属于用户显式设置，不在这里自动重置，只给出恢复入口提示。
 */
function ensureScanVisible(reason: "submit" | "document-change"): void {
    if (!text.value.trim() || !hasStarted.value) {
        return;
    }
    const textKey = `${text.value.length}:${text.value.slice(0, 80)}:${text.value.slice(-80)}`;
    if (filteredIssues.value.length === 0 && allIssues.value.length > 0) {
        showHiddenIssues();
        const guardKey = `filters:${textKey}`;
        if (lastVisibilityGuardKey.value !== guardKey) {
            lastVisibilityGuardKey.value = guardKey;
            notification.info(t(reason === "submit" ? "notify.filtersAutoReveal" : "notify.documentChangeAutoReveal"));
        }
        return;
    }
    if (hiddenByRuleSettings.value > 0 && allIssues.value.length === 0) {
        const guardKey = `rules:${textKey}`;
        if (lastVisibilityGuardKey.value !== guardKey) {
            lastVisibilityGuardKey.value = guardKey;
            notification.notify({message: t("summary.ruleSettingsWarning"), tone: "warning"});
        }
    }
}

/**
 * 粗略判断工作台内是否换了一篇新文档，避免普通小编辑反复改写用户过滤器。
 */
function isLikelyNewDocument(previousText: string, nextText: string): boolean {
    if (!previousText.trim() || !nextText.trim()) {
        return false;
    }
    if (Math.abs(nextText.length - previousText.length) > 500) {
        return true;
    }
    return previousText.slice(0, 240) !== nextText.slice(0, 240) && nextText.length > 1000;
}

// 点右侧命中 → 定位正文 + 高亮该规则卡片。
function onListLocate(issue: Issue) {
    activeRuleId.value = issue.rule.id;
    activeCaretIssue.value = issue;
    locateOffset.value = offsetOf(text.value, issue);
}

// 点正文（光标落在某命中内）→ 高亮+滚动对应卡片 + 记录当前光标处的规则
function onCaretClick(offset: number) {
    const issue = issueAtOffset(text.value, filteredIssues.value, offset);
    activeCaretIssue.value = issue || null;
    if (issue) {
        activeRuleId.value = issue.rule.id;
    }
}

function onApplyIssue(issue: Issue): void {
    onListLocate(issue);
    const applied = textPanel.value?.acceptIssueReplacement(issue) ?? false;
    if (!applied) {
        notification.info(t("notify.issueNotAutoReplaceable"));
    }
}

function onRebaseOriginal(value: string): void {
    originalText.value = value;
}

function onNavigateIssue(direction: "previous" | "next"): void {
    const issues = filteredIssues.value;
    if (issues.length === 0) {
        return;
    }
    const activeId = activeCaretIssue.value ? issueId(activeCaretIssue.value) : "";
    const activeIndex = activeId ? issues.findIndex((issue) => issueId(issue) === activeId) : -1;
    const nextIndex = direction === "next"
        ? activeIndex >= 0 ? (activeIndex + 1) % issues.length : 0
        : activeIndex >= 0 ? (activeIndex - 1 + issues.length) % issues.length : issues.length - 1;
    const issue = issues[nextIndex];
    if (issue) {
        onListLocate(issue);
    }
}

async function onReplacementApplied(from: number): Promise<void> {
    await nextTick();
    const issues = filteredIssues.value;
    if (issues.length === 0) {
        activeCaretIssue.value = null;
        activeRuleId.value = null;
        locateOffset.value = null;
        return;
    }
    const nextIssue = issues.find((issue) => offsetOf(text.value, issue) >= from) ?? issues[0];
    if (nextIssue) {
        onListLocate(nextIssue);
    }
}

// 一键机械修复（auto 桶）：右侧统计由页面计算，实际应用在 TextPanel 内完成，方便同步批注快照撤销。
const autoFixResult = computed(() => autoFix(text.value, filters.scanAll));

// 复制当前过滤视图为 CheckJsonReport JSON。
async function onCopy() {
    const report = buildReport(allIssues.value, filters);
    try {
        await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
        notification.success(t("notify.copyOk"));
    } catch {
        notification.error(t("notify.copyFailed"));
    }
}

async function onCopyOptimizationPrompt(includeText: boolean): Promise<void> {
    const prompt = buildLlmOptimizationPrompt({
        text: text.value,
        issues: filteredIssues.value,
        summary: summary.value,
        filters,
        comments: textPanel.value?.getReviewComments() ?? [],
        includeText,
    });
    try {
        await navigator.clipboard.writeText(prompt);
        notification.success(t(includeText ? "notify.optimizationPromptWithTextCopied" : "notify.optimizationPromptCopied"));
    } catch {
        notification.error(t("notify.copyFailed"));
    }
}

function onReplaceTextFromClipboard(): void {
    replaceFullTextConfirmOpen.value = true;
}

function confirmReplaceTextFromClipboard(): void {
    replaceFullTextConfirmOpen.value = false;
    void textPanel.value?.replaceTextFromClipboard();
}

function updateFilters(next: UiFilters) {
    Object.assign(filters, next);
    patch({
        review: next.review,
        minLevel: next.minLevel,
        namespaces: [...next.namespaces],
        scanAll: next.scanAll,
    });
}

function showHiddenIssues(): void {
    updateFilters({
        ...filters,
        review: "all",
        minLevel: "low",
        namespaces: [],
    });
}

function resetRulesAndReveal(): void {
    resetRuleOverrides();
    showHiddenIssues();
    notification.info(t("notify.ruleSettingsRestored"));
}

watch(() => settings.value, (nextSettings) => {
    Object.assign(filters, {
        review: nextSettings.review,
        minLevel: nextSettings.minLevel,
        namespaces: [...nextSettings.namespaces],
        scanAll: nextSettings.scanAll,
    });
}, {deep: true});

watch(text, async (nextText, previousText) => {
    if (nextText.trim()) {
        if (hasStarted.value && isLikelyNewDocument(previousText, nextText)) {
            await nextTick();
            ensureScanVisible("document-change");
        }
        return;
    }
    hasStarted.value = false;
    originalText.value = "";
    activeRuleId.value = null;
    locateOffset.value = null;
    activeCaretIssue.value = null;
});

watch(() => filteredIssues.value, (newIssues) => {
    if (activeCaretIssue.value) {
        const stillExists = newIssues.some((issue) => 
            issue.rule.id === activeCaretIssue.value?.rule.id &&
            issue.line === activeCaretIssue.value?.line &&
            issue.column === activeCaretIssue.value?.column
        );
        if (!stillExists) {
            activeCaretIssue.value = null;
            activeRuleId.value = null;
            locateOffset.value = null;
        }
    }
    if (activeRuleId.value && !newIssues.some((issue) => issue.rule.id === activeRuleId.value)) {
        activeRuleId.value = null;
        locateOffset.value = null;
    }
});
</script>

<template>
    <div class="flex h-screen flex-col bg-[var(--bg-main)] text-[var(--text-main)]">
        <AppHeader />
        <main class="min-h-0 flex-1 overflow-hidden">
            <Transition name="home-state" mode="out-in">
                <HomeInputPanel
                    v-if="!isWorkbench"
                    key="home"
                    v-model="text"
                    :active-regex-rules="registry.regexRules.length"
                    :llm-rules="registry.llmRules.length"
                    @submit="startCheck"
                />
                <div
                    v-else
                    key="workbench"
                    class="analysis-grid flex h-full min-h-0 flex-col md:flex-row"
                    :class="isReportPaneResizing ? 'is-resizing' : ''"
                >
                    <!-- 左：输入与行内高亮 -->
                    <section class="analysis-text-pane min-h-0 flex-1 border-b border-[var(--border-color)] md:border-b-0">
                        <TextPanel
                            ref="textPanel"
                            v-model="text"
                            v-model:scan-all="filters.scanAll"
                            :ranges="highlightRanges"
                            :issues="filteredIssues"
                            :locate-offset="locateOffset"
                            :auto-fix-count="autoFixResult.count"
                            :auto-fix-text="autoFixResult.fixed"
                            :auto-fix-changes="autoFixResult.changes"
                            :active-issue="activeCaretIssue"
                            :original-text="originalText"
                            @caret-click="onCaretClick"
                            @navigate-issue="onNavigateIssue"
                            @rebase-original="onRebaseOriginal"
                            @replacement-applied="onReplacementApplied"
                        />
                    </section>
                    <div
                        ref="reportResizeHandle"
                        class="analysis-resize-handle hidden md:flex"
                        :class="isReportPaneResizing ? 'is-active' : ''"
                        role="separator"
                        aria-orientation="vertical"
                        :tabindex="canResizeWorkbench ? 0 : -1"
                        :aria-valuenow="Math.round(settings.workbenchReportWidth)"
                        :aria-valuemin="Math.round(reportPanelMinWidth)"
                        :aria-valuemax="Math.round(reportPanelMaxWidth)"
                        :title="t('layout.resizeReportPanelTitle')"
                        @keydown="handleReportResizeKeydown"
                    >
                        <span />
                    </div>
                    <!-- 右：过滤 + 汇总 + 结果 + llm 规则 -->
                    <section class="analysis-report-pane flex min-h-0 flex-col md:shrink-0" :style="canResizeWorkbench ? reportPanelStyle : undefined">
                        <FilterControls :filters="filters" :namespace-options="nsOptions" @update:filters="updateFilters" />
                        <SummaryBar
                            :summary="summary"
                            :active-rules="registry.regexRules.length"
                            :hidden="hidden"
                            :rule-settings-hidden="hiddenByRuleSettings"
                            @copy="onCopy"
                            @copy-optimization-prompt="onCopyOptimizationPrompt"
                            @replace-text-from-clipboard="onReplaceTextFromClipboard"
                            @show-hidden="showHiddenIssues"
                            @reset-rule-settings="resetRulesAndReveal"
                        />
                        <div class="min-h-0 flex-1">
                            <IssueList
                                :groups="groups"
                                :has-text="text.trim().length > 0"
                                :hidden="hidden"
                                :rule-settings-hidden="hiddenByRuleSettings"
                                :active-rule-id="activeRuleId"
                                :active-issue-id="activeIssueId"
                                @open-rule="(rule) => (activeRule = rule)"
                                @locate-issue="onListLocate"
                                @apply-issue="onApplyIssue"
                                @show-hidden="showHiddenIssues"
                                @reset-rule-settings="resetRulesAndReveal"
                            />
                        </div>
                        <LlmRulesPanel :rules="registry.llmRules" />
                    </section>
                </div>
            </Transition>
        </main>
        <RuleDetailDialog :rule="activeRule" @close="activeRule = null" />
        <Dialog v-model="replaceFullTextConfirmOpen" :title="t('llm.replaceFullTitle')" show-footer :close-on-overlay="false" width="min(520px, calc(100vw - 32px))" @confirm="confirmReplaceTextFromClipboard">
            <p class="text-sm leading-6 text-[var(--text-secondary)]">{{ t("llm.replaceFullBody") }}</p>
            <template #footer="{ close }">
                <button type="button" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-sm hover:bg-[var(--bg-hover)]" @click="close">{{ t("common.cancel") }}</button>
                <button type="button" class="h-8 rounded-md bg-[var(--accent-main)] px-3 text-sm font-medium text-white hover:opacity-90" @click="confirmReplaceTextFromClipboard">{{ t("llm.replaceFullConfirm") }}</button>
            </template>
        </Dialog>
    </div>
</template>

<style scoped>
.home-state-enter-active,
.home-state-leave-active {
    transition: opacity 0.24s ease, transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
}

.home-state-enter-from {
    opacity: 0;
    transform: translateY(10px) scale(0.985);
}

.home-state-leave-to {
    opacity: 0;
    transform: translateX(-4%) scale(0.985);
}

.analysis-grid {
    animation: analysis-grid-in 0.34s cubic-bezier(0.22, 1, 0.36, 1);
}

.analysis-text-pane {
    animation: analysis-text-dock 0.46s cubic-bezier(0.22, 1, 0.36, 1);
    transform-origin: center left;
}

.analysis-report-pane {
    animation: analysis-report-in 0.38s cubic-bezier(0.22, 1, 0.36, 1) 0.04s both;
}

.analysis-resize-handle {
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

.analysis-resize-handle span {
    width: 2px;
    margin: 10px 0;
    border-radius: 999px;
    background: color-mix(in srgb, var(--border-color) 78%, transparent);
    transition: background-color 0.15s ease, width 0.15s ease;
}

.analysis-resize-handle:hover span,
.analysis-resize-handle.is-active span {
    width: 3px;
    background: var(--accent-main);
}

.analysis-resize-handle:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent-main) 70%, transparent);
    outline-offset: -2px;
}

.analysis-grid.is-resizing {
    user-select: none;
}

.analysis-grid.is-resizing :deep(.llmlint-source-editor-surface textarea) {
    pointer-events: none;
}

@keyframes analysis-grid-in {
    from {
        opacity: 0;
    }
    to {
        opacity: 1;
    }
}

@keyframes analysis-text-dock {
    from {
        opacity: 0.72;
        transform: translateX(26vw) scale(0.94);
    }
    to {
        opacity: 1;
        transform: translateX(0) scale(1);
    }
}

@keyframes analysis-report-in {
    from {
        opacity: 0;
        transform: translateX(18px);
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
}

@media (prefers-reduced-motion: reduce) {
    .home-state-enter-active,
    .home-state-leave-active,
    .analysis-grid,
    .analysis-text-pane,
    .analysis-report-pane {
        animation: none;
        transition: none;
    }
}
</style>
