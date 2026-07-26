import {existsSync, readFileSync, statSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {Command} from "commander";
import {globSync} from "tinyglobby";
import {loadConfig} from "./config";
import {loadRules} from "./rules";
import {computeMaskedRanges, mergeRanges} from "./markdown-mask";
import {prepareScanContext} from "./scan-context";
import {buildLineStarts, locatePosition, scanHandlerRules, scanWithContext} from "./scanner";
import {scanDensity} from "./density";
import {applyAutoFix} from "./fix";
import {createCheckJsonReport, createFixJsonReport, createLLMRulesJsonReport, createMultiCheckJsonReport, formatCheckAggregate, formatCheckReport, formatFixReport, formatJsonReport, formatLLMRules, hasHighLevelIssue, summarizeIssues} from "./reporter";
import {readDetectCache, detectCacheKey, writeDetectCache} from "./detect/cache";
import {chunkBySentence} from "./detect/chunk";
import {aggregate, defaultDetectorOptions, HfTransport, type DetectPayload, type DetectorTransport} from "./detect/transport";
import {loadUserSettings, saveUserSettings, userCacheDir} from "./user-state";
import {LLMLINT_VERSION} from "./version";
import type {CheckFileEntry, CheckFilterInfo, DensityIssue, FixFileResult, Issue, LlmlintOutput, MaskedRange, RegexRuleRecord, Review, RuleLevel} from "./types";
import type {SharingMode, SharingTier, UserSettings} from "./user-state";

type GlobalOptions = {
    config?: string;
    format?: string;
    minLevel?: string;
    review?: string;
    scanAll?: boolean;
    showLines?: boolean;
    /** JSON 输出内联完整规则对象；缺省为紧凑形态（规则元数据去重到顶层 rules）。 */
    ruleDetail?: boolean;
    write?: boolean;
    /** commander 的 --no-cache 会落成 cache:false。 */
    cache?: boolean;
    noCache?: boolean;
};

/** 单文件检查结果（含逐文件隐藏统计，供 stylish 逐文件表头使用）。 */
type FileResult = CheckFileEntry & {hiddenByReview: number; hiddenByLevel: number};
type DetectFileResult = DetectPayload & {filePath: string; cached: boolean; content: string};
/** 报告层的单个 chunk：在缓存 payload 之外补文内位次与相对偏离。 */
type DetectChunkReport = DetectPayload["chunks"][number] & {
    /** 文内 P(AI) 降序位次，1 起。用于取热区/冷区，取代绝对阈值。 */
    rank: number;
    /** 相对文档均值的偏离（pAi − docPAi）。正=比本篇平均更可疑。 */
    relative: number;
};
type DetectFileReport = {
    filePath: string;
    docPAi: number;
    maxPAi: number;
    /**
     * 文内 P(AI) 极差（max − min）。低于 DETECT_SPREAD_FLOOR 时四象限对这篇不适用；
     * chunk 少于 2 个时为 0。
     */
    spread: number;
    cached: boolean;
    chunks: DetectChunkReport[];
};

/** 整篇层（绝对）判据：docPAi 达到该值即「这篇整体可疑」。只用于整篇结论，不用于挑文内热区。 */
const DETECT_DOC_SUSPICIOUS = 0.85;
/**
 * 文内 P(AI) 极差下限。低于它说明 chunk 之间没有可分辨的高低差——
 * 整篇 AI 生成的文本常常全部 chunk 都在 0.98 以上，此时「热区 / 冷区」只是噪声，
 * 四象限（规则信号 × 检测热力）给不出可执行结论，应改用规则信号密度排优先级。
 */
const DETECT_SPREAD_FLOOR = 0.15;

const OUTPUTS = new Set<LlmlintOutput>(["stylish", "json"]);
const LEVELS = new Set<RuleLevel>(["high", "medium", "low"]);
const REVIEWS = new Set<Review | "all">(["agent", "human", "none", "all"]);
const LEVEL_RANK: Record<RuleLevel, number> = {
    high: 3,
    medium: 2,
    low: 1,
};
const CONFIG_KEYS = [
    "initialized",
    "sharing.tier",
    "sharing.mode",
    "sharing.anonymous",
    "detector.proxy",
    "detector.space",
    "detector.chunkChars",
    "detector.minIntervalMs",
] as const;
type ConfigKey = typeof CONFIG_KEYS[number];

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
        .command("status")
        .description("显示 llmlint 用户状态、项目配置路径与检测器设置")
        .option("-f, --format <format>", "输出格式：stylish 或 json")
        .action(async (commandOptions: GlobalOptions | Command) => {
            try {
                const options = mergeOptions(program, commandOptions);
                await showStatus(options);
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    const configCommand = program
        .command("config")
        .description("管理用户级 settings.json；不会修改项目级 llmlint.config.ts")
        .addHelpText("after", `\n合法键：${CONFIG_KEYS.join(", ")}`);

    configCommand
        .command("get")
        .description("读取用户级 settings.json 的归一设置；不读取项目级 llmlint.config.ts")
        .argument("[key]", "可选 dot-path；省略时输出完整 JSON")
        .action(async (key: string | undefined) => {
            try {
                await configGet(key);
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    configCommand
        .command("set")
        .description("写入用户级 settings.json 的白名单键；不会修改项目级 llmlint.config.ts")
        .argument("<key>", "dot-path 白名单键")
        .argument("<value>", "值；true/false、数字、null 会按类型解析")
        .action(async (key: string, value: string) => {
            try {
                await configSet(key, value);
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    program
        .command("check")
        .description("检查文件或目录中的 regex rule 候选问题（目录递归 .md/.markdown/.txt）")
        .argument("<files...>", "要检查的 UTF-8 文本文件或目录，可传多个")
        .option("-f, --format <format>", "输出格式：stylish 或 json")
        .option("--min-level <level>", "只显示该级别及以上的问题：high、medium 或 low")
        .option("--review <scope>", "按审查受众过滤：agent（默认）、human、none 或 all")
        .option("--scan-all", "关闭 Markdown 区域遮罩，扫描代码块 / 链接等全部内容")
        .option("--show-lines", "在 stylish 输出中显示完整命中行")
        .option("--rule-detail", "JSON 输出内联完整规则对象（detector / source / scope）与逐 namespace 明细；缺省为紧凑形态")
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
        .description("应用 fixability:auto 的确定性机械修复（零宽字符、省略号/破折号尾部清理）；默认 dry-run，加 --write 落盘")
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

    program
        .command("detect")
        .description("调用外部神经检测器估算文本 P(AI)，结果按正文哈希缓存")
        .argument("<files...>", "要检测的 UTF-8 文本文件或目录，可传多个")
        .option("-f, --format <format>", "输出格式：stylish 或 json")
        .option("--no-cache", "跳过缓存读取，但成功检测后仍写入新缓存")
        .action(async (files: string[], commandOptions: GlobalOptions | Command) => {
            try {
                const options = mergeOptions(program, commandOptions);
                await detectFiles(files, options);
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}\n可运行 llmlint config set detector.proxy http://127.0.0.1:7890 配置代理`);
                process.exitCode = 1;
            }
        });

    await program.parseAsync(argv);
}

async function showStatus(options: GlobalOptions): Promise<void> {
    const settings = loadUserSettings();
    const {configPath} = await loadConfig({cwd: process.cwd(), configPath: options.config});
    const report = {
        kind: "status" as const,
        version: LLMLINT_VERSION,
        initialized: settings.initialized,
        login: "none" as const,
        sharing: settings.sharing,
        configPath,
        detector: {
            space: settings.detector.space,
            proxyConfigured: settings.detector.proxy !== null,
            cacheDir: userCacheDir(),
        },
    };
    const output = resolveOutput("stylish", options.format);
    console.log(output === "json" ? JSON.stringify(report, null, 2) : formatStatus(report));
}

type StatusReport = {
    kind: "status";
    version: string;
    initialized: boolean;
    login: "none";
    sharing: UserSettings["sharing"];
    configPath: string | null;
    detector: {
        space: string;
        proxyConfigured: boolean;
        cacheDir: string;
    };
};

/** status stylish 输出：每行一个状态，便于 Agent/人直接读。 */
function formatStatus(report: StatusReport): string {
    return [
        `llmlint ${report.version}`,
        `initialized: ${report.initialized}`,
        `login: ${report.login}`,
        `sharing.tier: ${report.sharing.tier}`,
        `sharing.mode: ${report.sharing.mode}`,
        `sharing.anonymous: ${report.sharing.anonymous}`,
        `configPath: ${report.configPath ?? "null"}`,
        `detector.space: ${report.detector.space}`,
        `detector.proxyConfigured: ${report.detector.proxyConfigured}`,
        `detector.cacheDir: ${report.detector.cacheDir}`,
    ].join("\n");
}

async function configGet(rawKey: string | undefined): Promise<void> {
    const settings = loadUserSettings();
    if (rawKey === undefined) {
        console.log(JSON.stringify(settings, null, 4));
        return;
    }
    const key = normalizeConfigKey(rawKey);
    console.log(`${key} = ${JSON.stringify(readConfigValue(settings, key))}`);
}

async function configSet(rawKey: string, rawValue: string): Promise<void> {
    const key = normalizeConfigKey(rawKey);
    const value = parseConfigValue(rawValue);
    const settings = loadUserSettings();
    const next = applyConfigValue(settings, key, value);
    saveUserSettings(next);
    console.log(`${key} = ${JSON.stringify(readConfigValue(next, key))}`);
}

function normalizeConfigKey(key: string): ConfigKey {
    if (CONFIG_KEYS.includes(key as ConfigKey)) {
        return key as ConfigKey;
    }
    throw new Error(`未知配置键: ${key}。合法键：${CONFIG_KEYS.join(", ")}`);
}

function parseConfigValue(value: string): string | number | boolean | null {
    if (value === "true") {
        return true;
    }
    if (value === "false") {
        return false;
    }
    if (value === "null") {
        return null;
    }
    if (/^-?\d+$/u.test(value)) {
        return Number(value);
    }
    return value;
}

function applyConfigValue(settings: UserSettings, key: ConfigKey, value: string | number | boolean | null): UserSettings {
    const next: UserSettings = {
        version: settings.version,
        initialized: settings.initialized,
        sharing: {...settings.sharing},
        detector: {...settings.detector},
    };

    if (key === "initialized") {
        next.initialized = requireBoolean(value, key);
    } else if (key === "sharing.tier") {
        next.sharing.tier = requireSharingTier(value, key);
    } else if (key === "sharing.mode") {
        next.sharing.mode = requireSharingMode(value, key);
    } else if (key === "sharing.anonymous") {
        next.sharing.anonymous = requireBoolean(value, key);
    } else if (key === "detector.proxy") {
        next.detector.proxy = value === null || value === "" ? null : requireString(value, key);
    } else if (key === "detector.space") {
        next.detector.space = requireString(value, key);
    } else if (key === "detector.chunkChars") {
        next.detector.chunkChars = requirePositiveInteger(value, key);
    } else {
        next.detector.minIntervalMs = value === null ? null : requireNonNegativeInteger(value, key);
    }
    return next;
}

function readConfigValue(settings: UserSettings, key: ConfigKey): string | number | boolean | null {
    if (key === "initialized") return settings.initialized;
    if (key === "sharing.tier") return settings.sharing.tier;
    if (key === "sharing.mode") return settings.sharing.mode;
    if (key === "sharing.anonymous") return settings.sharing.anonymous;
    if (key === "detector.proxy") return settings.detector.proxy;
    if (key === "detector.space") return settings.detector.space;
    if (key === "detector.chunkChars") return settings.detector.chunkChars;
    return settings.detector.minIntervalMs;
}

function requireBoolean(value: string | number | boolean | null, key: ConfigKey): boolean {
    if (typeof value !== "boolean") {
        throw new Error(`${key} 必须是 true 或 false。`);
    }
    return value;
}

function requireString(value: string | number | boolean | null, key: ConfigKey): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${key} 必须是非空字符串。`);
    }
    return value;
}

function requirePositiveInteger(value: string | number | boolean | null, key: ConfigKey): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
        throw new Error(`${key} 必须是正整数。`);
    }
    return value;
}

function requireNonNegativeInteger(value: string | number | boolean | null, key: ConfigKey): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new Error(`${key} 必须是非负整数或 null。`);
    }
    return value;
}

function requireSharingTier(value: string | number | boolean | null, key: ConfigKey): SharingTier {
    if (value === "off" || value === "stats" || value === "fragments" || value === "full") {
        return value;
    }
    throw new Error(`${key} 必须是 off、stats、fragments 或 full。`);
}

function requireSharingMode(value: string | number | boolean | null, key: ConfigKey): SharingMode {
    if (value === "auto" || value === "ask") {
        return value;
    }
    throw new Error(`${key} 必须是 auto 或 ask。`);
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
        const ctx = prepareScanContext(content, {maskedRanges, ignoreTerms: config.ignoreTerms});
        const allIssues = [...scanWithContext(ctx, loadedRules.regexRules), ...scanHandlerRules(ctx, loadedRules.handlerRules)];
        const allDensity = scanDensity(ctx, loadedRules.densityRules);
        // 两段过滤：先按审查受众，再按级别，各自独立统计隐藏数，互不重复计数。
        // density 命中走同样两段，隐藏数并进同一组计数。
        const afterReview = filterIssuesByReview(allIssues, review);
        const afterReviewDensity = review === "all" ? allDensity : allDensity.filter((issue) => issue.rule.review === review);
        const hiddenByReview = (allIssues.length - afterReview.length) + (allDensity.length - afterReviewDensity.length);
        const issues = filterIssuesByLevel(afterReview, minLevel);
        const densityIssues = afterReviewDensity.filter((issue) => LEVEL_RANK[issue.rule.level] >= LEVEL_RANK[minLevel]);
        const hiddenByLevel = (afterReview.length - issues.length) + (afterReviewDensity.length - densityIssues.length);
        return {filePath, summary: summarizeIssues(issues), issues, densityIssues, hiddenByReview, hiddenByLevel};
    });

    const color = resolveColor(output);
    const printOptions: PrintOptions = {review, minLevel, showLines: options.showLines === true, ruleDetail: options.ruleDetail === true, color};
    if (results.length === 1) {
        printSingle(results[0]!, configPath, loadedRules, output, printOptions);
    } else {
        printMulti(results, configPath, loadedRules, output, printOptions);
    }
    // 退出码跟随可见视图：任一文件存在未被过滤掉的 high 命中（含密度指纹）即置 1。
    if (results.some((result) => hasHighLevelIssue(result.issues) || hasHighLevelDensity(result.densityIssues))) {
        process.exitCode = 1;
    }
}

/** density 命中里是否有 high 级别（与 hasHighLevelIssue 同口径）。 */
function hasHighLevelDensity(densityIssues: DensityIssue[] | undefined): boolean {
    return (densityIssues ?? []).some((issue) => issue.rule.level === "high");
}

type PrintOptions = {review: Review | "all"; minLevel: RuleLevel; showLines: boolean; ruleDetail: boolean; color: boolean};

/** 单文件输出：保持与历史一致的 JSON / stylish 形态。 */
function printSingle(result: FileResult, configPath: string | null, loadedRules: Awaited<ReturnType<typeof loadRules>>, output: LlmlintOutput, options: PrintOptions): void {
    const reportOptions = {
        review: options.review,
        hiddenByReview: result.hiddenByReview,
        minLevel: options.minLevel,
        hiddenByLevel: result.hiddenByLevel,
        color: options.color,
        densityIssues: result.densityIssues ?? [],
        ...(options.showLines ? {showLines: true} : {}),
        ...(options.ruleDetail ? {ruleDetail: true} : {}),
    };
    console.log(output === "json"
        ? formatJsonReport(createCheckJsonReport(result.filePath, configPath, result.issues, loadedRules, reportOptions), options.ruleDetail)
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
        console.log(formatJsonReport(createMultiCheckJsonReport(configPath, results, loadedRules, filter, options.ruleDetail), options.ruleDetail));
        return;
    }
    const sections = results.map((result, index) => formatCheckReport(result.filePath, result.issues, loadedRules, {
        review: options.review,
        hiddenByReview: result.hiddenByReview,
        minLevel: options.minLevel,
        hiddenByLevel: result.hiddenByLevel,
        includeDiagnostics: index === 0,
        color: options.color,
        densityIssues: result.densityIssues ?? [],
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
        const ctx = prepareScanContext(content, {maskedRanges, ignoreTerms: config.ignoreTerms});
        const issues = scanWithContext(ctx, autoRules);
        // 豁免词区间并进遮罩段：机械修复不得改写豁免词内部文本。
        const protectedRanges = mergeRanges([...maskedRanges, ...ctx.ignoreRanges]);
        const fixed = applyAutoFix(content, autoRules, protectedRanges);
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

async function detectFiles(inputs: string[], options: GlobalOptions): Promise<void> {
    const settings = loadUserSettings();
    const detectorOptions = defaultDetectorOptions({
        space: settings.detector.space,
        chunkChars: settings.detector.chunkChars,
        minIntervalMs: settings.detector.minIntervalMs,
        proxy: settings.detector.proxy,
    });
    const output = resolveOutput("stylish", options.format);
    const files = expandInputs(inputs);
    const transport = new HfTransport(detectorOptions);
    const results: DetectFileResult[] = [];

    for (const filePath of files) {
        const content = readFileSync(filePath, "utf-8");
        const payload = await detectContent(filePath, content, detectorOptions, transport, options.noCache === true || options.cache === false);
        results.push(payload);
    }

    const report = {kind: "detect" as const, files: results.map(toDetectReport)};
    console.log(output === "json" ? JSON.stringify(report, null, 2) : formatDetectReport(results));
}

async function detectContent(filePath: string, content: string, detectorOptions: ReturnType<typeof defaultDetectorOptions>, transport: DetectorTransport, noCache: boolean): Promise<DetectFileResult> {
    const key = detectCacheKey(content, detectorOptions);
    if (!noCache) {
        const cached = readDetectCache(key);
        if (cached) {
            return {...cached, filePath, cached: true, content};
        }
    }

    const chunks = chunkBySentence(content, detectorOptions.chunkChars);
    if (chunks.length === 0) {
        const emptyPayload: DetectPayload = {
            detector: {
                version: detectorOptions.version,
                endpoint: detectorOptions.endpoint,
                space: detectorOptions.space,
                chunkChars: detectorOptions.chunkChars,
            },
            docPAi: 0,
            maxPAi: 0,
            chunks: [],
        };
        writeDetectCache(key, emptyPayload);
        return {...emptyPayload, filePath, cached: false, content};
    }

    const scores = await transport.detectChunks(chunks.map((chunk) => chunk.text));
    const aggregateScore = aggregate(scores, chunks);
    const lineStarts = buildLineStarts(content);
    const payload: DetectPayload = {
        detector: {
            version: detectorOptions.version,
            endpoint: detectorOptions.endpoint,
            space: detectorOptions.space,
            chunkChars: detectorOptions.chunkChars,
        },
        docPAi: aggregateScore.docPAi,
        maxPAi: aggregateScore.maxPAi,
        chunks: chunks.map((chunk, index) => ({
            span: [chunk.start, chunk.end],
            pAi: scores[index] ?? 0,
            line: locatePosition(content, lineStarts, chunk.start).line,
        })),
    };
    writeDetectCache(key, payload);
    return {...payload, filePath, cached: false, content};
}

/**
 * 文内最可疑 / 最不可疑各取的 chunk 数：`ceil(总数 / 4)`，至少 1。
 * 绝对阈值（如 P(AI) ≥ 0.85）在整体 AI 文本上会把全文标红，四象限失去分辨力；相对排序不会。
 */
function hotChunkCount(total: number): number {
    return Math.max(1, Math.ceil(total / 4));
}

/** 文内 P(AI) 极差；chunk 少于 2 个时无极差可言，返回 0。 */
function chunkSpread(chunks: DetectPayload["chunks"]): number {
    if (chunks.length < 2) {
        return 0;
    }
    const scores = chunks.map((chunk) => chunk.pAi);
    return Math.max(...scores) - Math.min(...scores);
}

function toDetectReport(result: DetectFileResult): DetectFileReport {
    // 派生字段（rank / relative / spread）在报告层算，刻意不写进缓存 payload：
    // 否则每次给报告加字段都要让全部 content-hash 缓存失效。
    const descending = [...result.chunks].sort((left, right) => right.pAi - left.pAi);
    const rankByChunk = new Map(descending.map((chunk, index) => [chunk, index + 1]));
    return {
        filePath: result.filePath,
        docPAi: result.docPAi,
        maxPAi: result.maxPAi,
        spread: chunkSpread(result.chunks),
        cached: result.cached,
        // chunks 保持原文顺序，位次单独用 rank 表达。
        chunks: result.chunks.map((chunk) => ({
            ...chunk,
            rank: rankByChunk.get(chunk) ?? 1,
            relative: chunk.pAi - result.docPAi,
        })),
    };
}

function formatDetectReport(results: DetectFileResult[]): string {
    const lines: string[] = [];
    for (const result of results) {
        const report = toDetectReport(result);
        lines.push(`${result.filePath}`);
        // 整篇层用绝对判据回答「这篇整体可疑吗」。
        const docVerdict = report.docPAi >= DETECT_DOC_SUSPICIOUS ? "整体可疑" : "整体不可疑";
        lines.push(`  mean P(AI): ${formatProbability(report.docPAi)}（${docVerdict}）；max P(AI): ${formatProbability(report.maxPAi)}；文内极差: ${formatProbability(report.spread)}；cached: ${report.cached}`);
        if (report.chunks.length === 0) {
            lines.push("  文内分布：无可检测内容");
            lines.push("");
            continue;
        }
        if (report.spread < DETECT_SPREAD_FLOOR) {
            // 全篇均匀：热区/冷区之分是噪声，明确告诉消费者四象限在这篇不适用。
            lines.push(`  文内分布：极差 < ${DETECT_SPREAD_FLOOR}，全篇均匀，四象限不适用；按规则信号密度排优先级。`);
            lines.push("");
            continue;
        }

        const count = hotChunkCount(report.chunks.length);
        const byScore = [...report.chunks].sort((left, right) => left.rank - right.rank);
        // 刻意不用「热区 / 冷区」：文内低位不等于检测器认为它像人写（本篇 rank 6 仍有 P(AI)=0.929），
        // 绝对判断只在 mean P(AI) 那一层做。红绿措辞会诱导「低位 ⇒ 规则误报」的错误推论。
        lines.push(`  文内最可疑（rank 1–${count} / ${report.chunks.length}）：`);
        for (const chunk of byScore.slice(0, count)) {
            lines.push(`    ${formatDetectChunk(result, chunk)}`);
        }
        // chunk 数不足 2×count 时两端会重叠，此时不单列低位段。
        if (report.chunks.length >= count * 2) {
            lines.push(`  文内最不可疑（rank ${report.chunks.length - count + 1}–${report.chunks.length}，仍需看绝对 P(AI)）：`);
            for (const chunk of byScore.slice(-count)) {
                lines.push(`    ${formatDetectChunk(result, chunk)}`);
            }
        }
        lines.push("");
    }
    return lines.join("\n").trimEnd();
}

/** 单个 chunk 的一行呈现：行号范围、P(AI)、文内位次、相对文档均值偏离、短预览。 */
function formatDetectChunk(result: DetectFileResult, chunk: DetectChunkReport): string {
    const delta = `${chunk.relative >= 0 ? "+" : "-"}${formatProbability(Math.abs(chunk.relative))}`;
    return `L${chunk.line}-${detectEndLine(result, chunk.span[1])}  P(AI)=${formatProbability(chunk.pAi)}  rank ${chunk.rank}  Δ${delta}  ${previewChunk(result, chunk.span)}`;
}

function detectEndLine(result: DetectFileResult, end: number): number {
    if (end <= 0) {
        return 1;
    }
    return locatePosition(result.content, buildLineStarts(result.content), end - 1).line;
}

function previewChunk(result: DetectFileResult, span: [number, number]): string {
    const preview = result.content.slice(span[0], span[1]).replace(/\s+/gu, " ").trim();
    return Array.from(preview).slice(0, 30).join("");
}

function formatProbability(value: number): string {
    return value.toFixed(3);
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
