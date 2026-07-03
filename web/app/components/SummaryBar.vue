<script setup lang="ts">
import {computed} from "vue";
import type {CheckSummary} from "../types";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import Dropdown from "./common/Dropdown.vue";
import type {DropdownItem} from "./common/dropdown.types";

// 结果汇总条
const props = defineProps<{summary: CheckSummary; activeRules: number; hidden: number; ruleSettingsHidden?: number}>();
const emit = defineEmits<{
    (e: "copy"): void;
    (e: "copy-optimization-prompt", includeText: boolean): void;
    (e: "replace-text-from-clipboard"): void;
    (e: "show-hidden"): void;
    (e: "reset-rule-settings"): void;
}>();
const {t} = useLlmlintI18n();

const optimizationPromptItems = computed<DropdownItem[]>(() => [
    {
        label: t("llm.copyPromptOnly"),
        value: "prompt-only",
        iconClass: "i-lucide-clipboard-list",
    },
    {
        label: t("llm.copyPromptWithText"),
        value: "prompt-with-text",
        iconClass: "i-lucide-file-input",
    },
    {
        label: t("llm.replaceFullFromClipboard"),
        value: "replace-text",
        iconClass: "i-lucide-clipboard-paste",
    },
]);

function handleOptimizationPromptSelect(value: string): void {
    if (value === "replace-text") {
        emit("replace-text-from-clipboard");
        return;
    }
    emit("copy-optimization-prompt", value === "prompt-with-text");
}
</script>

<template>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--border-color)] px-4 py-2 text-sm">
        <template v-if="summary.total === 0 && hidden > 0">
            <span class="inline-flex items-center gap-1.5 text-[var(--accent-text)]">
                <span class="i-lucide-filter-x" /> {{ t("summary.filteredHidden", {count: hidden}) }}
            </span>
        </template>
        <template v-else-if="summary.total === 0 && (ruleSettingsHidden ?? 0) > 0">
            <span class="inline-flex items-center gap-1.5 text-[var(--accent-text)]">
                <span class="i-lucide-sliders-horizontal" /> {{ t("summary.ruleSettingsHidden", {count: ruleSettingsHidden ?? 0}) }}
            </span>
        </template>
        <template v-else-if="summary.total === 0">
            <span class="inline-flex items-center gap-1.5 text-emerald-600">
                <span class="i-lucide-check-circle-2" /> {{ t("summary.noIssues") }}
            </span>
        </template>
        <template v-else>
            <span>{{ t("summary.total", {total: summary.total}) }}</span>
            <span class="text-red-600">{{ t("common.high") }} {{ summary.high }}</span>
            <span class="text-amber-600">{{ t("common.medium") }} {{ summary.medium }}</span>
            <span class="text-[var(--text-muted)]">{{ t("common.low") }} {{ summary.low }}</span>
        </template>
        <div class="ml-auto flex items-center gap-3">
            <span class="text-xs text-[var(--text-muted)]">
                <template v-if="hidden > 0">{{ t("summary.hidden", {count: hidden}) }} · </template>
                <template v-if="(ruleSettingsHidden ?? 0) > 0">{{ t("summary.ruleSettingsHiddenInline", {count: ruleSettingsHidden ?? 0}) }} · </template>
                {{ t("summary.scanRules", {count: activeRules}) }}
            </span>
            <button
                v-if="hidden > 0"
                class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-[var(--accent-text)] hover:bg-[var(--accent-bg)]"
                :title="t('summary.showHiddenTitle')"
                @click="emit('show-hidden')"
            ><span class="i-lucide-eye" /> {{ t("summary.showHidden") }}</button>
            <button
                v-if="(ruleSettingsHidden ?? 0) > 0"
                class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-[var(--accent-text)] hover:bg-[var(--accent-bg)]"
                :title="t('summary.resetRuleSettingsTitle')"
                @click="emit('reset-rule-settings')"
            ><span class="i-lucide-rotate-ccw" /> {{ t("summary.resetRuleSettings") }}</button>
            <button
                class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                :title="t('summary.copyJsonTitle')"
                @click="emit('copy')"
            ><span class="i-lucide-copy" /> {{ t("summary.copyJson") }}</button>
            <Dropdown
                :items="optimizationPromptItems"
                root-class="relative"
                menu-class="right-0 top-full mt-2 w-56"
                compact
                @select="handleOptimizationPromptSelect"
            >
                <button
                    type="button"
                    class="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition"
                    :class="props.summary.total > 0 ? 'bg-[var(--accent-main)] text-white hover:brightness-105' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                    :title="t('llm.menuTitle')"
                >
                    <span class="i-lucide-wand-sparkles h-3.5 w-3.5" />
                    <span>{{ t("llm.menuLabel") }}</span>
                    <span class="i-lucide-chevron-down h-3 w-3" />
                </button>
            </Dropdown>
        </div>
    </div>
</template>
