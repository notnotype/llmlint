import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {Command} from "commander";
import {Value} from "typebox/value";
import {buildStyleSynthesisUser, SYNTHESIZE_STYLE_SYSTEM, SYNTHESIZE_STYLE_TOOL, STYLE_DISTILL_PROMPT_VERSION, type DistilledStyleOutput, type StyleAnalysis} from "./style-distill-prompt";
import {loadConfig} from "../generator/config";
import {loadEvalConfig} from "../generator/eval-config";
import {resolveAnyModel, resolveRepoPath} from "../generator/resolve-model";
import {callModelForTool, configureModelClient} from "../generator/model-client";
import {ProviderGate} from "../generator/rate-limit";

type Options = {input: string; output: string; model?: string; evalConfig?: string; config: string; shuffle?: boolean; dryRun?: boolean};
type AnalysisFile = {promptVersion: string; model: string; sampleKey: string; bodySha256: string; analysis: Omit<StyleAnalysis, "sampleKey">};
const DEFAULT_INPUT = join(import.meta.dir, "style-distill-analyses");
const DEFAULT_OUTPUT = join(import.meta.dir, "style-distill-output");

function sha256(value: string): string {
    return `sha256:${createHash("sha256").update(value, "utf-8").digest("hex")}`;
}

function readAnalyses(inputRoot: string): StyleAnalysis[] {
    const files = readdirSync(resolve(inputRoot), {withFileTypes: true})
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));
    const analyses = files.map((file) => {
        const payload = JSON.parse(readFileSync(join(resolve(inputRoot), file), "utf-8")) as AnalysisFile;
        if (payload.promptVersion !== STYLE_DISTILL_PROMPT_VERSION) {
            throw new Error(`${file} 使用 ${payload.promptVersion}，期望 ${STYLE_DISTILL_PROMPT_VERSION}`);
        }
        if (payload.sampleKey.length === 0 || !payload.analysis) {
            throw new Error(`${file} 缺 sampleKey 或 analysis`);
        }
        return {sampleKey: payload.sampleKey, ...payload.analysis};
    });
    if (analyses.length === 0) {
        throw new Error(`分析目录没有 JSON：${inputRoot}`);
    }
    return analyses.sort((left, right) => left.sampleKey.localeCompare(right.sampleKey));
}

function parseOutput(value: Record<string, unknown>): DistilledStyleOutput {
    if (!Value.Check(SYNTHESIZE_STYLE_TOOL.parameters, value)) {
        throw new Error("蒸馏输出不符合 schema");
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

/** 先按 sampleKey 形成规范输入；shuffle 只记录审计顺序，不改变模型输入。 */
async function run(opts: Options): Promise<void> {
    const analyses = readAnalyses(opts.input);
    const ordered = opts.shuffle ? [...analyses].reverse() : analyses;
    const canonical = [...analyses].sort((left, right) => left.sampleKey.localeCompare(right.sampleKey));
    const evalConfig = loadEvalConfig(opts.evalConfig);
    const modelKey = opts.model ?? evalConfig.renderModels[0];
    if (!modelKey) {
        throw new Error("没有可用汇总模型：请用 --model 指定");
    }
    const orderFingerprint = sha256(ordered.map((analysis) => analysis.sampleKey).join("\n"));
    const canonicalFingerprint = sha256(canonical.map((analysis) => analysis.sampleKey).join("\n"));
    console.log(`汇总模型：${modelKey}｜分析 ${analyses.length} 篇｜输入顺序 ${orderFingerprint}｜规范指纹 ${canonicalFingerprint}`);
    if (opts.dryRun) {
        console.log("干跑结束，未调用模型。");
        return;
    }
    const config = loadConfig(resolveRepoPath(opts.config || evalConfig.modelsConfig));
    configureModelClient({retry: evalConfig.retry, gate: new ProviderGate(evalConfig.rateLimit.default, evalConfig.rateLimit.perProvider ?? {})});
    const model = resolveAnyModel(config, modelKey, evalConfig.cliProviders ?? {}, evalConfig.proxy, evalConfig.providerTimeouts);
    const response = await callModelForTool(model, SYNTHESIZE_STYLE_SYSTEM, buildStyleSynthesisUser(canonical), SYNTHESIZE_STYLE_TOOL, 8000);
    const output = parseOutput(response.toolArguments);
    const result = {
        meta: {
            promptVersion: STYLE_DISTILL_PROMPT_VERSION,
            model: modelKey,
            inputSamples: canonical.map((analysis) => analysis.sampleKey),
            inputOrderFingerprint: orderFingerprint,
            canonicalInputFingerprint: canonicalFingerprint,
            outputFingerprint: sha256(JSON.stringify(output)),
            synthesizedAt: new Date().toISOString(),
        },
        output,
    };
    const outputRoot = resolve(opts.output);
    mkdirSync(outputRoot, {recursive: true});
    writeFileSync(join(outputRoot, "distill-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf-8");
    writeFileSync(join(outputRoot, "style.md"), `${output.styleMarkdown.trim()}\n`, "utf-8");
    console.log(`完成：${join(outputRoot, "style.md")}`);
}

const program = new Command();
program
    .name("style-distill-synthesize")
    .description("从匿名逐篇分析汇总 NeuroBook writer 文风预设")
    .option("--input <dir>", "逐篇分析目录", DEFAULT_INPUT)
    .option("--output <dir>", "汇总产物目录", DEFAULT_OUTPUT)
    .option("--model <key>", "汇总模型")
    .option("--eval-config <path>", "eval 配置路径")
    .option("--config <path>", "NeuroBook config.json 路径")
    .option("--shuffle", "反转分析输入顺序")
    .option("--dry-run", "只打印计划")
    .action((opts: Options) => run(opts));
await program.parseAsync(process.argv);
