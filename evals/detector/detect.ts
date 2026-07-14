#!/usr/bin/env bun
// 外部 AIGC 检测器批量打分。对 corpus 全样本打分 → sidecar 缓存 → 外部对照（reference 应低分 / render 应高分）。
// 分数是对照仪表，不改 docScore/lift（口径分离）。repair 样本也打分（score.ts 的 report.repair 消费 before/after），
// 但 summary 仍只按 reference/render 汇总，repair 不进外部 AUC。
// 用法：bun evals/detector/detect.ts [--corpus <dir>] [--out <dir>] [--eval-config <path>] [--limit N]
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {isAbsolute, join, resolve} from "node:path";
import {Command} from "commander";
import {loadCorpus} from "../lib/corpus";
import {rocAuc} from "../lib/metrics";
import {loadEvalConfig} from "../generator/eval-config";
import {HfDetector, type DetectorClient} from "./hf-client";
import {detectorCacheKey, type DetectorScoresFile} from "./scores";
import type {ExternalDetectorSummary} from "../lib/types";

const DEFAULT_CORPUS = join(import.meta.dir, "..", "corpus");
const DEFAULT_OUT = join(import.meta.dir, "..", "report");
const REPO_ROOT = join(import.meta.dir, "..", "..");

/** sidecar 缓存：key = 内容hash+detector+version+chunkChars（内容变才失效；形状与 key 算法见 scores.ts）。summary 供 score.ts 搬进 report。 */
type Cache = DetectorScoresFile;

async function run(opts: {corpus: string; out: string; evalConfig?: string; limit?: string}): Promise<void> {
    const evalConfig = loadEvalConfig(opts.evalConfig);
    // proxy：设进程 env → Bun fetch（HF 检测器调用）走代理（所有 provider 支持 http proxy）。
    if (evalConfig.proxy) {
        process.env.HTTP_PROXY = evalConfig.proxy;
        process.env.HTTPS_PROXY = evalConfig.proxy;
        process.env.http_proxy = evalConfig.proxy;
        process.env.https_proxy = evalConfig.proxy;
    }
    const dc = evalConfig.detector;
    if (!dc) {
        fail("eval.config 缺 detector 配置");
    }
    const detector: DetectorClient = new HfDetector({endpoint: dc.endpoint, version: dc.version, chunkChars: dc.chunkChars, minIntervalMs: dc.minIntervalMs});

    const corpusRoot = resolve(isAbsolute(opts.corpus) ? opts.corpus : join(REPO_ROOT, opts.corpus));
    const {samples, warnings} = loadCorpus(corpusRoot);
    warnings.forEach((w) => console.log(`  ⚠ ${w}`));
    // repair 也打分：report.repair 的外部 P(AI) before/after 消费；summary 只按 reference/render 汇总（buildSummary 内过滤）。
    const targets = samples.filter((s) => s.role === "reference" || s.role === "render" || s.role === "repair");
    const limited = opts.limit ? targets.slice(0, Number.parseInt(opts.limit, 10)) : targets;
    console.log(`检测器 ${detector.name} @ ${detector.version}｜chunk ${dc.chunkChars} 字｜样本 ${limited.length}/${targets.length}`);

    const outDir = resolve(isAbsolute(opts.out) ? opts.out : join(REPO_ROOT, opts.out));
    mkdirSync(outDir, {recursive: true});
    const cachePath = join(outDir, "detector-scores.json");
    const cache = loadCache(cachePath, detector, dc.chunkChars);

    // 逐样本打分（断点续跑：内容 hash 命中缓存即跳过——贵结果落盘复用，同 render 哲学）。
    const scored: Array<{role: string; model?: string; genre: string; plotId: string; file: string; meanPAi: number; maxPAi: number}> = [];
    let hit = 0;
    let done = 0;
    for (const s of limited) {
        const key = detectorCacheKey(detector.name, detector.version, dc.chunkChars, s.text);
        let entry = cache.entries[key];
        if (entry) {
            hit += 1;
        } else {
            try {
                const result = await detector.detect(s.text);
                entry = {key, doc: result.doc, chunks: result.chunks};
                cache.entries[key] = entry;
                done += 1;
                if (done % 5 === 0) {
                    writeCache(cachePath, cache); // 周期落盘，中断不丢已打的分
                }
            } catch (error) {
                console.log(`  ⚠ ${s.genre}/${s.plotId}/${s.file}：检测失败（${error instanceof Error ? error.message : String(error)}），跳过`);
                continue;
            }
        }
        scored.push({role: s.role, model: s.model, genre: s.genre, plotId: s.plotId, file: s.file, meanPAi: entry.doc.meanPAi, maxPAi: entry.doc.maxPAi});
    }
    const summary = buildSummary(scored, detector, dc.chunkChars);
    cache.summary = summary;
    writeCache(cachePath, cache);

    printComparison(summary);
    console.log(`缓存命中 ${hit}｜新打分 ${done} → ${cachePath}`);
}

