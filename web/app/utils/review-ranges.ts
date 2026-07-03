import type {Fixability, Issue, RuleLevel} from "../types";
import {applySingleIssueReplacement} from "llmlint/fix";

export type ReviewEditorMode = "source" | "preview";

export type ReviewIssueMark = {
    id: string;
    ruleId: string;
    level: RuleLevel;
    from: number;
    to: number;
    title: string;
    match: string;
    replacement: string | null;
    fixability: Fixability;
};

export type ReviewComment = {
    id: string;
    from: number;
    to: number;
    quote: string;
    body: string;
    source: "user" | "rule";
    resolved?: boolean;
};

export type ReviewTextDiff = {
    id: string;
    from: number;
    to: number;
    deleted: string;
    inserted: string;
    source: "static" | "llm";
    title: string;
};

export type ReviewTextSelection = {
    start: number;
    end: number;
    text: string;
    source: ReviewEditorMode;
    mappable: boolean;
    disabledReason?: string;
    anchor?: {
        left: number;
        top: number;
        height: number;
        containerWidth: number;
        containerHeight: number;
        absoluteTop: number;
    };
};

/** 每行在文本中的 UTF-16 起始偏移（含首行 0）。 */
export function utf16LineStarts(text: string): number[] {
    const starts = [0];
    for (let index = 0; index < text.length; index++) {
        if (text[index] === "\n") {
            starts.push(index + 1);
        }
    }
    return starts;
}

/**
 * 把 scanner 的 1-based code point column 反算回 UTF-16 offset。
 */
export function columnToOffset(text: string, lineStarts: number[], line: number, column: number): number {
    let index = lineStarts[line - 1] ?? 0;
    for (let step = 1; step < column; step++) {
        const codePoint = text.codePointAt(index);
        index += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    }
    return index;
}

export function issueStartOffset(text: string, issue: Issue): number {
    return columnToOffset(text, utf16LineStarts(text), issue.line, issue.column);
}

export function issueId(issue: Issue): string {
    return [
        issue.rule.id,
        issue.line,
        issue.column,
        issue.endLine,
        issue.endColumn,
        encodeURIComponent(issue.match),
    ].join(":");
}

export function buildReviewIssueMarks(text: string, issues: Issue[]): ReviewIssueMark[] {
    const lineStarts = utf16LineStarts(text);
    return issues.map((issue) => {
        const from = columnToOffset(text, lineStarts, issue.line, issue.column);
        const replacement = applySingleIssueReplacement(text, issue, from, {
            allowedFixabilities: ["auto", "candidate"],
        });
        return {
            id: issueId(issue),
            ruleId: issue.rule.id,
            level: issue.rule.level,
            from,
            to: from + issue.match.length,
            title: issue.rule.title,
            match: issue.match,
            replacement: replacement?.replacement ?? null,
            fixability: issue.rule.fixability,
        };
    });
}

export function issueAtOffset(text: string, issues: Issue[], offset: number): Issue | null {
    const lineStarts = utf16LineStarts(text);
    for (const issue of issues) {
        const from = columnToOffset(text, lineStarts, issue.line, issue.column);
        if (offset >= from && offset < from + issue.match.length) {
            return issue;
        }
    }
    return null;
}

export function applyIssueReplacement(text: string, mark: ReviewIssueMark): string {
    if (mark.replacement === null) {
        return text;
    }
    return `${text.slice(0, mark.from)}${mark.replacement}${text.slice(mark.to)}`;
}

export function transformReviewCommentsForTextChange(previousText: string, nextText: string, comments: ReviewComment[]): ReviewComment[] {
    if (previousText === nextText || comments.length === 0) {
        return comments;
    }

    const diff = locateTextDiff(previousText, nextText);
    const delta = diff.nextEnd - diff.nextStart - (diff.previousEnd - diff.previousStart);
    return comments
        .filter((comment) => comment.to <= diff.previousStart || comment.from >= diff.previousEnd)
        .map((comment) => {
            if (comment.from < diff.previousEnd) {
                return comment;
            }
            return {
                ...comment,
                from: comment.from + delta,
                to: comment.to + delta,
            };
        });
}

