import type {
    Issue,
    ActiveHandlerRuleRecord,
    SemanticRuleRecord,
    DensityRuleRecord,
    RegexRuleRecord,
    RegistryDiagnostic,
    RegistrySummary,
    RuleRegistryCatalogItem,
    RuleLevel,
} from "llmlint/types";
// verdict 值集单源在 evals 侧 RuleStat（纯 import type，构建期擦除；alias `evals`→../evals/lib）。
import type {RuleStat} from "evals/types";
import type {CreativeProfileExclusion, CreativeRuleProfile} from "../shared/rule-profile";

// 复用引擎类型，避免在前端重新定义规则/命中形态。
export type {
    Issue,
    ActiveRuleRecord,
    RegexRuleRecord,
    SemanticRuleRecord,
    DensityRuleRecord,
    ActiveHandlerRuleRecord,
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

/**
 * 评测报告烘进 registry 的 per-rule 判别裁决（Task 13 D-D，来源 = evals/report/report.json 的 rules）。
 * verdict 值集直接取 evals RuleStat（单源）；effectiveLift = max(lift, prevalenceLift)，样本不足时为 null。
 */
export type RuleVerdictBake = {
    verdict: RuleStat["verdict"];
    effectiveLift: number | null;
};

/** 构建期预烘产物 registry.json 的形态（由 scripts/build-registry.ts 生成）。 */
export type LlmlintRegistry = {
    version: string;
    /** 引擎版本单源（Task 13 D-C）：包版本 + 静态扫描规则集内容 hash，服务端 MachineScan 落库用同一值。 */
    engineVersion: string;
    generatedFrom: string;
    catalog: RuleRegistryCatalogItem[];
    namespaceAliases: Record<string, string>;
    loadedRulesets: string[];
    summary: RegistrySummary;
    diagnostics: RegistryDiagnostic[];
    regexRules: RegexRuleRecord[];
    densityRules: DensityRuleRecord[];
    handlerRules: ActiveHandlerRuleRecord[];
    semanticRules: SemanticRuleRecord[];
    /** ruleId → 判别裁决；用于规则排序、展示与创作修复 task profile。 */
    ruleVerdicts?: Record<string, RuleVerdictBake>;
    /** 版本化创作 profile；MachineScan 仍扫描全量，LLM 候选只消费 includedRuleIds。 */
    creativeProfile: CreativeRuleProfile;
};

/**
 * 构建期烘焙产物 rules-report.json 的 per-rule 统计条目（Task 15 P0-B）：
 * = RuleStat 全量统计换名（id → ruleId），文件内已按 effectiveLift 降序预排（null 殿后）。
 */
export type RulesReportEntry = {ruleId: string} & Omit<RuleStat, "id">;

/** rules-report.json 文件形态（web/scripts/build-registry.ts 生成，规则页消费）。 */
export type RulesReport = {
    generatedAt: string;
    /** 与 registry.json 同一次构建的引擎版本戳。 */
    engineVersion: string;
    /** null = 降级（evals/report/report.json 缺失，rules 为空数组，页面注明未跑评测）。 */
    source: "evals/report/report.json" | null;
    /** 判别统计准入门槛；降级时 null。 */
    minSupport: number | null;
    /** 两侧样本篇数（human=reference、ai=render）；降级时 null。 */
    sampleCounts: {human: number; ai: number} | null;
    rules: RulesReportEntry[];
};

/**
 * 规则页一行：规则本体 + 评测统计（按 ruleId join；null = 未入评测 =「未测」）。
 * Task 16 R3：rule 放宽为 regex | semantic 联合——语义规则不参与静态扫描，stat 恒为 null，排在列表最后。
 */
export type RuleCatalogRow = {
    rule: RegexRuleRecord | SemanticRuleRecord;
    stat: RulesReportEntry | null;
    /** 仅 regex 规则可能非空；说明为何未进入 creative-writing profile。 */
    profileExclusion: CreativeProfileExclusion | null;
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

/** 按规则分组后的一组命中，供 IssueList 渲染。rule 取 Issue.rule 联合（regex/handler）。 */
export type RuleGroup = {
    rule: Issue["rule"];
    issues: Issue[];
};

/** 行内高亮区间：文本中的 UTF-16 半开区间 [start, end)，level 取重叠命中中的最高级别。 */
export type HighlightRange = {
    start: number;
    end: number;
    level: RuleLevel;
};
