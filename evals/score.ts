#!/usr/bin/env bun
// llmlint 评测消费侧入口。语料 → 复用 llmlint 引擎扫描 → lift/AUC/排名 → 报告。
// 用法：bun evals/score.ts [--corpus <dir>] [--out <dir>] [--min-support N] [--holdout <ratio>]
// 默认 corpus=evals/corpus、out=evals/report（脚本同级，cwd 无关、不随 .agent 清理丢失）。
import {mkdirSync, writeFileSync, existsSync, readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {Command} from "commander";
import {loadCorpus} from "./lib/corpus";
import {scanAll} from "./lib/scan";
import {computeMetrics, computeRepairStat, HOLDOUT_MIN_GROUPS} from "./lib/metrics";
import {buildReport} from "./lib/report";
import {detectorCacheKey, type DetectorScoresFile} from "./detector/scores";
import type {Sample} from "./lib/types";

const DEFAULT_CORPUS = join(import.meta.dir, "corpus");
const DEFAULT_OUT = join(import.meta.dir, "report");

async function main(args: {corpus: string; out: string; minSupport: number; holdout: number}): Promise<void> {
    const corpusRoot = resolve(args.corpus);

    const {samples, warnings} = loadCorpus(corpusRoot);
    if (samples.length === 0) {
        fail(`语料为空（无可用样本）：${corpusRoot}`);
    }

    // holdout 题组不足自动关闭（<4 组无统计意义），把降级如实写进报告警告。
    const groupCount = new Set(samples.map((sample) => `${sample.genre}/${sample.plotId}`)).size;
    let holdoutRatio = args.holdout;
    if (holdoutRatio > 0 && groupCount < HOLDOUT_MIN_GROUPS) {
        warnings.push(`holdout 已关闭：题组仅 ${groupCount} 个（<${HOLDOUT_MIN_GROUPS}），切分无统计意义。`);
        holdoutRatio = 0;
    }

    const {scans, ruleMetas, activeRegexRules, overlap} = await scanAll(samples);
    const metrics = computeMetrics(scans, ruleMetas, args.minSupport, holdoutRatio);
    const outDir = resolve(args.out);
    // 外部检测器对照：若 detect.ts 已跑（detector-scores.json 有 summary），原样搬进 report（对照仪表，不进 lift）。
    const detectorScores = readDetectorScores(join(outDir, "detector-scores.json"));
    const externalDetector = detectorScores?.summary ?? null;
    // repair before/after 配对（I5 单独统计）：外部 P(AI) 从 sidecar 按当前正文重算 key 查表（内容已变 = 视为未打分）。
    const repair = computeRepairStat(scans, detectorScores ? externalPAiByFile(samples, detectorScores) : undefined);
    const report = buildReport(corpusRoot, metrics, activeRegexRules, args.minSupport, warnings, overlap, externalDetector, repair);

    mkdirSync(outDir, {recursive: true});
    // 唯一产物：report.json（数据契约）。表现层交给 web/ 的报告页（拖入 json 渲染）。
    writeFileSync(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf-8");

    printSummary(report, outDir);
}

/** 读 detector sidecar（detect.ts 产出，含 summary + 按内容 hash 的逐篇分）；无/损坏则 null。 */
function readDetectorScores(path: string): DetectorScoresFile | null {
    if (!existsSync(path)) {
        return null;
    }
    try {
        return JSON.parse(readFileSync(path, "utf-8")) as DetectorScoresFile;
    } catch {
        return null;
    }
}

/** 逐样本查外部检测分：Map<`${genre}/${plotId}/${file}`, meanPAi>。key 按当前正文重算（scores.ts 单一算法），无陈旧映射。 */
function externalPAiByFile(samples: Sample[], scores: DetectorScoresFile): Map<string, number> {
    const map = new Map<string, number>();
    for (const sample of samples) {
        const entry = scores.entries[detectorCacheKey(scores.detector, scores.version, scores.chunkChars, sample.text)];
        if (entry) {
            map.set(`${sample.genre}/${sample.plotId}/${sample.file}`, entry.doc.meanPAi);
        }
    }
    return map;
}

function printSummary(report: ReturnType<typeof buildReport>, outDir: string): void {
    const {counts, detector} = report;
    console.log(`题组 ${counts.groups}｜reference ${counts.reference}｜render ${counts.render}｜repair ${counts.repair}｜命中规则 ${report.rules.length}`);
    if (detector.auc === null) {
        console.log(`检测器 AUC：— （无 AI render）｜人类 docScore 中位 ${detector.humanMedianScore.toFixed(2)}/千字｜误杀率 ${detector.humanAgentFalseRate.toFixed(2)}/千字`);
    } else {
        console.log(`检测器 ROC-AUC：${detector.auc.toFixed(3)}｜docScore 中位 人类 ${detector.humanMedianScore.toFixed(2)} / AI ${detector.aiMedianScore.toFixed(2)}｜人类误杀率 ${detector.humanAgentFalseRate.toFixed(2)}/千字`);
        const strong = report.rules.filter((rule) => rule.verdict === "strong").length;
        const anti = report.rules.filter((rule) => rule.verdict === "anti").length;
    console.log(`规则裁决：强判别 ${strong}｜反指标 ${anti}（详见 report.json）`);
    console.log(`规则重叠：原始 ${report.overlap.rawHits}｜唯一 span ${report.overlap.uniqueSpans}｜重复率 ${(report.overlap.duplicateRate * 100).toFixed(1)}%`);
    }
    if (report.holdout) {
        const {trainGroups, testGroups, trainAuc, testAuc} = report.holdout;
        const fmt = (auc: number | null): string => (auc === null ? "—" : auc.toFixed(3));
        console.log(`Holdout：train ${trainGroups} 组 AUC ${fmt(trainAuc)} / test ${testGroups} 组 AUC ${fmt(testAuc)}`);
    }
    if (report.externalDetector) {
        const e = report.externalDetector;
        const fmt = (v: number | null): string => (v === null ? "—" : v.toFixed(3));
        console.log(`外部检测器 ${e.name}：reference P(AI) 中位 ${fmt(e.referenceMedianPAi)} / render ${fmt(e.renderMedianPAi)}｜AUC ${fmt(e.auc)}（对照仪表，不进 lift）`);
    }
    if (report.repair) {
        const r = report.repair;
        const fmt2 = (v: number | null): string => (v === null ? "—" : v.toFixed(2));
        const orphanTag = r.orphans > 0 ? `（另有孤儿 ${r.orphans}）` : "";
        console.log(`Repair 一轮（I5 单独统计，不进 lift/AUC）：配对 ${r.total}${orphanTag}｜docScore 中位 ${fmt2(r.docScoreMedianBefore)} → ${fmt2(r.docScoreMedianAfter)}｜改善 ${r.docScoreImproved}/${r.total}`);
        if (r.externalCovered > 0) {
            const fmt3 = (v: number | null): string => (v === null ? "—" : v.toFixed(3));
            console.log(`  外部检测器 P(AI) 中位 ${fmt3(r.externalMedianBefore)} → ${fmt3(r.externalMedianAfter)}（覆盖 ${r.externalCovered}/${r.total}）｜下降 ${r.externalImproved}/${r.externalCovered}`);
        }
    }
    if (report.warnings.length > 0) {
        console.log(`警告 ${report.warnings.length} 条（详见 report.json 的 warnings）`);
    }
    console.log(`→ ${join(outDir, "report.json")}（拖进 web 报告页查看）`);
}

function fail(message: string): never {
    console.error(`错误：${message}`);
    process.exit(1);
}

const program = new Command();
program
    .name("score")
    .description("eval 消费侧：扫描语料 → lift/AUC/排名 → report.json")
    .option("--corpus <dir>", "语料根目录", DEFAULT_CORPUS)
    .option("--out <dir>", "报告输出目录", DEFAULT_OUT)
    .option("--min-support <n>", "规则支持度守门（人+AI 总命中不足则不裁决）", "5")
    .option("--holdout <ratio>", "留出集比例（0=关闭；题组<4 自动关）", "0.4")
    .action((opts: {corpus: string; out: string; minSupport: string; holdout: string}) =>
        main({corpus: opts.corpus, out: opts.out, minSupport: Number.parseInt(opts.minSupport, 10), holdout: Number.parseFloat(opts.holdout)}));

await program.parseAsync(process.argv);
