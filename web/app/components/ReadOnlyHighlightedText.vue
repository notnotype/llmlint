<script setup lang="ts">
import {computed, nextTick, ref, watch} from "vue";
import type {HighlightRange, RuleLevel} from "../types";
import {heatColor, pAiPercent, type HeatChunk} from "../utils/contribute-workspace";

// 只读行内高亮：复用 HighlightedTextarea 的分段逻辑，但文字可见、无 textarea/编辑。
// 数据集查看器用它展示样本正文 + llmlint 命中底色（红=high/琥珀=medium/灰=low）。
// Task 15 P1-C 热力图层：传入 heat（检测器分块 P(AI)）时正文按块铺梯度底色（绿→红），
// 规则命中改为下划线标注——「底色 vs 下划线」区分两种信号；不传 heat 行为与旧版一致。
const props = defineProps<{
    text: string;
    ranges: HighlightRange[];
    locateOffset?: number | null;
    /** 热力块（坐标锚定 text）；null/缺省 = 不开热力图层（命中沿用底色高亮）。 */
    heat?: HeatChunk[] | null;
}>();

type Segment = {text: string; level: RuleLevel | null; pAi: number | null; start: number; end: number};

const hostRef = ref<HTMLDivElement | null>(null);
const flashIndex = ref<number | null>(null);

// 热力模式：有非空 heat 才生效（命中渲染切换为下划线）。
const heatMode = computed(() => (props.heat?.length ?? 0) > 0);

/** 级别取高（重叠命中的段取最高级别）。 */
const LEVEL_RANK: Record<RuleLevel, number> = {high: 3, medium: 2, low: 1};
function higherLevel(left: RuleLevel | null, right: RuleLevel): RuleLevel {
    return left !== null && LEVEL_RANK[left] >= LEVEL_RANK[right] ? left : right;
}

// 按「命中区间 + 热力块」的全部边界点把正文切段，逐段标注 level（命中）与 pAi（热力）。
// 无 heat 时退化为旧算法的等价形态（仅命中边界切段）。
const segments = computed<Segment[]>(() => {
    const value = props.text;
    const ranges = props.ranges;
    const heat = props.heat ?? [];
    if (ranges.length === 0 && heat.length === 0) {
        return [{text: value, level: null, pAi: null, start: 0, end: value.length}];
    }
    const points = new Set<number>([0, value.length]);
    for (const range of ranges) {
        points.add(Math.max(0, Math.min(value.length, range.start)));
        points.add(Math.max(0, Math.min(value.length, range.end)));
    }
    for (const chunk of heat) {
        points.add(Math.max(0, Math.min(value.length, chunk.start)));
        points.add(Math.max(0, Math.min(value.length, chunk.end)));
    }
    const sorted = [...points].sort((left, right) => left - right);
    const out: Segment[] = [];
    let previous: number | null = null;
    for (const point of sorted) {
        if (previous !== null && point > previous) {
            const start = previous;
            const end = point;
            let level: RuleLevel | null = null;
            for (const range of ranges) {
                if (range.start <= start && end <= range.end) {
                    level = higherLevel(level, range.level);
                }
            }
            // 检测分块互不重叠（chunker 顺序切块），取覆盖段首的那块即可。
            const chunk = heat.find((item) => item.start <= start && end <= item.end) ?? null;
            out.push({text: value.slice(start, end), level, pAi: chunk?.pAi ?? null, start, end});
        }
        previous = point;
    }
    return out;
});

const MARK_CLASS: Record<RuleLevel, string> = {
    high: "bg-red-400/45",
    medium: "bg-amber-400/45",
    low: "bg-zinc-400/45",
};
// 热力模式下命中改下划线（底色让给热力梯度）。
const UNDERLINE_CLASS: Record<RuleLevel, string> = {
    high: "underline decoration-2 underline-offset-2 decoration-red-500",
    medium: "underline decoration-2 underline-offset-2 decoration-amber-500",
    low: "underline decoration-2 underline-offset-2 decoration-zinc-400",
};

/** 段的命中呈现 class：热力模式=下划线；否则=旧版底色。 */
function segmentClass(segment: Segment): string {
    if (segment.level === null) {
        return "";
    }
    return heatMode.value ? UNDERLINE_CLASS[segment.level] : `rounded ${MARK_CLASS[segment.level]}`;
}

watch(
    () => props.locateOffset,
    async (offset) => {
        if (offset === null || offset === undefined) {
            return;
        }
        const index = segments.value.findIndex((segment) => offset >= segment.start && offset < segment.end);
        if (index < 0) {
            return;
        }
        flashIndex.value = index;
        await nextTick();
        hostRef.value?.querySelector<HTMLElement>(`[data-segment-index="${index}"]`)?.scrollIntoView({block: "center", behavior: "smooth"});
        window.setTimeout(() => {
            if (flashIndex.value === index) {
                flashIndex.value = null;
            }
        }, 900);
    },
);
</script>

<template>
    <!-- 只读正文 + 高亮底色（热力模式：块底色=P(AI) 梯度、命中=下划线，hover 显块概率）；等宽、软换行、可滚 -->
    <div ref="hostRef" class="h-full min-h-0 w-full overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-sm leading-relaxed text-[var(--text-main)]"><span
        v-for="(seg, index) in segments"
        :key="index"
        :data-segment-index="index"
        :class="[segmentClass(seg), flashIndex === index ? 'outline outline-2 outline-[var(--accent-main)]' : '']"
        :style="seg.pAi !== null ? {backgroundColor: heatColor(seg.pAi)} : undefined"
        :title="seg.pAi !== null ? `P(AI) ${pAiPercent(seg.pAi)}%` : undefined"
    >{{ seg.text }}</span></div>
</template>
