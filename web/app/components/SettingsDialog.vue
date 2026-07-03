<script setup lang="ts">
import {computed, ref} from "vue";
import type {Fixability, Review, RuleLevel} from "../types";
import {localeLabels, type SupportedLocale} from "../i18n/messages";
import {useLlmlint} from "../composables/useLlmlint";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import {useWebSettings} from "../composables/useWebSettings";
import type {WebRuleOverride} from "../utils/web-settings";
import type {LlmlintTheme} from "../utils/theme/theme-tokens";
import Dialog from "./common/Dialog.vue";
import FormSelect from "./common/FormSelect.vue";
import IconButton from "./common/IconButton.vue";
import SegmentedControl from "./common/SegmentedControl.vue";
import SwitchField from "./common/SwitchField.vue";

type Section = "display" | "detection" | "rules";
type OverrideField = "level" | "review" | "fixability";
type SelectOption = {value: string; label: string};
type SegmentedOption = {value: string; label: string};

const model = defineModel<boolean>({required: true});
const {settings, overrideCount, patch, setNamespaceOverride, setRuleOverride, resetRuleOverrides} = useWebSettings();
const {registry, baseRegistry, namespaceOptions} = useLlmlint();
const {t} = useLlmlintI18n();

const activeSection = ref<Section>("display");
const ruleQuery = ref("");

const sections = computed<Array<{value: Section; label: string; icon: string}>>(() => [
    {value: "display", label: t("settings.display"), icon: "i-lucide-monitor-cog"},
    {value: "detection", label: t("settings.detection"), icon: "i-lucide-scan-text"},
    {value: "rules", label: `${t("settings.rules")}${overrideCount.value ? ` (${overrideCount.value})` : ""}`, icon: "i-lucide-sliders-horizontal"},
]);

const localeOptions = computed<SelectOption[]>(() => (Object.entries(localeLabels) as Array<[SupportedLocale, string]>).map(([value, label]) => ({value, label})));
const themeOptions = computed<SelectOption[]>(() => [
    {value: "system", label: t("common.system")},
    {value: "light", label: t("common.themeLight")},
    {value: "dark", label: t("common.themeDark")},
    {value: "sepia", label: t("common.themeSepia")},
]);
const reviewOptions = computed<SegmentedOption[]>(() => [
    {value: "agent", label: t("common.agent")},
    {value: "human", label: t("common.human")},
    {value: "none", label: t("common.none")},
    {value: "all", label: t("common.all")},
]);
const levelOptions = computed<SegmentedOption[]>(() => [
    {value: "high", label: t("common.high")},
    {value: "medium", label: t("common.medium")},
    {value: "low", label: t("common.low")},
]);
const selectLevelOptions = computed<SelectOption[]>(() => [
    {value: "__inherit", label: t("common.default")},
    {value: "high", label: t("common.high")},
    {value: "medium", label: t("common.medium")},
    {value: "low", label: t("common.low")},
]);
const selectReviewOptions = computed<SelectOption[]>(() => [
    {value: "__inherit", label: t("common.default")},
    {value: "agent", label: t("common.agent")},
    {value: "human", label: t("common.human")},
    {value: "none", label: t("common.none")},
]);
const selectFixOptions = computed<SelectOption[]>(() => [
    {value: "__inherit", label: t("common.default")},
    {value: "auto", label: t("common.auto")},
    {value: "candidate", label: t("common.candidate")},
    {value: "manual", label: t("common.manual")},
]);

const namespaceRows = computed(() => {
    const active = new Map(registry.value.summary.namespaces.map((item) => [item.namespace, item.activeRules]));
    return baseRegistry.catalog.reduce((rows, item) => {
        const existing = rows.get(item.rule.namespace) ?? {
            namespace: item.rule.namespace,
            total: 0,
            active: active.get(item.rule.namespace) ?? 0,
            override: settings.value.namespaceOverrides[item.rule.namespace],
        };
        existing.total++;
        rows.set(item.rule.namespace, existing);
        return rows;
    }, new Map<string, {namespace: string; total: number; active: number; override?: WebRuleOverride}>());
});

const filteredRules = computed(() => {
    const query = ruleQuery.value.trim().toLowerCase();
    return baseRegistry.catalog
        .filter((item) => {
            if (!query) {
                return true;
            }
            return item.rule.id.toLowerCase().includes(query)
                || item.rule.namespace.toLowerCase().includes(query)
                || item.rule.title.toLowerCase().includes(query);
        })
        .slice(0, 120);
});

function toggleNamespace(ns: string): void {
    const set = new Set(settings.value.namespaces);
    if (set.has(ns)) {
        set.delete(ns);
    } else {
        set.add(ns);
    }
    patch({namespaces: [...set]});
}