export function transformReviewDiffsForTextChange(previousText: string, nextText: string, diffs: ReviewTextDiff[]): ReviewTextDiff[] {
    if (previousText === nextText || diffs.length === 0) {
        return diffs;
    }

    const textDiff = locateTextDiff(previousText, nextText);
    const delta = textDiff.nextEnd - textDiff.nextStart - (textDiff.previousEnd - textDiff.previousStart);
    return diffs
        .filter((diff) => !doesDiffOverlapTextChange(diff, textDiff.previousStart, textDiff.previousEnd))
        .map((diff) => {
            if (diff.from < textDiff.previousEnd) {
                return diff;
            }
            return {
                ...diff,
                from: diff.from + delta,
                to: diff.to + delta,
            };
        })
        .filter((diff) => diff.inserted.length === 0 || nextText.slice(diff.from, diff.to) === diff.inserted);
}

export function buildLineDiffRangesForTextReplacement(previousText: string, nextText: string): Array<Pick<ReviewTextDiff, "from" | "to" | "deleted" | "inserted">> {
    if (previousText === nextText) {
        return [];
    }
    const previousLines = splitLines(previousText);
    const nextLines = splitLines(nextText);
    if (previousLines.length === 0 || nextLines.length === 0 || previousLines.length * nextLines.length > 120_000) {
        return [buildContiguousLineDiffRange(previousText, nextText)];
    }

    const pairs = longestCommonLinePairs(previousLines, nextLines);
    const nextOffsets = lineOffsets(nextLines);
    const ranges: Array<Pick<ReviewTextDiff, "from" | "to" | "deleted" | "inserted">> = [];
    let previousStart = 0;
    let nextStart = 0;
    for (const [previousMatch, nextMatch] of [...pairs, [previousLines.length, nextLines.length] as const]) {
        if (previousStart < previousMatch || nextStart < nextMatch) {
            const deleted = previousLines.slice(previousStart, previousMatch).join("");
            const inserted = nextLines.slice(nextStart, nextMatch).join("");
            const from = nextOffsets[nextStart] ?? nextText.length;
            ranges.push(trimSharedTrailingNewline({from, to: from + inserted.length, deleted, inserted}));
        }
        previousStart = previousMatch + 1;
        nextStart = nextMatch + 1;
    }
    return ranges.filter((range) => range.deleted || range.inserted);
}

function doesDiffOverlapTextChange(diff: ReviewTextDiff, changeStart: number, changeEnd: number): boolean {
    if (changeStart === changeEnd) {
        return diff.from < changeEnd && diff.to > changeStart;
    }
    if (diff.from === diff.to) {
        return diff.from >= changeStart && diff.from <= changeEnd;
    }
    return diff.from < changeEnd && diff.to > changeStart;
}

