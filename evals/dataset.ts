#!/usr/bin/env bun
// 数据集正文导出：corpus → dataset.json（正文 + meta），供 web 数据集查看器本地拖入。
// ⚠ 含版权正文（网文全本切片）→ 只本地用；dataset.json 落在 gitignored 的 evals/report/，勿分发、勿 bake 进 web/public。
// 用法：bun evals/dataset.ts [--corpus <dir>] [--out <dir>]（默认 corpus=evals/corpus、out=evals/report）
import {mkdirSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {loadCorpus} from "./lib/corpus";
import type {Dataset, DatasetSample} from "./lib/types";

const DEFAULT_CORPUS = join(import.meta.dir, "corpus");
const DEFAULT_OUT = join(import.meta.dir, "report");

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    const corpusRoot = resolve(args.corpus);

    const {samples, warnings} = loadCorpus(corpusRoot);
    if (samples.length === 0) {
        fail(`语料为空（无可用样本）：${corpusRoot}`);
    }

    // Sample → DatasetSample：丢掉服务端字段（absPath），只留 web 需要的 meta + 正文。
    const datasetSamples: DatasetSample[] = samples.map((sample) => ({
        genre: sample.genre,
        plotId: sample.plotId,
        file: sample.file,
        role: sample.role,
        model: sample.model,
        pairRef: sample.pairRef,
        promptVersion: sample.promptVersion,
        difficulty: sample.difficulty,
        referenceSource: sample.referenceSource,
        charCount: sample.charCount,
        text: sample.text,
    }));

    const dataset: Dataset = {
        corpusRoot,
        generatedNote: "数据集正文（含版权语料）；仅本地用于 web 数据集查看器，勿分发 / 勿 bake 进 public。",
        samples: datasetSamples,
    };

    const outDir = resolve(args.out);
    mkdirSync(outDir, {recursive: true});
    const outPath = join(outDir, "dataset.json");
    writeFileSync(outPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf-8");

    const refCount = datasetSamples.filter((sample) => sample.role === "reference").length;
    const renderCount = datasetSamples.filter((sample) => sample.role === "render").length;
    console.log(`数据集：${datasetSamples.length} 样本（reference ${refCount}、render ${renderCount}）→ ${outPath}`);
    if (warnings.length > 0) {
        console.log(`（加载警告 ${warnings.length} 条，已跳过对应样本）`);
    }
    console.log("⚠ 含版权正文，仅本地拖入 web /dataset 查看，勿分发 / 勿进 public。");
}

function parseArgs(argv: string[]): {corpus: string; out: string} {
    const opts: Record<string, string> = {};
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i] ?? "";
        if (token.startsWith("--")) {
            opts[token.slice(2)] = argv[i + 1] ?? "";
            i += 1;
        }
    }
    return {corpus: opts.corpus || DEFAULT_CORPUS, out: opts.out || DEFAULT_OUT};
}

function fail(message: string): never {
    console.error(`错误：${message}`);
    process.exit(1);
}

main();
