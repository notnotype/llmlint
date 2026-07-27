#!/usr/bin/env bun
// 写作期约束元评测 · 生成侧：同一批 brief 上跑两臂 render，唯一变量是系统提示词里有没有
// `llmlint guide` 的写作约束。
//
// 为什么两臂都要现生成：现有语料的 render-v1 样本是几周前产出的，直接拿来当对照臂会把
// 模型漂移混进结论。两臂都用 render-v2（空约束时与 v1 逐字节等价，prompts.test.ts 守）
// 并且逐 brief 逐模型**紧挨着**跑，让时间漂移对两臂等量作用。
//
// 产物不进主语料：I8 禁止一份报告里混 render 版本，主语料是 render-v1，本实验是 render-v2。
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {Command} from "commander";
import {loadConfig, modelSlug} from "../generator/config";
import {loadEvalConfig} from "../generator/eval-config";
import {resolveAnyModel, resolveRepoPath} from "../generator/resolve-model";
import {configureModelClient, type AnyModel} from "../generator/model-client";
import {ProviderGate} from "../generator/rate-limit";
import {renderDetailed} from "../generator/render";
import {visibleLength} from "../lib/corpus";
import {GUIDE_TIERS, type GuideTier} from "../../skill/src/guide";
import {buildGuideText, listGroups, readGroupMeta, refsOf, resolveTier, writeGroupMeta, type SampleMeta} from "./arm-corpus";

const DEFAULT_CORPUS = join(import.meta.dir, "..", "corpus");
const DEFAULT_OUT = join(import.meta.dir, "guide-arm");
/** 本实验固定用 render-v2：它是唯一带约束槽位的模板，空约束时与 v1 逐字节等价。 */
const RENDER_VERSION = "render-v2";

/** 两臂。control 不注入约束，是本实验自己的 baseline（不复用主语料的历史 render）。 */
const ARMS = ["control", "guide"] as const;
type Arm = typeof ARMS[number];

type Options = {
    corpus: string;
    out: string;
    tier: string;
    profile?: string;
    models?: string;
    maxGroups: string;
    perGroup: string;
    evalConfig?: string;
    config: string;
    dryRun?: boolean;
};

