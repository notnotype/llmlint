<script setup lang="ts">
import type {HoldoutStat} from "../report-types";

// Holdout 泛化校验卡片：train/test 两侧 AUC。
defineProps<{holdout: HoldoutStat}>();
const fmt = (auc: number | null): string => (auc === null ? "—" : auc.toFixed(3));
</script>

<template>
    <section class="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 class="mb-3 text-sm font-semibold">Holdout 泛化校验</h2>
        <div class="grid grid-cols-3 gap-2">
            <div class="rounded border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900">
                <div class="text-lg font-bold">{{ fmt(holdout.trainAuc) }}</div>
                <div class="text-xs text-zinc-500">train AUC（{{ holdout.trainGroups }} 组）</div>
            </div>
            <div class="rounded border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900">
                <div class="text-lg font-bold">{{ fmt(holdout.testAuc) }}</div>
                <div class="text-xs text-zinc-500">test AUC（{{ holdout.testGroups }} 组）</div>
            </div>
            <div class="rounded border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900">
                <div class="text-lg font-bold">{{ holdout.ratio }}</div>
                <div class="text-xs text-zinc-500">test 占比</div>
            </div>
        </div>
        <p class="mt-2 text-xs text-zinc-500">按 genre/plotId 确定性切；规则/裁决只在 train 拟合。test 接近 train ⇒ 分离稳、非过拟某几组；掉得多 ⇒ 判别不泛化。</p>
    </section>
</template>
