<script setup lang="ts">
import {computed, ref} from "vue";
import type {Issue, RegexRuleRecord, RuleGroup} from "../types";
import {issueId} from "../utils/review-ranges";
import {isIssueReplacementApplicable} from "../utils/review-issue-ui";
import {verdictBadge} from "../utils/verdict-badge";
import {CATEGORY_BADGE, ruleCategory} from "../utils/rule-category";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";

// 单条规则的命中卡片。Task 15 P1-C（7a）：batchApply 模式追加规则级批量入口——
// 「应用全部」按钮（该规则全部可自动替换命中一次并入）+ 多选 checkbox（宿主底部批量应用所选规则）。
// Task 16 W2：头部类型徽标（R3，命中规则恒为 regex → 只会出现「有替换/仅检测」两类）、
// verdict 分级主体色（R4，verdict prop 未传=报告缺失降级不显示）、「隐藏此规则」按钮（R1，只 emit 由宿主消化）。
const props = withDefaults(defineProps<{
    group: RuleGroup;
    activeRuleId?: string | null;
    activeIssueId?: string | null;
    /** 7a 批量应用入口开关（只在 head 编辑视图的命中 tab 传真；只读/playground 场景关闭）。 */
    batchApply?: boolean;
    /** 该规则是否在宿主的多选集合中（batchApply 模式下 checkbox 状态）。 */
    selected?: boolean;
    /**
     * R4：该规则的评测 verdict。三态语义——
     * undefined（不传）= 宿主无评测报告，降级：不显示 verdict 徽标、不加左边框主体色；
     * null = 有报告但该规则未入报告 → 显示「未测」徽标；
     * 字符串 = strong/weak/noise/anti/insufficient → 对应徽标 + 左边框主体色。
     */
    verdict?: string | null;
}>(), {
    activeIssueId: null,
    batchApply: false,
    selected: false,
});
const emit = defineEmits<{
    (e: "open-rule", rule: Issue["rule"]): void;
    (e: "locate-issue", issue: Issue): void;
    (e: "apply-issue", issue: Issue): void;
    /** 7a：应用该规则的全部可自动替换命中（宿主转 TextPanel 批量并入，坐标从后往前）。 */
    (e: "apply-group", issues: Issue[]): void;
    /** 7a：勾选/取消该规则参与底部「应用所选规则」批量。 */
    (e: "toggle-select", ruleId: string, checked: boolean): void;
    /** R1：请求隐藏该规则（写 ruleOverrides[id].enabled=false 由宿主消化；本组件只上抛）。 */
    (e: "hide-rule", ruleId: string): void;
}>();
const {t} = useLlmlintI18n();

// R3：规则分类徽标（命中卡片的 rule 恒为 RegexRuleRecord → 只会是 replace/suggest）。
const categoryBadge = computed(() => CATEGORY_BADGE[ruleCategory(props.group.rule)]);
// R4：verdict 徽标（undefined = 不显示；null = 未测）。
const verdictInfo = computed(() => props.verdict === undefined ? null : verdictBadge(props.verdict));
// R4：卡片容器左边框主体色（verdict 未传时空串 = 保持现状外观）。
const verdictBorderCls = computed(() => verdictInfo.value === null ? "" : `border-l-4 ${verdictInfo.value.borderCls}`);

