import {createColors} from "picocolors";
import type {CheckFileEntry, CheckFilterInfo, CheckJsonReport, CheckMultiJsonReport, CheckSummary, FixFileEntry, FixFileResult, FixReport, FixRuleCount, Issue, LLMRuleRecord, LLMRulesJsonReport, LoadedRules, RegistryDiagnostic, Review, RuleLevel} from "./types";

/** picocolors 着色器；createColors(false) 时所有方法为恒等，输出纯文本。 */
type Painter = ReturnType<typeof createColors>;

const LEVEL_ORDER: RuleLevel[] = ["high", "medium", "low"];
const MAX_MATCH_TEXT_LENGTH = 80;

export type CheckReportOptions = {
    minLevel?: RuleLevel;
    /** 被级别过滤隐藏的命中数。 */
    hiddenByLevel?: number;
    /** 当前审查受众过滤；all 表示不过滤。 */
    review?: Review | "all";
    /** 被审查受众过滤隐藏的命中数。 */
    hiddenByReview?: number;
    showLines?: boolean;
    /** 多文件模式下抑制重复的诊断块；缺省 true（单文件时正常展示）。 */
    includeDiagnostics?: boolean;
    /** 是否对 stylish 输出着色；由 CLI 按 TTY/NO_COLOR/非 json 决定，缺省 false。 */
    color?: boolean;
};

export function formatCheckReport(filePath: string, issues: Issue[], loadedRules: LoadedRules, options: CheckReportOptions = {}): string {
    const pc = createColors(options.color ?? false);
    const lines: string[] = [
        pc.bold(filePath),
        "",
        ...(options.includeDiagnostics === false ? [] : formatDiagnostics(loadedRules.diagnostics, pc)),
    ];
    const hiddenByReview = options.hiddenByReview ?? 0;
    const hiddenByLevel = options.hiddenByLevel ?? 0;
    if (issues.length === 0) {
        const hiddenNote = formatHiddenNote(hiddenByReview, hiddenByLevel);
        lines.push(hiddenNote ? `${pc.green("✓ No problems found in current view.")}${hiddenNote}` : pc.green("✓ No problems found"));
        return lines.join("\n");
    }

    const summary = summarizeIssues(issues);
    const filterHeader = formatFilterHeader(options.review, hiddenByReview, options.minLevel, hiddenByLevel);
    if (filterHeader.length > 0) {
        lines.push(...filterHeader);
        lines.push("");
    }

    for (const level of LEVEL_ORDER) {
        const levelIssues = issues.filter((issue) => issue.rule.level === level);
        if (levelIssues.length === 0) {
            continue;
        }
        lines.push(colorizeLevel(pc, level, `${level} (${levelIssues.length} problem${levelIssues.length > 1 ? "s" : ""})`));
        lines.push("");

        for (const ruleIssues of groupByRule(levelIssues).values()) {
            const firstIssue = ruleIssues[0];
            if (!firstIssue) {
                continue;
            }
            const rule = firstIssue.rule;
            lines.push(`${pc.cyan(rule.id)} ${pc.dim(`[${rule.namespace}]`)} (${rule.title})`);
            lines.push(pc.dim(`  来源：${rule.ruleset}；级别：${rule.level}；审查：${rule.review}；修复：${rule.fixability}`));

            for (const issue of ruleIssues) {
                lines.push(options.showLines
                    ? `  ${formatIssueRange(issue)}  ${formatMarkedLine(issue)}`.trimEnd()
                    : `  ${formatIssueRange(issue)}  match: ${pc.yellow(formatMatchText(issue.match))}`);
                if (options.showLines) {
                    lines.push("");
                }
            }
            if (!options.showLines) {
                lines.push("");
            }

            const occurrenceText = ruleIssues.length === 1 ? "occurrence" : "occurrences";
            lines.push(`  ${ruleIssues.length} ${occurrenceText}. ${formatAction(rule.action)}`);
            if (rule.note) {
                lines.push(pc.dim(`  说明：${rule.note}`));
            }
            lines.push("");
        }
    }

    const parts = [];
    if (summary.high > 0) parts.push(`${summary.high} high`);
    if (summary.medium > 0) parts.push(`${summary.medium} medium`);
    if (summary.low > 0) parts.push(`${summary.low} low`);
    // 隐藏统计只在顶部过滤表头展示一次，总结行不重复。
    lines.push(pc.red(`✖ ${summary.total} problem${summary.total > 1 ? "s" : ""} (${parts.join(", ")})`));

    return lines.join("\n");
}

