import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {join, resolve} from "node:path";
import {Command} from "commander";
import {Value} from "typebox/value";
import {buildStyleAnalysisUser, buildStyleSynthesisUser, ANALYZE_STYLE_SYSTEM, ANALYZE_STYLE_TOOL, STYLE_DISTILL_PROMPT_VERSION, SYNTHESIZE_STYLE_SYSTEM, SYNTHESIZE_STYLE_TOOL, type DistilledStyleOutput, type StyleAnalysis} from "./style-distill-prompt";
import {loadConfig} from "../generator/config";
import {loadEvalConfig} from "../generator/eval-config";
import {resolveAnyModel, resolveRepoPath} from "../generator/resolve-model";
import {callModelForTool, configureModelClient, type AnyModel} from "../generator/model-client";
import {ProviderGate} from "../generator/rate-limit";

type SourceSample = {
    key: string;
    body: string;
};

type DistillMeta = {
    promptVersion: string;
    model: string;
    inputSamples: string[];
    inputOrderFingerprint: string;
    analysisFingerprint: string;
    outputFingerprint: string;
    analyzedAt: string;
};

type DistillResult = {
    meta: DistillMeta;
    analyses: StyleAnalysis[];
    output: DistilledStyleOutput;
};

type Options = {
    input: string;
    output: string;
    model?: string;
    evalConfig?: string;
    config: string;
    maxChars: string;
    dryRun?: boolean;
    shuffle?: boolean;
};

const DEFAULT_INPUT = join(import.meta.dir, "..", "corpus", "light-novel", "villain-loli");
const DEFAULT_OUTPUT = join(import.meta.dir, "style-distill-output");

/** 读取参考正文，不读取 render，避免把自产样本混入蒸馏输入。 */
function readReferenceSamples(inputRoot: string): SourceSample[] {
    const root = resolve(inputRoot);
    if (!existsSync(join(root, "meta.json"))) {
        throw new Error(`蒸馏输入缺少 meta.json：${root}`);
    }
    const meta = JSON.parse(readFileSync(join(root, "meta.json"), "utf-8")) as {samples?: Array<{file?: string; role?: string}>};
    const samples = (meta.samples ?? [])
        .filter((sample) => sample.role === "reference" && typeof sample.file === "string")
        .map((sample) => {
            const file = sample.file!;
            const path = join(root, file);
            if (!existsSync(path)) {
                throw new Error(`参考正文不存在：${path}`);
            }
            return {key: file, body: readFileSync(path, "utf-8")};
        });
    if (samples.length === 0) {
        throw new Error(`蒸馏输入没有 reference 样本：${root}`);
    }
    return samples.sort((left, right) => left.key.localeCompare(right.key));
}

/** 规范化模型返回的结构化分析，拒绝额外字段或不完整结构进入下一阶段。 */
function parseAnalysis(sampleKey: string, value: Record<string, unknown>): StyleAnalysis {
    if (!Value.Check(ANALYZE_STYLE_TOOL.parameters, value)) {
        throw new Error(`样本 ${sampleKey} 的文风分析不符合 schema`);
    }
    return {sampleKey, ...value} as StyleAnalysis;
}

/** 规范化最终文风产物，并挡住会把参考内容带入 bundled 资产的专名/原文泄漏。 */
function parseDistilledStyle(value: Record<string, unknown>): DistilledStyleOutput {
    if (!Value.Check(SYNTHESIZE_STYLE_TOOL.parameters, value)) {
        throw new Error("文风蒸馏输出不符合 schema");
    }
    const output = value as DistilledStyleOutput;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(output.suggestedKey)) {
        throw new Error(`suggestedKey 不是 kebab-case：${output.suggestedKey}`);
    }
    if (output.styleMarkdown.includes("reference-") || output.styleMarkdown.includes("render-") || /(?:作者|书名|章节|角色名|地名|原文专名)/u.test(output.styleMarkdown)) {
        throw new Error("styleMarkdown 疑似包含来源/专名泄漏，拒绝落盘");
    }
    return output;
}

function sha256(value: string): string {
    return `sha256:${createHash("sha256").update(value, "utf-8").digest("hex")}`;
}

