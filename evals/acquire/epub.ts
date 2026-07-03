// epub → 章节文本。用项目现成的 fflate 解 zip，OPF/spine/xhtml 解析模式参照
// assets/.../skills/novel-import-tomato-reference/scripts/tomato-novel.ts，但最小化：只要纯文本。
import {readFileSync} from "node:fs";
import {unzipSync} from "fflate";
import type {Chapter} from "./txt";

const UTF8 = new TextDecoder("utf-8");

export type EpubBook = {title?: string; author?: string; chapters: Chapter[]};

/**
 * 读取 epub，按 spine 顺序产出章节纯文本（排除目录/导航页、空白页）。
 */
export function readEpubChapters(filePath: string): EpubBook {
    const buffer = readFileSync(filePath);
    const files = unzipSync(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
    const read = (zipPath: string): string | undefined => {
        const bytes = files[zipPath];
        return bytes ? UTF8.decode(bytes) : undefined;
    };

    const container = read("META-INF/container.xml") ?? fail("epub 缺 META-INF/container.xml");
    const opfPath = firstMatch(container, /full-path="([^"]+)"/u) ?? fail("epub 缺 OPF 路径");
    const opf = read(opfPath) ?? fail(`epub 缺 OPF 文件：${opfPath}`);
    const opfDir = posixDir(opfPath);
    const manifest = parseManifest(opf);
    const spine = parseSpine(opf);
    const title = firstMatch(opf, /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/iu)?.trim();
    const author = firstMatch(opf, /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/iu)?.trim();

    const chapters: Chapter[] = [];
    for (const idref of selectChapterItems(spine, manifest)) {
        const href = manifest.get(idref);
        if (!href) {
            continue;
        }
        const xhtml = read(joinPosix(opfDir, href));
        if (!xhtml) {
            continue;
        }
        const text = xhtmlToText(xhtml);
        if (text.length === 0) {
            continue;
        }
        chapters.push({index: chapters.length + 1, title: extractTitle(xhtml) || `第 ${chapters.length + 1} 章`, text});
    }
    return {title: title ? decodeEntities(title) : undefined, author: author ? decodeEntities(author) : undefined, chapters};
}

/** 优先番茄式 chapter_NNNNN.xhtml；否则取 spine 中的 xhtml 文档并排除 toc/nav/封面。 */
function selectChapterItems(spine: string[], manifest: Map<string, string>): string[] {
    const xhtmlSpine = spine.filter((id) => /\.(xhtml|html?)$/iu.test(manifest.get(id) ?? ""));
    const tomatoStyle = xhtmlSpine.filter((id) => /(^|\/)chapter_\d+\.(xhtml|html?)$/iu.test(manifest.get(id) ?? ""));
    if (tomatoStyle.length > 0) {
        return tomatoStyle;
    }
    return xhtmlSpine.filter((id) => !/(^|\/)(toc|nav|cover|title|table-of-contents|aux)[^/]*\.(xhtml|html?)$/iu.test(manifest.get(id) ?? ""));
}

/** xhtml → 纯文本：块级标签转换行，去标签，解码实体，归一空行。 */
function xhtmlToText(html: string): string {
    const stripped = html
        .replace(/<head[\s\S]*?<\/head>/giu, "")
        .replace(/<(script|style)[\s\S]*?<\/\1>/giu, "")
        .replace(/<\/(p|div|section|article|h[1-6]|li|tr|blockquote)>/giu, "\n")
        .replace(/<br\s*\/?>/giu, "\n")
        .replace(/<[^>]+>/gu, "");
    return decodeEntities(stripped)
        .split(/\n/u)
        .map((line) => line.trim())
        .join("\n")
        .replace(/\n{3,}/gu, "\n\n")
        .trim();
}

function parseManifest(opfXml: string): Map<string, string> {
    const manifest = new Map<string, string>();
    for (const match of opfXml.matchAll(/<item\b([^>]*)\/?>/giu)) {
        const attrs = match[1] ?? "";
        const id = firstMatch(attrs, /\bid=["']([^"']+)["']/iu);
        const href = firstMatch(attrs, /\bhref=["']([^"']+)["']/iu);
        if (id && href) {
            manifest.set(id, decodeEntities(href));
        }
    }
    return manifest;
}

function parseSpine(opfXml: string): string[] {
    const spine = opfXml.match(/<spine\b[\s\S]*?<\/spine>/iu);
    if (!spine) {
        return [];
    }
    return Array.from(spine[0].matchAll(/<itemref\b[^>]*idref=["']([^"']+)["']/giu), (match) => match[1] ?? "");
}

function extractTitle(html: string): string {
    return decodeEntities((firstMatch(html, /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/iu)
        || firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/iu)
        || "").replace(/<[^>]+>/gu, "").trim());
}

function decodeEntities(input: string): string {
    const named: Record<string, string> = {amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " "};
    return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/giu, (match, entity: string) => {
        if (entity.startsWith("#x")) {
            return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
        }
        if (entity.startsWith("#")) {
            return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
        }
        return named[entity.toLowerCase()] ?? match;
    });
}

function firstMatch(input: string, pattern: RegExp): string | undefined {
    return input.match(pattern)?.[1];
}

function posixDir(path: string): string {
    const index = path.lastIndexOf("/");
    return index === -1 ? "" : path.slice(0, index);
}

function joinPosix(dir: string, href: string): string {
    const raw = dir ? `${dir}/${href.split("#")[0]}` : (href.split("#")[0] ?? href);
    const parts: string[] = [];
    for (const segment of raw.split("/")) {
        if (segment === "" || segment === ".") {
            continue;
        }
        if (segment === "..") {
            parts.pop();
            continue;
        }
        parts.push(segment);
    }
    return parts.join("/");
}

function fail(message: string): never {
    throw new Error(message);
}
