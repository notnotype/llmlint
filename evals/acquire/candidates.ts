#!/usr/bin/env bun
// 候选清单工具：解析一本书 → 清洗 → 列出可用章节（标题/字数/切段数/开头预览），供人工选章。
// 用法：bun candidates.ts <book.epub|book.txt> [--limit N] [--skip N] [--min-chars N]
// 这是 curation 质量闸门的辅助：agent 用它产出候选清单，用户确认后再用 acquire.ts 正式入语料。
import {existsSync} from "node:fs";
import {extname, resolve} from "node:path";
import {readEpubChapters} from "./epub";
import {decodeTextFile, splitTxtChapters, type Chapter} from "./txt";
import {cleanProse, isUsableChapter, segmentChapter, visibleLength} from "./clean";

function main(): void {
    const argv = process.argv.slice(2);
    const positional: string[] = [];
    const opts: Record<string, string> = {};
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i] ?? "";
        if (token.startsWith("--")) {
            opts[token.slice(2)] = argv[++i] ?? "";
        } else {
            positional.push(token);
        }
    }
    const file = positional[0];
    if (!file || !existsSync(resolve(file))) {
        console.error("用法：candidates.ts <book.epub|book.txt> [--limit N] [--skip N] [--min-chars N]");
        process.exit(1);
    }
    const limit = opts.limit ? Number.parseInt(opts.limit, 10) : 10;
    const skip = opts.skip ? Number.parseInt(opts.skip, 10) : 0;
    const minChars = opts["min-chars"] ? Number.parseInt(opts["min-chars"], 10) : 500;

    const ext = extname(file).toLowerCase();
    const book = ext === ".epub"
        ? readEpubChapters(resolve(file))
        : {title: undefined, author: undefined, chapters: splitTxtChapters(decodeTextFile(resolve(file)))};
    const usable = book.chapters.filter((chapter: Chapter) => isUsableChapter(chapter, minChars));
    console.log(`书名：${book.title ?? "?"}　作者：${book.author ?? "?"}　解析 ${book.chapters.length} 章，可用 ${usable.length} 章（≥${minChars} 字）`);
    console.log("usable# | 章题 | 可见字数 | 切段数 | 开头预览");
    for (const [index, chapter] of usable.slice(skip, skip + limit).entries()) {
        const cleaned = cleanProse(chapter.text);
        const units = segmentChapter(cleaned);
        const preview = cleaned.replace(/\s+/gu, "").slice(0, 48);
        console.log(`${String(skip + index).padStart(3)} | ${(chapter.title ?? "?").slice(0, 20)} | ${visibleLength(cleaned)} | ${units.length} | ${preview}…`);
    }
}

main();
