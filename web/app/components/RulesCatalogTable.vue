<script setup lang="ts">
import {ref} from "vue";
import type {RuleCatalogRow} from "../types";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import {verdictBadge, type VerdictBadge} from "../utils/verdict-badge";
import {CATEGORY_BADGE, ruleCategory, type RuleCategoryBadge} from "../utils/rule-category";
import DimensionBadges from "./DimensionBadges.vue";

// 规则库表格（Task 15 P1-D /rules 页）：规则本体 + 评测判别统计一行一条，点行展开详情。
// Task 16 W2：行放宽为 regex|llm 联合（R3）、概要行类型徽标、行级显示/隐藏开关列（R1）。
// 筛选/搜索/分页状态在父页面（rules.vue），本组件只渲染传入的当前页 rows；
// 隐藏态由父页面从 web settings 读出传入，开关点击只上抛事件不落状态。
const props = withDefaults(defineProps<{
    /** 当前页要渲染的行（已过滤、已分页）。 */
    rows: RuleCatalogRow[];
    /** false = 本次构建缺评测报告（全部行都是未测），表头统计列仍渲染但值全为占位。 */
    hasReport: boolean;
    /** 被用户隐藏（ruleOverrides[id].enabled === false）的规则 id 集合；行渲染弱化视觉 + 开关显示恢复态。 */
    hiddenRuleIds?: ReadonlySet<string>;
}>(), {
    hiddenRuleIds: () => new Set<string>(),
});
const emit = defineEmits<{
    /** R1：切换规则显示/隐藏。hidden = 期望的新状态（true=隐藏）；父页面负责写 web settings。 */
    (e: "toggle-visibility", ruleId: string, hidden: boolean): void;
}>();
const {t} = useLlmlintI18n();

// 展开行集合（ruleId）。翻页/筛选后保留已展开状态无害，不额外清理。
const expandedIds = ref<Set<string>>(new Set());

/** 切换某行的展开态。 */
function toggleExpand(ruleId: string): void {
    const next = new Set(expandedIds.value);
    if (next.has(ruleId)) {
        next.delete(ruleId);
    } else {
        next.add(ruleId);
    }
    expandedIds.value = next;
}

/** 行的 verdict 徽标（Task 16 W0 迁出到 utils/verdict-badge 单源；stat 为 null 时归为未测）。 */
function badgeOf(row: RuleCatalogRow): VerdictBadge {
    return verdictBadge(row.stat?.verdict ?? null);
}

/** 行的分类徽标（语义规则 / 有替换 / 仅检测）。 */
function categoryBadgeOf(row: RuleCatalogRow): RuleCategoryBadge {
    return CATEGORY_BADGE[ruleCategory(row.rule)];
}

/** 是否语义规则：不参与静态扫描 → 无正则 targets、无隐藏开关、统计恒空。 */
function isSemantic(row: RuleCatalogRow): boolean {
    return ruleCategory(row.rule) === "semantic";
}

/** 是否被用户隐藏（父页面从 web settings 读出的集合）。 */
function isHidden(row: RuleCatalogRow): boolean {
    return props.hiddenRuleIds.has(row.rule.id);
}

/** 创作 profile 排除原因的本地化说明。 */
function profileExclusionLabel(row: RuleCatalogRow): string {
    const exclusion = row.profileExclusion;
    if (!exclusion) {
        return "";
    }
    if (exclusion.reason === "noise") {
        return t("rules.profileNoise");
    }
    if (exclusion.reason === "anti") {
        return t("rules.profileAnti");
    }
    return t("rules.profileOverlap", {canonical: exclusion.canonicalRuleId ?? ""});
}

/** 各静态判据的可读入口；语义规则返回 null（模板据此切换为 prompt 概要）。 */
function detectorPatterns(row: RuleCatalogRow): string[] | null {
    if ("handler" in row.rule) {
        return [`builtin: ${row.rule.handler.name}`];
    }
    if (row.rule.detector.type === "semantic") {
        return null;
    }
    if (row.rule.detector.type === "density") {
        return row.rule.detector.patterns.map((pattern) => pattern.target);
    }
    return row.rule.detector.targets;
}

/** 语义规则的判定说明概要（压空白 + 截断 240 字）；正则规则返回 null。 */
function semanticPromptSummary(row: RuleCatalogRow): string | null {
    if ("handler" in row.rule) {
        return null;
    }
    if (row.rule.detector.type !== "semantic") {
        return null;
    }
    const prompt = row.rule.detector.prompt.replace(/\s+/g, " ").trim();
    return prompt.length > 240 ? `${prompt.slice(0, 240)}…` : prompt;
}

/** lift 类数值格式化：null（样本不足）显示占位符。 */
function fmtLift(value: number | null | undefined): string {
    return value === null || value === undefined ? "—" : value.toFixed(2);
}

/** 千字命中率格式化：无统计显示占位符。 */
function fmtRate(value: number | undefined): string {
    return value === undefined ? "—" : value.toFixed(2);
}

