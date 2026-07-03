// 文本编码探测 + 章节切分。网文 txt 多为 GBK/GB18030（如《诡秘之主》精校全本）。
// 本模块只做"整本 txt → 章节文本"，清洗与分段在 clean.ts。
import {readFileSync} from "node:fs";

export type Chapter = {index: number; title: string; text: string};

/**
 * 探测编码并解码整本文本文件。
 * 策略：有 UTF-8 BOM 直接 UTF-8；否则先严格 UTF-8（fatal），抛错回退 gb18030
 *（gb18030 是 GBK 超集且对任意字节都不抛错，必须放最后兜底）。
 */
export function decodeTextFile(filePath: string): string {
    const buffer = readFileSync(filePath);
    const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        return new TextDecoder("utf-8").decode(bytes.subarray(3));
    }
    try {
        return new TextDecoder("utf-8", {fatal: true}).decode(bytes);
    } catch {
        return new TextDecoder("gb18030").decode(bytes);
    }
}

// 章节标题行：行首（可含空白/全角空格）+ 第X章/回/节 + 短标题。
// 用长度上限挡掉正文里偶发的"第三章讲的是…"误判（真标题都很短）。
const CHAPTER_HEADING = /^[ \t　]*第[0-9〇零一二三四五六七八九十百千两]+[章回节][^\n]*$/u;
// 卷标题行（第X卷）只作分隔，不当章节，丢弃。
const VOLUME_HEADING = /^[ \t　]*第[0-9〇零一二三四五六七八九十百千两]+卷[^\n]*$/u;
const MAX_HEADING_LENGTH = 40;

/**
 * 按"第X章/回/节"标题切分章节。第一个标题之前的内容（书名/内容简介/前言）丢弃。
 */
export function splitTxtChapters(content: string): Chapter[] {
    const lines = content.replace(/\r\n?/g, "\n").split("\n");
    const chapters: Chapter[] = [];
    let current: {title: string; body: string[]} | null = null;

    for (const line of lines) {
        if (isChapterHeading(line)) {
            if (current) {
                chapters.push(finishChapter(current, chapters.length));
            }
            current = {title: line.trim(), body: []};
            continue;
        }
        if (VOLUME_HEADING.test(line)) {
            continue; // 卷分隔行丢弃
        }
        if (current) {
            current.body.push(line);
        }
    }
    if (current) {
        chapters.push(finishChapter(current, chapters.length));
    }
    return chapters;
}

function isChapterHeading(line: string): boolean {
    return line.trim().length <= MAX_HEADING_LENGTH && CHAPTER_HEADING.test(line);
}

function finishChapter(current: {title: string; body: string[]}, doneCount: number): Chapter {
    return {index: doneCount + 1, title: current.title, text: current.body.join("\n").trim()};
}
