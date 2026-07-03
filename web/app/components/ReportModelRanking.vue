<script setup lang="ts">
import {computed} from "vue";
import type {ModelRank} from "../report-types";

// 模型排名条形榜：docScore 中位越低越像人；置顶画人类基线行作对照。
const props = defineProps<{ranking: ModelRank[]; humanScore: number}>();
const max = computed(() => Math.max(...props.ranking.map((model) => model.medianScore), props.humanScore, 1));
const pct = (value: number): string => `${(value / max.value) * 100}%`;
</script>

<template>
    <section class="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 class="mb-3 text-sm font-semibold">模型排名 <span class="font-normal text-zinc-500">（docScore 中位，越低越像人）</span></h2>
        <div class="space-y-2">
            <!-- 人类基线行（对照） -->
            <div class="grid grid-cols-[minmax(0,13rem)_1fr] items-center gap-3">
                <div class="truncate text-xs font-semibold text-red-600 dark:text-red-400">人类基线</div>
                <div class="relative h-5 rounded bg-zinc-100 dark:bg-zinc-800">
                    <div class="absolute inset-y-0 left-0 rounded bg-red-400/60" :style="{width: pct(humanScore)}" />
                    <span class="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold">{{ humanScore.toFixed(2) }}</span>
                </div>
            </div>
            <!-- 各模型行 -->
            <div v-for="model in ranking" :key="model.model" class="grid grid-cols-[minmax(0,13rem)_1fr] items-center gap-3">
                <div class="truncate font-mono text-xs" :title="model.model">{{ model.model }} <span class="text-zinc-500">n={{ model.sampleCount }}</span></div>
                <div class="relative h-5 rounded bg-zinc-100 dark:bg-zinc-800">
                    <div class="absolute inset-y-0 left-0 rounded bg-gradient-to-r from-emerald-300 to-amber-400" :style="{width: pct(model.medianScore)}" />
                    <span class="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold">{{ model.medianScore.toFixed(2) }}</span>
                </div>
            </div>
        </div>
        <p class="mt-2 text-xs text-zinc-500">条越短越像人；越接近人类基线 = 越难被检测（注意样本数 n）。</p>
    </section>
</template>
