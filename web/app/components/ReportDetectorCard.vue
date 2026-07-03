<script setup lang="ts">
import type {DetectorStat} from "../report-types";

// AI 检测器卡片：AUC 条 + docScore 人类/AI + 误杀率。auc=null 时降级显示（无 AI render）。
defineProps<{detector: DetectorStat}>();
</script>

<template>
    <section class="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 class="mb-3 text-sm font-semibold">AI 检测器</h2>
        <template v-if="detector.auc === null">
            <p class="text-sm text-zinc-500">ROC-AUC：—（需要 AI render）。人类 docScore 中位 <b class="text-zinc-800 dark:text-zinc-100">{{ detector.humanMedianScore.toFixed(2) }}</b>（去重 span/千字）。</p>
            <p class="mt-1 text-sm text-zinc-500">人类侧 agent 桶误杀率：{{ detector.humanAgentFalseRate.toFixed(2) }} /千字。</p>
        </template>
        <template v-else>
            <!-- AUC 大数字 + 进度条（0.5 随机线） -->
            <div class="mb-3">
                <div class="text-3xl font-bold text-blue-600 dark:text-blue-400">{{ detector.auc.toFixed(3) }}</div>
                <div class="relative mt-1 h-3 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
                    <div class="absolute inset-y-0 left-0 rounded bg-gradient-to-r from-blue-300 to-blue-600" :style="{width: (detector.auc * 100) + '%'}" />
                    <span class="absolute top-0 h-3 w-px bg-zinc-400" style="left:50%" title="0.5=随机" />
                </div>
                <div class="mt-1 text-xs text-zinc-500">ROC-AUC（越接近 1 越能区分 AI/人；0.5=随机）</div>
            </div>
            <!-- 四个统计块 -->
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div class="rounded border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900">
                    <div class="text-lg font-bold">{{ detector.humanMedianScore.toFixed(2) }}</div>
                    <div class="text-xs text-zinc-500">人类 docScore 中位</div>
                </div>
                <div class="rounded border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900">
                    <div class="text-lg font-bold">{{ detector.aiMedianScore.toFixed(2) }}</div>
                    <div class="text-xs text-zinc-500">AI docScore 中位</div>
                </div>
                <div class="rounded border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900">
                    <div class="text-lg font-bold">{{ detector.humanAgentFalseRate.toFixed(2) }}</div>
                    <div class="text-xs text-zinc-500">人类误杀基线 /千字</div>
                </div>
                <div class="rounded border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900">
                    <div class="text-lg font-bold">{{ detector.aiAgentRate.toFixed(2) }}</div>
                    <div class="text-xs text-zinc-500">AI agent 桶率 /千字</div>
                </div>
            </div>
            <p class="mt-2 text-xs text-zinc-500">docScore = 去重 span/千字（文档负担口径）；误杀基线 = agent 可见规则在人类正文上的命中率。</p>
        </template>
    </section>
</template>