const LIMIT = 8;
const expanded = ref(false);
// 该规则下可自动替换的命中（7a 批量的应用集合；与单条「应用」按钮同一口径）。
const applicableIssues = computed(() => props.group.issues.filter(isIssueReplacementApplicable));
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
    return isIssueReplacementApplicable(issue);
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
    <!-- 卡片容器：R4 verdict 主体色左边框（verdict 未传时不加，保持现状外观） -->
    <div
        :data-rule-id="group.rule.id"
        class="issue-card border bg-[var(--bg-panel)] p-3 transition-colors"
        :class="[isActive ? 'border-[var(--accent-main)] ring-2 ring-[var(--accent-main)]/45' : 'border-[var(--border-color)]', verdictBorderCls]"
    >
        <!-- 头部 -->
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <!-- 7a 多选：勾选该规则参与底部「应用所选规则」批量（仅有可自动替换命中的规则出现） -->
            <input v-if="batchApply && applicableIssues.length > 0" type="checkbox" class="h-3.5 w-3.5 accent-[var(--accent-main)]" :checked="selected" :title="t('issue.batchSelectTitle')" @change="emit('toggle-select', group.rule.id, ($event.target as HTMLInputElement).checked)">
            <span class="font-medium">{{ group.rule.title }}</span>
            <span class="font-mono text-xs text-zinc-400">{{ group.rule.id }}</span>
            <span class="font-mono text-xs text-zinc-500">[{{ group.rule.namespace }}]</span>
            <!-- R3 类型徽标（有替换 / 仅检测） -->
            <span class="rounded px-1.5 py-0.5 text-[11px]" :class="categoryBadge.cls">{{ t(categoryBadge.labelKey) }}</span>
            <!-- R4 verdict 徽标（verdict prop 未传时整个不渲染 = 报告缺失降级） -->
            <span v-if="verdictInfo" class="rounded-full px-2 py-0.5 text-[11px] font-semibold" :class="verdictInfo.cls">{{ t(verdictInfo.labelKey) }}</span>
            <DimensionBadges :rule="group.rule" />
            <span class="ml-auto rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-xs font-bold text-[var(--text-secondary)]">{{ t("issue.count", {count: group.issues.length}) }}</span>
            <!-- 7a：应用该规则全部（≥2 处可自动替换才出现，单处沿用行内按钮） -->
            <button
                v-if="batchApply && applicableIssues.length >= 2"
                type="button"
                class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
                :title="t('issue.applyGroupTitle')"
                @click="emit('apply-group', applicableIssues)"
            >
                <span class="i-lucide-check-check h-3.5 w-3.5" /> {{ t("issue.applyGroup", {count: applicableIssues.length}) }}
            </button>
            <button
                class="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                :aria-label="t('issue.openRuleTitle', {title: group.rule.title})"
                :title="t('issue.openRuleTitle', {title: group.rule.title})"
                @click="emit('open-rule', group.rule)"
            >
                <span class="i-lucide-info" /> {{ t("issue.openRule") }}
            </button>
            <!-- R1 隐藏此规则（图标钮，只 emit 由宿主写 ruleOverrides；规则页可恢复） -->
            <button
                type="button"
                class="inline-flex items-center rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                :aria-label="t('issue.hideRuleTitle')"
                :title="t('issue.hideRuleTitle')"
                @click="emit('hide-rule', group.rule.id)"
            >
                <span class="i-lucide-eye-off h-3.5 w-3.5" />
            </button>
        </div>
        <!-- 命中列表（点击定位到正文） -->
        <ul class="mt-2 space-y-1">
            <li
                v-for="(issue, index) in visibleIssues"
                :key="issueId(issue)"
                :data-issue-id="issueId(issue)"
                class="group flex gap-1 rounded px-1 py-0.5 text-sm transition-colors hover:bg-[var(--bg-hover)] focus-within:ring-2 focus-within:ring-[var(--accent-main)]/45"
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
.issue-card {
    position: relative;
    border-radius: 3px;
    box-shadow: 3px 3px 0 color-mix(in srgb, var(--manga-ink) 6%, transparent);
}

.issue-card::before {
    position: absolute;
    top: -1px;
    left: 0.75rem;
    width: 2.5rem;
    height: 3px;
    background: var(--accent-main);
    content: "";
}

.issue-card:nth-child(3n + 2)::before {
    background: var(--accent-pop);
}

.issue-card:nth-child(3n)::before {
    background: var(--accent-signal);
}

</style>
