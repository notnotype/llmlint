<script setup lang="ts">
import {onClickOutside} from "@vueuse/core";
import {computed, ref} from "vue";
import type {ReviewFilter, RuleLevel, UiFilters} from "../types";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import SegmentedControl, {type SegmentedOption} from "./common/SegmentedControl.vue";

// 过滤条：受众 / 最低级别 / 命名空间多选。不改 props，构造新对象 emit。
const props = defineProps<{filters: UiFilters; namespaceOptions: string[]}>();
const emit = defineEmits<{(e: "update:filters", value: UiFilters): void}>();
const {t} = useLlmlintI18n();

const REVIEWS = computed<SegmentedOption[]>(() => [
    {value: "agent", label: "Agent"},
    {value: "human", label: t("common.human")},
    {value: "none", label: t("common.none")},
    {value: "all", label: t("common.all")},
]);
const LEVELS = computed<SegmentedOption[]>(() => [
    {value: "high", label: t("common.high")},
    {value: "medium", label: t("common.medium")},
    {value: "low", label: t("common.low")},
]);

const nsOpen = ref(false);
const namespaceRef = ref<HTMLDivElement | null>(null);

function patch(part: Partial<UiFilters>) {
    emit("update:filters", {...props.filters, ...part});
}
function toggleNamespace(ns: string) {
    const set = new Set(props.filters.namespaces);
    if (set.has(ns)) {
        set.delete(ns);
    } else {
        set.add(ns);
    }
    patch({namespaces: [...set]});
}

onClickOutside(namespaceRef, () => {
    nsOpen.value = false;
});
</script>

<template>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
        <!-- 受众 -->
        <div class="flex items-center gap-2">
            <span class="text-xs text-[var(--text-muted)]">{{ t("settings.review") }}</span>
            <SegmentedControl :model-value="filters.review" :options="REVIEWS" @update:model-value="patch({review: $event as ReviewFilter})" />
        </div>
        <!-- 最低级别 -->
        <div class="flex items-center gap-2">
            <span class="text-xs text-[var(--text-muted)]">{{ t("settings.minLevel") }}</span>
            <SegmentedControl :model-value="filters.minLevel" :options="LEVELS" @update:model-value="patch({minLevel: $event as RuleLevel})" />
        </div>
        <!-- 命名空间多选 -->
        <div ref="namespaceRef" class="relative" @keydown.esc.prevent.stop="nsOpen = false">
            <button
                type="button"
                class="inline-flex items-center gap-1 rounded border border-[var(--border-color)] bg-[var(--bg-subtle)] px-2.5 py-1 text-sm hover:bg-[var(--bg-hover)]"
                :aria-expanded="nsOpen"
                @click="nsOpen = !nsOpen"
            >
                {{ t("settings.namespaces") }}
                <span v-if="filters.namespaces.length">({{ filters.namespaces.length }})</span>
                <span v-else class="text-[var(--text-muted)]">{{ t("common.all") }}</span>
                <span class="i-lucide-chevron-down" />
            </button>
            <div
                v-if="nsOpen"
                class="absolute left-0 z-30 mt-1 max-h-72 w-56 overflow-auto rounded border border-[var(--border-color)] bg-[var(--bg-panel)] p-2 shadow-lg"
            >
                <div class="mb-1 flex items-center justify-between px-1 text-xs text-[var(--text-muted)]">
                    <span>{{ t("settings.namespaceCount", {count: namespaceOptions.length}) }}</span>
                    <button type="button" class="hover:text-[var(--text-main)]" @click="patch({namespaces: []})">{{ t("common.clear") }}</button>
                </div>
                <label
                    v-for="ns in namespaceOptions"
                    :key="ns"
                    class="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-[var(--bg-hover)]"
                >
                    <input type="checkbox" :checked="filters.namespaces.includes(ns)" @change="toggleNamespace(ns)" >
                    <span class="truncate font-mono text-xs">{{ ns }}</span>
                </label>
            </div>
        </div>
    </div>
</template>
