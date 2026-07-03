<script setup lang="ts">
import {computed, nextTick, ref, watch} from "vue";
import type {HighlightRange, RuleLevel} from "../types";

// 只读行内高亮：复用 HighlightedTextarea 的分段逻辑，但文字可见、无 textarea/编辑。
// 数据集查看器用它展示样本正文 + llmlint 命中底色（红=high/琥珀=medium/灰=low）。
const props = defineProps<{text: string; ranges: HighlightRange[]; locateOffset?: number | null}>();

type Segment = {text: string; level: RuleLevel | null; start: number; end: number};

const hostRef = ref<HTMLDivElement | null>(null);
const flashIndex = ref<number | null>(null);

// 按合并后的高亮区间把正文切成 [普通 | 高亮] 段（同 HighlightedTextarea 的算法，去掉定位用的 start）。
const segments = computed<Segment[]>(() => {
    const value = props.text;
    const ranges = props.ranges;
    if (ranges.length === 0) {
        return [{text: value, level: null, start: 0, end: value.length}];
    }
    const out: Segment[] = [];
    let cursor = 0;
    for (const range of ranges) {
        const start = Math.max(cursor, range.start);
        if (start > cursor) {
            out.push({text: value.slice(cursor, start), level: null, start: cursor, end: start});
        }
        const end = Math.min(value.length, range.end);
        if (end > start) {
            out.push({text: value.slice(start, end), level: range.level, start, end});
        }
        cursor = Math.max(cursor, end);
    }
    if (cursor < value.length) {
        out.push({text: value.slice(cursor), level: null, start: cursor, end: value.length});
    }
    return out;
});

const MARK_CLASS: Record<RuleLevel, string> = {
    high: "bg-red-400/45",
    medium: "bg-amber-400/45",
    low: "bg-zinc-400/45",
};

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
    <!-- 只读正文 + 高亮底色；等宽、软换行、可滚 -->
    <div ref="hostRef" class="h-full min-h-0 w-full overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-sm leading-relaxed text-[var(--text-main)]"><span
        v-for="(seg, index) in segments"
        :key="index"
        :data-segment-index="index"
        :class="[seg.level ? `rounded ${MARK_CLASS[seg.level]}` : '', flashIndex === index ? 'outline outline-2 outline-[var(--accent-main)]' : '']"
    >{{ seg.text }}</span></div>
</template>