/** 文档占比 → 百分数文案。 */
function fmtFrac(value: number): string {
    return `${(value * 100).toFixed(0)}%`;
}
</script>

<template>
    <!-- 规则库表格容器 -->
    <div class="overflow-x-auto rounded-lg border border-[var(--border-color)]">
        <table class="w-full text-sm">
            <thead>
                <tr class="border-b border-[var(--border-color)] bg-[var(--bg-subtle)] text-xs text-[var(--text-muted)]">
                    <th class="w-6 px-2 py-2"></th>
                    <th class="px-2 py-2 text-left font-semibold">{{ t("rules.colRule") }}</th>
                    <th class="whitespace-nowrap px-2 py-2 text-left font-semibold">{{ t("rules.colVerdict") }}</th>
                    <th class="whitespace-nowrap px-2 py-2 text-right font-semibold" :title="t('rules.effLiftHint')">{{ t("rules.colEffLift") }}</th>
                    <th class="whitespace-nowrap px-2 py-2 text-right font-semibold" :title="t('rules.rateHint')">{{ t("rules.colHumanRate") }}</th>
                    <th class="whitespace-nowrap px-2 py-2 text-right font-semibold" :title="t('rules.rateHint')">{{ t("rules.colAiRate") }}</th>
                    <th class="whitespace-nowrap px-2 py-2 text-center font-semibold">{{ t("rules.colVisibility") }}</th>
                </tr>
            </thead>
            <tbody>
                <template v-for="row in props.rows" :key="row.rule.id">
                    <!-- 概要行：点击展开/收起详情；被隐藏的规则整行弱化 -->
                    <tr class="cursor-pointer border-b border-[var(--border-color)]/60 hover:bg-[var(--bg-hover)]" :class="isHidden(row) ? 'opacity-50' : ''" @click="toggleExpand(row.rule.id)">
                        <td class="px-2 py-2 text-center text-[var(--text-muted)]">
                            <span class="inline-block h-3.5 w-3.5 align-middle transition-transform" :class="[expandedIds.has(row.rule.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right']" />
                        </td>
                        <td class="px-2 py-2">
                            <!-- 规则名称 + 类型徽标（R3：LLM 规则 / 有替换 / 仅检测） -->
                            <div class="flex flex-wrap items-center gap-1.5">
                                <span class="font-medium">{{ row.rule.title }}</span>
                                <ScopeBadge :scope="row.rule.scope" />
                                <span class="rounded px-1.5 py-0.5 text-[11px]" :class="categoryBadgeOf(row).cls">{{ t(categoryBadgeOf(row).labelKey) }}</span>
                                <span v-if="row.profileExclusion" class="rounded border border-[var(--status-warning)] bg-[var(--bg-hover)] px-1.5 py-0.5 text-[11px] text-[var(--status-warning)]" :title="profileExclusionLabel(row)">{{ t("rules.profileExcluded") }}</span>
                            </div>
                            <div class="font-mono text-xs text-[var(--text-muted)]">{{ row.rule.id }}</div>
                        </td>
                        <td class="whitespace-nowrap px-2 py-2">
                            <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold" :class="badgeOf(row).cls">{{ t(badgeOf(row).labelKey) }}</span>
                        </td>
                        <td class="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums">{{ fmtLift(row.stat?.effectiveLift) }}</td>
                        <td class="whitespace-nowrap px-2 py-2 text-right tabular-nums text-[var(--text-secondary)]">{{ fmtRate(row.stat?.humanRate) }}</td>
                        <td class="whitespace-nowrap px-2 py-2 text-right tabular-nums text-[var(--text-secondary)]">{{ fmtRate(row.stat?.aiRate) }}</td>
                        <!-- R1 显示/隐藏开关：LLM 规则不参与扫描，无开关 -->
                        <td class="whitespace-nowrap px-2 py-2 text-center">
                            <button
                                v-if="!isSemantic(row)"
                                type="button"
                                class="rounded p-1 text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                                :title="isHidden(row) ? t('rules.showRule') : t('rules.hideRule')"
                                :aria-label="isHidden(row) ? t('rules.showRule') : t('rules.hideRule')"
                                @click.stop="emit('toggle-visibility', row.rule.id, !isHidden(row))"
                            >
                                <span class="inline-block h-4 w-4 align-middle" :class="isHidden(row) ? 'i-lucide-eye-off' : 'i-lucide-eye'" />
                            </button>
                        </td>
                    </tr>
                    <!-- 展开行：规则详情（正则/修复动作/示例）+ 判别统计明细 -->
                    <tr v-if="expandedIds.has(row.rule.id)" class="border-b border-[var(--border-color)]/60 bg-[var(--bg-subtle)]/60">
                        <td></td>
                        <td colspan="6" class="px-2 py-3">
                            <div class="space-y-3 text-sm">
                                <div class="flex flex-wrap items-center gap-2">
                                    <DimensionBadges :rule="row.rule" />
                                    <ScopeBadge :scope="row.rule.scope" />
                                    <span class="font-mono text-xs text-[var(--text-muted)]">{{ row.rule.namespace }} · {{ row.rule.ruleset }}</span>
                                </div>
                                <p v-if="row.rule.note" class="rounded-md bg-[var(--bg-panel)] p-2 text-sm text-[var(--text-secondary)]">{{ row.rule.note }}</p>
                                <p v-if="row.profileExclusion" class="rounded-md border border-[var(--status-warning)] bg-[var(--bg-hover)] p-2 text-sm text-[var(--status-warning)]">{{ profileExclusionLabel(row) }}</p>

                                <!-- 匹配模式（正则 targets）；LLM 规则改为提示词概要 + 未参与静态扫描注记 -->
                                <section v-if="detectorPatterns(row) !== null">
                                    <h4 class="text-xs font-medium text-[var(--text-muted)]">{{ t("ruleDetail.pattern") }}</h4>
                                    <ul class="mt-1 space-y-1">
                                        <li v-for="(target, index) in detectorPatterns(row) ?? []" :key="index" class="overflow-x-auto rounded bg-[var(--bg-panel)] p-1.5 font-mono text-xs">{{ target }}</li>
                                    </ul>
                                </section>
                                <section v-else>
                                    <p class="text-xs text-[var(--text-muted)]">{{ t("rules.semanticNotScanned") }}</p>
                                    <h4 class="mt-2 text-xs font-medium text-[var(--text-muted)]">{{ t("rules.llmPrompt") }}</h4>
                                    <p class="mt-1 rounded bg-[var(--bg-panel)] p-1.5 text-xs text-[var(--text-secondary)]">{{ semanticPromptSummary(row) }}</p>
                                </section>

                                <!-- 修复动作：replace 列出替换词，suggest 显示建议文案 -->
                                <section>
                                    <h4 class="text-xs font-medium text-[var(--text-muted)]">{{ t("ruleDetail.action") }}</h4>
                                    <ul v-if="row.rule.action.type === 'replace'" class="mt-1 space-y-0.5 text-sm">
                                        <li v-for="(rep, index) in row.rule.action.replacements" :key="index" class="font-mono text-xs">
                                            <span v-if="rep === ''" class="text-[var(--text-muted)]">{{ t("ruleDetail.deleteReplacement") }}</span>
                                            <span v-else>{{ rep }}</span>
                                        </li>
                                    </ul>
                                    <p v-else class="mt-1 text-sm text-[var(--text-secondary)]">{{ row.rule.action.message }}</p>
                                </section>

                                <!-- 示例（若规则带） -->
                                <section v-if="row.rule.examples && row.rule.examples.length">
                                    <h4 class="text-xs font-medium text-[var(--text-muted)]">{{ t("ruleDetail.examples") }}</h4>
                                    <ul class="mt-1 space-y-2">
                                        <!-- hit=false 是「形近但不该报」的对照例，不能画成删除线坏例 -->
                                        <li v-for="(ex, index) in row.rule.examples" :key="index" class="text-sm">
                                            <p v-if="ex.hit" class="text-red-600 line-through decoration-red-400 dark:text-red-400">{{ ex.text }}</p>
                                            <p v-else class="text-emerald-700 dark:text-emerald-400">{{ ex.text }}</p>
                                            <p v-if="ex.fix" class="text-emerald-700 dark:text-emerald-400">{{ ex.fix }}</p>
                                            <p v-if="ex.reason" class="text-xs text-[var(--text-muted)]">{{ ex.reason }}</p>
                                        </li>
                                    </ul>
                                </section>

                                <!-- 判别统计明细（已测规则） -->
                                <section v-if="row.stat" class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
                                    <span :title="t('rules.effLiftHint')">{{ t("rules.statLift") }} <b class="text-[var(--text-main)]">{{ fmtLift(row.stat.lift) }}</b></span>
                                    <span>{{ t("rules.statPrevLift") }} <b class="text-[var(--text-main)]">{{ fmtLift(row.stat.prevalenceLift) }}</b></span>
                                    <span>{{ t("rules.statFireFrac", {human: fmtFrac(row.stat.humanFireFrac), ai: fmtFrac(row.stat.aiFireFrac)}) }}</span>
                                    <span>{{ t("rules.statHits", {human: row.stat.humanHits, ai: row.stat.aiHits}) }}</span>
                                    <span>{{ t("rules.statPairs", {aiGreater: row.stat.pairsAiGreater, total: row.stat.pairsTotal}) }}</span>
                                </section>
                                <!-- 未测注记只对 regex 规则显示（LLM 规则的「未参与扫描」注记在上方 prompt 区） -->
                                <p v-else-if="props.hasReport && !isSemantic(row)" class="text-xs text-[var(--text-muted)]">{{ t("rules.untestedNote") }}</p>
                            </div>
                        </td>
                    </tr>
                </template>
                <!-- 空态 -->
                <tr v-if="props.rows.length === 0">
                    <td colspan="7" class="px-2 py-8 text-center text-sm text-[var(--text-muted)]">{{ t("rules.noMatch") }}</td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
