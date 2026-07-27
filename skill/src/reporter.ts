import {createColors} from "picocolors";
import {mergeCompactRules, projectCheckIssues} from "./check-report";
import {ruleDetectorKind} from "./rule-registry";
import type {ActiveRuleRecord, CheckDetailJsonReport, CheckFileEntry, CheckFilterInfo, CheckJsonReport, CheckMultiDetailJsonReport, CheckMultiJsonReport, CheckSummary, DensityIssue, FixFileEntry, FixFileResult, FixReport, FixRuleCount, Issue, LoadedRules, RegistryDiagnostic, RegistrySummary, Review, RuleLevel, RulesJsonReport} from "./types";

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
    /** density 规则命中；缺省 = 未跑 density 扫描。 */
    densityIssues?: DensityIssue[];
    /** JSON 输出是否内联完整规则对象（`--rule-detail`）；缺省 = 紧凑形态。只影响 JSON，stylish 不看这个字段。 */
    ruleDetail?: boolean;
    /** 正文可见字数（与 density perKilo 同分母）；缺省 = 调用方无原文上下文，报告不输出篇幅。 */
    visibleChars?: number;
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
    const densityIssues = options.densityIssues ?? [];
    if (issues.length === 0 && densityIssues.length === 0) {
        const hiddenNote = formatHiddenNote(hiddenByReview, hiddenByLevel);
        lines.push(hiddenNote ? `${pc.green("✓ No problems found in current view.")}${hiddenNote}` : pc.green("✓ No problems found"));
        return lines.join("\n");
    }

    const summary = summarizeIssues(issues, options.visibleChars);
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
                if (issue.detail) {
                    lines.push(pc.dim(`    ${issue.detail}`));
                }
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

    // 密度指纹段：与逐处命中分开呈现——它是「分布问题」，一条代表全文/一段的统计结论。
    if (densityIssues.length > 0) {
        lines.push(pc.bold(`密度指纹 (${densityIssues.length})`));
        lines.push("");
        for (const issue of densityIssues) {
            const rule = issue.rule;
            lines.push(`${pc.cyan(rule.id)} ${pc.dim(`[${rule.namespace}]`)} (${rule.title})`);
            lines.push(pc.dim(`  来源：${rule.ruleset}；级别：${rule.level}；审查：${rule.review}；修复：${rule.fixability}`));
            lines.push(`  ${issue.line}:${issue.column}  ${issue.hits} 处命中，${issue.perKilo}/千字`);
            if (issue.samples.length > 0) {
                lines.push(pc.dim(`  样本：${issue.samples.map((sample) => formatMatchText(sample)).join("、")}`));
            }
            lines.push(`  ${formatAction(rule.action)}`);
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
    if (summary.total > 0) {
        lines.push(pc.red(`✖ ${summary.total} problem${summary.total > 1 ? "s" : ""} (${parts.join(", ")})`));
    }
    if (densityIssues.length > 0) {
        lines.push(pc.red(`✖ ${densityIssues.length} 条密度指纹`));
    }
    // 篇幅放在总结行之后：修复复测要拿它和修复前对比，删减过多本身就是一种回归。
    if (summary.visibleChars !== undefined) {
        lines.push(pc.dim(`正文 ${summary.visibleChars} 可见字（与「/千字」同分母；修复后用它对比篇幅）`));
    }

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

export function createCheckJsonReport(filePath: string, configPath: string | null, issues: Issue[], loadedRules: LoadedRules, options: CheckReportOptions = {}): CheckJsonReport | CheckDetailJsonReport {
    const filter: CheckFilterInfo = {
        review: options.review ?? "agent",
        hiddenByReview: options.hiddenByReview ?? 0,
        minLevel: options.minLevel ?? "low",
        hiddenByLevel: options.hiddenByLevel ?? 0,
    };
    if (options.ruleDetail) {
        return {
            kind: "check",
            filePath,
            configPath,
            summary: summarizeIssues(issues, options.visibleChars),
            filter,
            registry: loadedRules.summary,
            diagnostics: loadedRules.diagnostics,
            issues,
            ...(options.densityIssues ? {densityIssues: options.densityIssues} : {}),
        };
    }
    const {namespaces, ...registry} = loadedRules.summary;
    const projected = projectCheckIssues(issues, options.densityIssues);
    return {
        kind: "check",
        filePath,
        configPath,
        summary: summarizeIssues(issues, options.visibleChars),
        filter,
        registry,
        diagnostics: loadedRules.diagnostics,
        rules: projected.rules,
        issues: projected.issues,
        ...(projected.densityIssues ? {densityIssues: projected.densityIssues} : {}),
    };
}

/** 多文件汇总行：文件数、有命中文件数、各级别总数。 */
export function formatCheckAggregate(files: CheckFileEntry[], color = false): string {
    const pc = createColors(color);
    const summary = aggregateSummary(files);
    const filesWithIssues = files.filter((file) => file.issues.length > 0 || (file.densityIssues?.length ?? 0) > 0).length;
    const densityTotal = files.reduce((sum, file) => sum + (file.densityIssues?.length ?? 0), 0);
    const parts: string[] = [];
    if (summary.high > 0) parts.push(`${summary.high} high`);
    if (summary.medium > 0) parts.push(`${summary.medium} medium`);
    if (summary.low > 0) parts.push(`${summary.low} low`);
    const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
    const densityNote = densityTotal > 0 ? `，${densityTotal} 条密度指纹` : "";
    return pc.bold(`═══ 汇总：${files.length} 个文件，${filesWithIssues} 个有命中，共 ${summary.total} problem${summary.total === 1 ? "" : "s"}${detail}${densityNote} ═══`);
}

export function createMultiCheckJsonReport(configPath: string | null, files: CheckFileEntry[], loadedRules: LoadedRules, filter: CheckFilterInfo, ruleDetail = false): CheckMultiJsonReport | CheckMultiDetailJsonReport {
    if (ruleDetail) {
        return {
            kind: "check-multi",
            configPath,
            filter,
            registry: loadedRules.summary,
            diagnostics: loadedRules.diagnostics,
            files: files.map((file) => ({
                filePath: file.filePath,
                summary: file.summary,
                issues: file.issues,
                ...(file.densityIssues ? {densityIssues: file.densityIssues} : {}),
            })),
            summary: aggregateSummary(files),
        };
    }
    const {namespaces, ...registry} = loadedRules.summary;
    const projected = files.map((file) => ({file, compact: projectCheckIssues(file.issues, file.densityIssues)}));
    return {
        kind: "check-multi",
        configPath,
        filter,
        registry,
        diagnostics: loadedRules.diagnostics,
        rules: mergeCompactRules(projected.map((entry) => entry.compact.rules)),
        files: projected.map(({file, compact}) => ({
            filePath: file.filePath,
            summary: file.summary,
            issues: compact.issues,
            ...(compact.densityIssues ? {densityIssues: compact.densityIssues} : {}),
        })),
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

export function createRulesJsonReport(configPath: string | null, loadedRules: LoadedRules, rules: ActiveRuleRecord[], filter: RulesJsonReport["filter"]): RulesJsonReport {
    return {
        kind: "rules",
        configPath,
        registry: loadedRules.summary,
        diagnostics: loadedRules.diagnostics,
        rules,
        filter,
    };
}

/**
 * 序列化 JSON 报告。
 *
 * @param pretty 是否缩进。缺省缩进，便于人工与 diff 阅读；紧凑 check 报告传 false——
 *   它的消费者是 Agent，缩进在长清单上纯属上下文开销（本仓样本上占 25%）。
 */
export function formatJsonReport(report: CheckJsonReport | CheckDetailJsonReport | CheckMultiJsonReport | CheckMultiDetailJsonReport | FixReport | RulesJsonReport, pretty = true): string {
    return pretty ? JSON.stringify(report, null, 2) : JSON.stringify(report);
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

/** 一条规则的处置摘要：替换类给目标词，纯删除类说明是整处删除，建议类给建议原文。 */
export function ruleActionSummary(rule: ActiveRuleRecord): string {
    if (rule.action.type === "suggest") {
        return rule.action.message;
    }
    const targets = rule.action.replacements.filter(Boolean);
    return targets.length > 0 ? `替换为 ${targets.join(" / ")}` : "整处删除";
}

/**
 * rules 命令的 stylish 输出：规则库检视，按 namespace 分组、一条一行。
 *
 * 语义规则额外展开完整判定说明与示例——对这类规则 `detector.prompt` 就是规则的
 * 全部内容，只给 20 字标题等于没给。其余判据类别的正文是 targets/patterns，
 * 属于实现细节，要看走 JSON 输出。
 */
export function formatRules(rules: ActiveRuleRecord[], filter: RulesJsonReport["filter"], registry: RegistrySummary, diagnostics: RegistryDiagnostic[], color = false): string {
    const pc = createColors(color);
    const conditions = [
        filter.detector === "all" ? null : `判据 ${filter.detector}`,
        filter.namespace === null ? null : `namespace ${filter.namespace}`,
    ].filter((item): item is string => item !== null);
    const lines: string[] = [
        ...formatDiagnostics(diagnostics, pc),
        pc.bold(`规则库${conditions.length > 0 ? `（${conditions.join("，")}）` : ""}`),
        pc.dim(`${rules.length} / ${registry.activeRules} 条 active；规则包 ${registry.rulesets.join(", ")}`),
        "",
    ];

    if (rules.length === 0) {
        lines.push("没有符合条件的规则。");
        return lines.join("\n");
    }

    const byNamespace = new Map<string, ActiveRuleRecord[]>();
    for (const rule of rules) {
        byNamespace.set(rule.namespace, [...(byNamespace.get(rule.namespace) ?? []), rule]);
    }
    for (const namespace of [...byNamespace.keys()].sort((left, right) => left.localeCompare(right))) {
        lines.push(pc.bold(namespace));
        for (const rule of byNamespace.get(namespace) ?? []) {
            lines.push(`  ${pc.cyan(rule.id)}  ${pc.dim(`[${rule.level}/${rule.review}/${ruleDetectorKind(rule)}]`)}  ${rule.title}`);
            lines.push(`    ${ruleActionSummary(rule)}`);
            if (!("handler" in rule) && rule.detector.type === "semantic") {
                lines.push("    判定说明：");
                for (const line of rule.detector.prompt.split("\n")) {
                    lines.push(`      ${line}`);
                }
                for (const example of rule.examples ?? []) {
                    const parts = [`${example.hit ? "命中例" : "对照例（不该报）"}: ${example.text}`];
                    if (example.fix) {
                        parts.push(`改法: ${example.fix}`);
                    }
                    if (example.reason) {
                        parts.push(`理由: ${example.reason}`);
                    }
                    lines.push(`      - ${parts.join("｜")}`);
                }
            }
        }
        lines.push("");
    }

    return lines.join("\n").trimEnd();
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

/**
 * 汇总命中级别分布。
 *
 * @param visibleChars 正文可见字数；不传则 summary 不带 `visibleChars`（见该字段注释）。
 */
export function summarizeIssues(issues: Issue[], visibleChars?: number): CheckSummary {
    const summary: CheckSummary = {total: issues.length, high: 0, medium: 0, low: 0};
    for (const issue of issues) {
        summary[issue.rule.level]++;
    }
    if (visibleChars !== undefined) {
        summary.visibleChars = visibleChars;
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