/** 按级别给文本上色：high 红粗、medium 黄、low 暗。 */
function colorizeLevel(pc: Painter, level: RuleLevel, text: string): string {
    if (level === "high") {
        return pc.red(pc.bold(text));
    }
    if (level === "medium") {
        return pc.yellow(text);
    }
    return pc.dim(text);
}

/** 拼出过滤表头：审查受众一行 + 级别一行，仅在确实隐藏了命中时显示。 */
function formatFilterHeader(review: Review | "all" | undefined, hiddenByReview: number, minLevel: RuleLevel | undefined, hiddenByLevel: number): string[] {
    const header: string[] = [];
    if (review && review !== "all" && hiddenByReview > 0) {
        header.push(`显示范围：review=${review}；已隐藏 ${hiddenByReview} 条非 ${review} 命中。`);
    }
    if (minLevel && minLevel !== "low") {
        header.push(`显示级别：${minLevel} 及以上；已隐藏 ${hiddenByLevel} 条较低级别命中。`);
    }
    return header;
}

/** 总结行尾部的隐藏统计，按审查受众与级别两个桶分开计数。 */
function formatHiddenNote(hiddenByReview: number, hiddenByLevel: number): string {
    const parts: string[] = [];
    if (hiddenByReview > 0) parts.push(`${hiddenByReview} 条按审查受众隐藏`);
    if (hiddenByLevel > 0) parts.push(`${hiddenByLevel} 条按级别隐藏`);
    return parts.length > 0 ? ` 已隐藏：${parts.join("，")}。` : "";
}

export function createCheckJsonReport(filePath: string, configPath: string | null, issues: Issue[], loadedRules: LoadedRules, options: CheckReportOptions = {}): CheckJsonReport {
    return {
        kind: "check",
        filePath,
        configPath,
        summary: summarizeIssues(issues),
        filter: {
            review: options.review ?? "agent",
            hiddenByReview: options.hiddenByReview ?? 0,
            minLevel: options.minLevel ?? "low",
            hiddenByLevel: options.hiddenByLevel ?? 0,
        },
        registry: loadedRules.summary,
        diagnostics: loadedRules.diagnostics,
        issues,
    };
}

/** 多文件汇总行：文件数、有命中文件数、各级别总数。 */
export function formatCheckAggregate(files: CheckFileEntry[], color = false): string {
    const pc = createColors(color);
    const summary = aggregateSummary(files);
    const filesWithIssues = files.filter((file) => file.issues.length > 0).length;
    const parts: string[] = [];
    if (summary.high > 0) parts.push(`${summary.high} high`);
    if (summary.medium > 0) parts.push(`${summary.medium} medium`);
    if (summary.low > 0) parts.push(`${summary.low} low`);
    const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
    return pc.bold(`═══ 汇总：${files.length} 个文件，${filesWithIssues} 个有命中，共 ${summary.total} problem${summary.total === 1 ? "" : "s"}${detail} ═══`);
}

export function createMultiCheckJsonReport(configPath: string | null, files: CheckFileEntry[], loadedRules: LoadedRules, filter: CheckFilterInfo): CheckMultiJsonReport {
    return {
        kind: "check-multi",
        configPath,
        filter,
        registry: loadedRules.summary,
        diagnostics: loadedRules.diagnostics,
        files: files.map((file) => ({filePath: file.filePath, summary: file.summary, issues: file.issues})),
        summary: aggregateSummary(files),
    };
}

/** 把各文件 summary 相加得到聚合 summary。 */
function aggregateSummary(files: CheckFileEntry[]): CheckSummary {
    const summary: CheckSummary = {total: 0, high: 0, medium: 0, low: 0};
    for (const file of files) {
        summary.total += file.summary.total;
        summary.high += file.summary.high;
        summary.medium += file.summary.medium;
        summary.low += file.summary.low;
    }
    return summary;
}

export function createLLMRulesJsonReport(configPath: string | null, loadedRules: LoadedRules): LLMRulesJsonReport {
    return {
        kind: "llm-rules",
        configPath,
        registry: loadedRules.summary,
        diagnostics: loadedRules.diagnostics,
        rules: loadedRules.llmRules,
    };
}

