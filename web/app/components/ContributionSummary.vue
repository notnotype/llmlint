<script setup lang="ts">
// 贡献总结卡（Task 13 W8 G6）：「完成本篇」后的完成态视图——rev 链（复用 LineageStrip）、
// 盲评 vs 终评分数对比、D5 结论、标注条数、感谢语 + 「再传一篇」/「查看数据集」两出口。
// 纯展示组件：全部数据来自 props；「再传一篇」只 emit restart，状态重置由宿主 resetFlow() 执行。
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import type {MessageKey} from "../i18n/messages";
import LineageStrip, {type LineageEntry} from "./LineageStrip.vue";

/** D5 结论枚举（宿主按 verdict 屏 computeds 折算）：pass = 完整口径通过（检测概率腿）；
 *  passDegraded = 降级口径通过（命中腿）；fail = 未完全通过；noBaseline = 无盲评基线仅机器腿可判；
 *  none = 最后一轮未提交复评（本篇不计 D5 结论）。 */
export type SummaryVerdict = "pass" | "passDegraded" | "fail" | "noBaseline" | "none";

const props = defineProps<{
    /** rev 链（按 ordinal 升序，宿主谱系数组直传）。 */
    lineage: LineageEntry[];
    /** 当前 head ordinal（rev 链高亮）。 */
    headOrdinal: number;
    /** 盲评两轴；null = 步① 跳过打分（无盲评基线）。 */
    blindScores: {aiFlavor: number; wantReadOn: number} | null;
    /** 终评两轴（最后一轮复评）；null = 最后一轮未提交复评。 */
    finalScores: {aiFlavor: number; wantReadOn: number} | null;
    /** D5 结论（语义见 SummaryVerdict）。 */
    verdict: SummaryVerdict;
    /** 本次流程内成功提交的 span 标注条数（前端轻量计数，重置归零）。 */
    annotationCount: number;
}>();

const emit = defineEmits<{
    /** 「再传一篇」：宿主原地重置全部流程状态回 draft 屏。 */
    (e: "restart"): void;
}>();

const {t} = useLlmlintI18n();

// D5 结论 → 文案 key（pass 三态复用 verdict 屏标题，口径一致）+ 强调色。
const verdictPresentation: Record<SummaryVerdict, {labelKey: MessageKey; textClass: string}> = {
    pass: {labelKey: "contribute.verdictPassTitle", textClass: "text-emerald-600 dark:text-emerald-400"},
    passDegraded: {labelKey: "contribute.verdictPassTitleDegraded", textClass: "text-emerald-600 dark:text-emerald-400"},
    fail: {labelKey: "contribute.verdictFailTitle", textClass: "text-amber-600 dark:text-amber-400"},
    noBaseline: {labelKey: "contribute.verdictNoBaselineTitle", textClass: "text-amber-600 dark:text-amber-400"},
    none: {labelKey: "contribute.summaryVerdictNone", textClass: "text-[var(--text-muted)]"},
};
</script>

<template>
    <!-- 贡献总结卡：感谢语 + rev 链 + 分数对比/D5/标注 + 双出口 -->
    <div class="mx-auto grid max-w-3xl gap-5 px-4 py-8">
        <!-- 完成头图：图标 + 标题 + 感谢语 -->
        <div class="grid justify-items-center gap-2 text-center">
            <span class="i-lucide-circle-check h-10 w-10 text-emerald-600 dark:text-emerald-400" />
            <h1 class="text-lg font-semibold">{{ t("contribute.summaryTitle") }}</h1>
            <p class="text-sm text-[var(--text-muted)]">{{ t("contribute.summaryThanks") }}</p>
        </div>
        <!-- rev 链（复用谱系进度条） -->
        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-4">
            <LineageStrip :entries="props.lineage" :head-ordinal="props.headOrdinal" />
        </div>
        <!-- 分数对比 + D5 结论 + 标注条数 -->
        <div class="grid gap-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-4 text-sm">
            <div class="font-medium">{{ t("contribute.summaryScoresTitle") }}</div>
            <div class="grid grid-cols-[auto_1fr_1fr] items-center gap-x-6 gap-y-1">
                <span />
                <span class="text-xs text-[var(--text-muted)]">{{ t("contribute.summaryBlindCol") }}</span>
                <span class="text-xs text-[var(--text-muted)]">{{ t("contribute.summaryFinalCol") }}</span>
                <span class="text-[var(--text-muted)]">{{ t("contribute.summaryAiFlavorRow") }}</span>
                <span>{{ props.blindScores ? `${props.blindScores.aiFlavor}/5` : t("contribute.summarySkippedBlind") }}</span>
                <span>{{ props.finalScores ? `${props.finalScores.aiFlavor}/5` : t("contribute.summaryNotRescored") }}</span>
                <span class="text-[var(--text-muted)]">{{ t("contribute.summaryWantReadOnRow") }}</span>
                <span>{{ props.blindScores ? `${props.blindScores.wantReadOn}/5` : t("contribute.summarySkippedBlind") }}</span>
                <span>{{ props.finalScores ? `${props.finalScores.wantReadOn}/5` : t("contribute.summaryNotRescored") }}</span>
            </div>
            <div class="flex items-center justify-between gap-4 border-t border-[var(--border-color)] pt-2">
                <span class="shrink-0 text-[var(--text-muted)]">{{ t("contribute.summaryD5Row") }}</span>
                <span class="text-right" :class="verdictPresentation[props.verdict].textClass">{{ t(verdictPresentation[props.verdict].labelKey) }}</span>
            </div>
            <div class="flex items-center justify-between gap-4">
                <span class="text-[var(--text-muted)]">{{ t("contribute.summaryAnnotationsRow") }}</span>
                <span>{{ t("contribute.summaryAnnotationsValue", {count: props.annotationCount}) }}</span>
            </div>
        </div>
        <!-- 出口：再传一篇（主 CTA）+ 查看数据集（次） -->
        <div class="flex justify-center gap-2">
            <NuxtLink to="/dataset" class="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border-color)] px-4 text-sm hover:bg-[var(--bg-hover)]">
                <span class="i-lucide-database" /> {{ t("contribute.viewDataset") }}
            </NuxtLink>
            <button type="button" class="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--accent-main)] px-4 text-sm font-medium text-white hover:brightness-105" @click="emit('restart')">
                <span class="i-lucide-plus" /> {{ t("contribute.restartButton") }}
            </button>
        </div>
    </div>
</template>
