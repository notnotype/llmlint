<script setup lang="ts">
// 检测报告 tab（Task 15 P0-A 建立，Task 17 工单 D 改版为测速网站式报告，纯展示组件）：
// ① rev0 未揭示 → 整个 tab 只显示盲评卡（打分/跳过，D2：提交前不渲染任何机器结果，服务端 revealedAt 闸门本就强制）；
// ② 揭示后 → 综合分主卡置顶（0-100「AI 味指数」色环 + 等级词 + 白话汇总；scan 未到时显示检测中动画；
//    缺检测器降级为规则面分并注明——拍板②推翻 Task 15「不合成综合分」）
//    + 检测进程小状态行（三路图标+文字）+ 分项指标卡（规则命中/命中密度/每检测器 AI 概率+热力条）
//    + LLM 评审卡骨架（工单 C 接线前显示等待行）；
// ③ 查看 rev_k(k≥1) → 追加「与 rev0 对比」+ 复评四维（reveal 先行，blind=false 自洽）+ D5 三态；
// ④ 「完成本篇」出口（W8 总结卡语义保留，宿主切 done）。
// 流程状态与全部 POST 由宿主承担；本组件只有表单局部值 + emit。
import {computed, ref, watch} from "vue";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import type {AnalysisChannel, AnalysisStatus} from "#shared/analysis";
import {computeD5Legs, pAiPercent, type BlindScores, type PostJudgment, type ScanHitsSummary, type WorkspaceRevision} from "../utils/contribute-workspace";

const props = defineProps<{
    /** rev0 是否已揭示（盲评已交或已跳过）；false 时整个 tab 只渲染盲评卡。 */
    revealed: boolean;
    /** 当前查看版本（版本条 activeOrdinal 对应条目）。 */
    active: WorkspaceRevision | null;
    /** rev0 基线（对比与 D5 恒锚定 rev0）。 */
    rev0: WorkspaceRevision | null;
    /** 盲评两轴快照；null = 跳过打分（无盲评基线）。 */
    blindScores: BlindScores | null;
    /**
     * 当前查看版本的白话汇总统计（Task 16 R8，宿主用 summarizeScanHits 算好传入）。
     * null = 该版 scan 未到（汇总行不渲染）；strongHits 为 null = 报告缺失（强判别行不显示）。
     */
    scanSummary: ScanHitsSummary | null;
    /** 宿主请求进行中（盲评提交 / 复评提交共用 loading）。 */
    submitting: boolean;
    /** AI 改写等待中：锁「完成本篇」出口（W7 离场纪律——在途结果无人收尾会跨篇泄漏，须先等完或取消）。 */
    llmFixRunning: boolean;
}>();

const emit = defineEmits<{
    /** 提交盲评两轴（宿主 POST judgment → reveal）。 */
    (e: "blind-submit", scores: BlindScores): void;
    /** 跳过打分直接揭示（宿主直接 reveal，本篇无盲评基线）。 */
    (e: "blind-skip"): void;
    /** 提交当前查看 rev_k 的复评四维（宿主 POST 后写回该版 judgment）。 */
    (e: "judgment-submit", payload: PostJudgment): void;
    (e: "detector-retry"): void;
    (e: "detector-cancel"): void;
    (e: "llm-retry"): void;
    (e: "llm-cancel"): void;
    /** 「完成本篇」：宿主切完成态总结卡。 */
    (e: "finish"): void;
}>();

const {t} = useLlmlintI18n();

// —— 盲评卡表单（rev0，blind=true；D2 采集点） ——
const blindAiFlavor = ref(3);
const blindWantReadOn = ref(3);

// —— 复评四维表单（rev_k；每次切换查看版本时从该版已提交值或盲评基线重置） ——
const postAiFlavor = ref(3);
const postWantReadOn = ref(3);
const improvementScore = ref(3);
const postComment = ref("");

/** 该版是否已在本会话提交过复评（提交后表单锁定展示已提交值）。 */
const judgmentSubmitted = computed(() => props.active?.judgment != null);