export function formatJsonReport(report: CheckJsonReport | CheckMultiJsonReport | FixReport | LLMRulesJsonReport): string {
    return JSON.stringify(report, null, 2);
}

/** fix 命令的 stylish 输出：逐文件规则计数 + 变更行预览，末尾汇总。 */
export function formatFixReport(results: FixFileResult[], write: boolean, color = false): string {
    const pc = createColors(color);
    const sections: string[] = [];
    let total = 0;
    for (const result of results) {
        total += result.issues.length;
        if (!result.changed) {
            sections.push(`${pc.bold(result.filePath)}\n  ${pc.green("✓ 无可自动修复项")}`);
            continue;
        }
        const lines: string[] = [pc.bold(result.filePath)];
        for (const [ruleId, ruleIssues] of groupByRule(result.issues)) {
            lines.push(`  ${pc.cyan(ruleId)} (${ruleIssues[0]?.rule.title ?? ""})：${ruleIssues.length} 处`);
        }
        const changedLines = collectChangedLines(result.content, result.fixed).slice(0, 5);
        if (changedLines.length > 0) {
            lines.push("  预览（before → after）：");
            for (const changed of changedLines) {
                lines.push(`    L${changed.line}: ${pc.red(changed.before)} → ${pc.green(changed.after)}`);
            }
        }
        lines.push(write
            ? pc.green(`  已写入 ${result.issues.length} 处修复`)
            : pc.yellow(`  ${result.issues.length} 处可修复（dry-run，加 --write 落盘）`));
        sections.push(lines.join("\n"));
    }
    const verb = write ? "已修复" : "可修复（dry-run）";
    sections.push(pc.bold(`═══ ${verb}：${results.length} 个文件，共 ${total} 处 ═══`));
    return sections.join("\n\n");
}

export function createFixJsonReport(configPath: string | null, results: FixFileResult[], write: boolean): FixReport {
    const files: FixFileEntry[] = results.map((result) => ({
        filePath: result.filePath,
        changed: result.changed,
        occurrences: result.issues.length,
        ruleCounts: countByRule(result.issues),
    }));
    return {
        kind: "fix",
        configPath,
        write,
        files,
        totalOccurrences: files.reduce((sum, file) => sum + file.occurrences, 0),
    };
}

/** 把命中按规则聚成 {ruleId, title, count} 列表，供 JSON 报告用。 */
function countByRule(issues: Issue[]): FixRuleCount[] {
    return [...groupByRule(issues).entries()].map(([ruleId, ruleIssues]) => ({
        ruleId,
        title: ruleIssues[0]?.rule.title ?? "",
        count: ruleIssues.length,
    }));
}

/** 逐行比较 before/after，返回有差异的行（零宽等不可见字符会被显形）。auto 修复不增删行，行号一一对应。 */
function collectChangedLines(before: string, after: string): Array<{line: number; before: string; after: string}> {
    const beforeLines = before.split("\n");
    const afterLines = after.split("\n");
    const changes: Array<{line: number; before: string; after: string}> = [];
    for (let index = 0; index < beforeLines.length; index++) {
        const beforeLine = beforeLines[index] ?? "";
        const afterLine = afterLines[index] ?? "";
        if (beforeLine !== afterLine) {
            changes.push({line: index + 1, before: revealInvisible(renderInline(beforeLine)), after: revealInvisible(renderInline(afterLine))});
        }
    }
    return changes;
}

/** 把零宽 / BOM 等不可见字符显形为可见标记（用码点构造，源码内不出现不可见字符）。 */
function revealInvisible(text: string): string {
    const invisibleCodes = [0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF];
    const charClass = invisibleCodes.map((code) => String.fromCharCode(code)).join("");
    return text.replace(new RegExp(`[${charClass}]`, "g"), "▯");
}

