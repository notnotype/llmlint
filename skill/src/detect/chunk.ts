// 移植自 evals/detector/chunk.ts：保持 UTF-16 span、句界切分、短尾合并与无句读兜底语义。

export type Chunk = {
    start: number;
    end: number;
    text: string;
};

// 句末标点（含中文句号/问号/叹号/省略号 + 常见闭合引号），切分点在这些之后。
const SENTENCE_END = /[。！？…]+[」』”）】]*|[.!?]+["')\]]*(?=\s|$)/gu;

/**
 * 按句界把文本切成接近 targetChars 的块。span 使用 UTF-16 offset，与原文 slice 一致。
 * 尾块短于 minTailChars 时并入上一块，避免检测器收到过碎残句。
 */
export function chunkBySentence(text: string, targetChars = 450, minTailChars = 150): Chunk[] {
    const sentences = splitSentences(text);
    const chunks: Chunk[] = [];
    let bufferStart = 0;
    let bufferEnd = 0;
    let bufferChars = 0;

    for (const sentence of sentences) {
        if (bufferChars === 0) {
            bufferStart = sentence.start;
        }
        bufferEnd = sentence.end;
        bufferChars += visibleLen(sentence.text);
        if (bufferChars >= targetChars) {
            chunks.push({start: bufferStart, end: bufferEnd, text: text.slice(bufferStart, bufferEnd)});
            bufferChars = 0;
        }
    }

    if (bufferChars > 0) {
        const tail = {start: bufferStart, end: bufferEnd, text: text.slice(bufferStart, bufferEnd)};
        if (chunks.length > 0 && visibleLen(tail.text) < minTailChars) {
            const previous = chunks[chunks.length - 1]!;
            chunks[chunks.length - 1] = {start: previous.start, end: tail.end, text: text.slice(previous.start, tail.end)};
        } else {
            chunks.push(tail);
        }
    }

    if (chunks.length === 0 && text.trim().length > 0) {
        return [{start: 0, end: text.length, text}];
    }
    return chunks;
}

/** 可见字数：去空白后按码点计数，与 evals 检测口径一致。 */
export function visibleLen(text: string): number {
    return [...text.replace(/\s/gu, "")].length;
}

/** 按句末标点切句，保留每句在原文中的 UTF-16 span。 */
function splitSentences(text: string): Chunk[] {
    const chunks: Chunk[] = [];
    let last = 0;
    SENTENCE_END.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SENTENCE_END.exec(text)) !== null) {
        const end = match.index + match[0].length;
        chunks.push({start: last, end, text: text.slice(last, end)});
        last = end;
    }
    if (last < text.length) {
        chunks.push({start: last, end: text.length, text: text.slice(last)});
    }
    return chunks;
}
