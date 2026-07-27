<script setup lang="ts">
import {computed, ref, watch} from "vue";
import rulesReportData from "../data/rules-report.json";
import {useLlmlint} from "../composables/useLlmlint";
import {useLlmlintI18n} from "../composables/useLlmlintI18n";
import {useWebSettings} from "../composables/useWebSettings";
import {ruleCategory, type RuleCategory} from "../utils/rule-category";
import type {RuleCatalogRow, RulesReport, RulesReportEntry} from "../types";
import RulesCatalogTable from "../components/RulesCatalogTable.vue";

// 规则页（Task 15 P1-D，拍板⑤）：内置规则全量清单 + 评测判别统计。
// 统计来自构建期烘焙的 rules-report.json（P0-B），规则本体从 registry 按 ruleId join；
// report 缺失的构建 source===null → 降级为纯规则清单并注明「评测数据缺失」。
// Task 16 W2：追加 llmRules 入表（stat 恒 null，殿后）、类型 chips 筛选、行级显示/隐藏开关（R1）。
// JSON import 的字面量推导对大数组过宽，这里与 registry.json 同款做一次收口 cast。
const rulesReport = rulesReportData as unknown as RulesReport;
const {baseRegistry} = useLlmlint();
const {t} = useLlmlintI18n();
const {settings, setRuleOverride} = useWebSettings();

// 是否有评测统计（降级判据 = source 为 null，见 P0-B 契约）。
const hasReport = rulesReport.source !== null;

// 全量行构建（一次性）：已测规则按报告预排（effectiveLift 降序）在前，未测 regex 规则按
// ruleId 字典序居中，LLM 规则（不参与静态扫描，stat 恒 null）按 ruleId 字典序殿后。
// 报告里 ruleId 对不上现行 registry 的条目（规则已删改）直接跳过——规则页以规则本体为准。
const allRows: RuleCatalogRow[] = (() => {
    const ruleById = new Map(baseRegistry.regexRules.map((rule) => [rule.id, rule]));
    const statById = new Map<string, RulesReportEntry>(rulesReport.rules.map((entry) => [entry.ruleId, entry]));
    const tested: RuleCatalogRow[] = [];
    for (const entry of rulesReport.rules) {
        const rule = ruleById.get(entry.ruleId);
        if (rule) {
            tested.push({
                rule,
                stat: entry,
                profileExclusion: baseRegistry.creativeProfile.excludedRules[rule.id] ?? null,
            });
        }
    }
    const untested: RuleCatalogRow[] = baseRegistry.regexRules
        .filter((rule) => !statById.has(rule.id))
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((rule) => ({
            rule,
            stat: null,
            profileExclusion: baseRegistry.creativeProfile.excludedRules[rule.id] ?? null,
        }));
    const semanticRows: RuleCatalogRow[] = [...baseRegistry.semanticRules]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((rule) => ({rule, stat: null, profileExclusion: null}));
    return [...tested, ...untested, ...semanticRows];
})();

// 已测条数（meta 行展示）。
const testedCount = allRows.filter((row) => row.stat !== null).length;

/** verdict 筛选值集：all=不筛，untested=未入报告的规则。 */
type VerdictFilter = "all" | "strong" | "weak" | "noise" | "anti" | "insufficient" | "untested";
const verdictFilter = ref<VerdictFilter>("all");
/** 类型筛选值集（R3）：all=不筛，其余对应 ruleCategory 三分类。 */
type CategoryFilter = "all" | RuleCategory;
const categoryFilter = ref<CategoryFilter>("all");
const query = ref("");

