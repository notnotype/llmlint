export type RuleLevel = "high" | "medium" | "low";

/**
 * 审查受众：决定一条命中默认进入哪个审查出口，独立于严重度 level。
 * 用 agent 而不是 llm，避免和 detector.type === "llm" 撞名（那是“检测手段”，这是“给谁看”）。
 * - agent：需要 Agent/LLM 读上下文判断，check 默认输出。
 * - human：偏人工或作者风格偏好的检查，默认不喂给 Agent。
 * - none：机械/诊断类规则，默认不进入审查输出。
 */
export type Review = "agent" | "human" | "none";

/**
 * 机械修复能力：描述规则能否被确定性替换，预留给未来 opt-in 的 --fix。
 * - auto：单一确定替换，未来可自动修复。
 * - candidate：有删除/替换候选，但仍需判断上下文。
 * - manual：无机械替换，需要人工或 LLM 改写。
 */
export type Fixability = "auto" | "candidate" | "manual";

/** 配置里按规则/命名空间覆盖时的对象形态；与字符串简写并存，可显式 enable/disable 并调整维度。 */
export type RuleOverrideObject = {
    /** 显式启停；未设置=不改变规则的 enable 状态。 */
    enabled?: boolean;
    level?: RuleLevel;
    review?: Review;
    fixability?: Fixability;
};

export type RuleOverride = "off" | "warn" | "error" | RuleLevel | RuleOverrideObject;

/**
 * 归一化后的覆盖项：字符串简写也展开成这个 patch 形态，是 loader 的唯一消费形态。
 * 字符串语法糖：off→{enabled:false}，warn→{enabled:true,level:medium}，error→{enabled:true,level:high}，
 * high/medium/low→{enabled:true,level:X}。未设置的字段表示「不改变」。
 */
export type NormalizedRuleOverride = {
    /** 未设置=不改变 enable 状态。 */
    enabled?: boolean;
    level?: RuleLevel;
    review?: Review;
    fixability?: Fixability;
};

export type RulesetOverride = "off" | "on";

export type LlmlintOutput = "stylish" | "json";

export type LlmlintConfig = {
    /** 启用的规则包。为空时默认使用 builtin/default。 */
    rulesets?: string[];
    /** 允许加载未来 handler rule 的规则包；v1 仍不执行 handler。 */
    trustedRulesets?: string[];
    /** 按规则包启停。 */
    rulesetOverrides?: Record<string, RulesetOverride>;
    /** 按 namespace 批量关闭或调整级别；支持中文 alias。 */
    namespaces?: Record<string, RuleOverride>;
    /** 按规则 ID 覆盖级别；off 表示禁用该规则。 */
    rules?: Record<string, RuleOverride>;
    output?: LlmlintOutput;
};

export type NormalizedLlmlintConfig = {
    rulesets: string[];
    trustedRulesets: string[];
    rulesetOverrides: Record<string, RulesetOverride>;
    namespaces: Record<string, NormalizedRuleOverride>;
    rules: Record<string, NormalizedRuleOverride>;
    output: LlmlintOutput;
};

export type RulesetManifest = {
    id: string;
    title: string;
    version: string;
    description?: string;
    namespaceAliases?: Record<string, string>;
};

export type LintRuleRecord = DeclarativeRuleRecord | HandlerRuleRecord;

export type BaseLintRuleRecord = {
    id: string;
    namespace: string;
    /** 规则包来源由 loader 写入，规则文件中可省略。 */
    ruleset?: string;
    title: string;
    level: RuleLevel;
    /** 审查受众；缺省时由命名空间策略表或 detector/action 推导。 */
    review?: Review;
    /** 修复能力；缺省时由命名空间策略表或 detector/action 推导。 */
    fixability?: Fixability;
    enabled?: boolean;
    note?: string;
    examples?: Array<{
        bad: string;
        good?: string;
        reason?: string;
    }>;
    source?: {
        version?: string;
        canonicalKey?: string;
        importedFrom?: string;
    };
};

export type RegexDetector = {
    type: "regex";
    targets: string[];
    flags?: string;
};

export type LLMDetector = {
    type: "llm";
    prompt: string;
};

export type DeclarativeRuleRecord = BaseLintRuleRecord & {
    detector: RegexDetector | LLMDetector;
    action:
        | {type: "replace"; replacements: string[]}
        | {type: "suggest"; message: string};
};

export type HandlerRuleRecord = BaseLintRuleRecord & {
    handler: {
        type: "module";
        path: string;
        export?: string;
    };
};

