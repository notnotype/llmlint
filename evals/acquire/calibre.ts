#!/usr/bin/env bun
// mobi 等格式 → epub 批量转换（calibre ebook-convert 包装）。
// 用法：bun calibre.ts <book.mobi> [more.mobi ...] [--out <dir>] [--calibre <ebook-convert 路径>]
// - 幂等：目标 epub 已存在即跳过（贵操作落盘复用）。
// - 默认输出目录：源文件目录的兄弟目录 converted/（books/x.mobi → ../converted/x.epub），
//   保持 books/ 与 manifest.tsv 的清单一一对应，不混入派生文件。
// - spawn 用数组参数，不拼 shell 字符串（中文书名路径在 Windows 上的引号/编码坑）。
import {existsSync, mkdirSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {basename, dirname, extname, join, resolve} from "node:path";

const DEFAULT_CALIBRE = "C:\\Program Files\\Calibre2\\ebook-convert.exe";
// 单本转换墙钟上限：mobi 通常几秒~几十秒，超时视为失败。
const CONVERT_TIMEOUT_MS = 300_000;

export type ConvertResult = {source: string; target: string; skipped: boolean};

/**
 * 把一本电子书转成 epub。目标已存在时跳过（幂等）。
 * @param source 源文件（mobi/azw3 等 calibre 支持的格式）
 * @param outDir 输出目录（不存在则创建）
 * @param calibrePath ebook-convert 可执行文件路径
 */
export function convertToEpub(source: string, outDir: string, calibrePath: string = DEFAULT_CALIBRE): ConvertResult {
    const sourcePath = resolve(source);
    const target = join(resolve(outDir), `${basename(sourcePath, extname(sourcePath))}.epub`);
    if (existsSync(target)) {
        return {source: sourcePath, target, skipped: true};
    }
    if (!existsSync(calibrePath)) {
        throw new Error(`找不到 ebook-convert：${calibrePath}（用 --calibre 指定或安装 calibre）`);
    }
    mkdirSync(resolve(outDir), {recursive: true});
    const run = spawnSync(calibrePath, [sourcePath, target], {timeout: CONVERT_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"]});
    if (run.error) {
        throw new Error(`ebook-convert 启动失败：${run.error.message}`);
    }
    if (run.status !== 0 || !existsSync(target)) {
        const stderr = run.stderr?.toString("utf-8").slice(-500) ?? "";
        throw new Error(`转换失败（exit=${run.status}）：${basename(sourcePath)}\n${stderr}`);
    }
    return {source: sourcePath, target, skipped: false};
}

/** 源文件的默认输出目录：books/ 内 → 兄弟 converted/；否则同目录 converted/。 */
function defaultOutDir(source: string): string {
    const dir = dirname(resolve(source));
    return basename(dir) === "books" ? join(dir, "..", "converted") : join(dir, "converted");
}

function main(): void {
    const argv = process.argv.slice(2);
    const files: string[] = [];
    let out = "";
    let calibre = DEFAULT_CALIBRE;
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i] ?? "";
        if (token === "--out") {
            out = argv[++i] ?? "";
        } else if (token === "--calibre") {
            calibre = argv[++i] ?? DEFAULT_CALIBRE;
        } else {
            files.push(token);
        }
    }
    if (files.length === 0) {
        console.error("用法：calibre.ts <book.mobi> [more ...] [--out <dir>] [--calibre <ebook-convert>]");
        process.exit(1);
    }
    let failed = 0;
    for (const file of files) {
        try {
            const result = convertToEpub(file, out || defaultOutDir(file), calibre);
            console.log(`${result.skipped ? "↷ 已存在，跳过" : "✓ 转换完成"}：${result.target}`);
        } catch (error) {
            failed += 1;
            console.error(`✗ ${file}：${error instanceof Error ? error.message : String(error)}`);
        }
    }
    process.exit(failed > 0 ? 1 : 0);
}

if (import.meta.main) {
    main();
}
