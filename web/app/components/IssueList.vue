<script setup lang="ts">
import {nextTick, ref, watch} from "vue";
import type {Issue, RegexRuleRecord, RuleGroup} from "../types";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";

// 右侧结果列表容器
const props = withDefaults(defineProps<{groups: RuleGroup[]; hasText: boolean; hidden?: number; ruleSettingsHidden?: number; activeRuleId?: string | null; activeIssueId?: string | null}>(), {
    hidden: 0,
    ruleSettingsHidden: 0,
    activeIssueId: null,
});
const emit = defineEmits<{
    (e: "open-rule", rule: RegexRuleRecord): void;
    (e: "locate-issue", issue: Issue): void;
    (e: "apply-issue", issue: Issue): void;
    (e: "show-hidden"): void;
    (e: "reset-rule-settings"): void;
}>();

const listEl = ref<HTMLDivElement | null>(null);
const {t} = useLlmlintI18n();

// 正文→列表定位时，把当前激活命中行滚进视口；没有行时回退到规则卡片。
watch(
    () => [props.activeIssueId, props.activeRuleId] as const,
    async ([issueId, ruleId]) => {
        if (!issueId && !ruleId) {
            return;
        }
        await nextTick();
        const issueRow = issueId ? listEl.value?.querySelector<HTMLElement>(`[data-issue-id="${CSS.escape(issueId)}"]`) : null;
        if (issueRow) {
            issueRow.scrollIntoView({block: "nearest", behavior: "smooth"});
            return;
        }
        const card = ruleId ? listEl.value?.querySelector<HTMLElement>(`[data-rule-id="${CSS.escape(ruleId)}"]`) : null;
        card?.scrollIntoView({block: "nearest", behavior: "smooth"});
    },
);
</script>

<template>
    <div ref="listEl" class="h-full min-h-0 overflow-y-auto">
        <!-- 空状态：还没输入 -->
        <div v-if="!hasText" class="flex h-full flex-col items-center justify-center gap-2 p-8 text-zinc-400">
            <span class="i-lucide-file-text text-2xl" />
            <p class="text-sm">{{ t("issue.emptyNoText") }}</p>
        </div>
        <!-- 空状态：有输入但当前过滤无可见命中 -->
        <div v-else-if="groups.length === 0" class="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <template v-if="hidden > 0">
                <span class="i-lucide-filter-x text-2xl text-[var(--accent-text)]" />
                <div class="space-y-1">
                    <p class="text-sm font-medium text-[var(--text-main)]">{{ t("issue.filteredHiddenTitle", {count: hidden}) }}</p>
                    <p class="text-xs text-[var(--text-muted)]">{{ t("issue.filteredHiddenDescription") }}</p>
                </div>
                <button
                    type="button"
                    class="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent-main)] px-3 text-xs font-medium text-white transition hover:brightness-105"
                    @click="emit('show-hidden')"
                >
                    <span class="i-lucide-eye h-3.5 w-3.5" />
                    <span>{{ t("issue.showAll") }}</span>
                </button>
            </template>
            <template v-else-if="ruleSettingsHidden > 0">
                <span class="i-lucide-sliders-horizontal text-2xl text-[var(--accent-text)]" />
                <div class="space-y-1">
                    <p class="text-sm font-medium text-[var(--text-main)]">{{ t("issue.ruleSettingsHiddenTitle", {count: ruleSettingsHidden}) }}</p>
                    <p class="text-xs text-[var(--text-muted)]">{{ t("issue.ruleSettingsHiddenDescription") }}</p>
                </div>
                <button
                    type="button"
                    class="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent-main)] px-3 text-xs font-medium text-white transition hover:brightness-105"
                    @click="emit('reset-rule-settings')"
                >
                    <span class="i-lucide-rotate-ccw h-3.5 w-3.5" />
                    <span>{{ t("issue.resetRules") }}</span>
                </button>
            </template>
            <template v-else>
                <span class="i-lucide-check-circle-2 text-2xl text-emerald-600 dark:text-emerald-400" />
                <p class="text-sm text-emerald-600 dark:text-emerald-400">{{ t("issue.clean") }}</p>
            </template>
        </div>
        <!-- 结果 -->
        <div v-else class="space-y-3 p-3">
            <IssueCard
                v-for="group in groups"
                :key="group.rule.id"
                :group="group"
                :active-rule-id="activeRuleId"
                :active-issue-id="activeIssueId"
                @open-rule="(rule) => emit('open-rule', rule)"
                @locate-issue="(issue) => emit('locate-issue', issue)"
                @apply-issue="(issue) => emit('apply-issue', issue)"
            />
        </div>
    </div>
</template>
