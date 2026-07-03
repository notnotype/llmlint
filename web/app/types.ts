import type {
    Issue,
    LLMRuleRecord,
    RegexRuleRecord,
    RegistryDiagnostic,
    RegistrySummary,
    RuleRegistryCatalogItem,
    RuleLevel,
} from "llmlint/types";

// 复用引擎类型，避免在前端重新定义规则/命中形态。
export type {
    Issue,
    RegexRuleRecord,
    LLMRuleRecord,
    RegistrySummary,
    RegistryDiagnostic,
    CheckSummary,
    CheckJsonReport,
    CheckFilterInfo,
    RuleLevel,
    Review,
    Fixability,
    NormalizedRuleOverride,
    RuleRegistryCatalogItem,
} from "llmlint/types";

/** 构建期预烘产物 registry.json 的形态（由 scripts/build-registry.ts 生成）。 */
export type LlmlintRegistry = {
    version: string;
    generatedFrom: string;
    catalog: RuleRegistryCatalogItem[];
    namespaceAliases: Record<string, string>;
    loadedRulesets: string[];
    summary: RegistrySummary;
    diagnostics: RegistryDiagnostic[];
    regexRules: RegexRuleRecord[];
    llmRules: LLMRuleRecord[];
};

/** 审查受众过滤：agent/human/none 对应 rule.review；all = 不按受众过滤。 */
export type ReviewFilter = "agent" | "human" | "none" | "all";

/** 页面过滤状态。 */
export type UiFilters = {
    review: ReviewFilter;
    /** 只显示 >= 该级别的命中。 */
    minLevel: RuleLevel;
    /** 空数组 = 不按命名空间过滤（全部）。 */
    namespaces: string[];
    /** true = 不做 Markdown 遮罩（等价 CLI --scan-all）。 */
    scanAll: boolean;
};

/** 按规则分组后的一组命中，供 IssueList 渲染。 */
export type RuleGroup = {
    rule: RegexRuleRecord;
    issues: Issue[];
};

/** 行内高亮区间：文本中的 UTF-16 半开区间 [start, end)，level 取重叠命中中的最高级别。 */
export type HighlightRange = {
    start: number;
    end: number;
    level: RuleLevel;
};
