#!/usr/bin/env bun
// 文风候选四臂分析：配对比较并输出机器诊断 JSON；人评仍由 web 私有池终审。
import {createHash} from "node:crypto";
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {Command} from "commander";
import {loadCorpus, visibleLength} from "../lib/corpus";
import {scanAll} from "../lib/scan";
import {detectorCacheKey, type DetectorScoresFile} from "../detector/scores";
import type {Sample, SampleScan} from "../lib/types";

type Arm = "control" | "current-default" | "beileng-clean" | "distilled";
type Pair = {genre: string; plotId: string; pairRef: string; model: string; baseline: SampleScan; treatment: SampleScan};
type MetricRow = {label: string; baselineMedian: number | null; treatmentMedian: number | null; treatmentLower: number; decided: number; ties: number; pValue: number | null; deltaMedian: number | null};
type Report = {experiment: string; generatedAt: string; arms: [Arm, Arm]; pairCount: number; pairs: Array<{genre: string; plotId: string; pairRef: string; model: string; baselineFile: string; treatmentFile: string}>; metrics: MetricRow[]; notes: string[]};

type Options = {corpus: string; arms: string; detector?: string; out: string};

function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : sorted[mid] ?? 0;
}
function binomial(n: number, k: number): number {
    let value = 1;
    for (let i = 0; i < k; i += 1) value = (value * (n - i)) / (i + 1);
    return value;
}
function signTestP(wins: number, n: number): number | null {
    if (n === 0) return null;
    const extreme = Math.max(wins, n - wins);
    let tail = 0;
    for (let k = extreme; k <= n; k += 1) tail += binomial(n, k);
    return Math.min(1, (2 * tail) / 2 ** n);
}
function sha256(text: string): string {
    return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}
function parseArms(raw: string): [Arm, Arm] {
    const parts = raw.split(",").map((item) => item.trim()) as Arm[];
    if (parts.length !== 2 || parts[0] === parts[1]) throw new Error(`--arms 需要两个不同臂名：${raw}`);
    const allowed: Arm[] = ["control", "current-default", "beileng-clean", "distilled"];
    if (!parts.every((part) => allowed.includes(part))) throw new Error(`臂名无效：${raw}`);
    return [parts[0]!, parts[1]!];
}
function buildPairs(scans: SampleScan[], arms: [Arm, Arm]): Pair[] {
    const map = new Map<string, {baseline?: SampleScan; treatment?: SampleScan}>();
    for (const scan of scans) {
        const arm = scan.sample.styleKey as Arm;
        if (arm !== arms[0] && arm !== arms[1] || !scan.sample.pairRef) continue;
        const key = `${scan.sample.genre}/${scan.sample.plotId}/${scan.sample.pairRef}/${scan.sample.model ?? ""}`;
        const entry = map.get(key) ?? {};
        if (arm === arms[0]) entry.baseline = scan; else entry.treatment = scan;
        map.set(key, entry);
    }
    return [...map.entries()].flatMap(([key, value]) => {
        if (!value.baseline || !value.treatment) return [];
        const [genre, plotId, pairRef, model] = key.split("/");
        return [{genre: genre!, plotId: plotId!, pairRef: pairRef!, model: model ?? "", baseline: value.baseline, treatment: value.treatment}];
    });
}
function loadDetector(path: string | undefined): (text: string) => number | null {
    if (!path) return () => null;
    const file = JSON.parse(readFileSync(resolve(path), "utf-8")) as DetectorScoresFile;
    return (text) => file.entries[detectorCacheKey(file.detector, file.version, file.chunkChars, text)]?.doc.meanPAi ?? null;
}
function metric(label: string, values: Array<[number | null, number | null]>): MetricRow {
    const usable = values.filter((pair): pair is [number, number] => pair[0] !== null && pair[1] !== null);
    const deltas = usable.map(([left, right]) => right - left);
    const wins = deltas.filter((delta) => delta < 0).length;
    const ties = deltas.filter((delta) => delta === 0).length;
    return {label, baselineMedian: median(usable.map(([left]) => left)), treatmentMedian: median(usable.map(([, right]) => right)), treatmentLower: wins, decided: usable.length - ties, ties, pValue: signTestP(wins, usable.length - ties), deltaMedian: median(deltas)};
}
function rates(scan: SampleScan, detector: (text: string) => number | null): {docScore: number; chars: number; pAi: number | null} {
    const chars = scan.sample.charCount;
    return {docScore: chars === 0 ? 0 : (scan.dedupSpanCount / chars) * 1000, chars, pAi: detector(scan.sample.text)};
}

async function run(opts: Options): Promise<void> {
    const arms = parseArms(opts.arms);
    const loaded = loadCorpus(resolve(opts.corpus));
    const {scans} = await scanAll(loaded.samples.filter((sample) => sample.role === "render"));
    const pairs = buildPairs(scans, arms);
    if (pairs.length === 0) throw new Error(`没有配对：${arms.join(" / ")}`);
    const detector = loadDetector(opts.detector);
    const values = pairs.map((pair) => ({pair, baseline: rates(pair.baseline, detector), treatment: rates(pair.treatment, detector)}));
    const metrics = [
        metric("外部检测器 docPAi（主指标）", values.map(({baseline, treatment}) => [baseline.pAi, treatment.pAi])),
        metric("docScore 去重 span / 千字（诊断）", values.map(({baseline, treatment}) => [baseline.docScore, treatment.docScore])),
        metric("可见字数（篇幅护栏）", values.map(({baseline, treatment}) => [baseline.chars, treatment.chars])),
    ];
    const report: Report = {
        experiment: "style-arm-v1",
        generatedAt: new Date().toISOString(),
        arms,
        pairCount: pairs.length,
        pairs: pairs.map((pair) => ({genre: pair.genre, plotId: pair.plotId, pairRef: pair.pairRef, model: pair.model, baselineFile: pair.baseline.sample.file, treatmentFile: pair.treatment.sample.file})),
        metrics,
        notes: ["机器指标只作诊断；用户私有盲评的 wantReadOn、aiFlavor、剧情保真和评论是终审。", `语料指纹：${sha256(pairs.map((pair) => `${pair.baseline.sample.file}:${pair.baseline.sample.text}:${pair.treatment.sample.file}:${pair.treatment.sample.text}`).join("\n"))}`],
    };
    writeFileSync(resolve(opts.out), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
    console.log(JSON.stringify(report, null, 2));
}

const program = new Command();
program.name("style-compare").description("文风四臂配对机器诊断").option("--corpus <dir>", "实验语料根").option("--arms <baseline,treatment>", "对比臂", "control,distilled").option("--detector <path>", "detector-scores.json").option("--out <path>", "报告 JSON", join(import.meta.dir, "style-arm-report.json")).action((opts: Options) => run(opts));
await program.parseAsync(process.argv);