/** 对参考正文逐篇分析，再把匿名分析汇总成可执行 Markdown。 */
async function run(opts: Options): Promise<void> {
    const samples = readReferenceSamples(opts.input);
    const maxChars = Number.parseInt(opts.maxChars, 10);
    if (!Number.isSafeInteger(maxChars) || maxChars < 500) {
        throw new Error(`--max-chars 必须是不小于 500 的整数：${opts.maxChars}`);
    }
    const evalConfig = loadEvalConfig(opts.evalConfig);
    const modelKey = opts.model ?? evalConfig.renderModels[0];
    if (!modelKey) {
        throw new Error("没有可用蒸馏模型：请用 --model 指定");
    }
    const orderedSamples = opts.shuffle ? [...samples].reverse() : samples;
    const inputOrderFingerprint = sha256(orderedSamples.map((sample) => sample.key).join("\n"));
    const outRoot = resolve(opts.output);
    console.log(`蒸馏模型：${modelKey}`);
    console.log(`参考样本：${samples.length} 篇｜最大输入 ${maxChars} 字/篇`);
    console.log(`提示词版本：${STYLE_DISTILL_PROMPT_VERSION}`);
    console.log(`输入顺序指纹：${inputOrderFingerprint}`);
    if (opts.dryRun) {
        console.log("干跑结束，未调用模型。");
        return;
    }

    const rawConfig = loadConfig(resolveRepoPath(opts.config || evalConfig.modelsConfig));
    if (evalConfig.proxy) {
        process.env.HTTP_PROXY = evalConfig.proxy;
        process.env.HTTPS_PROXY = evalConfig.proxy;
        process.env.http_proxy = evalConfig.proxy;
        process.env.https_proxy = evalConfig.proxy;
    }
    configureModelClient({retry: evalConfig.retry, gate: new ProviderGate(evalConfig.rateLimit.default, evalConfig.rateLimit.perProvider ?? {})});
    const model = resolveAnyModel(rawConfig, modelKey, evalConfig.cliProviders ?? {}, evalConfig.proxy, evalConfig.providerTimeouts);
    const analyses: StyleAnalysis[] = [];
    for (const sample of orderedSamples) {
        const result = await callModelForTool(
            model,
            ANALYZE_STYLE_SYSTEM,
            buildStyleAnalysisUser(sample.key, sample.body, maxChars),
            ANALYZE_STYLE_TOOL,
            5000,
        );
        analyses.push(parseAnalysis(sample.key, result.toolArguments));
        console.log(`  已分析 ${sample.key}`);
    }
    const stableAnalyses = [...analyses].sort((left, right) => left.sampleKey.localeCompare(right.sampleKey));
    const synthesis = await callModelForTool(
        model,
        SYNTHESIZE_STYLE_SYSTEM,
        buildStyleSynthesisUser(stableAnalyses),
        SYNTHESIZE_STYLE_TOOL,
        8000,
    );
    const output = parseDistilledStyle(synthesis.toolArguments);
    const result: DistillResult = {
        meta: {
            promptVersion: STYLE_DISTILL_PROMPT_VERSION,
            model: modelKey,
            inputSamples: stableAnalyses.map((analysis) => analysis.sampleKey),
            inputOrderFingerprint,
            analysisFingerprint: sha256(JSON.stringify(stableAnalyses)),
            outputFingerprint: sha256(JSON.stringify(output)),
            analyzedAt: new Date().toISOString(),
        },
        analyses: stableAnalyses,
        output,
    };
    mkdirSync(outRoot, {recursive: true});
    writeFileSync(join(outRoot, "distill-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf-8");
    writeFileSync(join(outRoot, "style.md"), `${output.styleMarkdown.trim()}\n`, "utf-8");
    console.log(`蒸馏完成：${join(outRoot, "style.md")}`);
    console.log(`产物指纹：${result.meta.outputFingerprint}`);
}

function resolveAnyConfigPath(configPath: string): string {
    return resolveRepoPath(configPath);
}

const program = new Command();
program
    .name("style-distill")
    .description("从匿名参考正文分析中蒸馏可执行 NeuroBook writer 文风")
    .option("--input <dir>", "包含 meta.json 与 reference-NNNN.md 的题组目录", DEFAULT_INPUT)
    .option("--output <dir>", "蒸馏产物目录（默认 gitignored）", DEFAULT_OUTPUT)
    .option("--model <key>", "蒸馏模型；默认取 eval 配置的首个 render 模型")
    .option("--eval-config <path>", "eval 配置路径")
    .option("--config <path>", "NeuroBook config.json 路径")
    .option("--max-chars <n>", "每篇送入分析模型的最大字符数", "12000")
    .option("--shuffle", "反转输入顺序，用于稳定性复核")
    .option("--dry-run", "只检查输入与调用计划，不调用模型")
    .action((opts: Options) => run(opts));

await program.parseAsync(process.argv);