async function run(opts: Options): Promise<void> {
    const tier = resolveTier(opts.tier);
    const corpusRoot = resolve(opts.corpus);
    const outRoot = resolve(opts.out);
    const maxGroups = Number(opts.maxGroups);
    const perGroup = Number(opts.perGroup);

    const guideText = await buildGuideText(tier, opts.profile);
    console.log(`写作约束：档位 ${tier}，${visibleLength(guideText)} 可见字\n`);

    const evalConfig = loadEvalConfig(opts.evalConfig);
    const modelKeys = (opts.models ?? evalConfig.renderModels.join(",")).split(",").map((key) => key.trim()).filter(Boolean);
    if (modelKeys.length === 0) {
        throw new Error("没有可用的 render 模型：用 --models 指定，或在 eval.config.json 里配 renderModels。");
    }

    const groups = listGroups(corpusRoot).slice(0, maxGroups);
    const plan = groups.flatMap((group) => refsOf(corpusRoot, group).slice(0, perGroup).map((ref) => ({group, ref})));
    const pending = plan.length * modelKeys.length * ARMS.length;
    console.log(`题组 ${groups.length} × 章节 ≤${perGroup} × 模型 ${modelKeys.length} × 两臂 = 最多 ${pending} 次调用`);
    console.log(`模型：${modelKeys.join(", ")}`);
    console.log(`输出：${outRoot}\n`);
    if (opts.dryRun) {
        for (const {group, ref} of plan) {
            console.log(`  ${group.genre}/${group.plot} ${ref.file}（目标 ${ref.targetChars} 字，brief ${visibleLength(readFileSync(ref.briefPath, "utf-8"))} 字）`);
        }
        console.log(`\n干跑结束，未调用任何模型。`);
        return;
    }

    const rawConfig = loadConfig(resolveRepoPath(opts.config || evalConfig.modelsConfig));
    const cliProviders = evalConfig.cliProviders ?? {};
    // 限流由 model-client 内部统一应用（与 generate.ts 同口径），调用方不自己排队。
    configureModelClient({
        retry: evalConfig.retry,
        gate: new ProviderGate(evalConfig.rateLimit.default, evalConfig.rateLimit.perProvider ?? {}),
    });
    const models = modelKeys.map((key) => ({key, model: resolveAnyModel(rawConfig, key, cliProviders, evalConfig.proxy, evalConfig.providerTimeouts)}));

    let done = 0;
    let skipped = 0;
    let failed = 0;
    for (const {group, ref} of plan) {
        const outDir = join(outRoot, group.genre, group.plot);
        mkdirSync(outDir, {recursive: true});
        const brief = readFileSync(ref.briefPath, "utf-8");
        const samples: SampleMeta[] = readGroupMeta(outDir)?.samples ?? [];

        for (const {key, model} of models) {
            // 两臂紧挨着跑：让模型漂移、限流抖动对 control 与 guide 等量作用。
            for (const arm of ARMS) {
                const file = `render-${ref.idx}-${modelSlug(key)}-${arm}.md`;
                const path = join(outDir, file);
                if (existsSync(path)) {
                    skipped++;
                    continue;
                }
                const text = await renderOne(key, model, brief, group.genre, ref.targetChars, arm === "guide" ? guideText : "");
                if (text === null) {
                    failed++;
                    continue;
                }
                writeFileSync(path, text, "utf-8");
                samples.push({file, role: "render", model: key, promptVersion: RENDER_VERSION, pairRef: ref.file, styleKey: arm, difficulty: arm === "guide" ? `llmlint-guide-${tier}` : "raw", charCount: visibleLength(text)});
                writeGroupMeta(outDir, group.genre, group.plot, RENDER_VERSION, tier, samples);
                done++;
                console.log(`  ${group.genre}/${group.plot} ${ref.file} ← ${key} [${arm}]：${visibleLength(text)} 字（目标 ${ref.targetChars}）`);
            }
        }
    }
    console.log(`\n完成：新生成 ${done}，已存在跳过 ${skipped}，失败 ${failed}`);
    if (failed > 0) {
        console.log(`失败的样本不会写盘；重跑本命令会只补失败项（已存在的文件自动跳过）。`);
    }
}

/**
 * 跑一次 render。
 *
 * @returns 正文；调用失败或产出明显过短（疑似拒答/截断）时返回 null，由调用方计入失败。
 *   过短判据沿用 generate.ts 的口径，避免把半截文本混进配对统计。
 */
async function renderOne(modelKey: string, model: AnyModel, brief: string, genre: string, targetChars: number, constraints: string): Promise<string | null> {
    try {
        const result = await renderDetailed(brief, {genre, targetChars, constraints}, model, RENDER_VERSION);
        const text = result.text.trim();
        if (visibleLength(text) < Math.min(400, targetChars * 0.2)) {
            console.log(`  ⚠ ${modelKey}：疑似拒答/截断（${visibleLength(text)} 字 ≪ 目标 ${targetChars}），跳过`);
            return null;
        }
        return text;
    } catch (error) {
        console.log(`  ✖ ${modelKey}：${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}


const program = new Command();
program
    .name("guide-arm")
    .description("写作期约束元评测生成侧：同一批 brief 上跑 control / guide 两臂 render")
    .option("--corpus <dir>", "主语料根（只读 brief 与 reference）", DEFAULT_CORPUS)
    .option("--out <dir>", "实验语料输出根", DEFAULT_OUT)
    .option("--tier <tier>", `写作约束档位：${GUIDE_TIERS.join(" < ")}`, "standard")
    .option("--profile <path>", "eval 报告 JSON 路径；提供后 core/wide 档才带判别力规则")
    .option("--models <keys>", "render 模型面板（逗号分隔；缺省用 eval.config.renderModels）")
    .option("--max-groups <n>", "最多处理题组数", "50")
    .option("--per-group <n>", "每个题组最多处理章节数", "50")
    .option("--eval-config <path>", "eval 配置路径")
    .option("--config <path>", "LLM HTTP config.json 路径（缺省用 eval.config.modelsConfig）", "")
    .option("--dry-run", "只列出将要生成的样本与调用次数，不调用模型")
    .action((opts: Options) => run(opts));

await program.parseAsync(process.argv);
