import {existsSync, readFileSync, statSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {Command} from "commander";
import {globSync} from "tinyglobby";
import {loadConfig} from "./config";
import {loadRules} from "./rules";
import {computeMaskedRanges} from "./markdown-mask";
import {scanText} from "./scanner";
import {applyAutoFix} from "./fix";
import {createCheckJsonReport, createFixJsonReport, createLLMRulesJsonReport, createMultiCheckJsonReport, formatCheckAggregate, formatCheckReport, formatFixReport, formatJsonReport, formatLLMRules, hasHighLevelIssue, summarizeIssues} from "./reporter";
import {LLMLINT_VERSION} from "./version";
import type {CheckFileEntry, CheckFilterInfo, FixFileResult, Issue, LlmlintOutput, MaskedRange, RegexRuleRecord, Review, RuleLevel} from "./types";

type GlobalOptions = {
    config?: string;
    format?: string;
    minLevel?: string;
    review?: string;
    scanAll?: boolean;
    showLines?: boolean;
    write?: boolean;
};

/** 单文件检查结果（含逐文件隐藏统计，供 stylish 逐文件表头使用）。 */
type FileResult = CheckFileEntry & {hiddenByReview: number; hiddenByLevel: number};

const OUTPUTS = new Set<LlmlintOutput>(["stylish", "json"]);
const LEVELS = new Set<RuleLevel>(["high", "medium", "low"]);
const REVIEWS = new Set<Review | "all">(["agent", "human", "none", "all"]);
const LEVEL_RANK: Record<RuleLevel, number> = {
    high: 3,
    medium: 2,
    low: 1,
};

/**
 * llmlint 命令行入口。CLI 只做参数解析和错误出口，规则行为由模块提供。
 */
export async function runCli(argv: string[]): Promise<void> {
    // runCli 可被测试或宿主进程多次调用；每轮都应独立计算退出码。
    process.exitCode = 0;
    const program = new Command();

    program
        .name("llmlint")
        .description("检查 LLM 输出中的套路化表达、AI 写作痕迹和中文文本节奏问题")
        .version(LLMLINT_VERSION)
        .addHelpCommand(false)
        .option("-c, --config <path>", "指定 llmlint.config.ts 路径")
        .option("-f, --format <format>", "输出格式：stylish 或 json");

    program
        .command("check")
        .description("检查文件或目录中的 regex rule 候选问题（目录递归 .md/.markdown/.txt）")
        .argument("<files...>", "要检查的 UTF-8 文本文件或目录，可传多个")
        .option("-f, --format <format>", "输出格式：stylish 或 json")
        .option("--min-level <level>", "只显示该级别及以上的问题：high、medium 或 low")
        .option("--review <scope>", "按审查受众过滤：agent（默认）、human、none 或 all")
        .option("--scan-all", "关闭 Markdown 区域遮罩，扫描代码块 / 链接等全部内容")
        .option("--show-lines", "在 stylish 输出中显示完整命中行")
        .action(async (files: string[], commandOptions: GlobalOptions | Command) => {
            try {
                const options = mergeOptions(program, commandOptions);
                await checkFiles(files, options);
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    program
        .command("fix")
        .description("应用 fixability:auto 的确定性机械修复（零宽字符、连续符号去重）；默认 dry-run，加 --write 落盘")
        .argument("<files...>", "要修复的 UTF-8 文本文件或目录，可传多个")
        .option("-f, --format <format>", "输出格式：stylish 或 json")
        .option("--write", "把修复写回原文件（缺省只预览，不改文件）")
        .option("--scan-all", "关闭 Markdown 区域遮罩，连代码块 / frontmatter 一并修复")
        .action(async (files: string[], commandOptions: GlobalOptions | Command) => {
            try {
                const options = mergeOptions(program, commandOptions);
                await fixFiles(files, options);
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    program
        .command("show-llm-rules")
        .description("显示需要 Agent 主动全文审查的 LLM 规则")
        .option("-f, --format <format>", "输出格式：stylish 或 json")
        .action(async (commandOptions: GlobalOptions | Command) => {
            try {
                const options = mergeOptions(program, commandOptions);
                await showLLMRules(options);
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    await program.parseAsync(argv);
}

async function checkFiles(inputs: string[], options: GlobalOptions): Promise<void> {
    const {config, configPath} = await loadConfig({cwd: process.cwd(), configPath: options.config});
    const loadedRules = await loadRules(config);
    const output = resolveOutput(config.output, options.format);
    const minLevel = resolveMinLevel(options.minLevel);
    const review = resolveReview(options.review);
    const scanAll = options.scanAll === true;

    const files = expandInputs(inputs);
    const results: FileResult[] = files.map((filePath) => {
        const content = readFileSync(filePath, "utf-8");
        const maskedRanges = resolveMaskedRanges(filePath, content, scanAll);
        const allIssues = scanText(content, loadedRules.regexRules, {maskedRanges});
        // 两段过滤：先按审查受众，再按级别，各自独立统计隐藏数，互不重复计数。
        const afterReview = filterIssuesByReview(allIssues, review);
        const hiddenByReview = allIssues.length - afterReview.length;
        const issues = filterIssuesByLevel(afterReview, minLevel);
        const hiddenByLevel = afterReview.length - issues.length;
        return {filePath, summary: summarizeIssues(issues), issues, hiddenByReview, hiddenByLevel};
    });

    const color = resolveColor(output);
    if (results.length === 1) {
        printSingle(results[0]!, configPath, loadedRules, output, {review, minLevel, showLines: options.showLines === true, color});
    } else {
        printMulti(results, configPath, loadedRules, output, {review, minLevel, showLines: options.showLines === true, color});
    }
    // 退出码跟随可见视图：任一文件存在未被过滤掉的 high 命中即置 1。
    if (results.some((result) => hasHighLevelIssue(result.issues))) {
        process.exitCode = 1;
    }
}

type PrintOptions = {review: Review | "all"; minLevel: RuleLevel; showLines: boolean; color: boolean};

/** 单文件输出：保持与历史一致的 JSON / stylish 形态。 */
function printSingle(result: FileResult, configPath: string | null, loadedRules: Awaited<ReturnType<typeof loadRules>>, output: LlmlintOutput, options: PrintOptions): void {
    const reportOptions = {
        review: options.review,
        hiddenByReview: result.hiddenByReview,
        minLevel: options.minLevel,
        hiddenByLevel: result.hiddenByLevel,
        color: options.color,
        ...(options.showLines ? {showLines: true} : {}),
    };
    console.log(output === "json"
        ? formatJsonReport(createCheckJsonReport(result.filePath, configPath, result.issues, loadedRules, reportOptions))
        : formatCheckReport(result.filePath, result.issues, loadedRules, reportOptions));
}

/** 多文件输出：JSON 用 check-multi 形态；stylish 逐文件分段（诊断只在首段展示）+ 末尾聚合行。 */
function printMulti(results: FileResult[], configPath: string | null, loadedRules: Awaited<ReturnType<typeof loadRules>>, output: LlmlintOutput, options: PrintOptions): void {
    const filter: CheckFilterInfo = {
        review: options.review,
        hiddenByReview: results.reduce((sum, result) => sum + result.hiddenByReview, 0),
        minLevel: options.minLevel,
        hiddenByLevel: results.reduce((sum, result) => sum + result.hiddenByLevel, 0),
    };
    if (output === "json") {
        console.log(formatJsonReport(createMultiCheckJsonReport(configPath, results, loadedRules, filter)));
        return;
    }
    const sections = results.map((result, index) => formatCheckReport(result.filePath, result.issues, loadedRules, {
        review: options.review,
        hiddenByReview: result.hiddenByReview,
        minLevel: options.minLevel,
        hiddenByLevel: result.hiddenByLevel,
        includeDiagnostics: index === 0,
        color: options.color,
        ...(options.showLines ? {showLines: true} : {}),
    }));
    console.log([...sections, formatCheckAggregate(results, options.color)].join("\n\n"));
}

/** 展开输入：字面文件直接收，目录递归 .md/.markdown/.txt，glob 模式交给 tinyglobby。去重排序为绝对路径。 */
function expandInputs(inputs: string[]): string[] {
    const files = new Set<string>();
    const patterns: string[] = [];
    for (const input of inputs) {
        // 含 glob 元字符 → 当模式交给 tinyglobby（支持 **、! 排除、{a,b} 花括号）。
        if (/[*?{}[\]!]/.test(input)) {
            patterns.push(toPosix(input));
            continue;
        }
        const absolute = resolve(process.cwd(), input);
        if (!existsSync(absolute)) {
            throw new Error(`文件或目录不存在: ${input}`);
        }
        if (statSync(absolute).isDirectory()) {
            // 目录：以目录本身为 cwd 递归 glob，避免绝对路径 / 跨盘符模式在 tinyglobby 下不匹配。
            for (const match of globSync("**/*.{md,markdown,txt}", {cwd: absolute, absolute: true, onlyFiles: true})) {
                files.add(match);
            }
            continue;
        }
        files.add(absolute);
    }
    if (patterns.length > 0) {
        for (const match of globSync(patterns, {cwd: process.cwd(), absolute: true, onlyFiles: true, expandDirectories: false})) {
            files.add(match);
        }
    }
    if (files.size === 0) {
        throw new Error(`未匹配到任何可检查的文件: ${inputs.join(", ")}`);
    }
    return [...files].sort((left, right) => left.localeCompare(right));
}

/** Windows 反斜杠路径转 POSIX 正斜杠，供 glob 模式匹配使用。 */
function toPosix(path: string): string {
    return path.replace(/\\/g, "/");
}

/** 仅对 Markdown 文件计算遮罩区间；--scan-all 或非 Markdown 后缀时不遮罩。 */
function resolveMaskedRanges(filePath: string, content: string, scanAll: boolean): MaskedRange[] {
    if (scanAll || !/\.(md|markdown)$/i.test(filePath)) {
        return [];
    }
    return computeMaskedRanges(content);
}

async function fixFiles(inputs: string[], options: GlobalOptions): Promise<void> {
    const {config, configPath} = await loadConfig({cwd: process.cwd(), configPath: options.config});
    const loadedRules = await loadRules(config);
    const output = resolveOutput(config.output, options.format);
    const scanAll = options.scanAll === true;
    const write = options.write === true;
    // 只取「无需判断」的机械修复规则；candidate/manual 不在此自动改写。
    const autoRules = loadedRules.regexRules.filter((rule) => rule.fixability === "auto");

    const files = expandInputs(inputs);
    const results: FixFileResult[] = files.map((filePath) => {
        const content = readFileSync(filePath, "utf-8");
        const maskedRanges = resolveMaskedRanges(filePath, content, scanAll);
        const issues = scanText(content, autoRules, {maskedRanges});
        const fixed = applyAutoFix(content, autoRules, maskedRanges);
        const changed = fixed !== content;
        if (write && changed) {
            writeFileSync(filePath, fixed, "utf-8");
        }
        return {filePath, content, fixed, changed, issues};
    });

    console.log(output === "json"
        ? formatJsonReport(createFixJsonReport(configPath, results, write))
        : formatFixReport(results, write, resolveColor(output)));
    // dry-run 且存在待修复项时置退出码 1（便于 CI 门禁，如「禁止零宽字符入库」）；--write 或无改动为 0。
    if (!write && results.some((result) => result.changed)) {
        process.exitCode = 1;
    }
}

async function showLLMRules(options: GlobalOptions): Promise<void> {
    const {config, configPath} = await loadConfig({cwd: process.cwd(), configPath: options.config});
    const loadedRules = await loadRules(config);
    const output = resolveOutput(config.output, options.format);
    console.log(output === "json"
        ? formatJsonReport(createLLMRulesJsonReport(configPath, loadedRules))
        : formatLLMRules(loadedRules.llmRules, loadedRules.diagnostics, resolveColor(output)));
}

function mergeOptions(program: Command, commandOptions: GlobalOptions | Command): GlobalOptions {
    const localOptions = typeof (commandOptions as Command).opts === "function"
        ? (commandOptions as Command).opts<GlobalOptions>()
        : commandOptions as GlobalOptions;
    return {
        ...program.opts<GlobalOptions>(),
        ...localOptions,
    };
}

function resolveOutput(configOutput: LlmlintOutput, optionOutput: string | undefined): LlmlintOutput {
    if (!optionOutput) {
        return configOutput;
    }
    if (!OUTPUTS.has(optionOutput as LlmlintOutput)) {
        throw new Error(`输出格式无效: ${optionOutput}`);
    }
    return optionOutput as LlmlintOutput;
}

function resolveMinLevel(minLevel: string | undefined): RuleLevel {
    if (!minLevel) {
        return "low";
    }
    if (!LEVELS.has(minLevel as RuleLevel)) {
        throw new Error(`级别过滤无效: ${minLevel}`);
    }
    return minLevel as RuleLevel;
}

/** 审查受众过滤；默认 agent，即只展示需要 Agent/LLM 处理的命中。 */
function resolveReview(review: string | undefined): Review | "all" {
    if (!review) {
        return "agent";
    }
    if (!REVIEWS.has(review as Review | "all")) {
        throw new Error(`审查受众过滤无效: ${review}`);
    }
    return review as Review | "all";
}

/** stylish 是否着色：仅当输出非 json、stdout 是 TTY、且未设 NO_COLOR；Agent/管道下自动纯文本。 */
function resolveColor(output: LlmlintOutput): boolean {
    return output !== "json" && process.stdout.isTTY === true && !process.env.NO_COLOR;
}

function filterIssuesByLevel(issues: Issue[], minLevel: RuleLevel): Issue[] {
    return issues.filter((issue) => LEVEL_RANK[issue.rule.level] >= LEVEL_RANK[minLevel]);
}

function filterIssuesByReview(issues: Issue[], review: Review | "all"): Issue[] {
    if (review === "all") {
        return issues;
    }
    return issues.filter((issue) => issue.rule.review === review);
}
