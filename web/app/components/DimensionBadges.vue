<script setup lang="ts">
import {computed} from "vue";
import type {ActiveRuleRecord} from "../types";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";

// 规则三维度徽章：级别 / 受众(review) / 修复(fixability)
// Task 16 R3：prop 从 RegexRuleRecord 放宽为 ActiveRuleRecord（regex/llm 通吃，本组件只读三维字段与 action.type）。
const props = defineProps<{rule: ActiveRuleRecord}>();
const {t} = useLlmlintI18n();

const LEVEL_CLASS: Record<string, string> = {
    high: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
    medium: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
    low: "bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300",
};

const neutral = "bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300";
const fixabilityTone = computed(() => {
    if (props.rule.fixability === "auto" && props.rule.action.type === "replace") {
        return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    }
    if (props.rule.fixability === "candidate" && props.rule.action.type === "replace") {
        return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
    }
    return neutral;
});
const fixabilityLabel = computed(() => {
    if (props.rule.fixability === "auto" && props.rule.action.type === "replace") {
        return t("issue.fixable");
    }
    if (props.rule.fixability === "candidate" && props.rule.action.type === "replace") {
        return t("issue.candidateFixable");
    }
    return t(`common.${props.rule.fixability}`);
});
</script>

<template>
    <span class="inline-flex flex-wrap items-center gap-1 align-middle">
        <span class="rounded px-1.5 py-0.5 text-xs" :class="LEVEL_CLASS[props.rule.level]">{{ t("dimension.level") }}·{{ t(`common.${props.rule.level}`) }}</span>
        <span class="rounded px-1.5 py-0.5 text-xs" :class="neutral">{{ t("dimension.review") }}·{{ t(`common.${props.rule.review}`) }}</span>
        <span class="rounded px-1.5 py-0.5 text-xs" :class="fixabilityTone">{{ t("dimension.fixability") }}·{{ fixabilityLabel }}</span>
    </span>
</template>
