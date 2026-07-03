#!/usr/bin/env bun
// 数据获取 CLI：整本 epub/txt 人类小说 → 切章 → 清洗 → 分段 → reference 单元写进语料。
// 用法：
//   bun acquire.ts <book.epub|book.txt> --genre <g> --plot <id> [--out <corpusRoot>]
//        [--max-chapters N] [--skip N] [--min-chars N] [--pub-year YYYY]
// 默认 out = evals/corpus（脚本同级 ../corpus，作为独立仓评测资产维护）。
// 产出：<out>/<genre>/<plot>/reference-NNNN.md + meta.json（role:reference）。
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {basename, extname, join, resolve} from "node:path";
import {readEpubChapters} from "./epub";
import {decodeTextFile, splitTxtChapters, type Chapter} from "./txt";
import {cleanProse, isUsableChapter, segmentChapter, visibleLength} from "./clean";

// 默认语料根 = 脚本同级目录的 ../corpus（evals/corpus），cwd 无关。
const DEFAULT_CORPUS = join(import.meta.dir, "..", "corpus");

type Args = {file: string; genre: string; plot: string; out: string; maxChapters: number; skip: number; minChars: number; pubYear?: number; author?: string};

type SampleMeta = {
    file: string;
    role: "reference" | "render" | "repair";
    referenceSource?: "book-segment" | "hand-picked";
    charCount: number;
    title?: string;
    sourceFile?: string;
    pubYear?: number;
    [key: string]: unknown;
};

type GroupMeta = {genre: string; plotId: string; author?: string; samples: SampleMeta[]};

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    const sourcePath = resolve(args.file);
    if (!existsSync(sourcePath)) {
        fail(`文件不存在：${sourcePath}`);
    }

    const book = readBook(sourcePath);
    const usable = book.chapters.filter((chapter) => isUsableChapter(chapter, args.minChars));
    const selected = usable.slice(args.skip, args.skip + args.maxChapters);
    if (selected.length === 0) {
        fail(`没有可用章节（解析到 ${book.chapters.length} 章，可用 ${usable.length} 章）。检查切分/编码。`);
    }

    const groupDir = join(resolve(args.out), args.genre, args.plot);
    mkdirSync(groupDir, {recursive: true});
    clearReferenceFiles(groupDir);

    const samples: SampleMeta[] = [];
    let unitIndex = 0;
    for (const chapter of selected) {
        const cleaned = cleanProse(chapter.text);
        for (const unit of segmentChapter(cleaned)) {
            if (visibleLength(unit) < args.minChars) {
                continue;
            }
            unitIndex += 1;
            const fileName = `reference-${String(unitIndex).padStart(4, "0")}.md`;
            writeFileSync(join(groupDir, fileName), `${unit}\n`, "utf-8");
            samples.push({
                file: fileName,
                role: "reference",
                referenceSource: "book-segment",
                charCount: visibleLength(unit),
                title: chapter.title,
                sourceFile: basename(sourcePath),
                ...(args.pubYear ? {pubYear: args.pubYear} : {}),
            });
        }
    }

    writeMeta(groupDir, {genre: args.genre, plotId: args.plot, author: args.author || book.author, samples});
    console.log(`✓ ${args.genre}/${args.plot}: ${samples.length} 个 reference 单元（来自 ${selected.length} 章）→ ${groupDir}`);
    console.log(`  字数区间：${Math.min(...samples.map((s) => s.charCount))}–${Math.max(...samples.map((s) => s.charCount))}；书名：${book.title ?? "?"}；作者：${book.author ?? "?"}`);
}

/** 按后缀分流 epub/txt → 统一的章节列表。 */
function readBook(sourcePath: string): {title?: string; author?: string; chapters: Chapter[]} {
    const ext = extname(sourcePath).toLowerCase();
    if (ext === ".epub") {
        return readEpubChapters(sourcePath);
    }
    if (ext === ".txt") {
        return {chapters: splitTxtChapters(decodeTextFile(sourcePath))};
    }
    fail(`不支持的格式：${ext}（仅 .epub / .txt）`);
}

/** 重写 meta.json：保留已有的 render/repair 样本（M2+ 由 render 工具写入），只替换 reference。 */
function writeMeta(groupDir: string, next: GroupMeta): void {
    const metaPath = join(groupDir, "meta.json");
    let preserved: SampleMeta[] = [];
    if (existsSync(metaPath)) {
        try {
            const existing = JSON.parse(readFileSync(metaPath, "utf-8")) as GroupMeta;
            preserved = (existing.samples ?? []).filter((sample) => sample.role !== "reference");
        } catch {
            preserved = [];
        }
    }
    const merged: GroupMeta = {...next, samples: [...next.samples, ...preserved]};
    writeFileSync(metaPath, `${JSON.stringify(merged, null, 2)}\n`, "utf-8");
}

function clearReferenceFiles(groupDir: string): void {
    for (const name of readdirSync(groupDir)) {
        if (/^reference-\d+\.md$/u.test(name)) {
            rmSync(join(groupDir, name));
        }
    }
}

function parseArgs(argv: string[]): Args {
    const positional: string[] = [];
    const opts: Record<string, string> = {};
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i] ?? "";
        if (token.startsWith("--")) {
            opts[token.slice(2)] = argv[i + 1] ?? "";
            i += 1;
        } else {
            positional.push(token);
        }
    }
    const file = positional[0];
    if (!file || !opts.genre || !opts.plot) {
        fail("用法：acquire.ts <book.epub|book.txt> --genre <g> --plot <id> [--out <corpusRoot>] [--max-chapters N] [--skip N] [--min-chars N] [--pub-year YYYY]");
    }
    return {
        file,
        genre: opts.genre,
        plot: opts.plot,
        out: opts.out || DEFAULT_CORPUS,
        maxChapters: opts["max-chapters"] ? Number.parseInt(opts["max-chapters"], 10) : 20,
        skip: opts.skip ? Number.parseInt(opts.skip, 10) : 0,
        minChars: opts["min-chars"] ? Number.parseInt(opts["min-chars"], 10) : 500,
        pubYear: opts["pub-year"] ? Number.parseInt(opts["pub-year"], 10) : undefined,
        author: opts.author || undefined,
    };
}

function fail(message: string): never {
    console.error(`错误：${message}`);
    process.exit(1);
}

main();
