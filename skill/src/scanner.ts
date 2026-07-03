import {isMasked} from "./markdown-mask";
import type {Issue, MaskedRange, RegexRuleRecord} from "./types";

export type ScanOptions = {
    /** Markdown 遮罩区间；命中起点落入其中时跳过（代码块/frontmatter/链接等）。缺省=不遮罩。 */
    maskedRanges?: MaskedRange[];
};

/**
 * 使用 regex detector 扫描全文。命中只表示候选，是否修复仍由 Agent 结合上下文判断。
 * 传入 maskedRanges 时，跳过命中起点落在遮罩区域内的结果，但不改变行列定位。
 */
export function scanText(content: string, rules: RegexRuleRecord[], options: ScanOptions = {}): Issue[] {
    const lineStarts = buildLineStarts(content);
    const maskedRanges = options.maskedRanges ?? [];
    const issues: Issue[] = [];

    for (const rule of rules) {
        for (const target of rule.detector.targets) {
            let regex: RegExp;
            try {
                regex = new RegExp(target, ensureGlobalFlags(rule.detector.flags));
            } catch (error) {
                throw new Error(`规则 ${rule.id} 的正则无效: ${error instanceof Error ? error.message : String(error)}`);
            }

            let match: RegExpExecArray | null;
            while ((match = regex.exec(content)) !== null) {
                const matchIndex = match.index;
                const matchText = match[0];
                // 零长匹配先推进 lastIndex，避免死循环；遮罩判断与下面的 continue 不影响推进。
                if (matchText.length === 0) {
                    regex.lastIndex++;
                }
                if (maskedRanges.length > 0 && isMasked(matchIndex, maskedRanges)) {
                    continue;
                }
                const position = locatePosition(content, lineStarts, matchIndex);
                const endPosition = locateEndPosition(content, lineStarts, matchIndex, matchText.length);
                issues.push({
                    rule,
                    line: position.line,
                    column: position.column,
                    endLine: endPosition.line,
                    endColumn: endPosition.column,
                    match: matchText,
                    target,
                    context: extractContext(content, matchIndex, matchText.length),
                });
            }
        }
    }

    return issues;
}

/** 把规则 detector 的 flags 合并出一定含 g 的标志串，供扫描与机械修复共用。 */
export function ensureGlobalFlags(flags: string | undefined): string {
    const merged = new Set((flags ?? "").split("").filter((flag) => flag.length > 0));
    merged.add("g");
    return [...merged].join("");
}

function buildLineStarts(content: string): number[] {
    const lineStarts = [0];
    for (let index = 0; index < content.length; index++) {
        if (content[index] === "\n") {
            lineStarts.push(index + 1);
        }
    }
    return lineStarts;
}

function locatePosition(content: string, lineStarts: number[], index: number): {line: number; column: number} {
    const lineIndex = locateLineIndex(lineStarts, index);
    const lineStart = lineStarts[lineIndex] ?? 0;
    return {
        line: lineIndex + 1,
        column: Array.from(content.slice(lineStart, index)).length + 1,
    };
}

function locateEndPosition(content: string, lineStarts: number[], matchIndex: number, matchLength: number): {line: number; column: number} {
    if (matchLength === 0) {
        return locatePosition(content, lineStarts, matchIndex);
    }

    const exclusiveEnd = matchIndex + matchLength;
    const lastCodeUnitIndex = exclusiveEnd - 1;
    if (content[lastCodeUnitIndex] === "\n") {
        return locatePosition(content, lineStarts, lastCodeUnitIndex);
    }

    const lineIndex = locateLineIndex(lineStarts, lastCodeUnitIndex);
    const lineStart = lineStarts[lineIndex] ?? 0;
    return {
        line: lineIndex + 1,
        column: Array.from(content.slice(lineStart, exclusiveEnd)).length,
    };
}

function locateLineIndex(lineStarts: number[], index: number): number {
    let low = 0;
    let high = lineStarts.length - 1;

    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const lineStart = lineStarts[middle] ?? 0;
        if (lineStart <= index) {
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    return Math.max(0, high);
}

function extractContext(content: string, matchIndex: number, matchLength: number): Issue["context"] {
    const matchEnd = matchIndex + matchLength;
    const lineStart = content.lastIndexOf("\n", Math.max(0, matchIndex - 1)) + 1;
    const nextLineBreak = content.indexOf("\n", matchEnd);
    let lineEnd = nextLineBreak === -1 ? content.length : nextLineBreak;
    if (lineEnd > lineStart && content[lineEnd - 1] === "\r") {
        lineEnd--;
    }
    const visibleMatchEnd = Math.min(matchEnd, lineEnd);

    return {
        before: renderInline(content.substring(lineStart, matchIndex)),
        current: renderInline(content.substring(matchIndex, visibleMatchEnd)),
        after: renderInline(content.substring(visibleMatchEnd, lineEnd)),
    };
}

function renderInline(text: string): string {
    return text
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}
