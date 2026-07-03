#!/usr/bin/env bun
// llmlint 评测消费侧入口。语料 → 复用 llmlint 引擎扫描 → lift/AUC/排名 → 报告。
// 用法：bun evals/score.ts [--corpus <dir>] [--out <dir>] [--min-support N] [--holdout <ratio>]
// 默认 corpus=evals/corpus、out=evals/report（脚本同级，cwd 无关、不随 .agent 清理丢失）。
import {mkdirSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {Command} from "commander";
import {loadCorpus} from "./lib/corpus";
import {scanAll} from "./lib/scan";
import {computeMetrics, HOLDOUT_MIN_GROUPS} from "./lib/metrics";
import {buildReport} from "./lib/report";

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

    const {scans, ruleMetas, activeRegexRules} = await scanAll(samples);
    const metrics = computeMetrics(scans, ruleMetas, args.minSupport, holdoutRatio);
    const report = buildReport(corpusRoot, metrics, activeRegexRules, args.minSupport, warnings);

    const outDir = resolve(args.out);
    mkdirSync(outDir, {recursive: true});
    // 唯一产物：report.json（数据契约）。表现层交给 web/ 的报告页（拖入 json 渲染）。
    writeFileSync(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf-8");

    printSummary(report, outDir);
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
    }
    if (report.holdout) {
        const {trainGroups, testGroups, trainAuc, testAuc} = report.holdout;
        const fmt = (auc: number | null): string => (auc === null ? "—" : auc.toFixed(3));
        console.log(`Holdout：train ${trainGroups} 组 AUC ${fmt(trainAuc)} / test ${testGroups} 组 AUC ${fmt(testAuc)}`);
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
    .option("--holdout <ratio>", "留出集比例（0=关闭；题组<4 自动关）", "0")
    .action((opts: {corpus: string; out: string; minSupport: string; holdout: string}) =>
        main({corpus: opts.corpus, out: opts.out, minSupport: Number.parseInt(opts.minSupport, 10), holdout: Number.parseFloat(opts.holdout)}));

await program.parseAsync(process.argv);
