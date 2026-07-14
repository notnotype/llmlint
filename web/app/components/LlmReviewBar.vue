<script setup lang="ts">
// AI 改写审阅横幅（Task 13 W7 F1 / G5）：整篇改写 diff 化并入草稿后出现在编辑器上方，
// 提供 llm diff 的逐处巡检（上一处 / 下一处）、拒绝该处、已巡检 k/N 进度与关闭。
// 纯展示组件：diff 状态由宿主（contribute.vue）经 TextPanel expose 读写，这里只收数字、发动作。
import {useLlmlintI18n} from "../composables/useLlmlintI18n";

defineProps<{
    /** 当前 llm diff 总数 N（宿主读 TextPanel.getLlmDiffs().length，拒绝 / 吸收合并后实时变化）。 */
    total: number;
    /** 已巡检数 k（宿主按「导航到过的 diff id ∩ 当前队列」计，被拒绝的不再计入）。 */
    visited: number;
}>();

const emit = defineEmits<{
    (e: "navigate", direction: "previous" | "next"): void;
    (e: "reject"): void;
    (e: "close"): void;
}>();

const {t} = useLlmlintI18n();
</script>

<template>
    <!-- AI 改写审阅横幅：标题 + 巡检进度 + 上一处/下一处/拒绝该处/关闭 -->
    <div class="flex flex-wrap items-center gap-2 border-b border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 py-2 text-xs">
        <span class="i-lucide-bot h-3.5 w-3.5 text-[var(--accent-main)]" />
        <span class="font-medium">{{ t("contribute.llmReviewTitle", {count: total}) }}</span>
        <span class="text-[var(--text-muted)]">{{ t("contribute.llmReviewVisited", {visited, total}) }}</span>
        <div class="ml-auto flex items-center gap-1.5">
            <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-color)] px-2 hover:bg-[var(--bg-hover)]" @click="emit('navigate', 'previous')">
                <span class="i-lucide-chevron-up h-3.5 w-3.5" /> {{ t("contribute.llmReviewPrevious") }}
            </button>
            <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-color)] px-2 hover:bg-[var(--bg-hover)]" @click="emit('navigate', 'next')">
                <span class="i-lucide-chevron-down h-3.5 w-3.5" /> {{ t("contribute.llmReviewNext") }}
            </button>
            <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-red-500/40 px-2 text-red-600 hover:bg-red-500/10 dark:text-red-400" @click="emit('reject')">
                <span class="i-lucide-x h-3.5 w-3.5" /> {{ t("contribute.llmReviewReject") }}
            </button>
            <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-[var(--bg-hover)]" :title="t('common.close')" :aria-label="t('common.close')" @click="emit('close')">
                <span class="i-lucide-x h-3.5 w-3.5 text-[var(--text-muted)]" />
            </button>
        </div>
    </div>
</template>
