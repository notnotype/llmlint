#!/usr/bin/env bun
// 固定模型文风候选四臂实验：同一 brief 紧挨生成 control / current-default / beileng-clean / distilled。
// 语料只落实验目录；正文与样本来源保留在 gitignored 本地环境，meta 只留哈希和受控变量审计字段。
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {Command} from "commander";
import {loadConfig, modelSlug} from "../generator/config";
import {loadEvalConfig} from "../generator/eval-config";
import {resolveAnyModel, resolveRepoPath} from "../generator/resolve-model";
import {configureModelClient, type AnyModel} from "../generator/model-client";
import {ProviderGate} from "../generator/rate-limit";
import {renderDetailed} from "../generator/render";
import {renderPrompt, renderSystem} from "../generator/prompts";
import {genreLabel} from "../generator/render";
import {visibleLength} from "../lib/corpus";
import {listGroups, refsOf, type RefEntry} from "./arm-corpus";
import type {SampleMeta} from "./arm-corpus";

const RENDER_VERSION = "render-v2";
const STYLE_EXPERIMENT_VERSION = "style-arm-v2";
const MODEL_KEY = "deepseek/deepseek-v4-flash";
const ARMS = ["control", "current-default", "beileng-clean", "distilled"] as const;
type Arm = typeof ARMS[number];

type Options = {
    corpus: string;
    out: string;
    currentStyle?: string;
    beilengStyle?: string;
    distilledStyle?: string;
    guide?: string;
    guideTier: string;
    guideProfile?: string;
    genre?: string;
    plot?: string;
    maxGroups: string;
    perGroup: string;
    evalConfig?: string;
    config: string;
    dryRun?: boolean;
};

type StyleArmMeta = {
    genre: string;
    plotId: string;
    promptVersion: {render: string};
    experiment: {
        kind: "writing-style";
        version: string;
        model: string;
        arms: readonly string[];
        stylePromptVersion: string;
        stylePromptSha256: Record<string, string>;
        guide: {tier: string; profile: string | null; promptSha256: string};
        constraintsSha256: Record<string, string>;
    };
    samples: SampleMeta[];
};

function sha256(value: string): string {
    return `sha256:${createHash("sha256").update(value, "utf-8").digest("hex")}`;
}

function readStyleBody(path: string, arm: Exclude<Arm, "control">): {text: string; version: string; fingerprint: string} {
    const raw = readFileSync(resolve(path), "utf-8");
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, "").trim();
    if (body.length < 80) {
        throw new Error(`${arm} 文风文件过短：${path}`);
    }
    return {text: body, version: `${STYLE_EXPERIMENT_VERSION}:${arm}`, fingerprint: sha256(body)};
}

function readGuide(path: string, tier: string, profile?: string): {text: string; version: string; fingerprint: string; profile: string | null} {
    const text = readFileSync(resolve(path), "utf-8").trim();
    if (!text.includes("# 中文正文写作约束要点") || !text.includes(`档位 ${tier}`)) {
        throw new Error(`llmlint guide 内容或档位不匹配：${path}`);
    }
    return {text, version: `llmlint-guide:${tier}`, fingerprint: sha256(text), profile: profile ? resolve(profile) : null};
}

function combineConstraints(guide: string, style: string): string {
    if (style.length === 0) {
        return guide;
    }
    return `${guide}\n\n# 本轮文风要求\n\n${style}`;
}

function readMeta(path: string): StyleArmMeta | null {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) as StyleArmMeta : null;
}