export type ActiveRuleRecord = DeclarativeRuleRecord & {
    ruleset: string;
    /** loader 解析后的最终审查受众，下游一定有值。 */
    review: Review;
    /** loader 解析后的最终修复能力，下游一定有值。 */
    fixability: Fixability;
};

export type RegexRuleRecord = ActiveRuleRecord & {
    detector: RegexDetector;
};

export type LLMRuleRecord = ActiveRuleRecord & {
    detector: LLMDetector;
};

export type RegistryDiagnostic = {
    level: "info" | "warning" | "error";
    code: string;
    message: string;
    ruleset?: string;
    ruleId?: string;
    namespace?: string;
    previousRuleset?: string;
    nextRuleset?: string;
};

export type RegistrySummary = {
    rulesets: string[];
    totalRules: number;
    activeRules: number;
    disabledRules: number;
    namespaces: Array<{
        namespace: string;
        totalRules: number;
        activeRules: number;
    }>;
};

export type LoadedRules = {
    rules: ActiveRuleRecord[];
    regexRules: RegexRuleRecord[];
    llmRules: LLMRuleRecord[];
    diagnostics: RegistryDiagnostic[];
    summary: RegistrySummary;
};

/** Markdown 遮罩区间：半开 `[start, end)`，字符索引空间与 scanner 的 `match.index` 一致。 */
export type MaskedRange = [number, number];

export interface Issue {
    rule: RegexRuleRecord;
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
    match: string;
    target: string;
    context: {
        before: string;
        current: string;
        after: string;
    };
}

export type CheckSummary = {
    total: number;
    high: number;
    medium: number;
    low: number;
};

export type CheckJsonReport = {
    kind: "check";
    filePath: string;
    configPath: string | null;
    summary: CheckSummary;
    /** CLI 级别 / 审查受众过滤信息；check 默认按 review 过滤，故一定存在。 */
    filter: CheckFilterInfo;
    registry: RegistrySummary;
    diagnostics: RegistryDiagnostic[];
    issues: Issue[];
};

/** CLI 级别 / 审查受众过滤信息，check 与 check-multi 共用。 */
export type CheckFilterInfo = {
    review: Review | "all";
    hiddenByReview: number;
    minLevel: RuleLevel;
    hiddenByLevel: number;
};

export type LLMRulesJsonReport = {
    kind: "llm-rules";
    configPath: string | null;
    registry: RegistrySummary;
    diagnostics: RegistryDiagnostic[];
    rules: LLMRuleRecord[];
};

/** 多文件 check 的单文件条目。 */
export type CheckFileEntry = {
    filePath: string;
    summary: CheckSummary;
    issues: Issue[];
};

/** 多文件 check 报告；registry/diagnostics/filter 为全局，files 为逐文件结果，summary 为聚合。 */
export type CheckMultiJsonReport = {
    kind: "check-multi";
    configPath: string | null;
    filter: CheckFilterInfo;
    registry: RegistrySummary;
    diagnostics: RegistryDiagnostic[];
    files: CheckFileEntry[];
    summary: CheckSummary;
};

/** fix 命令的逐规则修复计数。 */
export type FixRuleCount = {
    ruleId: string;
    title: string;
    count: number;
};

/** fix 命令的单文件结果（占位/统计用，不含正文）。 */
export type FixFileEntry = {
    filePath: string;
    changed: boolean;
    /** 该文件在可编辑区域内命中的 auto 规则次数。 */
    occurrences: number;
    ruleCounts: FixRuleCount[];
};

/** fix 命令报告。write=false 为 dry-run（仅预览，不落盘）。 */
export type FixReport = {
    kind: "fix";
    configPath: string | null;
    write: boolean;
    files: FixFileEntry[];
    totalOccurrences: number;
};

/** fix 命令在内存中的完整单文件结果（含正文，供预览与写盘）。 */
export type FixFileResult = {
    filePath: string;
    content: string;
    fixed: string;
    changed: boolean;
    issues: Issue[];
};

export type CuratedRulesetReport = {
    rulesetId: string;
    outputRoot: string;
    sourceFiles: string[];
    originalTargets: number;
    rules: number;
    activeRules: number;
    converted: {
        text: number;
        simple: number;
        regex: number;
    };
    replacementConflicts: number;
};

export type CuratedImportJsonReport = {
    kind: "curated-import";
    sourceRoot: string;
    outputRoot: string;
    sourceFiles: number;
    originalTargets: number;
    uniqueRules: number;
    converted: {
        text: number;
        simple: number;
        regex: number;
    };
    skipped: Array<{
        file: string;
        group: string;
        reason: string;
        target?: string;
    }>;
    rulesets: CuratedRulesetReport[];
};