// 切换查看版本（或提交成功写回 judgment）时同步表单：已提交值 > 盲评基线 > 默认 3。
watch(() => [props.active?.ordinal, props.active?.judgment] as const, () => {
    const judgment = props.active?.judgment ?? null;
    postAiFlavor.value = judgment?.aiFlavor ?? props.blindScores?.aiFlavor ?? 3;
    postWantReadOn.value = judgment?.wantReadOn ?? props.blindScores?.wantReadOn ?? 3;
    improvementScore.value = judgment?.improvementScore ?? 3;
    postComment.value = judgment?.comment ?? "";
}, {immediate: true});

/** 是否查看 rev_k(k≥1)：对比卡 / 复评 / D5 只在此时出现。 */
const isRevK = computed(() => (props.active?.ordinal ?? 0) >= 1);

// D5 各腿（口径与 Task 13 verdict 屏一字不差；rev0 视图恒 null）。
const legs = computed(() => {
    if (!props.active || !props.rev0 || !isRevK.value) {
        return null;
    }
    return computeD5Legs(props.rev0, props.active, props.blindScores, props.active.judgment);
});
// D5 通过 = 复评已交 且 机器腿过 且 想追更未降（无基线 = 第三态，不冒充通过/失败）。
const verdictPass = computed(() => judgmentSubmitted.value && legs.value !== null && legs.value.machineLegPass && legs.value.wantReadOnKept === true);

// 多维卡命中分级统计（服务器扫描 hits 的 level 计数；本地过滤视图不参与——报告 tab 用落库真相）。
const hitLevelCounts = computed(() => {
    const counts = {high: 0, medium: 0, low: 0};
    for (const hit of props.active?.scan?.hits ?? []) {
        if (hit.level === "high" || hit.level === "medium" || hit.level === "low") {
            counts[hit.level] += 1;
        }
    }
    return counts;
});

/** LLM 评审结果（工单 C 随 WorkspaceRevision 落库带出）；null = 未 reveal / 异步未到 / 通道未配置（卡内显示等待行）。 */
const llmReview = computed(() => props.active?.llmReview ?? null);
const analysis = computed(() => props.active?.analysis ?? null);
const retryableStatuses: AnalysisStatus[] = ["failed", "cancelled", "interrupted"];

/** 三卡统一状态文案。 */
function statusLabel(status: AnalysisStatus): string {
    if (status === "waiting") return t("contribute.channelWaiting");
    if (status === "running") return t("contribute.channelRunning");
    if (status === "completed") return t("contribute.channelCompleted");
    if (status === "failed") return t("contribute.channelFailed");
    if (status === "cancelled") return t("contribute.channelCancelled");
    if (status === "interrupted") return t("contribute.channelInterrupted");
    return t("contribute.channelUnavailable");
}

function statusIcon(status: AnalysisStatus): string {
    if (status === "running") return "i-lucide-loader-circle animate-spin";
    if (status === "completed") return "i-lucide-circle-check text-[var(--success-text)]";
    if (status === "failed") return "i-lucide-circle-x text-[var(--danger-text)]";
    if (status === "cancelled" || status === "interrupted") return "i-lucide-circle-pause text-[var(--warning-text)]";
    return "i-lucide-circle-dashed text-[var(--text-muted)]";
}

function canRetry(channel: AnalysisChannel): boolean {
    return retryableStatuses.includes(channel.status);
}

function cancelChannel(key: string): void {
    if (key === "detector") emit("detector-cancel");
    else emit("llm-cancel");
}

function retryChannel(key: string): void {
    if (key === "detector") emit("detector-retry");
    else emit("llm-retry");
}

function riskLabel(score: number | null): string {
    if (score === null) return "";
    if (score >= 75) return t("contribute.riskHigh");
    if (score >= 50) return t("contribute.riskElevated");
    if (score >= 25) return t("contribute.riskModerate");
    return t("contribute.riskLow");
}

/** 提交复评：把表单值打包上抛（宿主 POST /api/judgments，目标 = 当前查看 rev_k）。 */
function submitJudgment(): void {
    emit("judgment-submit", {aiFlavor: postAiFlavor.value, wantReadOn: postWantReadOn.value, improvementScore: improvementScore.value, comment: postComment.value});
}
</script>

