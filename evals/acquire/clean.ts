// 章节正文清洗 + 分段。
// 关键纪律：只去站点/付费/作者噪声 + 归一空白，绝不改标点（破折号、全角符号都是规则要测的对象，
// 动了就污染评测）。所以这里不做"全半角归一"，保持作者原文。
import type {Chapter} from "./txt";

const NOISE_LINE_PATTERNS: RegExp[] = [
    /^[-—=*＊_]{3,}$/u,                       // 分隔线
    /本章未完|未完待续|未完，?待续/u,
    /^\s*(作者|作者君|作者的话|ps|PS|P\.?S\.?)[:：]/u,
    /起点中文|纵横中文|晋江|番茄小说|17K|刺猬猫|飞卢/u,
    /https?:\/\/|www\.|\.com|\.net/iu,
    /手机阅读|请收藏|求票|求推荐|求订阅|月票|打赏|加更|本书首发/u,
    /^Google\s*谷歌/u,                        // txt 合集常见站点水印行（如"Google 谷歌 第一卷 … 第一章 …"）
];

/** 去噪声行 + 归一空白，不动标点与字形。 */
export function cleanProse(text: string): string {
    const kept = text
        .replace(/ /gu, " ")
        .split("\n")
        .filter((line) => !isNoiseLine(line));
    return kept
        .join("\n")
        .replace(/[ \t]+\n/gu, "\n")
        .replace(/\n{3,}/gu, "\n\n")
        .trim();
}

function isNoiseLine(line: string): boolean {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
        return false; // 空行保留为段落分隔，交给上面的 \n{3,} 折叠
    }
    return NOISE_LINE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * 把一章切成若干 reference 单元。默认一章一单元；超过 softLimit 字时按段落（空行）累积切到目标区间。
 * 这样评测粒度稳定在 ~2-4k 字，且不切碎段落。
 */
export function segmentChapter(text: string, softLimit = 4000, hardFloor = 800): string[] {
    if (visibleLength(text) <= softLimit) {
        return [text];
    }
    // 优先按空行分段；有的来源（如 calibre 转的 epub）每段只有单换行、没有空行，
    // 空行切不开时回退按单换行行分段，否则整章会成一个不可切的"巨型段"。
    // 重组分隔符跟随切分方式：保持来源原有的段落空白风格，不做无谓归一。
    let separator = "\n\n";
    let paragraphs = text.split(/\n{2,}/u);
    if (paragraphs.length <= 1) {
        separator = "\n";
        paragraphs = text.split(/\n/u);
    }
    const units: string[] = [];
    let buffer: string[] = [];
    let size = 0;
    for (const paragraph of paragraphs) {
        buffer.push(paragraph);
        size += visibleLength(paragraph);
        if (size >= softLimit) {
            units.push(buffer.join(separator));
            buffer = [];
            size = 0;
        }
    }
    if (buffer.length > 0) {
        const tail = buffer.join(separator);
        // 末尾太短就并回上一单元，避免产生碎片 reference。
        if (units.length > 0 && visibleLength(tail) < hardFloor) {
            units[units.length - 1] += `${separator}${tail}`;
        } else {
            units.push(tail);
        }
    }
    return units;
}

/** 可见字数：去掉所有空白后的字符（码点）数，作为正文"字数"口径。 */
export function visibleLength(text: string): number {
    return [...text.replace(/\s/gu, "")].length;
}

/** 章节是否值得收作 reference（太短的楔子/过渡章丢弃）。 */
export function isUsableChapter(chapter: Chapter, minChars = 500): boolean {
    return visibleLength(chapter.text) >= minChars;
}
