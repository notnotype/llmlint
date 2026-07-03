export type MarkdownInlineState = {
    bold: boolean;
    italic: boolean;
    strike: boolean;
    code: boolean;
    link: boolean;
};

export type MarkdownBlockState = {
    headingLevel: 1 | 2 | 3 | null;
    blockquote: boolean;
    bulletList: boolean;
    orderedList: boolean;
    codeBlock: boolean;
};

export type MarkdownSelectionState = {
    inline: MarkdownInlineState;
    block: MarkdownBlockState;
};

export type MarkdownLinkRange = {
    fullStart: number;
    fullEnd: number;
    labelStart: number;
    labelEnd: number;
    label: string;
    destination: string;
    rawDestination: string;
    rawTitle: string | null;
    image: boolean;
};

export function markdownSelectionState(source: string, start: number, end: number): MarkdownSelectionState {
    return {
        inline: {
            bold: isSelectionWrapped(source, start, end, "**", "**") || isSelectionWrapped(source, start, end, "__", "__"),
            italic: isSelectionWrapped(source, start, end, "*", "*", ["**"]) || isSelectionWrapped(source, start, end, "_", "_", ["__"]),
            strike: isSelectionWrapped(source, start, end, "~~", "~~"),
            code: isSelectionWrapped(source, start, end, "`", "`") || isSelectionWrapped(source, start, end, "``", "``"),
            link: markdownSelectionLinkHref(source, start, end) !== null,
        },
        block: blockState(source, start, end),
    };
}

export function markdownSelectionLinkHref(source: string, start: number, end: number): string | null {
    return markdownLinkRangeAtSelection(source, start, end)?.destination ?? null;
}

export function markdownSelectionLinkInputHref(source: string, start: number, end: number, selectedText: string): string {
    const existingHref = markdownSelectionLinkHref(source, start, end);
    if (existingHref !== null) {
        return existingHref;
    }
    return markdownInferredLinkHref(selectedText) ?? "https://";
}

export function markdownLinkCandidateText(selectedText: string): string {
    return normalizeLinkCandidate(selectedText.trim());
}

export function markdownInferredLinkHref(selectedText: string): string | null {
    const candidate = markdownLinkCandidateText(selectedText);
    if (!candidate || /\s/.test(candidate)) {
        return null;
    }
    if (/^(?:https?:\/\/|mailto:|tel:)/i.test(candidate)) {
        return candidate;
    }
    if (/^www\.[^\s<>()]+$/i.test(candidate)) {
        return `https://${candidate}`;
    }
    if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(candidate)) {
        return `mailto:${candidate}`;
    }
    return null;
}

function normalizeLinkCandidate(candidate: string): string {
    let normalized = candidate.replace(/[.,;:!?。，、；：！？]+$/g, "");
    normalized = trimUnmatchedClosingBracket(normalized, "(", ")");
    normalized = trimUnmatchedClosingBracket(normalized, "（", "）");
    normalized = trimUnmatchedClosingBracket(normalized, "[", "]");
    normalized = trimUnmatchedClosingBracket(normalized, "【", "】");
    return normalized;
}

function trimUnmatchedClosingBracket(candidate: string, open: string, close: string): string {
    let normalized = candidate;
    while (normalized.endsWith(close) && countChar(normalized, close) > countChar(normalized, open)) {
        normalized = normalized.slice(0, -close.length);
    }
    return normalized;
}

function countChar(value: string, char: string): number {
    let count = 0;
    for (const item of value) {
        if (item === char) {
            count += 1;
        }
    }
    return count;
}

export function markdownLinkRangeAtSelection(source: string, start: number, end: number): MarkdownLinkRange | null {
    const lineStart = source.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const lineEndIndex = source.indexOf("\n", end);
    const lineEnd = lineEndIndex >= 0 ? lineEndIndex : source.length;
    const line = source.slice(lineStart, lineEnd);
    for (const link of parseMarkdownLinks(line, lineStart)) {
        const selectsFullLink = start === link.fullStart && end === link.fullEnd;
        const selectsLabel = start >= link.fullStart
            && end <= link.fullEnd
            && start < link.labelEnd
            && end > link.labelStart;
        if (selectsFullLink || selectsLabel) {
            return link;
        }
    }
    return null;
}

