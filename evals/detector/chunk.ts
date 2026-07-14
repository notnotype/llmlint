// 文本分块：句界对齐，避免切断句子（检测器对残句敏感）。
// 检测器只读前部窗口（task08 实测：>500 字后尾部静默截断），所以每块控制在窗口内。
// span 用 UTF-16 offset（与原文 slice 一致），batch 打分时可回指原文位置做热力图。

export type Chunk = {start: number; end: number; text: string};

// 句末标点（含中文句号/问号/叹号/省略号 + 常见闭合引号），切分点在这些之后。
const SENTENCE_END = /[。！？…]+[」』”）】]*|[.!?]+["')\]]*(?=\s|$)/gu;

/**
 * 按句界把文本切成 ~targetChars 的块。
 * @param text 原文
 * @param targetChars 目标块大小（可见字数量级；累积到此值就断块）
 * @param minTailChars 尾块下限，短于此并入前块，避免碎块
 */
export function chunkBySentence(text: string, targetChars = 450, minTailChars = 150): Chunk[] {
    const sentences = splitSentences(text);
    const chunks: Chunk[] = [];
    let bufStart = 0;
    let bufEnd = 0;
    let bufChars = 0;
    for (const s of sentences) {
        if (bufChars === 0) {
            bufStart = s.start;
        }
        bufEnd = s.end;
        bufChars += visibleLen(s.text);
        if (bufChars >= targetChars) {
            chunks.push({start: bufStart, end: bufEnd, text: text.slice(bufStart, bufEnd)});
            bufChars = 0;
        }
    }
    // 残余 buffer（最后一段）
    if (bufChars > 0) {
        const tail = {start: bufStart, end: bufEnd, text: text.slice(bufStart, bufEnd)};
        // 尾块太短且前面有块 → 并入前一块（重算 span 到尾块末尾）。
        if (chunks.length > 0 && visibleLen(tail.text) < minTailChars) {
            const prev = chunks[chunks.length - 1]!;
            chunks[chunks.length - 1] = {start: prev.start, end: tail.end, text: text.slice(prev.start, tail.end)};
        } else {
            chunks.push(tail);
        }
    }
    // 兜底：无句末标点的文本（整段没标点）→ 至少返回整篇一块。
    if (chunks.length === 0 && text.trim().length > 0) {
        return [{start: 0, end: text.length, text}];
    }
    return chunks;
}

/** 按句末标点切句，保留每句的原文 span（含标点）。 */
function splitSentences(text: string): Chunk[] {
    const out: Chunk[] = [];
    let last = 0;
    SENTENCE_END.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SENTENCE_END.exec(text)) !== null) {
        const end = m.index + m[0].length;
        out.push({start: last, end, text: text.slice(last, end)});
        last = end;
    }
    if (last < text.length) {
        out.push({start: last, end: text.length, text: text.slice(last)});
    }
    return out;
}

/** 可见字数：去空白后码点数（与 evals 全局口径一致）。 */
export function visibleLen(text: string): number {
    return [...text.replace(/\s/gu, "")].length;
}