export function formatLLMRules(rules: LLMRuleRecord[], diagnostics: RegistryDiagnostic[], color = false): string {
    const pc = createColors(color);
    const lines: string[] = [
        ...formatDiagnostics(diagnostics, pc),
        pc.bold("LLM 判断规则"),
        "",
        "说明：以下规则需要 Agent 根据上下文主动审查，不由 CLI 静态扫描命中。",
        "",
    ];

    if (rules.length === 0) {
        lines.push("当前没有启用需要全文语义审查的 LLM 规则。");
        return lines.join("\n");
    }

    for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {
        const rule = rules[ruleIndex];
        if (!rule) {
            continue;
        }
        lines.push(`规则 ${ruleIndex + 1}: ${pc.cyan(rule.id)} - ${rule.title}`);
        lines.push("");
        lines.push(`namespace: ${rule.namespace}`);
        lines.push("");
        lines.push(`来源: ${rule.ruleset}`);
        lines.push("");
        lines.push(`级别: ${rule.level}`);
        lines.push("");
        if (rule.note) {
            lines.push(`说明: ${rule.note}`);
            lines.push("");
        }
        lines.push("判断标准:");
        lines.push("");
        lines.push(rule.detector.prompt);
        lines.push("");

        if (rule.examples && rule.examples.length > 0) {
            lines.push("判断示例:");
            lines.push("");
            for (let i = 0; i < rule.examples.length; i++) {
                const example = rule.examples[i];
                if (!example) {
                    continue;
                }
                lines.push(`示例 ${i + 1}:`);
                lines.push("");
                lines.push(`坏例: ${example.bad}`);
                if (example.good) {
                    lines.push("");
                    lines.push(`好例: ${example.good}`);
                }
                if (example.reason) {
                    lines.push("");
                    lines.push(`理由: ${example.reason}`);
                }
                lines.push("");
            }
        }

        lines.push("----");
        lines.push("");
    }

    return lines.join("\n");
}

export function hasHighLevelIssue(issues: Issue[]): boolean {
    return issues.some((issue) => issue.rule.level === "high");
}

function formatDiagnostics(diagnostics: RegistryDiagnostic[], pc: Painter): string[] {
    const visible = diagnostics.filter((diagnostic) => diagnostic.level !== "info");
    if (visible.length === 0) {
        return [];
    }
    return [
        "规则加载提示：",
        ...visible.map((diagnostic) => `  ${colorizeDiagLevel(pc, diagnostic.level)} ${diagnostic.code}: ${diagnostic.message}`),
        "",
    ];
}

/** 诊断级别标签着色：error 红、warning 黄、info 暗（info 一般已被过滤）。 */
function colorizeDiagLevel(pc: Painter, level: RegistryDiagnostic["level"]): string {
    const label = `[${level}]`;
    if (level === "error") {
        return pc.red(label);
    }
    if (level === "warning") {
        return pc.yellow(label);
    }
    return pc.dim(label);
}

function formatAction(action: Issue["rule"]["action"]): string {
    if (action.type === "suggest") {
        return `建议：${action.message}`;
    }
    if (action.replacements.length === 1 && action.replacements[0] === "") {
        return "建议删除。";
    }
    const replacements = action.replacements
        .map((replacement) => replacement === "" ? "删除" : replacement)
        .join(" / ");
    return `替换候选：${replacements}`;
}

function formatMarkedLine(issue: Issue): string {
    return `${issue.context.before}<mark>${issue.context.current}</mark>${issue.context.after}`;
}

function formatIssueRange(issue: Issue): string {
    if (issue.line === issue.endLine) {
        return `${issue.line}:${issue.column}-${issue.endColumn}`;
    }
    return `${issue.line}:${issue.column}-${issue.endLine}:${issue.endColumn}`;
}

function formatMatchText(match: string): string {
    const escaped = renderInline(match);
    const characters = Array.from(escaped);
    if (characters.length <= MAX_MATCH_TEXT_LENGTH) {
        return escaped;
    }
    return `${characters.slice(0, MAX_MATCH_TEXT_LENGTH).join("")}... (${characters.length} chars)`;
}

function renderInline(text: string): string {
    return text
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}

export function summarizeIssues(issues: Issue[]): CheckSummary {
    const summary: CheckSummary = {total: issues.length, high: 0, medium: 0, low: 0};
    for (const issue of issues) {
        summary[issue.rule.level]++;
    }
    return summary;
}

function groupByRule(issues: Issue[]): Map<string, Issue[]> {
    const grouped = new Map<string, Issue[]>();
    for (const issue of issues) {
        const current = grouped.get(issue.rule.id) ?? [];
        current.push(issue);
        grouped.set(issue.rule.id, current);
    }
    return grouped;
}