function parseMarkdownLinks(line: string, lineStart: number): MarkdownLinkRange[] {
    const links: MarkdownLinkRange[] = [];
    let index = 0;
    while (index < line.length) {
        const image = line[index] === "!" && line[index + 1] === "[";
        const labelOpen = image ? index + 1 : line[index] === "[" ? index : -1;
        if (labelOpen < 0) {
            index += 1;
            continue;
        }
        const labelClose = findUnescaped(line, "]", labelOpen + 1);
        if (labelClose < 0 || line[labelClose + 1] !== "(") {
            index = labelOpen + 1;
            continue;
        }
        const destination = parseMarkdownLinkDestination(line, labelClose + 2);
        if (!destination) {
            index = labelClose + 1;
            continue;
        }
        links.push({
            fullStart: lineStart + index,
            fullEnd: lineStart + destination.fullEnd,
            labelStart: lineStart + labelOpen + 1,
            labelEnd: lineStart + labelClose,
            label: line.slice(labelOpen + 1, labelClose),
            destination: destination.destination,
            rawDestination: destination.rawDestination,
            rawTitle: destination.rawTitle,
            image,
        });
        index = destination.fullEnd;
    }
    return links;
}

function parseMarkdownLinkDestination(line: string, start: number): {destination: string; rawDestination: string; rawTitle: string | null; fullEnd: number} | null {
    const closeParen = findMarkdownDestinationClose(line, start);
    if (closeParen < 0) {
        return null;
    }
    const raw = line.slice(start, closeParen);
    if (raw.startsWith("<")) {
        const closeAngle = findUnescaped(raw, ">", 1);
        if (closeAngle < 0) {
            return null;
        }
        const rawDestination = raw.slice(0, closeAngle + 1);
        const rawTitle = parseMarkdownLinkTitle(raw.slice(closeAngle + 1).trim());
        if (rawTitle === undefined) {
            return null;
        }
        return {
            destination: raw.slice(1, closeAngle),
            rawDestination,
            rawTitle,
            fullEnd: closeParen + 1,
        };
    }
    const splitIndex = findDestinationTitleSplit(raw);
    if (splitIndex >= 0) {
        const rawDestination = raw.slice(0, splitIndex);
        const rawTitle = parseMarkdownLinkTitle(raw.slice(splitIndex).trim());
        if (rawTitle !== undefined) {
            return {
                destination: rawDestination,
                rawDestination,
                rawTitle,
                fullEnd: closeParen + 1,
            };
        }
    }
    return {
        destination: raw,
        rawDestination: raw,
        rawTitle: null,
        fullEnd: closeParen + 1,
    };
}

function findDestinationTitleSplit(raw: string): number {
    let depth = 0;
    for (let index = 0; index < raw.length; index += 1) {
        const char = raw[index] ?? "";
        if (char === "(" && !isEscaped(raw, index)) {
            depth += 1;
            continue;
        }
        if (char === ")" && !isEscaped(raw, index)) {
            depth = Math.max(0, depth - 1);
            continue;
        }
        if (depth === 0 && /\s/.test(char)) {
            return index;
        }
    }
    return -1;
}

function parseMarkdownLinkTitle(rawTitle: string): string | null | undefined {
    if (!rawTitle) {
        return null;
    }
    const first = rawTitle[0];
    const last = rawTitle.at(-1);
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
        return rawTitle;
    }
    if (first === "(" && last === ")" && findMarkdownDestinationClose(rawTitle, 1) === rawTitle.length - 1) {
        return rawTitle;
    }
    return undefined;
}

function findMarkdownDestinationClose(line: string, start: number): number {
    let depth = 0;
    for (let index = start; index < line.length; index += 1) {
        const char = line[index];
        if (char === "(" && !isEscaped(line, index)) {
            depth += 1;
            continue;
        }
        if (char === ")" && !isEscaped(line, index)) {
            if (depth === 0) {
                return index;
            }
            depth -= 1;
        }
    }
    return -1;
}

