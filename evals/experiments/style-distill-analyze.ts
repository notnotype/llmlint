import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {Command} from "commander";
import {loadConfig} from "../generator/config";
import {loadEvalConfig} from "../generator/eval-config";
import {resolveAnyModel, resolveRepoPath} from "../generator/resolve-model";
import {callModelForTool, configureModelClient} from "../generator/model-client";
import {ProviderGate} from "../generator/rate-limit";
import {ANALYZE_STYLE_SYSTEM, ANALYZE_STYLE_TOOL, buildStyleAnalysisUser, STYLE_DISTILL_PROMPT_VERSION, type StyleAnalysis} from "./style-distill-prompt";

type Options = {input: string; output: string; model?: string; evalConfig?: string; config: string; maxChars: string; dryRun?: boolean};
const DEFAULT_INPUT = join(import.meta.dir, "..", "corpus", "light-novel", "villain-loli");
const DEFAULT_OUTPUT = join(import.meta.dir, "style-distill-analyses");

type RawAnalysis = Omit<StyleAnalysis, "sampleKey">;

function sha256(value: string): string {
    return `sha256:${createHash("sha256").update(value, "utf-8").digest("hex")}`;
}

/** 只列 reference，输出可续跑的每篇分析，避免中途失败重复付费。 */
async function run(opts: Options): Promise<void> {
    const inputRoot = resolve(opts.input);
    const metaPath = join(inputRoot, "meta.json");
    if (!existsSync(metaPath)) {
        throw new Error(`蒸馏输入缺少 meta.json：${inputRoot}`);
    }
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as {samples?: Array<{file?: string; role?: string}>};
    const references = (meta.samples ?? [])
        .filter((sample) => sample.role === "reference" && sample.file)
        .map((sample) => ({key: sample.file!, body: readFileSync(join(inputRoot, sample.file!), "utf-8")}))
        .sort((left, right) => left.key.localeCompare(right.key));
    if (references.length === 0) {
        throw new Error(`蒸馏输入没有 reference：${inputRoot}`);
    }
    const maxChars = Number.parseInt(opts.maxChars, 10);
    const evalConfig = loadEvalConfig(opts.evalConfig);
    const modelKey = opts.model ?? evalConfig.renderModels[0];
    if (!modelKey) {
        throw new Error("没有可用分析模型：请用 --model 指定");
    }
    const outputRoot = resolve(opts.output);
    mkdirSync(outputRoot, {recursive: true});
    console.log(`分析模型：${modelKey}｜样本 ${references.length}｜提示词 ${STYLE_DISTILL_PROMPT_VERSION}`);
    if (opts.dryRun) {
        console.log(`最多 ${references.length} 次结构化调用，未调用模型。`);
        return;
    }
    const config = loadConfig(resolveRepoPath(opts.config || evalConfig.modelsConfig));
    configureModelClient({retry: evalConfig.retry, gate: new ProviderGate(evalConfig.rateLimit.default, evalConfig.rateLimit.perProvider ?? {})});
    const model = resolveAnyModel(config, modelKey, evalConfig.cliProviders ?? {}, evalConfig.proxy, evalConfig.providerTimeouts);
    for (const reference of references) {
        const path = join(outputRoot, `${reference.key}.json`);
        if (existsSync(path)) {
            console.log(`  跳过已有 ${reference.key}`);
            continue;
        }
        const response = await callModelForTool(model, ANALYZE_STYLE_SYSTEM, buildStyleAnalysisUser(reference.key, reference.body, maxChars), ANALYZE_STYLE_TOOL, 5000);
        const analysis: RawAnalysis = response.toolArguments as RawAnalysis;
        const payload = {promptVersion: STYLE_DISTILL_PROMPT_VERSION, model: modelKey, sampleKey: reference.key, bodySha256: sha256(reference.body), analysis};
        writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
        console.log(`  完成 ${reference.key}`);
    }
}

const program = new Command();
program
    .name("style-distill-analyze")
    .description("逐篇分析参考正文并落盘匿名文风分析")
    .option("--input <dir>", "题组目录", DEFAULT_INPUT)
    .option("--output <dir>", "分析产物目录", DEFAULT_OUTPUT)
    .option("--model <key>", "分析模型")
    .option("--eval-config <path>", "eval 配置路径")
    .option("--config <path>", "NeuroBook config.json 路径")
    .option("--max-chars <n>", "每篇最大分析字符数", "12000")
    .option("--dry-run", "只打印计划")
    .action((opts: Options) => run(opts));
await program.parseAsync(process.argv);
