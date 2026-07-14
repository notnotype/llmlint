<script setup lang="ts">
// 综合分色环（Task 17 工单 D）：SVG 环形描边，绿→黄→红随分数渐变；
// 挂载/分数变化时数字 count-up + 描边动画（requestAnimationFrame，不引新依赖）；
// prefers-reduced-motion 时直接落定终值不做动画。纯展示组件，等级词等文案由父组件放旁边。
import {computed, onBeforeUnmount, ref, watch} from "vue";

const props = defineProps<{
    /** 0-100 综合分（AI 味指数：高=红，低=绿）。 */
    score: number;
    /** 三维卡使用紧凑尺寸。 */
    compact?: boolean;
}>();

// —— 环几何（viewBox 120×120，描边宽 10） ——
const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** 当前动画中展示的分数（count-up 的插值值；reduced-motion 时恒等于目标值）。 */
const displayed = ref(0);
let rafId = 0;

/** 是否偏好减少动效（SSR 环境下 window 不存在则视为 false）。 */
function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// 分数变化时启动 count-up（800ms ease-out）；reduced-motion 直接落定。
watch(() => props.score, (target) => {
    cancelAnimationFrame(rafId);
    if (prefersReducedMotion()) {
        displayed.value = target;
        return;
    }
    const from = displayed.value;
    const start = performance.now();
    const duration = 800;
    const tick = (now: number): void => {
        const progress = Math.min(1, (now - start) / duration);
        // ease-out cubic：先快后慢，测速网站质感
        const eased = 1 - Math.pow(1 - progress, 3);
        displayed.value = from + (target - from) * eased;
        if (progress < 1) {
            rafId = requestAnimationFrame(tick);
        }
    };
    rafId = requestAnimationFrame(tick);
}, {immediate: true});

onBeforeUnmount(() => cancelAnimationFrame(rafId));

/** 展示整数分。 */
const shownScore = computed(() => Math.round(displayed.value));
/** 描边长度（随插值分数同步动画）。 */
const dashOffset = computed(() => CIRCUMFERENCE * (1 - Math.max(0, Math.min(100, displayed.value)) / 100));
/** 环与数字颜色：0 绿（像人）→ 100 红（AI 味重），HSL 色相 120→0 线性插值（与热力图同语义）。 */
const ringColor = computed(() => `hsl(${Math.round(120 * (1 - Math.max(0, Math.min(100, displayed.value)) / 100))}, 75%, 42%)`);
</script>

<template>
    <!-- 色环主体：底环（淡）+ 分数环（彩色描边，从 12 点方向顺时针） -->
    <div class="relative shrink-0" :class="props.compact ? 'h-20 w-20' : 'h-32 w-32'" role="img" :aria-label="String(props.score)">
        <svg viewBox="0 0 120 120" class="h-full w-full -rotate-90">
            <circle cx="60" cy="60" :r="RADIUS" fill="none" stroke="var(--border-color)" stroke-width="10" opacity="0.5" />
            <circle cx="60" cy="60" :r="RADIUS" fill="none" :stroke="ringColor" stroke-width="10" stroke-linecap="round" :stroke-dasharray="CIRCUMFERENCE" :stroke-dashoffset="dashOffset" />
        </svg>
        <!-- 环心分数数字 -->
        <div class="absolute inset-0 flex flex-col items-center justify-center">
            <span class="font-semibold tabular-nums" :class="props.compact ? 'text-xl' : 'text-3xl'" :style="{color: ringColor}">{{ shownScore }}</span>
            <span class="text-[10px] text-[var(--text-muted)]">/ 100</span>
        </div>
    </div>
</template>