function findUnescaped(value: string, needle: string, start: number): number {
    for (let index = start; index < value.length; index += 1) {
        if (value[index] === needle && !isEscaped(value, index)) {
            return index;
        }
    }
    return -1;
}

function isEscaped(value: string, index: number): boolean {
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
        slashCount += 1;
    }
    return slashCount % 2 === 1;
}

function blockState(source: string, start: number, end: number): MarkdownBlockState {
    const lines = sourceBlockLines(source, start, end);
    return {
        headingLevel: headingLevel(lines),
        blockquote: lines.length > 0 && lines.every((line) => /^\s{0,3}>\s?/.test(line)),
        bulletList: lines.length > 0 && lines.every((line) => /^\s*[-*+]\s+/.test(line)),
        orderedList: lines.length > 0 && lines.every((line) => /^\s*\d+[.)]\s+/.test(line)),
        codeBlock: isFencedCodeBlock(lines),
    };
}

function sourceBlockLines(source: string, start: number, end: number): string[] {
    const fencedLines = enclosingCodeFenceLines(source, start, end);
    if (fencedLines) {
        return fencedLines;
    }
    const blockStart = source.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const normalizedEnd = end > start && source[end - 1] === "\n" ? end - 1 : end;
    const nextBreak = source.indexOf("\n", Math.max(blockStart, normalizedEnd));
    const blockEnd = nextBreak >= 0 ? nextBreak : source.length;
    return source.slice(blockStart, blockEnd).split("\n").filter((line) => line.trim().length > 0);
}

function enclosingCodeFenceLines(source: string, start: number, end: number): string[] | null {
    let lineStart = 0;
    let open: {marker: "```" | "~~~"; from: number} | null = null;
    const normalizedEnd = Math.max(start, end);
    while (lineStart <= source.length) {
        const breakIndex = source.indexOf("\n", lineStart);
        const lineEnd = breakIndex >= 0 ? breakIndex : source.length;
        const line = source.slice(lineStart, lineEnd).trim();
        const marker = line.startsWith("```") ? "```" : line.startsWith("~~~") ? "~~~" : null;
        if (!open && marker) {
            open = {marker, from: lineStart};
        } else if (open && line === open.marker) {
            if (start >= open.from && normalizedEnd <= lineEnd) {
                return source.slice(open.from, lineEnd).split("\n").filter((item) => item.trim().length > 0);
            }
            open = null;
        }
        if (breakIndex < 0) {
            break;
        }
        lineStart = breakIndex + 1;
    }
    return null;
}

function isFencedCodeBlock(lines: string[]): boolean {
    if (lines.length === 0) {
        return false;
    }
    const firstLine = lines[0]?.trim() ?? "";
    const lastLine = lines[lines.length - 1]?.trim() ?? "";
    return (firstLine.startsWith("```") && lastLine === "```")
        || (firstLine.startsWith("~~~") && lastLine === "~~~");
}

function headingLevel(lines: string[]): 1 | 2 | 3 | null {
    if (lines.length === 0) {
        return null;
    }
    for (const level of [1, 2, 3] as const) {
        if (lines.every((line) => new RegExp(`^\\s{0,3}#{${level}}\\s+`).test(line))) {
            return level;
        }
    }
    return null;
}

function isSelectionWrapped(source: string, start: number, end: number, prefix: string, suffix: string, excludedPrefixes: string[] = []): boolean {
    const selected = source.slice(start, end);
    const hasExcludedBoundary = excludedPrefixes.some((marker) => source.slice(start - marker.length, start) === marker || selected.startsWith(marker));
    if (hasExcludedBoundary) {
        return false;
    }
    return (source.slice(start - prefix.length, start) === prefix && source.slice(end, end + suffix.length) === suffix)
        || (selected.startsWith(prefix) && selected.endsWith(suffix) && selected.length >= prefix.length + suffix.length);
}