<template>
    <div class="min-h-0 flex-1 overflow-auto">
        <!-- ═══ 盲评卡（rev0 未揭示时整个 tab 只有它，D2） ═══ -->
        <div v-if="!props.revealed" class="grid gap-4 p-4">
            <div class="grid gap-4 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-4">
                <div class="text-sm font-medium">{{ t("contribute.blindCardTitle") }}</div>
                <div class="text-xs text-[var(--text-muted)]">{{ t("contribute.blindHint") }}</div>
                <label class="grid gap-2">
                    <span class="text-sm font-medium">{{ t("contribute.aiFlavorLabel", {count: blindAiFlavor}) }}</span>
                    <input v-model.number="blindAiFlavor" type="range" min="0" max="5" step="1">
                    <div class="flex justify-between text-xs text-[var(--text-muted)]"><span>{{ t("contribute.aiFlavorLow") }}</span><span>{{ t("contribute.aiFlavorHigh") }}</span></div>
                </label>
                <label class="grid gap-2">
                    <span class="text-sm font-medium">{{ t("contribute.wantReadOnLabel", {count: blindWantReadOn}) }}</span>
                    <input v-model.number="blindWantReadOn" type="range" min="0" max="5" step="1">
                    <div class="flex justify-between text-xs text-[var(--text-muted)]"><span>{{ t("contribute.wantReadOnLow") }}</span><span>{{ t("contribute.wantReadOnHigh") }}</span></div>
                </label>
                <div class="flex items-center justify-end gap-3">
                    <!-- G3 主 CTA 纪律：跳过降为文字链接，「提交盲评」是唯一主按钮 -->
                    <button type="button" class="text-sm text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text-main)] hover:underline disabled:opacity-60" :disabled="props.submitting" @click="emit('blind-skip')">{{ t("contribute.skipBlindReview") }}</button>
                    <button type="button" class="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--accent-main)] px-4 text-sm font-medium text-white hover:brightness-105 disabled:opacity-60" :disabled="props.submitting" @click="emit('blind-submit', {aiFlavor: blindAiFlavor, wantReadOn: blindWantReadOn})">
                        <span class="i-lucide-eye-off" />
                        <span>{{ props.submitting ? t("contribute.submitting") : t("contribute.submitBlindReview") }}</span>
                    </button>
                </div>
            </div>
        </div>
        <!-- ═══ 揭示后：当前查看版本的检测报告 ═══ -->
        <div v-else-if="props.active" class="grid gap-4 p-4">
            <!-- 三维主评分：三张卡同权展示，综合分降为次级汇总。 -->
            <div class="grid gap-3 text-sm">
                <!-- 初读打分回显注脚（rev0 视图顶部）：已保存分数 / 已跳过（渲染条件与原孤行一致） -->
                <div v-if="!isRevK" class="flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]">
                    <template v-if="props.blindScores">
                        <span>{{ t("contribute.blindReviewSavedTitle") }}</span>
                        <span>{{ t("contribute.aiFlavorScore", {score: props.blindScores.aiFlavor}) }}</span>
                        <span>{{ t("contribute.wantReadOnScore", {score: props.blindScores.wantReadOn}) }}</span>
                    </template>
                    <span v-else>{{ t("contribute.blindSkippedTitle") }}</span>
                </div>
                <div class="flex items-center gap-2 rounded-md border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2 text-xs text-[var(--warning-text)]"><span class="i-lucide-triangle-alert" />{{ t("contribute.riskDirectionNote") }}</div>
                <div v-if="analysis" class="grid gap-3 lg:grid-cols-3">
                    <div v-for="card in [{key:'rules', title:t('contribute.processEngine'), channel:analysis.rules}, {key:'detector', title:t('contribute.processDetector'), channel:analysis.detector}, {key:'llm', title:t('contribute.processLlmJudge'), channel:analysis.llm}]" :key="card.key" class="grid min-h-36 content-between gap-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-4">
                        <div class="flex items-start justify-between gap-2">
                            <div class="min-w-0">
                                <div class="font-medium">{{ card.title }}</div>
                                <div class="mt-0.5 text-xs font-medium text-[var(--danger-text)]">{{ t("contribute.riskIndex") }}</div>
                                <div class="mt-1 flex items-center gap-1.5 text-xs text-[var(--text-muted)]"><span class="h-3.5 w-3.5" :class="statusIcon(card.channel.status)" />{{ statusLabel(card.channel.status) }}</div>
                            </div>
                            <div v-if="card.channel.score !== null" class="grid justify-items-center gap-0.5"><ScoreRing :score="card.channel.score" compact /><span class="text-[10px] font-medium text-[var(--text-muted)]">{{ riskLabel(card.channel.score) }}</span></div>
                            <div v-else class="text-3xl font-semibold tabular-nums">—</div>
                        </div>
                        <div class="grid gap-2">
                            <div v-if="card.channel.error" class="line-clamp-2 text-xs text-[var(--danger-text)]">{{ card.channel.error }}</div>
                            <div v-if="card.key === 'rules' && props.scanSummary" class="text-xs text-[var(--text-muted)]">{{ t("contribute.summaryHitsLine", {total: props.scanSummary.total, high: props.scanSummary.byLevel.high, medium: props.scanSummary.byLevel.medium, low: props.scanSummary.byLevel.low}) }}</div>
                            <div v-if="card.key === 'llm' && analysis.llm.confidence !== null" class="text-xs text-[var(--text-muted)]">{{ t("contribute.llmConfidence", {percent: Math.round(analysis.llm.confidence * 100)}) }}</div>
                            <div v-if="card.key !== 'rules'" class="flex justify-end gap-2">
                                <button v-if="card.channel.status === 'running'" type="button" class="h-7 rounded-md border border-[var(--border-color)] px-2 text-xs hover:bg-[var(--bg-hover)]" @click="cancelChannel(card.key)">{{ t("common.cancel") }}</button>
                                <button v-if="canRetry(card.channel)" type="button" class="h-7 rounded-md border border-[var(--border-color)] px-2 text-xs hover:bg-[var(--bg-hover)]" @click="retryChannel(card.key)">{{ t("common.retry") }}</button>
                                <button v-if="card.key === 'llm' && card.channel.status === 'completed'" type="button" class="h-7 rounded-md border border-[var(--border-color)] px-2 text-xs hover:bg-[var(--bg-hover)]" @click="retryChannel(card.key)">{{ t("contribute.rerunReview") }}</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div v-if="analysis" class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] px-4 py-3">
                    <div>
                        <span class="font-medium">{{ t("contribute.compositeRisk") }}</span>
                        <span class="ml-2 text-xs text-[var(--text-muted)]">{{ t(analysis.composite.complete ? "contribute.compositeComplete" : "contribute.compositePartial") }}</span>
                    </div>
                    <div class="text-right"><div class="text-xl font-semibold tabular-nums" :style="analysis.composite.score !== null ? {color:`hsl(${Math.round(120 * (1 - analysis.composite.score / 100))}, 75%, 42%)`} : undefined">{{ analysis.composite.score ?? "—" }}<span v-if="analysis.composite.score !== null" class="text-xs"> / 100</span></div><div v-if="analysis.composite.score !== null" class="text-xs text-[var(--text-muted)]">{{ riskLabel(analysis.composite.score) }}</div></div>
                </div>
            </div>
            <!-- ═══ 「详细数据」分组（UX 工单 B）：原生 details 折叠，含分项指标 + LLM 评审两张无边框子卡 ═══ -->
            <details open class="group grid gap-3">
                <summary class="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
                    <span class="i-lucide-chevron-right h-4 w-4 shrink-0 transition-transform group-open:rotate-90" />
                    <span>{{ t("contribute.metricsTitle", {ordinal: props.active.ordinal}) }}</span>
                </summary>
                <!-- 分项指标子卡：规则命中 / 命中密度 / 每检测器 AI 概率 + 热力条（原始口径，综合分仅参考） -->
                <div class="mt-3 grid gap-2 rounded-md bg-[var(--bg-subtle)] p-4 text-sm">
                    <div class="text-xs text-[var(--text-muted)]">{{ t("contribute.metricsNote") }}</div>
                <div class="flex items-center justify-between gap-4">
                    <span class="text-[var(--text-muted)]">{{ t("contribute.verdictHitsRow") }}</span>
                    <span>{{ props.active.scan ? t("contribute.hitSummary", {total: props.active.scan.hits.length, high: hitLevelCounts.high, medium: hitLevelCounts.medium, low: hitLevelCounts.low}) : "—" }}</span>
                </div>
                <div class="flex items-center justify-between gap-4">
                    <span class="text-[var(--text-muted)]">{{ t("contribute.docScoreRow") }}</span>
                    <span>{{ props.active.scan ? props.active.scan.docScore.toFixed(1) : "—" }}</span>
                </div>
                <!-- docScore 白话口径（R8）：去重命中每千字，低≈干净；规则面指标不等于 AI 概率 -->
                <div class="text-xs text-[var(--text-muted)]">{{ t("contribute.docScoreExplain") }}</div>
                <!-- 每检测器一行 + 热力缩略条（Task 15 P1-C：分块 P(AI) 梯度横条，hover 显块概率）；无数据时按轮询/缺省注明 -->
                <template v-if="props.active.detects.length > 0">
                    <div v-for="detect in props.active.detects" :key="detect.id" class="grid gap-1.5">
                        <div class="flex items-center justify-between gap-4">
                            <span class="text-[var(--text-muted)]">{{ t("contribute.detectCompareRow") }}</span>
                            <span>{{ t("contribute.detectPAi", {percent: pAiPercent(detect.docPAi), name: detect.detectorName}) }}</span>
                        </div>
                        <DetectHeatStrip v-if="detect.chunks.length > 0" :chunks="detect.chunks" :title="t('contribute.heatmapStripTitle')" />
                    </div>
                    <!-- P(AI) 白话口径（R8）：外部神经检测器的整篇概率 + 色条含义 -->
                    <div class="text-xs text-[var(--text-muted)]">{{ t("contribute.detectExplain") }}</div>
                </template>
                <div v-else class="text-xs text-[var(--text-muted)]">{{ t(props.active.detectState === "polling" ? "contribute.detectPending" : "contribute.detectUnavailable") }}</div>
            </div>
                <!-- LLM Agent 结构化报告：分数只在主卡展示，正文聚焦结论、证据与建议。 -->
                <div class="grid gap-2 rounded-md bg-[var(--bg-subtle)] p-4 text-sm">
                <div class="font-medium">{{ t("contribute.llmReviewCardTitle") }}</div>
                <template v-if="llmReview">
                    <div class="text-xs text-[var(--text-muted)]">{{ t("contribute.llmReviewModelLine", {model: llmReview.model, count: llmReview.hits.length}) }}</div>
                    <div>{{ llmReview.report.conclusion }}</div>
                    <div v-if="llmReview.report.evidence.length > 0" class="grid gap-2 border-t border-[var(--border-color)] pt-2">
                        <div class="text-xs font-medium">{{ t("contribute.llmEvidenceTitle") }}</div>
                        <div v-for="(evidence, index) in llmReview.report.evidence" :key="index" class="grid gap-0.5 text-xs">
                            <div class="text-[var(--text-muted)]">「{{ evidence.quote }}」</div><div>{{ evidence.reason }}</div>
                        </div>
                    </div>
                    <div class="grid gap-1 border-t border-[var(--border-color)] pt-2 text-xs"><div class="font-medium">{{ t("contribute.llmSuggestionsTitle") }}</div><div v-for="suggestion in llmReview.report.suggestions" :key="suggestion">· {{ suggestion }}</div></div>
                    <div v-if="llmReview.hits.length === 0" class="text-xs text-[var(--text-muted)]">{{ t("contribute.llmReviewNoHits") }}</div>
                    <details v-if="llmReview.hits.length > 0" class="border-t border-[var(--border-color)] pt-2"><summary class="cursor-pointer text-xs font-medium">{{ t("contribute.llmHitsDetail", {count: llmReview.hits.length}) }}</summary><div v-for="(hit, index) in llmReview.hits" :key="index" class="mt-2 grid gap-0.5"><div class="text-xs font-medium">{{ hit.ruleId }}</div><div class="text-xs text-[var(--text-muted)]">「{{ hit.quote }}」</div><div class="text-xs">{{ hit.reason }}</div></div></details>
                </template>
                <div v-else class="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                    <span class="i-lucide-circle-dashed h-3.5 w-3.5 shrink-0" />
                    <span>{{ t("contribute.llmReviewWaitingNote") }}</span>
                </div>
                </div>
            </details>
            <!-- ═══ 行动区（仅 rev_k(k≥1)）：分组标题 + 与 rev0 对比 + 复评四维 + D5 ═══ -->
            <template v-if="isRevK && legs && props.rev0">
                <!-- 行动区分组标题 -->
                <div class="text-sm font-medium">{{ t("contribute.actionGroupTitle") }}</div>
                <!-- 与 rev0 对比（基线恒定 rev0） -->
                <div class="grid gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-4 text-sm">
                    <div class="font-medium">{{ t("contribute.compareWithRev0", {ordinal: props.active.ordinal}) }}</div>
                    <div class="text-xs text-[var(--text-muted)]">{{ t("contribute.compareExplain") }}</div>
                    <div class="flex items-center justify-between gap-4">
                        <span class="text-[var(--text-muted)]">{{ t("contribute.verdictHitsRow") }}</span>
                        <span>{{ t("contribute.verdictCompareValue", {before: legs.rev0Hits, after: legs.revHits}) }} <span :class="legs.hitsDown ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'">{{ legs.hitsDown ? t("contribute.hitsDown") : t("contribute.hitsNotDown") }}</span></span>
                    </div>
                    <div v-if="props.rev0.scan && props.active.scan" class="flex items-center justify-between gap-4">
                        <span class="text-[var(--text-muted)]">{{ t("contribute.docScoreRow") }}</span>
                        <span>{{ props.rev0.scan.docScore.toFixed(1) }} → {{ props.active.scan.docScore.toFixed(1) }}</span>
                    </div>
                    <!-- 外部检测器 P(AI) 对比（D5 检测概率腿）：两端同口径才可比；缺端按轮询/缺省注明 -->
                    <div v-if="legs.detectPair" class="flex items-center justify-between gap-4">
                        <span class="text-[var(--text-muted)]">{{ t("contribute.detectCompareRow") }}</span>
                        <span>{{ t("contribute.detectCompareValue", {before: pAiPercent(legs.detectPair.before.docPAi), after: pAiPercent(legs.detectPair.after.docPAi)}) }} <span :class="legs.detectorDown ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'">{{ legs.detectorDown ? t("contribute.detectDown") : t("contribute.detectNotDown") }}</span></span>
                    </div>
                    <div v-else class="text-xs text-[var(--text-muted)]">{{ t(props.rev0.detectState === "polling" || props.active.detectState === "polling" ? "contribute.detectComparePending" : "contribute.detectCompareUnavailable") }}</div>
                </div>
                <!-- 复评四维（非盲：reveal 先行，blind=false 自洽；improvementScore 仅 rev_k 合法） -->
                <div class="grid gap-4 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-4">
                    <div class="text-sm font-medium">{{ t("contribute.postJudgmentTitle", {ordinal: props.active.ordinal}) }}</div>
                    <div class="text-xs text-[var(--text-muted)]">{{ t("contribute.postJudgmentHint") }}</div>
                    <label class="grid gap-2">
                        <span class="text-sm">{{ t("contribute.postAiFlavorLabel", {score: postAiFlavor}) }}{{ props.blindScores ? t("contribute.blindBaselineRef", {score: props.blindScores.aiFlavor}) : t("contribute.noBlindBaseline") }}</span>
                        <input v-model.number="postAiFlavor" type="range" min="0" max="5" step="1" :disabled="judgmentSubmitted">
                    </label>
                    <label class="grid gap-2">
                        <span class="text-sm">{{ t("contribute.postWantReadOnLabel", {score: postWantReadOn}) }}{{ props.blindScores ? t("contribute.blindBaselineRef", {score: props.blindScores.wantReadOn}) : t("contribute.noBlindBaseline") }}</span>
                        <input v-model.number="postWantReadOn" type="range" min="0" max="5" step="1" :disabled="judgmentSubmitted">
                    </label>
                    <label class="grid gap-2">
                        <span class="text-sm">{{ t("contribute.improvementLabel", {score: improvementScore}) }}</span>
                        <input v-model.number="improvementScore" type="range" min="0" max="5" step="1" :disabled="judgmentSubmitted">
                        <div class="flex justify-between text-xs text-[var(--text-muted)]"><span>{{ t("contribute.improvementLow") }}</span><span>{{ t("contribute.improvementHigh") }}</span></div>
                    </label>
                    <label class="grid gap-2">
                        <span class="text-sm">{{ t("contribute.commentLabel") }}</span>
                        <textarea v-model="postComment" class="min-h-20 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-sm outline-none focus:border-[var(--accent-main)]" :placeholder="t('contribute.commentPlaceholder')" maxlength="4000" :disabled="judgmentSubmitted" />
                    </label>
                    <button type="button" class="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--accent-main)] px-4 text-sm font-medium text-white hover:brightness-105 disabled:opacity-60" :disabled="props.submitting || judgmentSubmitted" @click="submitJudgment">
                        <span class="i-lucide-check" /> {{ judgmentSubmitted ? t("contribute.postJudgmentSavedButton") : (props.submitting ? t("contribute.committing") : t("contribute.submitPostJudgment")) }}
                    </button>
                </div>
                <!-- D5 三态结果：通过（检测概率腿/降级命中腿注明口径）/ 未通过 / 无盲评基线（人评腿不可判） -->
                <div v-if="judgmentSubmitted" class="rounded-md border p-4 text-sm" :class="verdictPass ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10'">
                    <div class="font-medium">{{ legs.wantReadOnKept === null ? t("contribute.verdictNoBaselineTitle") : (verdictPass ? t(legs.detectorDown !== null ? "contribute.verdictPassTitle" : "contribute.verdictPassTitleDegraded") : t("contribute.verdictFailTitle")) }}</div>
                    <div class="mt-1 text-xs text-[var(--text-muted)]">{{ t("contribute.verdictDetail", {
                        machine: legs.detectPair ? t(legs.detectorDown ? "contribute.verdictDetectorLowered" : "contribute.verdictDetectorNotLowered", {before: pAiPercent(legs.detectPair.before.docPAi), after: pAiPercent(legs.detectPair.after.docPAi)}) : t(legs.hitsDown ? "contribute.verdictHitsLowered" : "contribute.verdictHitsNotLowered"),
                        want: legs.wantReadOnKept === null ? t("contribute.verdictWantNoBaseline") : (legs.wantReadOnKept ? t("contribute.verdictWantKept") : t("contribute.verdictWantDropped")),
                        scope: t(legs.detectorDown !== null ? "contribute.verdictScopeDetector" : "contribute.verdictScopeHitsFallback"),
                    }) }}</div>
                </div>
            </template>
            <!-- 「完成本篇」出口（G6 总结卡语义保留）：复评通过/无基线三态 → 主按钮；未通过 → 次按钮 + 继续润色提示。
                 AI 改写等待期禁用（W7 离场纪律）：finish 后无人收尾在途 job，结果会泄漏进下一篇 -->
            <div class="grid gap-2">
                <div v-if="isRevK && judgmentSubmitted && legs && legs.wantReadOnKept !== null && !verdictPass" class="text-xs text-[var(--text-muted)]">{{ t("contribute.continueHint") }}</div>
                <div v-if="props.llmFixRunning" class="text-right text-xs text-[var(--text-muted)]">{{ t("contribute.finishLlmFixRunning") }}</div>
                <div class="flex justify-end">
                    <button type="button" class="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60" :class="isRevK && judgmentSubmitted && !(legs && legs.wantReadOnKept !== null && !verdictPass) ? 'bg-[var(--accent-main)] font-medium text-white hover:brightness-105' : 'border border-[var(--border-color)] hover:bg-[var(--bg-hover)]'" :disabled="props.llmFixRunning" :title="props.llmFixRunning ? t('contribute.finishLlmFixRunning') : undefined" @click="emit('finish')">
                        <span class="i-lucide-flag" /> {{ t("contribute.finishButton") }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
