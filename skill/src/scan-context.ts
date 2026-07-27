import {isMasked, mergeRanges, splitLines} from "./markdown-mask";
import type {MaskedRange, ScanContext, ScanLine} from "./types";

// 扫描上下文构建：引号分域、三层等长视图、结构行标记、词级白名单区间。
// 与 markdown-mask 同为纯函数层——不读文件系统，浏览器端可打包消费。
// 设计真相源：docs/tasks/23-skill-loop-and-service/rule-model-v3-design.md（v3.1）。

/**
 * 成对引号表：行内配对（不跨换行），未闭合不遮罩。
 * ASCII 直引号 " ' 因无方向性易误配，v1 不入表（后续按语料反馈再议）。
 */
const QUOTE_PAIRS: Record<string, string> = {
    "「": "」",
    "『": "』",
    "【": "】",
    "“": "”",
    "‘": "’",
};
const QUOTE_CLOSERS = new Set(Object.values(QUOTE_PAIRS));

/**
 * markdown 结构行判定：标题 / 引用 / 无序与有序列表 / 表格行 / 分隔线。
 * 围栏代码块行已被 maskedRanges 覆盖，不在此重复判定。
 */
const STRUCTURAL_LINE_PATTERN = /^\s{0,3}(?:#{1,6}\s|>|[-*+]\s|\d{1,3}[.)]\s|\|)/;
const HORIZONTAL_RULE_PATTERN = /^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
/** 章节标题行（`第N章 …`），density/handler 统计跳过，逐处 regex 规则不受影响。 */
const CHAPTER_HEADING_PATTERN = /^\s*第[0-9一二三四五六七八九十百千万零两]+[章节卷回幕]/;

export type PrepareScanOptions = {
    /** markdown 结构遮罩区间；缺省 = 不遮罩。 */
    maskedRanges?: MaskedRange[];
    /** 项目级豁免词（世界观术语、绰号、章名）；命中区间与其出现区间重叠即丢弃。 */
    ignoreTerms?: string[];
};

/**
 * 构建扫描上下文：一次算好遮罩、引号分域、三层视图与行切分，供三种 detector 共享。
 * 视图与原文严格等长（按 UTF-16 code unit），`match.index` 可直接回原文取 excerpt。
 */
export function prepareScanContext(content: string, options: PrepareScanOptions = {}): ScanContext {
    const maskedRanges = options.maskedRanges ?? [];
    const lines = splitScanLines(content);
    const dialogueRanges = computeDialogueRanges(lines, maskedRanges);
    return {
        content,
        layers: {
            all: content,
            narrative: buildPlaceholderView(content, dialogueRanges, "inside"),
            dialogue: buildPlaceholderView(content, dialogueRanges, "outside"),
        },
        maskedRanges,
        ignoreRanges: computeIgnoreTermRanges(content, options.ignoreTerms ?? []),
        dialogueRanges,
        lines,
    };
}

/** 行切分并打结构标记。 */
export function splitScanLines(content: string): ScanLine[] {
    return splitLines(content).map((line) => ({
        ...line,
        structural: isStructuralLine(line.text),
    }));
}

function isStructuralLine(text: string): boolean {
    return STRUCTURAL_LINE_PATTERN.test(text)
        || HORIZONTAL_RULE_PATTERN.test(text)
        || CHAPTER_HEADING_PATTERN.test(text);
}

/**
 * 成对引号区间计算：逐行栈式配对（含嵌套），未闭合的引号在行尾丢弃（不遮罩，防止
 * 一个漏引号把后半篇全吞进对白层）。落在 maskedRanges 内的引号字符不参与配对——
 * 代码块 / frontmatter 里的 `「` 不能制造假对白区。
 */
export function computeDialogueRanges(lines: ScanLine[], maskedRanges: MaskedRange[]): MaskedRange[] {
    const ranges: MaskedRange[] = [];
    for (const line of lines) {
        // 栈内是尚未闭合的开引号；close 只与栈顶同类配对，错配的闭引号当普通字符忽略。
        const stack: Array<{closer: string; index: number}> = [];
        for (let offset = 0; offset < line.text.length; offset++) {
            const char = line.text[offset]!;
            const absolute = line.start + offset;
            if (!(char in QUOTE_PAIRS) && !QUOTE_CLOSERS.has(char)) {
                continue;
            }
            if (maskedRanges.length > 0 && isMasked(absolute, maskedRanges)) {
                continue;
            }
            const closer = QUOTE_PAIRS[char];
            if (closer !== undefined) {
                stack.push({closer, index: absolute});
                continue;
            }
            const top = stack.at(-1);
            if (top && top.closer === char) {
                stack.pop();
                ranges.push([top.index, absolute + 1]);
            }
        }
    }
    return mergeRanges(ranges);
}

/**
 * 等长占位视图：把 ranges 内（mask="inside"）或外（mask="outside"）的字符替换为等长 `。`，
 * 换行符（\n / \r）始终保留，维持行结构与偏移一致。选 `。` 是为了让 `[^。，]` 类字符类
 * 天然截断，规则不会跨引号拼出假命中——这是特性不是缺陷。
 */
function buildPlaceholderView(content: string, ranges: MaskedRange[], mask: "inside" | "outside"): string {
    if (ranges.length === 0) {
        return mask === "inside" ? content : toPlaceholder(content);
    }
    let result = "";
    let cursor = 0;
    for (const [start, end] of ranges) {
        const outside = content.slice(cursor, start);
        const inside = content.slice(start, end);
        result += mask === "inside" ? outside : toPlaceholder(outside);
        result += mask === "inside" ? toPlaceholder(inside) : inside;
        cursor = end;
    }
    const tail = content.slice(cursor);
    result += mask === "inside" ? tail : toPlaceholder(tail);
    return result;
}

function toPlaceholder(text: string): string {
    return text.replace(/[^\n\r]/g, "。");
}

/**
 * 词级白名单区间：每个豁免词在原文中的所有出现算成区间。命中区间与之「重叠」即丢弃
 * （与 maskedRanges 的「起点落入」判定不同，见 overlapsRanges）。
 */
export function computeIgnoreTermRanges(content: string, terms: string[]): MaskedRange[] {
    const ranges: MaskedRange[] = [];
    for (const term of terms) {
        if (term.length === 0) {
            continue;
        }
        let from = 0;
        let index: number;
        while ((index = content.indexOf(term, from)) !== -1) {
            ranges.push([index, index + term.length]);
            from = index + term.length;
        }
    }
    return mergeRanges(ranges);
}

/** 判断区间 [start, end) 是否与任一区间重叠。ranges 需已排序合并。 */
export function overlapsRanges(start: number, end: number, ranges: MaskedRange[]): boolean {
    for (const [rangeStart, rangeEnd] of ranges) {
        if (rangeEnd <= start) {
            continue;
        }
        return rangeStart < end;
    }
    return false;
}

const VISIBLE_CHAR_PATTERN = /[\p{L}\p{N}]/u;

/** 可见字符数：CJK / 字母 / 数字。标点、空白与占位 `。` 不计。 */
export function visibleLength(text: string): number {
    let count = 0;
    for (const char of text) {
        if (VISIBLE_CHAR_PATTERN.test(char)) {
            count++;
        }
    }
    return count;
}

/**
 * 一份视图里「可计数」的可见字符数：跳过结构行与遮罩区。
 *
 * 这是 density 规则 `perKilo` 的分母，也是 `check` 报告的篇幅基准——两处必须同口径，
 * 否则同一份报告里「每千字命中」和「可见字数」会互相对不上。传 `ctx.layers.all` 得到
 * 全文篇幅；传某一层的视图得到该层篇幅（narrative 层台词是 `。` 占位，不计入）。
 */
export function countableVisibleChars(ctx: ScanContext, view: string): number {
    let total = 0;
    for (const line of ctx.lines) {
        if (line.structural) {
            continue;
        }
        total += visibleCharsInSpan(view, line.start, line.end, ctx.maskedRanges);
    }
    return total;
}

/** 统计 [start, end) 内、不落遮罩区的可见字符数。 */
export function visibleCharsInSpan(view: string, start: number, end: number, maskedRanges: MaskedRange[]): number {
    if (maskedRanges.length === 0) {
        return visibleLength(view.slice(start, end));
    }
    let total = 0;
    let cursor = start;
    for (const [maskStart, maskEnd] of maskedRanges) {
        if (maskEnd <= cursor) {
            continue;
        }
        if (maskStart >= end) {
            break;
        }
        if (maskStart > cursor) {
            total += visibleLength(view.slice(cursor, Math.min(maskStart, end)));
        }
        cursor = Math.max(cursor, Math.min(maskEnd, end));
        if (cursor >= end) {
            return total;
        }
    }
    if (cursor < end) {
        total += visibleLength(view.slice(cursor, end));
    }
    return total;
}

/**
 * 位置窗口：从文首（opening）/ 文末（ending）按 narrative 层可见字符数满 chars，
 * 返回允许的索引区间 [start, end)。台词在 narrative 层是 `。` 占位，不计入可见数
 * （预告腔看的是叙述层结尾）。命中起点落窗口外即跳过。
 */
export function computePositionWindow(ctx: ScanContext, position: {kind: "opening" | "ending"; chars: number}): MaskedRange {
    const view = ctx.layers.narrative;
    if (position.kind === "opening") {
        let count = 0;
        for (let index = 0; index < view.length; index++) {
            if (VISIBLE_CHAR_PATTERN.test(view[index]!)) {
                count++;
                if (count >= position.chars) {
                    return [0, index + 1];
                }
            }
        }
        return [0, view.length];
    }
    let count = 0;
    for (let index = view.length - 1; index >= 0; index--) {
        if (VISIBLE_CHAR_PATTERN.test(view[index]!)) {
            count++;
            if (count >= position.chars) {
                return [index, view.length];
            }
        }
    }
    return [0, view.length];
}