function splitLines(text: string): string[] {
    return text.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

function lineOffsets(lines: string[]): number[] {
    const offsets: number[] = [];
    let offset = 0;
    for (const line of lines) {
        offsets.push(offset);
        offset += line.length;
    }
    offsets.push(offset);
    return offsets;
}

function longestCommonLinePairs(previousLines: string[], nextLines: string[]): Array<readonly [number, number]> {
    const previousComparable = previousLines.map(normalizeLineForCompare);
    const nextComparable = nextLines.map(normalizeLineForCompare);
    const width = nextLines.length + 1;
    const table = new Uint32Array((previousLines.length + 1) * width);
    const valueAt = (previousIndex: number, nextIndex: number): number => table[previousIndex * width + nextIndex] ?? 0;
    for (let previousIndex = previousLines.length - 1; previousIndex >= 0; previousIndex -= 1) {
        for (let nextIndex = nextLines.length - 1; nextIndex >= 0; nextIndex -= 1) {
            const index = previousIndex * width + nextIndex;
            table[index] = previousComparable[previousIndex] === nextComparable[nextIndex]
                ? valueAt(previousIndex + 1, nextIndex + 1) + 1
                : Math.max(valueAt(previousIndex + 1, nextIndex), valueAt(previousIndex, nextIndex + 1));
        }
    }

    const pairs: Array<readonly [number, number]> = [];
    let previousIndex = 0;
    let nextIndex = 0;
    while (previousIndex < previousLines.length && nextIndex < nextLines.length) {
        if (previousComparable[previousIndex] === nextComparable[nextIndex]) {
            pairs.push([previousIndex, nextIndex]);
            previousIndex += 1;
            nextIndex += 1;
        } else if (valueAt(previousIndex + 1, nextIndex) >= valueAt(previousIndex, nextIndex + 1)) {
            previousIndex += 1;
        } else {
            nextIndex += 1;
        }
    }
    return pairs;
}

function normalizeLineForCompare(line: string): string {
    return line.replace(/\r\n/g, "\n");
}

function buildContiguousLineDiffRange(previousText: string, nextText: string): Pick<ReviewTextDiff, "from" | "to" | "deleted" | "inserted"> {
    const textDiff = locateTextDiff(previousText, nextText);
    const previousStart = lineStartBefore(previousText, textDiff.previousStart);
    const previousEnd = lineEndAfter(previousText, textDiff.previousEnd);
    const nextStart = lineStartBefore(nextText, textDiff.nextStart);
    const nextEnd = lineEndAfter(nextText, textDiff.nextEnd);
    return trimSharedTrailingNewline({
        from: nextStart,
        to: nextEnd,
        deleted: previousText.slice(previousStart, previousEnd),
        inserted: nextText.slice(nextStart, nextEnd),
    });
}

function trimSharedTrailingNewline(range: Pick<ReviewTextDiff, "from" | "to" | "deleted" | "inserted">): Pick<ReviewTextDiff, "from" | "to" | "deleted" | "inserted"> {
    if (!range.deleted.endsWith("\n") || !range.inserted.endsWith("\n")) {
        return range;
    }
    const inserted = stripOneTrailingLineBreak(range.inserted);
    return {
        ...range,
        to: Math.max(range.from, range.to - (range.inserted.length - inserted.length)),
        deleted: stripOneTrailingLineBreak(range.deleted),
        inserted,
    };
}

function stripOneTrailingLineBreak(value: string): string {
    if (value.endsWith("\r\n")) {
        return value.slice(0, -2);
    }
    if (value.endsWith("\n")) {
        return value.slice(0, -1);
    }
    return value;
}

function lineStartBefore(text: string, offset: number): number {
    const previousBreak = text.lastIndexOf("\n", Math.max(0, offset - 1));
    return previousBreak < 0 ? 0 : previousBreak + 1;
}

function lineEndAfter(text: string, offset: number): number {
    const nextBreak = text.indexOf("\n", offset);
    return nextBreak < 0 ? text.length : nextBreak + 1;
}

function locateTextDiff(previousText: string, nextText: string): {
    previousStart: number;
    previousEnd: number;
    nextStart: number;
    nextEnd: number;
} {
    let start = 0;
    while (
        start < previousText.length
        && start < nextText.length
        && previousText[start] === nextText[start]
    ) {
        start++;
    }

    let previousEnd = previousText.length;
    let nextEnd = nextText.length;
    while (
        previousEnd > start
        && nextEnd > start
        && previousText[previousEnd - 1] === nextText[nextEnd - 1]
    ) {
        previousEnd--;
        nextEnd--;
    }

    return {
        previousStart: start,
        previousEnd,
        nextStart: start,
        nextEnd,
    };
}