// 筛选 chips 定义（顺序 = 展示顺序）；count 现算，避免和 allRows 双份状态。
const chips = computed<Array<{value: VerdictFilter; label: string; count: number}>>(() => {
    const counts = new Map<string, number>();
    for (const row of allRows) {
        const key = row.stat?.verdict ?? "untested";
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const defs: Array<{value: VerdictFilter; label: string}> = [
        {value: "all", label: t("common.all")},
        {value: "strong", label: t("rules.verdictStrong")},
        {value: "weak", label: t("rules.verdictWeak")},
        {value: "noise", label: t("rules.verdictNoise")},
        {value: "anti", label: t("rules.verdictAnti")},
        {value: "insufficient", label: t("rules.verdictInsufficient")},
        {value: "untested", label: t("rules.verdictUntested")},
    ];
    return defs.map((def) => ({
        ...def,
        count: def.value === "all" ? allRows.length : counts.get(def.value) ?? 0,
    }));
});

// 类型筛选 chips（R3）：全部 / 语义规则 / 有替换 / 仅检测，带计数。
const categoryChips = computed<Array<{value: CategoryFilter; label: string; count: number}>>(() => {
    const counts = new Map<RuleCategory, number>();
    for (const row of allRows) {
        const key = ruleCategory(row.rule);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const defs: Array<{value: CategoryFilter; label: string}> = [
        {value: "all", label: t("common.all")},
        {value: "semantic", label: t("rules.typeSemantic")},
        {value: "replace", label: t("rules.typeReplace")},
        {value: "suggest", label: t("rules.typeSuggest")},
    ];
    return defs.map((def) => ({
        ...def,
        count: def.value === "all" ? allRows.length : counts.get(def.value) ?? 0,
    }));
});

// 过滤：verdict chip + 类型 chip + 文本搜索（规则 ID / 名称 / 说明 / 命名空间，大小写不敏感）。
const filteredRows = computed<RuleCatalogRow[]>(() => {
    const keyword = query.value.trim().toLowerCase();
    return allRows.filter((row) => {
        if (verdictFilter.value !== "all" && (row.stat?.verdict ?? "untested") !== verdictFilter.value) {
            return false;
        }
        if (categoryFilter.value !== "all" && ruleCategory(row.rule) !== categoryFilter.value) {
            return false;
        }
        if (keyword === "") {
            return true;
        }
        return (
            row.rule.id.toLowerCase().includes(keyword) ||
            row.rule.title.toLowerCase().includes(keyword) ||
            (row.rule.note ?? "").toLowerCase().includes(keyword) ||
            row.rule.namespace.toLowerCase().includes(keyword)
        );
    });
});

// 分页（300+ 行 + 行展开详情，分页足够，不上虚拟滚动）。
const PAGE_SIZE = 50;
const page = ref(1);
const pageCount = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / PAGE_SIZE)));
const pagedRows = computed(() => filteredRows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

// 筛选/搜索变化时回到第一页。
watch([verdictFilter, categoryFilter, query], () => {
    page.value = 1;
});

// R1：被隐藏的规则 id 集合（web settings 的 ruleOverrides[id].enabled === false 视为隐藏）。
const hiddenRuleIds = computed<Set<string>>(() => {
    const ids = new Set<string>();
    for (const [ruleId, override] of Object.entries(settings.value.ruleOverrides)) {
        if (override.enabled === false) {
            ids.add(ruleId);
        }
    }
    return ids;
});

/**
 * R1：切换规则显示/隐藏（写 web settings，扫描侧消费同一 override）。
 * 隐藏 = 在既有覆盖上并入 enabled:false；恢复 = 清除 enabled 覆盖（而非写 enabled:true），
 * 其余维度覆盖（level/review/fixability）保留，全空时整条覆盖删除（setRuleOverride(id, null)）。
 */
function toggleRuleVisibility(ruleId: string, hidden: boolean): void {
    const existing = settings.value.ruleOverrides[ruleId];
    if (hidden) {
        setRuleOverride(ruleId, {...existing, enabled: false});
        return;
    }
    const rest = {...existing};
    delete rest.enabled;
    setRuleOverride(ruleId, Object.keys(rest).length > 0 ? rest : null);
}
</script>

<template>
    <!-- 规则页外壳 -->
    <div class="flex min-h-screen flex-col bg-[var(--bg-main)] text-[var(--text-main)]">
        <AppHeader />
        <main class="mx-auto w-full max-w-5xl flex-1 p-4">
            <!-- 页头：标题 + 构建/样本 meta -->
            <div class="mb-4 space-y-1">
                <h1 class="text-lg font-bold">{{ t("rules.title") }}</h1>
                <p class="text-sm text-[var(--text-muted)]">{{ t("rules.description") }}</p>
                <p class="text-xs text-[var(--text-muted)]">
                    {{ t("rules.meta", {total: allRows.length, tested: testedCount, engine: rulesReport.engineVersion}) }}
                    <template v-if="hasReport && rulesReport.sampleCounts">
                        · {{ t("rules.sampleCounts", {human: rulesReport.sampleCounts.human, ai: rulesReport.sampleCounts.ai, minSupport: rulesReport.minSupport ?? 0}) }}
                    </template>
                </p>
            </div>

            <!-- 降级提示：本次构建缺评测报告 -->
            <div v-if="!hasReport" class="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-[var(--text-secondary)]">
                <span class="i-lucide-triangle-alert mr-1 inline-block h-4 w-4 align-text-bottom text-amber-600 dark:text-amber-400" />
                {{ t("rules.degraded") }}
            </div>

            <!-- 筛选区：verdict chips + 类型 chips + 搜索框 -->
            <div class="mb-3 flex flex-wrap items-center gap-2">
                <div class="flex flex-wrap gap-1.5">
                    <button
                        v-for="chip in chips"
                        :key="chip.value"
                        type="button"
                        class="rounded-full border px-3 py-1 text-xs transition"
                        :class="verdictFilter === chip.value
                            ? 'border-[var(--accent-main)] bg-[var(--accent-main)] text-white'
                            : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
                        @click="verdictFilter = chip.value"
                    >{{ chip.label }} {{ chip.count }}</button>
                </div>
                <!-- 类型 chips（R3）：与 verdict chips 并列，双筛选取交集 -->
                <div class="flex flex-wrap gap-1.5 border-l border-[var(--border-color)] pl-2">
                    <button
                        v-for="chip in categoryChips"
                        :key="chip.value"
                        type="button"
                        class="rounded-full border px-3 py-1 text-xs transition"
                        :class="categoryFilter === chip.value
                            ? 'border-[var(--accent-main)] bg-[var(--accent-main)] text-white'
                            : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
                        @click="categoryFilter = chip.value"
                    >{{ chip.label }} {{ chip.count }}</button>
                </div>
                <input
                    v-model="query"
                    type="search"
                    :placeholder="t('rules.searchPlaceholder')"
                    class="ml-auto w-56 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-sm outline-none focus:border-[var(--accent-main)]"
                >
            </div>

            <!-- 规则表格（当前页）；隐藏集合与开关事件接 web settings（R1） -->
            <RulesCatalogTable :rows="pagedRows" :has-report="hasReport" :hidden-rule-ids="hiddenRuleIds" @toggle-visibility="toggleRuleVisibility" />

            <!-- 分页条 -->
            <div v-if="pageCount > 1" class="mt-3 flex items-center justify-center gap-3 text-sm text-[var(--text-muted)]">
                <button
                    type="button"
                    class="rounded border border-[var(--border-color)] px-2 py-1 text-xs hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                    :disabled="page <= 1"
                    @click="page -= 1"
                >{{ t("rules.pagePrev") }}</button>
                <span class="tabular-nums">{{ t("rules.pageInfo", {page, pages: pageCount, count: filteredRows.length}) }}</span>
                <button
                    type="button"
                    class="rounded border border-[var(--border-color)] px-2 py-1 text-xs hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                    :disabled="page >= pageCount"
                    @click="page += 1"
                >{{ t("rules.pageNext") }}</button>
            </div>
        </main>
    </div>
</template>
