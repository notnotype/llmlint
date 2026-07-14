#!/usr/bin/env bun
// corpus 文本分类 CLI：LLM 补空题组的 pov/textType/genre（curator > llm，只补空不覆盖）。
// 用法：bun evals/classifier/classify.ts [--corpus <dir>] [--model <key>] [--eval-config <path>] [--dry]
// 写回 meta.json 的 classification 节：{pov?, textType?, source:"llm", model, classifiedAt}；genre 缺失也补（罕见，corpus 目录名即 curator genre）。
import {existsSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {isAbsolute, join} from "node:path";
import {Command} from "commander";
import {loadConfig, resolveModel} from "../generator/config";
import {loadEvalConfig} from "../generator/eval-config";
import {configureModelClient} from "../generator/model-client";
import {ProviderGate} from "../generator/rate-limit";
import {classifyText} from "./classify-agent";

const DEFAULT_CORPUS = join(import.meta.dir, "..", "corpus");
const REPO_ROOT = join(import.meta.dir, "..", "..");

type GroupMeta = {
    genre?: string;
    plotId?: string;
    /** LLM 分类补空的结果（curator 定的 genre 不进这里）；source 恒 "llm"（本 CLI 只producer llm 断言） */
    classification?: {genre?: string; textType?: string; pov?: string; source: "llm"; model: string; classifiedAt: string};
    samples?: Array<{file: string; role: string; [key: string]: unknown}>;
    [key: string]: unknown;
};

async function run(opts: {corpus: string; model?: string; evalConfig?: string; dry?: boolean}): Promise<void> {
    const evalConfig = loadEvalConfig(opts.evalConfig);
    if (evalConfig.proxy) {
        process.env.HTTP_PROXY = evalConfig.proxy;
        process.env.HTTPS_PROXY = evalConfig.proxy;
    }
    configureModelClient({
        retry: evalConfig.retry,
        gate: new ProviderGate(evalConfig.rateLimit.default, evalConfig.rateLimit.perProvider ?? {}),
    });
    const modelKey = opts.model || evalConfig.classifier?.model;
    if (!modelKey) {
        fail("未配置分类模型：--model 或 eval.config 的 classifier.model");
    }
    const config = loadConfig(resolveRepoPath(evalConfig.modelsConfig));
    const model = resolveModel(config, modelKey);
    const maxChars = evalConfig.classifier?.maxChars ?? 2000;

    const corpusRoot = isAbsolute(opts.corpus) ? opts.corpus : join(REPO_ROOT, opts.corpus);
    let classified = 0;
    let skipped = 0;
    for (const genreDir of listDirs(corpusRoot)) {
        for (const plotDir of listDirs(join(corpusRoot, genreDir))) {
            const groupDir = join(corpusRoot, genreDir, plotDir);
            const metaPath = join(groupDir, "meta.json");
            if (!existsSync(metaPath)) {
                continue;
            }
            const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as GroupMeta;
            // 只补空：genre 由目录/curator 定；pov/textType 缺才分类（curator > user > llm，不覆盖）。
            const missing = {
                genre: !(meta.genre ?? genreDir),
                textType: !meta.classification?.textType,
                pov: !meta.classification?.pov,
            };
            if (!missing.textType && !missing.pov && !missing.genre) {
                skipped += 1;
                continue;
            }
            const firstRef = (meta.samples ?? []).find((s) => s.role === "reference")?.file;
            if (!firstRef || !existsSync(join(groupDir, firstRef))) {
                console.log(`  ⚠ ${genreDir}/${plotDir}：无 reference，跳过`);
                continue;
            }
            const text = readFileSync(join(groupDir, firstRef), "utf-8");
            let result;
            try {
                result = await classifyText(text, model, maxChars);
            } catch (error) {
                console.log(`  ⚠ ${genreDir}/${plotDir}：分类失败（${error instanceof Error ? error.message : String(error)}），跳过`);
                continue;
            }
            // 组装补空结果（已有值绝不覆盖）。
            const next: NonNullable<GroupMeta["classification"]> = {
                ...(meta.classification ?? {}),
                source: "llm",
                model: modelKey,
                classifiedAt: new Date().toISOString(),
            };
            if (missing.pov && result.pov) {
                next.pov = result.pov;
            }
            if (missing.textType && result.textType) {
                next.textType = result.textType;
            }
            if (missing.genre && result.genre) {
                next.genre = result.genre;
            }
            const filled = ["pov", "textType", "genre"].filter((k) => (next as Record<string, unknown>)[k] && !(meta.classification as Record<string, unknown> | undefined)?.[k]);
            console.log(`  ${genreDir}/${plotDir} ← ${modelKey}：${filled.length ? filled.map((k) => `${k}=${(next as Record<string, unknown>)[k]}`).join(" ") : "（模型均不确定，未补）"}${opts.dry ? "（dry，不写盘）" : ""}`);
            if (!opts.dry && filled.length > 0) {
                writeFileSync(metaPath, `${JSON.stringify({...meta, classification: next}, null, 2)}\n`, "utf-8");
            }
            classified += 1;
        }
    }
    console.log(`完成：分类 ${classified} 组，已齐全跳过 ${skipped} 组。`);
}

function listDirs(root: string): string[] {
    if (!existsSync(root)) {
        return [];
    }
    return readdirSync(root, {withFileTypes: true}).filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

function resolveRepoPath(path: string): string {
    return isAbsolute(path) ? path : join(REPO_ROOT, path);
}

function fail(message: string): never {
    console.error(`错误：${message}`);
    process.exit(1);
}

const program = new Command();
program
    .name("classify")
    .description("LLM 补空 corpus 题组的分类（pov/textType；只补空不覆盖 curator 值）")
    .option("--corpus <dir>", "语料根目录", DEFAULT_CORPUS)
    .option("--model <key>", "分类模型（缺省用 eval.config.classifier.model）")
    .option("--eval-config <path>", "eval 配置路径")
    .option("--dry", "只打印不写盘")
    .action((opts: {corpus: string; model?: string; evalConfig?: string; dry?: boolean}) => run(opts));

await program.parseAsync(process.argv);
