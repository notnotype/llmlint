<script setup lang="ts">
import type {RuleStat} from "../report-types";
import type {SortKey, VerdictFilter} from "../composables/useReport";

// 规则体检表：可按表头排序、按裁决筛、搜规则名。状态在父组件（useReport），本组件只读 + emit 意图。
const props = defineProps<{
    rows: RuleStat[];
    counts: Record<string, number>;
    total: number;
    table: {verdict: VerdictFilter; query: string; sortKey: SortKey; asc: boolean};
}>();
const emit = defineEmits<{(e: "sort", key: SortKey): void; (e: "set-verdict", v: VerdictFilter): void; (e: "set-query", q: string): void}>();

// 列定义：有 key 的可排序。
type Col = {key?: SortKey; label: string; num?: boolean; title?: string};
const COLS: Col[] = [
    {key: "id", label: "规则"},
    {label: "ns"},
    {label: "审查"},
    {key: "effective", label: "effLift", num: true, title: "max(lift, prevLift)：裁决/排序口径"},
    {key: "lift", label: "lift", num: true, title: "rate 口径：AI/人 千字命中率之比"},
    {key: "prev", label: "prevLift", num: true, title: "prevalence：AI/人 命中文档占比之比"},
    {key: "human", label: "人类率", num: true},
    {key: "ai", label: "AI率", num: true},
    {label: "裁决"},
    {label: "跨题材", num: true, title: "byGenre 里 lift≥3 的题材数 / 出现题材数"},
    {key: "pair", label: "配对", num: true, title: "逐章 AI率 > 人类率 的比例"},
];

// 裁决筛选 chips。
const CHIPS: Array<{v: VerdictFilter; label: string}> = [
    {v: "all", label: "全部"},
    {v: "strong", label: "强判别"},
    {v: "weak", label: "弱"},
    {v: "noise", label: "噪声"},
    {v: "anti", label: "反指标"},
    {v: "insufficient", label: "数据不足"},
];

// 裁决色码（写全字面 class 让 UnoCSS 静态扫到）。
const VERDICT: Record<string, {label: string; cls: string}> = {
    strong: {label: "强判别", cls: "bg-emerald-600 text-white"},
    weak: {label: "弱", cls: "bg-amber-500 text-white"},
    noise: {label: "噪声", cls: "bg-zinc-400 text-white"},
    anti: {label: "反指标", cls: "bg-red-600 text-white"},
    insufficient: {label: "数据不足", cls: "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"},
};

const fmtLift = (value: number | null): string => (value === null ? "—" : value.toFixed(2));
const reviewCls = (review: string): string =>
    review === "agent"
        ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
        : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";

function genre(rule: RuleStat): string {
    const genres = Object.values(rule.byGenre);
    if (genres.length === 0) {
        return "—";
    }
    return `${genres.filter((item) => (item.lift ?? 0) >= 3).length}/${genres.length}`;
}
function pairPct(rule: RuleStat): number {
    return rule.pairsTotal > 0 ? (rule.pairsAiGreater / rule.pairsTotal) * 100 : 0;
}
function countOf(chip: VerdictFilter): number {
    return chip === "all" ? props.total : props.counts[chip] ?? 0;
}
</script>

<template>
    <section class="rounded-lg border border-zinc-200 dark:border-zinc-800">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
            <h2 class="text-sm font-semibold">规则体检表 <span class="font-normal text-zinc-500">（点表头排序）</span></h2>
            <input
                type="search"
                placeholder="搜规则名…"
                class="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                :value="table.query"
                @input="emit('set-query', ($event.target as HTMLInputElement).value)"
            >
        </div>
        <!-- 裁决筛选 chips -->
        <div class="flex flex-wrap gap-1.5 border-b border-zinc-200 p-3 dark:border-zinc-800">
            <button
                v-for="chip in CHIPS"
                :key="chip.v"
                class="rounded-full border px-3 py-1 text-xs"
                :class="table.verdict === chip.v ? 'border-blue-600 bg-blue-600 text-white' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'"
                @click="emit('set-verdict', chip.v)"
            >{{ chip.label }} {{ countOf(chip.v) }}</button>
        </div>
        <!-- 表格 -->
        <div class="overflow-x-auto">
            <table class="w-full text-xs">
                <thead>
                    <tr class="border-b border-zinc-200 dark:border-zinc-800">
                        <th
                            v-for="col in COLS"
                            :key="col.label"
                            class="whitespace-nowrap px-2 py-2 font-semibold"
                            :class="[col.num ? 'text-right' : 'text-left', col.key ? 'cursor-pointer select-none hover:bg-zinc-100 dark:hover:bg-zinc-800' : '']"
                            :title="col.title"
                            @click="col.key && emit('sort', col.key)"
                        >
                            {{ col.label }}<span v-if="col.key && table.sortKey === col.key" class="ml-0.5 text-zinc-400">{{ table.asc ? "▲" : "▼" }}</span>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="rule in rows" :key="rule.id" class="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/50">
                        <td class="whitespace-nowrap px-2 py-1.5 font-mono">{{ rule.id }}</td>
                        <td class="whitespace-nowrap px-2 py-1.5 font-mono text-zinc-500">{{ rule.namespace }}</td>
                        <td class="px-2 py-1.5"><span class="rounded px-1.5 py-0.5 text-[11px]" :class="reviewCls(rule.review)">{{ rule.review }}</span></td>
                        <td class="px-2 py-1.5 text-right font-semibold">{{ fmtLift(rule.effectiveLift) }}</td>
                        <td class="px-2 py-1.5 text-right">{{ fmtLift(rule.lift) }}</td>
                        <td class="px-2 py-1.5 text-right font-semibold text-blue-700 dark:text-blue-300">{{ fmtLift(rule.prevalenceLift) }}</td>
                        <td class="px-2 py-1.5 text-right">{{ rule.humanRate.toFixed(2) }}</td>
                        <td class="px-2 py-1.5 text-right">{{ rule.aiRate.toFixed(2) }}</td>
                        <td class="px-2 py-1.5"><span class="rounded-full px-2 py-0.5 text-[11px] font-semibold" :class="VERDICT[rule.verdict]?.cls">{{ VERDICT[rule.verdict]?.label ?? rule.verdict }}</span></td>
                        <td class="px-2 py-1.5 text-right">{{ genre(rule) }}</td>
                        <td class="px-2 py-1.5 text-right">
                            <span class="relative inline-block h-4 w-14 rounded bg-zinc-100 align-middle dark:bg-zinc-800" :title="`${rule.pairsAiGreater}/${rule.pairsTotal}`">
                                <span class="absolute inset-y-0 left-0 rounded bg-blue-200 dark:bg-blue-800" :style="{width: pairPct(rule) + '%'}" />
                                <span class="absolute inset-0 text-center text-[11px] leading-4">{{ rule.pairsAiGreater }}/{{ rule.pairsTotal }}</span>
                            </span>
                        </td>
                    </tr>
                    <tr v-if="rows.length === 0">
                        <td :colspan="COLS.length" class="px-2 py-6 text-center text-zinc-500">无匹配规则</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </section>
</template>
