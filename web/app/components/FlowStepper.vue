<script setup lang="ts">
// 阶段指示（Task 15 P0-A：五步 stepper 退役 → 三态阶段指示 上传 → 工作台 → 完成）。
// 五步方法论退为引导条叙事（StepGuideBar），轮次/版本感由版本条（VersionBar）承载。
// 沿用 W8 拍板：节点不可点击、纯展示；未到态灰显 + title 给解锁条件（门控显式化）。
import {computed} from "vue";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import type {MessageKey} from "../i18n/messages";

/** 宿主当前所处阶段（页面 step 状态直传）。 */
export type FlowStepperScreen = "draft" | "workspace" | "done";

const props = defineProps<{
    /** 当前阶段。 */
    current: FlowStepperScreen;
}>();

const {t} = useLlmlintI18n();

// 阶段 → 节点序。
const screenOrder: Record<FlowStepperScreen, number> = {draft: 0, workspace: 1, done: 2};
const currentIndex = computed(() => screenOrder[props.current]);

// 三个节点：label 常显；lockKey 只在未到态作 title（解锁条件）。
const nodes: Array<{labelKey: MessageKey; lockKey: MessageKey | null}> = [
    {labelKey: "contribute.flowStage1", lockKey: null},
    {labelKey: "contribute.flowStage2", lockKey: "contribute.flowStageLockWorkspace"},
    {labelKey: "contribute.flowStage3", lockKey: "contribute.flowStageLockDone"},
];
</script>

<template>
    <!-- 三态阶段指示（纯展示，节点不可点击）：已完成 ✓ / 当前高亮 / 未到灰显 -->
    <nav class="flex flex-wrap items-center gap-1 text-xs">
        <template v-for="(node, i) in nodes" :key="node.labelKey">
            <span class="inline-flex items-center gap-1.5" :class="currentIndex === i ? 'font-medium text-[var(--text-main)]' : currentIndex > i ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)]'" :title="currentIndex < i && node.lockKey ? t(node.lockKey) : undefined">
                <!-- 三态圆圈：已完成 ✓（success 绿）/ 当前数字（accent）/ 未到数字（灰） -->
                <span class="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px]" :class="currentIndex > i ? 'bg-emerald-600 text-white' : currentIndex === i ? 'bg-[var(--accent-main)] text-white' : 'bg-[var(--bg-subtle)] text-[var(--text-muted)]'">
                    <span v-if="currentIndex > i" class="i-lucide-check h-3 w-3" />
                    <template v-else>{{ i + 1 }}</template>
                </span>
                {{ t(node.labelKey) }}
            </span>
            <span v-if="i < nodes.length - 1" class="mx-1 text-[var(--text-muted)]">→</span>
        </template>
    </nav>
</template>