function setEnabledOverride(current: WebRuleOverride | undefined, enabled: boolean | null): WebRuleOverride | null {
    const next = {...current};
    if (enabled === null) {
        delete next.enabled;
    } else {
        next.enabled = enabled;
    }
    return Object.keys(next).length ? next : null;
}

function updateField(current: WebRuleOverride | undefined, field: OverrideField, value: string): WebRuleOverride | null {
    const next = {...current};
    if (value === "__inherit") {
        delete next[field];
    } else if (field === "level") {
        next.level = value as RuleLevel;
    } else if (field === "review") {
        next.review = value as Review;
    } else {
        next.fixability = value as Fixability;
    }
    return Object.keys(next).length ? next : null;
}
</script>

<template>
    <Dialog v-model="model" :title="t('settings.title')" width="min(980px, calc(100vw - 32px))">
        <div class="grid min-h-[560px] gap-4 md:grid-cols-[180px_1fr]">
            <aside class="flex flex-col gap-1 border-b border-[var(--border-color)] pb-3 md:border-b-0 md:border-r md:pb-0 md:pr-3">
                <button
                    v-for="section in sections"
                    :key="section.value"
                    class="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors"
                    :class="activeSection === section.value ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                    @click="activeSection = section.value"
                >
                    <span :class="section.icon" />
                    <span>{{ section.label }}</span>
                </button>
            </aside>

            <section class="min-w-0">
                <div v-if="activeSection === 'display'" class="space-y-4">
                    <div>
                        <h3 class="text-base font-semibold">{{ t("settings.display") }}</h3>
                        <p class="text-sm text-[var(--text-muted)]">{{ t("settings.displayDescription") }}</p>
                    </div>
                    <div class="grid gap-3 md:grid-cols-2">
                        <FormSelect :model-value="settings.locale" :options="localeOptions" :label="t('settings.language')" @update:model-value="patch({locale: $event as SupportedLocale})" />
                        <FormSelect :model-value="settings.theme" :options="themeOptions" :label="t('settings.theme')" @update:model-value="patch({theme: $event as LlmlintTheme})" />
                    </div>
                </div>

                <div v-else-if="activeSection === 'detection'" class="space-y-4">
                    <div>
                        <h3 class="text-base font-semibold">{{ t("settings.detection") }}</h3>
                        <p class="text-sm text-[var(--text-muted)]">{{ t("settings.detectionDescription") }}</p>
                    </div>
                    <div class="grid gap-3 md:grid-cols-2">
                        <div class="space-y-1.5">
                            <div class="text-xs font-medium text-[var(--text-muted)]">{{ t("settings.review") }}</div>
                            <SegmentedControl :model-value="settings.review" :options="reviewOptions" @update:model-value="patch({review: $event as Review | 'all'})" />
                        </div>
                        <div class="space-y-1.5">
                            <div class="text-xs font-medium text-[var(--text-muted)]">{{ t("settings.minLevel") }}</div>
                            <SegmentedControl :model-value="settings.minLevel" :options="levelOptions" @update:model-value="patch({minLevel: $event as RuleLevel})" />
                        </div>
                        <SwitchField :model-value="settings.highlight" :label="t('settings.highlight')" @update:model-value="patch({highlight: $event})" />
                        <SwitchField :model-value="!settings.scanAll" :label="t('settings.mask')" @update:model-value="patch({scanAll: !$event})" />
                    </div>
                    <div class="space-y-2">
                        <div class="text-xs font-medium text-[var(--text-muted)]">{{ t("settings.namespaces") }}</div>
                        <div class="flex max-h-52 flex-wrap gap-1 overflow-y-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2">
                            <button
                                v-for="ns in namespaceOptions()"
                                :key="ns"
                                class="rounded border px-2 py-1 font-mono text-xs"
                                :class="settings.namespaces.includes(ns) ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
                                @click="toggleNamespace(ns)"
                            >{{ ns }}</button>
                        </div>
                    </div>
                </div>

                <div v-else class="space-y-4">
                    <div class="flex flex-wrap items-start gap-3">
                        <div class="min-w-0 flex-1">
                            <h3 class="text-base font-semibold">{{ t("settings.ruleConfig") }}</h3>
                            <p class="text-sm text-[var(--text-muted)]">{{ t("settings.ruleDescription") }}</p>
                        </div>
                        <button class="rounded-md border border-[var(--border-color)] px-3 py-1.5 text-sm hover:bg-[var(--bg-hover)]" @click="resetRuleOverrides">{{ t("settings.resetAllRules") }}</button>
                    </div>

                    <div class="space-y-2">
                        <div v-for="row in [...namespaceRows.values()]" :key="row.namespace" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2">
                            <div class="flex flex-wrap items-center gap-2">
                                <div class="min-w-0 flex-1">
                                    <div class="truncate font-mono text-xs text-[var(--text-main)]">{{ row.namespace }}</div>
                                    <div class="text-xs text-[var(--text-muted)]">{{ t("settings.activeRules", {active: row.active, total: row.total}) }}</div>
                                </div>
                                <SegmentedControl
                                    :model-value="row.override?.enabled === undefined ? 'default' : row.override.enabled ? 'on' : 'off'"
                                    :options="[{value: 'default', label: t('common.default')}, {value: 'on', label: t('common.enabled')}, {value: 'off', label: t('common.disabled')}]"
                                    @update:model-value="setNamespaceOverride(row.namespace, setEnabledOverride(row.override, $event === 'default' ? null : $event === 'on'))"
                                />
                                <IconButton :title="t('common.reset')" @click="setNamespaceOverride(row.namespace, null)">
                                    <span class="i-lucide-rotate-ccw" />
                                </IconButton>
                            </div>
                            <div class="mt-2 grid gap-2 md:grid-cols-3">
                                <FormSelect :model-value="row.override?.level ?? '__inherit'" :options="selectLevelOptions" :label="t('settings.levelOverride')" @update:model-value="setNamespaceOverride(row.namespace, updateField(row.override, 'level', $event))" />
                                <FormSelect :model-value="row.override?.review ?? '__inherit'" :options="selectReviewOptions" :label="t('settings.reviewOverride')" @update:model-value="setNamespaceOverride(row.namespace, updateField(row.override, 'review', $event))" />
                                <FormSelect :model-value="row.override?.fixability ?? '__inherit'" :options="selectFixOptions" :label="t('settings.fixabilityOverride')" @update:model-value="setNamespaceOverride(row.namespace, updateField(row.override, 'fixability', $event))" />
                            </div>
                        </div>
                    </div>

                    <div class="space-y-2">
                        <input v-model="ruleQuery" class="h-9 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-sm outline-none focus:border-[var(--accent-main)]" :placeholder="t('settings.ruleSearch')">
                        <div v-if="filteredRules.length === 0" class="rounded-md border border-[var(--border-color)] p-6 text-center text-sm text-[var(--text-muted)]">{{ t("settings.noRuleResult") }}</div>
                        <div v-else class="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                            <div v-for="item in filteredRules" :key="item.rule.id" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3">
                                <div class="flex items-start gap-3">
                                    <div class="min-w-0 flex-1">
                                        <div class="truncate text-sm font-medium">{{ item.rule.title }}</div>
                                        <div class="truncate font-mono text-xs text-[var(--text-muted)]">{{ item.rule.id }} · {{ item.rule.namespace }}</div>
                                    </div>
                                    <SegmentedControl
                                        :model-value="settings.ruleOverrides[item.rule.id]?.enabled === undefined ? 'default' : settings.ruleOverrides[item.rule.id]?.enabled ? 'on' : 'off'"
                                        :options="[{value: 'default', label: t('common.default')}, {value: 'on', label: t('common.enabled')}, {value: 'off', label: t('common.disabled')}]"
                                        @update:model-value="setRuleOverride(item.rule.id, setEnabledOverride(settings.ruleOverrides[item.rule.id], $event === 'default' ? null : $event === 'on'))"
                                    />
                                    <IconButton :title="t('common.reset')" @click="setRuleOverride(item.rule.id, null)">
                                        <span class="i-lucide-rotate-ccw" />
                                    </IconButton>
                                </div>
                                <div class="mt-3 grid gap-2 md:grid-cols-3">
                                    <FormSelect :model-value="settings.ruleOverrides[item.rule.id]?.level ?? '__inherit'" :options="selectLevelOptions" :label="t('settings.levelOverride')" @update:model-value="setRuleOverride(item.rule.id, updateField(settings.ruleOverrides[item.rule.id], 'level', $event))" />
                                    <FormSelect :model-value="settings.ruleOverrides[item.rule.id]?.review ?? '__inherit'" :options="selectReviewOptions" :label="t('settings.reviewOverride')" @update:model-value="setRuleOverride(item.rule.id, updateField(settings.ruleOverrides[item.rule.id], 'review', $event))" />
                                    <FormSelect :model-value="settings.ruleOverrides[item.rule.id]?.fixability ?? '__inherit'" :options="selectFixOptions" :label="t('settings.fixabilityOverride')" @update:model-value="setRuleOverride(item.rule.id, updateField(settings.ruleOverrides[item.rule.id], 'fixability', $event))" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    </Dialog>
</template>