/** 计算外部对照摘要（reference vs render 的 P(AI) 中位 + AUC + byModel）。 */
function buildSummary(scored: Array<{role: string; model?: string; meanPAi: number}>, detector: DetectorClient, chunkChars: number): ExternalDetectorSummary {
    const human = scored.filter((s) => s.role === "reference").map((s) => s.meanPAi);
    const ai = scored.filter((s) => s.role === "render").map((s) => s.meanPAi);
    const byModelMap = new Map<string, number[]>();
    for (const s of scored) {
        if (s.role === "render" && s.model) {
            const list = byModelMap.get(s.model) ?? [];
            list.push(s.meanPAi);
            byModelMap.set(s.model, list);
        }
    }
    return {
        name: detector.name,
        version: detector.version,
        chunkChars,
        referenceMedianPAi: median(human),
        renderMedianPAi: median(ai),
        auc: rocAuc(ai, human),
        coverage: {reference: human.length, render: ai.length},
        byModel: [...byModelMap].map(([model, vals]) => ({model, medianPAi: median(vals) ?? 0, n: vals.length})),
    };
}

/** 外部对照打印（对照仪表，不进 lift）。 */
function printComparison(s: ExternalDetectorSummary): void {
    console.log("── 外部检测器对照（对照仪表，不进 lift）──");
    console.log(`  reference P(AI) 中位 ${fmt(s.referenceMedianPAi)}（n=${s.coverage.reference}）｜render P(AI) 中位 ${fmt(s.renderMedianPAi)}（n=${s.coverage.render}）`);
    console.log(`  外部检测器 AUC ${fmt(s.auc)}（P(render P(AI) > reference P(AI))；对照 llmlint report.json 的 detector.auc）`);
    for (const m of s.byModel) {
        console.log(`    ${m.model}：render P(AI) 中位 ${fmt(m.medianPAi)}（n=${m.n}）`);
    }
}

function loadCache(path: string, detector: DetectorClient, chunkChars: number): Cache {
    if (existsSync(path)) {
        try {
            const prev = JSON.parse(readFileSync(path, "utf-8")) as Cache;
            // detector/version/chunkChars 变了 → 旧缓存作废（口径变了不能混）。
            if (prev.detector === detector.name && prev.version === detector.version && prev.chunkChars === chunkChars) {
                return prev;
            }
        } catch {
            // 损坏则重建
        }
    }
    return {detector: detector.name, version: detector.version, chunkChars, entries: {}};
}

function writeCache(path: string, cache: Cache): void {
    writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, "utf-8");
}

/** 中位数（空数组 → null）。 */
function median(values: number[]): number | null {
    if (values.length === 0) {
        return null;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** 数值格式化（null → —）。 */
function fmt(value: number | null): string {
    return value === null ? "—" : value.toFixed(3);
}

function fail(message: string): never {
    console.error(`错误：${message}`);
    process.exit(1);
}

const program = new Command();
program
    .name("detect")
    .description("外部 AIGC 检测器批量打分 + 对照（对照仪表，不进 lift）")
    .option("--corpus <dir>", "语料根目录", DEFAULT_CORPUS)
    .option("--out <dir>", "输出目录（detector-scores.json）", DEFAULT_OUT)
    .option("--eval-config <path>", "eval 配置路径")
    .option("--limit <n>", "只打前 N 个样本（冒烟用）")
    .action((opts: {corpus: string; out: string; evalConfig?: string; limit?: string}) => run(opts));

await program.parseAsync(process.argv);
