import {computed} from "vue";
import {computeMaskedRanges} from "llmlint/markdown-mask";
import {prepareScanContext} from "llmlint/scan-context";
import {scanHandlerRules, scanText, scanWithContext} from "llmlint/scanner";
import {applyAutoFixWithChanges, type AutoFixChange} from "llmlint/fix";
import {materializeRules} from "llmlint/rule-registry";
import {projectCheckIssues} from "llmlint/check-report";
import registryData from "../data/registry.json";
import {useWebSettings} from "./useWebSettings";
import type {CheckJsonReport, CheckSummary, HighlightRange, Issue, LlmlintRegistry, RuleGroup, RuleLevel, UiFilters} from "../types";
import {columnToOffset, issueAtOffset as findIssueAtOffset, issueStartOffset, utf16LineStarts} from "../utils/review-ranges";

// 构建期预烘的规则数据。浏览器只 import 它 + 调纯函数扫描，不读文件系统、不发网络。
const baseRegistry = registryData as unknown as LlmlintRegistry;

const LEVEL_RANK: Record<string, number> = {high: 3, medium: 2, low: 1};

function higherLevel(left: RuleLevel, right: RuleLevel): RuleLevel {
    return (LEVEL_RANK[left] ?? 0) >= (LEVEL_RANK[right] ?? 0) ? left : right;
}

/**
 * llmlint 客户端检测核心。所有函数都是纯计算：
 * - scan：对整段文本跑一次 regex 扫描（scanAll=true 时跳过 Markdown 遮罩）。
 * - applyFilters / summarize / groupByRule：对命中列表做纯过滤/统计/分组。
 * - issueRanges：把命中反算成合并后的高亮区间（供行内高亮背板）。
 * - namespaceOptions：registry 里出现过的命名空间，供过滤下拉。
 */