function writeMeta(path: string, meta: StyleArmMeta): void {
    writeFileSync(path, `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
}

function stylePromptFor(arm: Arm, styles: Record<Exclude<Arm, "control">, {text: string; version: string; fingerprint: string}>): {text: string; version: string; fingerprint: string} {
    if (arm === "control") {
        return {text: "", version: "none", fingerprint: sha256("")};
    }
    return styles[arm];
}

function assertMetaMatches(meta: StyleArmMeta, guideFingerprint: string, styleFingerprints: Record<string, string>, constraintFingerprints: Record<string, string>, context: string): void {
    const mismatches = [
        meta.experiment.version === STYLE_EXPERIMENT_VERSION ? null : `version=${meta.experiment.version}`,
        meta.experiment.model === MODEL_KEY ? null : `model=${meta.experiment.model}`,
        meta.experiment.guide?.promptSha256 === guideFingerprint ? null : `guide=${meta.experiment.guide?.promptSha256 ?? "missing"}`,
        JSON.stringify(meta.experiment.stylePromptSha256) === JSON.stringify(styleFingerprints) ? null : "stylePromptSha256",
        JSON.stringify(meta.experiment.constraintsSha256) === JSON.stringify(constraintFingerprints) ? null : "constraintsSha256",
    ].filter((item): item is string => item !== null);
    if (mismatches.length > 0) {
        throw new Error(`${context} 实验 provenance 不匹配：${mismatches.join("、")}`);
    }
}

function assertExistingSample(sample: SampleMeta | undefined, expected: {guide: string; style: string; constraints: string; brief: string; prompt: string}, context: string): void {
    if (!sample) {
        throw new Error(`${context} 正文已存在但 meta 缺少样本记录`);
    }
    const mismatches = [
        sample.guidePromptSha256 === expected.guide ? null : "guidePromptSha256",
        sample.stylePromptSha256 === expected.style ? null : "stylePromptSha256",
        sample.constraintsSha256 === expected.constraints ? null : "constraintsSha256",
        sample.briefSha256 === expected.brief ? null : "briefSha256",
        sample.promptSha256 === expected.prompt ? null : "promptSha256",
    ].filter((item): item is string => item !== null);
    if (mismatches.length > 0) {
        throw new Error(`${context} 已存在样本 provenance 不匹配：${mismatches.join("、")}`);
    }
}

function requestFingerprint(brief: string, genre: string, targetChars: number, styleText: string): string {
    const preset = renderPrompt(RENDER_VERSION);
    const system = renderSystem(preset, targetChars, styleText);
    const user = `【题材】${genreLabel(genre)}\n\n【剧情纲】${brief}\n\n请据此写出本章正文。`;
    return sha256(JSON.stringify({renderVersion: RENDER_VERSION, system, user, maxTokens: 16000}));
}

function looksWrapped(text: string, styleText: string): boolean {
    const trimmed = text.trim();
    return trimmed.includes("<writing_style")
        || (styleText.length > 0 && trimmed.includes(styleText.slice(0, 80)))
        || /^```(?:markdown|text)?\s*$/mu.test(trimmed)
        || /(?:^|\n)(?:分析过程|写作思路|正文如下|以下是本章正文)[:：]/u.test(trimmed);
}

async function renderOne(model: AnyModel, brief: string, genre: string, targetChars: number, styleText: string): Promise<string | null> {
    const result = await renderDetailed(brief, {genre, targetChars, constraints: styleText}, model, RENDER_VERSION);
    const text = result.text.trim();
    if (visibleLength(text) < Math.min(400, targetChars * 0.2)) {
        console.log(`  ⚠ ${model.modelKey}：疑似拒答/截断（${visibleLength(text)} 字 ≪ 目标 ${targetChars}）`);
        return null;
    }
    if (looksWrapped(text, styleText)) {
        console.log(`  ⚠ ${model.modelKey}：输出包含提示词包装/分析过程，拒绝入库`);
        return null;
    }
    return text;
}

function validateOptions(opts: Options): void {
    if (!opts.guide || !existsSync(resolve(opts.guide))) {
        throw new Error(`缺少或找不到 --guide：四臂必须共享同一份 llmlint guide`);
    }
    if (opts.guideProfile && !existsSync(resolve(opts.guideProfile))) {
        throw new Error(`guide profile 不存在：${opts.guideProfile}`);
    }
    for (const [arm, path] of [["current-default", opts.currentStyle], ["beileng-clean", opts.beilengStyle], ["distilled", opts.distilledStyle]] as const) {
        if (!path) {
            throw new Error(`缺少 --${arm === "current-default" ? "current-style" : arm === "beileng-clean" ? "beileng-style" : "distilled-style"}：四臂实验不能缺候选输入`);
        }
        if (!existsSync(resolve(path))) {
            throw new Error(`${arm} 文风文件不存在：${path}`);
        }
    }
}

async function run(opts: Options): Promise<void> {
    const corpusRoot = resolve(opts.corpus);
    const outRoot = resolve(opts.out);
    const maxGroups = Number.parseInt(opts.maxGroups, 10);
    const perGroup = Number.parseInt(opts.perGroup, 10);
    validateOptions(opts);
    const guide = readGuide(opts.guide!, opts.guideTier, opts.guideProfile);
    const styles = {
        "current-default": readStyleBody(opts.currentStyle!, "current-default"),
        "beileng-clean": readStyleBody(opts.beilengStyle!, "beileng-clean"),
        distilled: readStyleBody(opts.distilledStyle!, "distilled"),
    };
    const groups = listGroups(corpusRoot)
        .filter((group) => !opts.genre || group.genre === opts.genre)
        .filter((group) => !opts.plot || group.plot === opts.plot)
        .slice(0, maxGroups);
    const plan = groups.flatMap((group) => refsOf(corpusRoot, group).slice(0, perGroup).map((ref) => ({group, ref})));
    const stylePromptSha256 = Object.fromEntries(ARMS.map((arm) => [arm, stylePromptFor(arm, styles).fingerprint]));
    const constraintsSha256 = Object.fromEntries(ARMS.map((arm) => [arm, sha256(combineConstraints(guide.text, stylePromptFor(arm, styles).text))]));
    console.log(`固定模型：${MODEL_KEY}`);
    console.log(`共享 guide：${guide.version}｜${guide.fingerprint}｜profile=${guide.profile ?? "none"}`);
    console.log(`题组 ${groups.length} × 章节 ≤${perGroup} × 四臂 = 最多 ${plan.length * ARMS.length} 次调用`);
    console.log(`文风指纹：${JSON.stringify(stylePromptSha256)}`);
    console.log(`组合约束指纹：${JSON.stringify(constraintsSha256)}`);
    if (plan.length === 0) {
        throw new Error(`没有匹配的 brief：genre=${opts.genre ?? "*"} plot=${opts.plot ?? "*"}`);
    }
    if (existsSync(outRoot)) {
        for (const group of listGroups(outRoot)) {
            const metaPath = join(outRoot, group.genre, group.plot, "meta.json");
            const meta = readMeta(metaPath);
            if (meta) {
                assertMetaMatches(meta, guide.fingerprint, stylePromptSha256, constraintsSha256, `${group.genre}/${group.plot}/meta.json`);
            }
        }
    }
    if (opts.dryRun) {
        for (const {group, ref} of plan) {
            console.log(`  ${group.genre}/${group.plot} ${ref.file}（目标 ${ref.targetChars} 字，四臂）`);
        }
        console.log("干跑结束，未调用模型。");
        return;
    }
    const evalConfig = loadEvalConfig(opts.evalConfig);
    const rawConfig = loadConfig(resolveRepoPath(opts.config || evalConfig.modelsConfig));
    configureModelClient({retry: evalConfig.retry, gate: new ProviderGate(evalConfig.rateLimit.default, evalConfig.rateLimit.perProvider ?? {})});
    const model = resolveAnyModel(rawConfig, MODEL_KEY, evalConfig.cliProviders ?? {}, evalConfig.proxy, evalConfig.providerTimeouts);
    let generated = 0;
    let skipped = 0;
    let failed = 0;
    for (const {group, ref} of plan) {
        const outDir = join(outRoot, group.genre, group.plot);
        mkdirSync(outDir, {recursive: true});
        const brief = readFileSync(ref.briefPath, "utf-8");
        const metaPath = join(outDir, "meta.json");
        const existing = readMeta(metaPath);
        const samples = existing?.samples ? [...existing.samples] : [];
        const groupMeta: StyleArmMeta = existing ?? {
            genre: group.genre,
            plotId: group.plot,
            promptVersion: {render: RENDER_VERSION},
            experiment: {
                kind: "writing-style",
                version: STYLE_EXPERIMENT_VERSION,
                model: MODEL_KEY,
                arms: ARMS,
                stylePromptVersion: STYLE_EXPERIMENT_VERSION,
                stylePromptSha256,
                guide: {tier: opts.guideTier, profile: guide.profile, promptSha256: guide.fingerprint},
                constraintsSha256,
            },
            samples,
        };
        for (const arm of ARMS) {
            const file = `render-${ref.idx}-${modelSlug(MODEL_KEY)}-${arm}.md`;
            const renderPath = join(outDir, file);
            const style = stylePromptFor(arm, styles);
            const constraints = combineConstraints(guide.text, style.text);
            if (existsSync(renderPath)) {
                assertExistingSample(samples.find((item) => item.file === file), {
                    guide: guide.fingerprint,
                    style: style.fingerprint,
                    constraints: sha256(constraints),
                    brief: sha256(brief),
                    prompt: requestFingerprint(brief, group.genre, ref.targetChars, constraints),
                }, `${group.genre}/${group.plot}/${file}`);
                skipped++;
                continue;
            }
            try {
                const text = await renderOne(model, brief, group.genre, ref.targetChars, constraints);
                if (text === null) {
                    failed++;
                    continue;
                }
                writeFileSync(renderPath, `${text}\n`, "utf-8");
                const sample: SampleMeta = {
                    file,
                    role: "render",
                    model: MODEL_KEY,
                    promptVersion: RENDER_VERSION,
                    pairRef: ref.file,
                    styleKey: arm,
                    difficulty: arm,
                    charCount: visibleLength(text),
                    stylePromptVersion: style.version,
                    stylePromptSha256: style.fingerprint,
                    guidePromptVersion: guide.version,
                    guidePromptSha256: guide.fingerprint,
                    constraintsSha256: sha256(constraints),
                    promptSha256: requestFingerprint(brief, group.genre, ref.targetChars, constraints),
                    bodySha256: sha256(text),
                    briefSha256: sha256(brief),
                };
                const index = samples.findIndex((item) => item.file === file);
                if (index >= 0) {
                    samples[index] = sample;
                } else {
                    samples.push(sample);
                }
                groupMeta.samples = samples;
                writeMeta(metaPath, groupMeta);
                generated++;
                console.log(`  ${group.genre}/${group.plot} ${ref.file} ← ${arm}：${visibleLength(text)} 字（目标 ${ref.targetChars}）`);
            } catch (error) {
                failed++;
                console.log(`  ✖ ${group.genre}/${group.plot} ${ref.file} [${arm}]：${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    console.log(`完成：新生成 ${generated}，已存在跳过 ${skipped}，失败 ${failed}`);
}

const program = new Command();
program
    .name("style-arm")
    .description("固定 DeepSeek 文风候选四臂实验")
    .option("--corpus <dir>", "主语料根", join(import.meta.dir, "..", "corpus"))
    .option("--out <dir>", "实验语料输出根", join(import.meta.dir, "style-arm-v2"))
    .option("--current-style <path>", "当前 NeuroBook 默认文风文件")
    .option("--beileng-style <path>", "清理后的北棱候选文风文件")
    .option("--distilled-style <path>", "本轮蒸馏候选文风文件")
    .option("--guide <path>", "四臂共享的 llmlint guide markdown")
    .option("--guide-tier <tier>", "guide 档位审计字段", "standard")
    .option("--guide-profile <path>", "生成 guide 使用的 eval report")
    .option("--genre <name>", "只处理指定题材")
    .option("--plot <name>", "只处理指定题组")
    .option("--max-groups <n>", "最多题组数", "50")
    .option("--per-group <n>", "每题组最多章节数", "50")
    .option("--eval-config <path>", "eval 配置路径")
    .option("--config <path>", "NeuroBook config.json 路径")
    .option("--dry-run", "只打印计划")
    .action((opts: Options) => run(opts));
await program.parseAsync(process.argv);
