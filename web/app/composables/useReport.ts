import {computed, reactive, ref} from "vue";
import type {Report, RuleStat} from "../report-types";

// 报告查看器逻辑：持有拖入的 report.json + 规则表的排序/筛选/搜索状态 + 派生行。
// 照 useLlmlint 的 ref/reactive/computed 风格；纯浏览器、不发网络。

export type VerdictFilter = "all" | "strong" | "weak" | "noise" | "anti" | "insufficient";
export type SortKey = "effective" | "lift" | "prev" | "human" | "ai" | "pair" | "id";

export function useReport() {
    /** 当前报告；null=还没拖入文件。 */
    const report = ref<Report | null>(null);
    /** 上次加载错误文案；空串=无错。 */
    const error = ref<string>("");

    /** 读一个 File（report.json）→ 解析校验 → 置 report；失败写 error、清 report。 */
    async function loadFile(file: File): Promise<void> {
        error.value = "";
        try {
            const parsed = JSON.parse(await file.text()) as Report;
            if (!parsed || !Array.isArray(parsed.rules) || !parsed.counts || !parsed.detector) {
                throw new Error("不是有效的 llmlint report.json（缺 rules / counts / detector）");
            }
            report.value = parsed;
        } catch (caught) {
            error.value = caught instanceof Error ? caught.message : String(caught);
            report.value = null;
        }
    }

    // 规则表状态：裁决筛选 + 规则名搜索 + 排序列/升降。默认按 effectiveLift 降序（与评测侧一致）。
    const table = reactive<{verdict: VerdictFilter; query: string; sortKey: SortKey; asc: boolean}>({
        verdict: "all",
        query: "",
        sortKey: "effective",
        asc: false,
    });

    /** 某规则在当前排序列上的可比值（数值列返数、id 列返字符串）。 */
    function sortValue(rule: RuleStat): number | string {
        return table.sortKey === "id"
            ? rule.id
            : table.sortKey === "lift"
                ? rule.lift ?? -1
                : table.sortKey === "prev"
                    ? rule.prevalenceLift ?? -1
                    : table.sortKey === "human"
                        ? rule.humanRate
                        : table.sortKey === "ai"
                            ? rule.aiRate
                            : table.sortKey === "pair"
                                ? rule.pairsTotal > 0 ? rule.pairsAiGreater / rule.pairsTotal : -1
                                : rule.effectiveLift ?? -1; // effective（默认）
    }

    /** 过滤(裁决 + 搜规则名) + 排序后的规则行。 */
    const rows = computed<RuleStat[]>(() => {
        const all = report.value?.rules ?? [];
        const query = table.query.trim().toLowerCase();
        const filtered = all.filter(
            (rule) =>
                (table.verdict === "all" || rule.verdict === table.verdict) &&
                (query === "" || rule.id.toLowerCase().includes(query)),
        );
        return [...filtered].sort((left, right) => {
            const leftValue = sortValue(left);
            const rightValue = sortValue(right);
            const cmp =
                typeof leftValue === "number" && typeof rightValue === "number"
                    ? leftValue - rightValue
                    : String(leftValue).localeCompare(String(rightValue));
            return table.asc ? cmp : -cmp;
        });
    });

    /** 点表头：同列切升降，换列则默认降序。 */
    function sortBy(key: SortKey): void {
        if (table.sortKey === key) {
            table.asc = !table.asc;
        } else {
            table.sortKey = key;
            table.asc = false;
        }
    }

    /** 各裁决桶计数（供筛选 chips 显示数量）。 */
    const verdictCounts = computed<Record<string, number>>(() => {
        const out: Record<string, number> = {};
        for (const rule of report.value?.rules ?? []) {
            out[rule.verdict] = (out[rule.verdict] ?? 0) + 1;
        }
        return out;
    });

    return {report, error, loadFile, table, rows, sortBy, verdictCounts};
}
