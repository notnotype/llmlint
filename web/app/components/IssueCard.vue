<script setup lang="ts">
import {computed, ref} from "vue";
import type {Issue, RegexRuleRecord, RuleGroup} from "../types";
import {issueId} from "../utils/review-ranges";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";

// 单条规则的命中卡片
const props = defineProps<{group: RuleGroup; activeRuleId?: string | null; activeIssueId?: string | null}>();
const emit = defineEmits<{
    (e: "open-rule", rule: RegexRuleRecord): void;
    (e: "locate-issue", issue: Issue): void;
    (e: "apply-issue", issue: Issue): void;
}>();
const {t} = useLlmlintI18n();

const LIMIT = 8;
const expanded = ref(false);
const visibleIssues = computed(() => {
    if (expanded.value) {
        return props.group.issues;
    }
    const head = props.group.issues.slice(0, LIMIT);
    if (!props.activeIssueId || head.some((issue) => issueId(issue) === props.activeIssueId)) {
        return head;
    }
    const active = props.group.issues.find((issue) => issueId(issue) === props.activeIssueId);
    return active ? [...head, active] : head;
});
const hasMore = computed(() => props.group.issues.length > LIMIT);
const isActive = computed(() => props.activeRuleId === props.group.rule.id);

function canApply(issue: Issue): boolean {
    return (issue.rule.fixability === "auto" || issue.rule.fixability === "candidate") && issue.rule.action.type === "replace";
}

function fixableBadgeLabel(issue: Issue): string {
    return issue.rule.fixability === "candidate" ? t("issue.candidateFixable") : t("issue.fixable");
}

function fixableBadgeTone(issue: Issue): string {
    return issue.rule.fixability === "candidate"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
}

function replacementLabel(issue: Issue): string {
    return (issue.rule.action.type === "replace" && (issue.rule.action.replacements[0] ?? "") === "") ? t("review.delete") : t("review.replace");
}

function applyActionLabel(issue: Issue): string {
    const action = replacementLabel(issue);
    return issue.rule.fixability === "candidate"
        ? t("issue.candidateApplyAction", {action})
        : action;
}

function applyButtonTone(issue: Issue): string {
    return issue.rule.fixability === "candidate"
        ? "text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
        : "text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300";
}

function isIssueActive(issue: Issue): boolean {
    return props.activeIssueId === issueId(issue);
}

function issueMatchLabel(issue: Issue): string {
    return issue.match.replace(/\s+/g, " ").trim();
}
</script>

<template>
    <div
        :data-rule-id="group.rule.id"
        class="rounded-lg border bg-white p-3 transition-colors dark:bg-zinc-900"
        :class="isActive ? 'border-amber-400 ring-2 ring-amber-400/60 dark:border-amber-500' : 'border-zinc-200 dark:border-zinc-800'"
    >
        <!-- 头部 -->
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="font-medium">{{ group.rule.title }}</span>
            <span class="font-mono text-xs text-zinc-400">{{ group.rule.id }}</span>
            <span class="font-mono text-xs text-zinc-500">[{{ group.rule.namespace }}]</span>
            <DimensionBadges :rule="group.rule" />
            <span class="ml-auto rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{{ t("issue.count", {count: group.issues.length}) }}</span>
            <button
                class="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                :aria-label="t('issue.openRuleTitle', {title: group.rule.title})"
                :title="t('issue.openRuleTitle', {title: group.rule.title})"
                @click="emit('open-rule', group.rule)"
            >
                <span class="i-lucide-info" /> {{ t("issue.openRule") }}
            </button>
        </div>
        <!-- 命中列表（点击定位到正文） -->
        <ul class="mt-2 space-y-1">
            <li
                v-for="(issue, index) in visibleIssues"
                :key="issueId(issue)"
                :data-issue-id="issueId(issue)"
                class="group flex gap-1 rounded px-1 py-0.5 text-sm transition-colors hover:bg-zinc-100 focus-within:ring-2 focus-within:ring-[var(--accent-main)]/45 dark:hover:bg-zinc-800"
                :class="isIssueActive(issue) ? 'bg-[var(--accent-bg)] outline outline-1 outline-[var(--accent-main)]/45 dark:bg-[var(--accent-bg)]' : ''"
            >
                <button
                    type="button"
                    class="flex min-w-0 flex-1 cursor-pointer gap-2 text-left outline-none"
                    :aria-label="t('issue.locateIssueTitle', {match: issueMatchLabel(issue)})"
                    :title="t('issue.locateIssueTitle', {match: issueMatchLabel(issue)})"
                    @click="emit('locate-issue', issue)"
                >
                    <span class="shrink-0 font-mono text-xs" :class="isIssueActive(issue) ? 'text-[var(--accent-text)]' : 'text-zinc-400'">{{ issue.line }}:{{ issue.column }}</span>
                    <span class="min-w-0 whitespace-pre-wrap break-words font-mono text-xs"><span class="text-zinc-500">{{ issue.context.before }}</span><mark class="rounded bg-amber-200 px-0.5 text-zinc-900 dark:bg-amber-500/40 dark:text-amber-50">{{ issue.context.current }}</mark><span class="text-zinc-500">{{ issue.context.after }}</span></span>
                </button>
                <span
                    v-if="canApply(issue)"
                    class="ml-auto inline-flex h-6 shrink-0 items-center rounded px-1.5 text-[11px] font-medium"
                    :class="fixableBadgeTone(issue)"
                    :title="fixableBadgeLabel(issue)"
                >
                    {{ fixableBadgeLabel(issue) }}
                </span>
                <button
                    v-if="canApply(issue)"
                    type="button"
                    class="issue-card-apply-button inline-flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] font-medium transition"
                    :class="applyButtonTone(issue)"
                    :aria-label="t('issue.applyIssueTitle', {action: applyActionLabel(issue), match: issueMatchLabel(issue)})"
                    :title="t('issue.applyIssueTitle', {action: applyActionLabel(issue), match: issueMatchLabel(issue)})"
                    @click.stop="emit('apply-issue', issue)"
                >
                    <span class="i-lucide-check h-3.5 w-3.5" />
                    <span>{{ applyActionLabel(issue) }}</span>
                </button>
            </li>
        </ul>
        <button v-if="hasMore" class="mt-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200" @click="expanded = !expanded">
            {{ expanded ? t("issue.collapse") : t("issue.expandAll", {count: group.issues.length}) }}
        </button>
    </div>
</template>

<style scoped>
.group:focus-within .issue-card-apply-button {
    opacity: 1;
}

.issue-card-apply-button:focus-visible {
    opacity: 1;
}

@media (hover: none), (pointer: coarse) {
    .issue-card-apply-button {
        opacity: 1;
    }
}
</style>