export function useLlmlint() {
    const {settings} = useWebSettings();
    const registry = computed<LlmlintRegistry>(() => {
        const loaded = materializeRules({
            catalog: baseRegistry.catalog,
            config: {
                rulesets: ["builtin/default"],
                trustedRulesets: [],
                rulesetOverrides: {},
                namespaces: settings.value.namespaceOverrides,
                rules: settings.value.ruleOverrides,
                ignoreTerms: [],
                output: "json",
            },
            diagnostics: baseRegistry.diagnostics,
            namespaceAliases: baseRegistry.namespaceAliases,
            loadedRulesets: baseRegistry.loadedRulesets,
        });
        return {
            ...baseRegistry,
            summary: loaded.summary,
            regexRules: loaded.regexRules,
            densityRules: loaded.densityRules,
            handlerRules: loaded.handlerRules,
            llmRules: loaded.llmRules,
        };
    });

    function scan(text: string, scanAll: boolean): Issue[] {
        if (!text.trim()) {
            return [];
        }
        const maskedRanges = scanAll ? [] : computeMaskedRanges(text);
        const ctx = prepareScanContext(text, {maskedRanges});
        return [...scanWithContext(ctx, registry.value.regexRules), ...scanHandlerRules(ctx, registry.value.handlerRules)];
    }

    function scanDefault(text: string, scanAll: boolean): Issue[] {
        if (!text.trim()) {
            return [];
        }
        const maskedRanges = scanAll ? [] : computeMaskedRanges(text);
        const ctx = prepareScanContext(text, {maskedRanges});
        return [...scanWithContext(ctx, baseRegistry.regexRules), ...scanHandlerRules(ctx, baseRegistry.handlerRules)];
    }

    function applyFilters(issues: Issue[], filters: UiFilters): Issue[] {
        return issues.filter((issue) => {
            if (filters.review !== "all" && issue.rule.review !== filters.review) {
                return false;
            }
            if ((LEVEL_RANK[issue.rule.level] ?? 0) < (LEVEL_RANK[filters.minLevel] ?? 0)) {
                return false;
            }
            if (filters.namespaces.length > 0 && !filters.namespaces.includes(issue.rule.namespace)) {
                return false;
            }
            return true;
        });
    }

    function summarize(issues: Issue[]): CheckSummary {
        const summary: CheckSummary = {total: issues.length, high: 0, medium: 0, low: 0};
        for (const issue of issues) {
            summary[issue.rule.level] += 1;
        }
        return summary;
    }

    // 判别强度排序权重（Task 17 需求 4）：强判别规则排最前，反指标殿后；未测/数据不足居中偏后。
    const VERDICT_RANK: Record<string, number> = {strong: 5, weak: 4, insufficient: 2, noise: 1, anti: 0};
    const UNTESTED_RANK = 3;

    /** 规则的判别强度权重（未烘焙 verdicts 时全部同权=退化为原命中数排序）。 */
    function verdictRank(ruleId: string): number {
        const verdicts = baseRegistry.ruleVerdicts;
        if (verdicts === undefined) {
            return UNTESTED_RANK;
        }
        const verdict = verdicts[ruleId]?.verdict;
        return verdict === undefined ? UNTESTED_RANK : VERDICT_RANK[verdict] ?? UNTESTED_RANK;
    }

    function groupByRule(issues: Issue[]): RuleGroup[] {
        const groups = new Map<string, RuleGroup>();
        for (const issue of issues) {
            const existing = groups.get(issue.rule.id);
            if (existing) {
                existing.issues.push(issue);
            } else {
                groups.set(issue.rule.id, {rule: issue.rule, issues: [issue]});
            }
        }
        // 判别强度优先（strong 组最前，用户先处理最像 AI 的问题），同档内命中密集的排前面（Task 17 需求 4）。
        return [...groups.values()].sort((left, right) => {
            const rankDiff = verdictRank(right.rule.id) - verdictRank(left.rule.id);
            return rankDiff !== 0 ? rankDiff : right.issues.length - left.issues.length;
        });
    }

    function namespaceOptions(): string[] {
        const set = new Set<string>();
        for (const item of baseRegistry.catalog) {
            if ("detector" in item.rule && item.rule.detector.type === "regex") {
                set.add(item.rule.namespace);
            }
        }
        return [...set].sort();
    }

    function activeNamespaceOptions(): string[] {
        const set = new Set<string>();
        for (const rule of registry.value.regexRules) {
            set.add(rule.namespace);
        }
        return [...set].sort();
    }

    // 把命中反算成文本 UTF-16 区间并合并重叠（重叠段取最高级别），供行内高亮背板着色。
    function issueRanges(text: string, issues: Issue[]): HighlightRange[] {
        if (!text || issues.length === 0) {
            return [];
        }
        const lineStarts = utf16LineStarts(text);
        const raw = issues
            .map((issue): HighlightRange => {
                const start = columnToOffset(text, lineStarts, issue.line, issue.column);
                return {start, end: start + issue.match.length, level: issue.rule.level};
            })
            .filter((range) => range.end > range.start)
            .sort((left, right) => left.start - right.start);

        const merged: HighlightRange[] = [];
        for (const range of raw) {
            const last = merged.at(-1);
            if (last && range.start <= last.end) {
                last.end = Math.max(last.end, range.end);
                last.level = higherLevel(last.level, range.level);
            } else {
                merged.push({...range});
            }
        }
        return merged;
    }

    // 单条命中的绝对 UTF-16 起点偏移（供列表→正文定位）。
    function offsetOf(text: string, issue: Issue): number {
        return issueStartOffset(text, issue);
    }

    // 找命中区间覆盖某偏移的 issue（供正文→列表定位）；无则返回 null。
    function issueAtOffset(text: string, issues: Issue[], offset: number): Issue | null {
        return findIssueAtOffset(text, issues, offset);
    }

    // 一键机械修复（fixability:auto）：只清零宽字符 / 连续标点等无需语境判断的问题。
    // report verdict 衡量 AI 判别力，不决定机械修复安全性；candidate 永远不进入这里。
    function autoFix(text: string, scanAll: boolean): {fixed: string; count: number; changes: AutoFixChange[]} {
        if (!text) {
            return {fixed: text, count: 0, changes: []};
        }
        const autoRules = registry.value.regexRules.filter((rule) => rule.fixability === "auto");
        const maskedRanges = scanAll ? [] : computeMaskedRanges(text);
        const result = applyAutoFixWithChanges(text, autoRules, maskedRanges);
        const count = scanText(text, autoRules, {maskedRanges}).length;
        return {fixed: result.fixed, count, changes: result.changes};
    }

    // 组出 CLI 同构的 CheckJsonReport（供「复制 JSON」）：先按 review，再按 level 统计隐藏数，最后套用 Web 额外的 namespace 视图过滤。
    function buildReport(allIssues: Issue[], filters: UiFilters): CheckJsonReport {
        const afterReview = filters.review === "all"
            ? allIssues
            : allIssues.filter((issue) => issue.rule.review === filters.review);
        const hiddenByReview = allIssues.length - afterReview.length;
        const afterLevel = afterReview.filter((issue) => (LEVEL_RANK[issue.rule.level] ?? 0) >= (LEVEL_RANK[filters.minLevel] ?? 0));
        const hiddenByLevel = afterReview.length - afterLevel.length;
        const issues = filters.namespaces.length > 0
            ? afterLevel.filter((issue) => filters.namespaces.includes(issue.rule.namespace))
            : afterLevel;
        // 与 CLI 同一份投影：规则元数据去重到顶层 rules，registry 去掉逐 namespace 明细。
        const projected = projectCheckIssues(issues);
        const {namespaces: _namespaces, ...compactRegistry} = registry.value.summary;
        return {
            kind: "check",
            filePath: "(web input)",
            configPath: null,
            summary: summarize(issues),
            filter: {review: filters.review, hiddenByReview, minLevel: filters.minLevel, hiddenByLevel},
            registry: compactRegistry,
            diagnostics: registry.value.diagnostics,
            rules: projected.rules,
            issues: projected.issues,
        };
    }

    return {registry, baseRegistry, scan, scanDefault, applyFilters, summarize, groupByRule, issueRanges, offsetOf, issueAtOffset, autoFix, buildReport, namespaceOptions, activeNamespaceOptions};
}
