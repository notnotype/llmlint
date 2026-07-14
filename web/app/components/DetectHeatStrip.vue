<script setup lang="ts">
// 热力缩略条（Task 15 P1-C，报告 tab 多维卡每检测器行下）：横条按 chunk span 长度分段、
// 按块 P(AI) 梯度着色（绿→红），hover 显该块概率。纯展示组件，坐标语义只用于宽度比例。
import {computed} from "vue";
import {heatColor, pAiPercent} from "../utils/contribute-workspace";

const props = defineProps<{
    /** 检测器分块结果（MachineDetect.chunks；span = 该版 body 的 UTF-16 半开区间）。 */
    chunks: Array<{span: {start: number; end: number}; pAi: number}>;
}>();

// 总长度（宽度比例分母）；空块防零除按 1 计。
const totalLength = computed(() => props.chunks.reduce((sum, chunk) => sum + Math.max(1, chunk.span.end - chunk.span.start), 0));

/** 单块宽度百分比（按 span 字数占比）。 */
function chunkWidth(chunk: {span: {start: number; end: number}}): string {
    return `${((Math.max(1, chunk.span.end - chunk.span.start) / totalLength.value) * 100).toFixed(2)}%`;
}
</script>

<template>
    <!-- 热力缩略条：分段着色横条（宽度∝块字数，色相∝P(AI)） -->
    <div class="flex h-2 w-full overflow-hidden rounded-sm border border-[var(--border-color)]">
        <span v-for="(chunk, index) in props.chunks" :key="index" class="h-full" :style="{width: chunkWidth(chunk), backgroundColor: heatColor(chunk.pAi, 0.85)}" :title="`P(AI) ${pAiPercent(chunk.pAi)}%`" />
    </div>
</template>
