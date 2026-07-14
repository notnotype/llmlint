// 分块 + P(AI) 聚合的纯逻辑守门（bun:test）。
import {test, expect} from "bun:test";
import {chunkBySentence} from "./chunk";

test("chunkBySentence：句界对齐，不切断句子（每块以句末标点结尾）", () => {
    const text = "第一句在这里。第二句也不短哦！第三句是个问句吗？第四句结束了。";
    const chunks = chunkBySentence(text, 6, 2); // 小 target 逼出多块
    // 每块都应以句末标点结尾（没有半句）
    for (const c of chunks) {
        expect(/[。！？…]$/u.test(c.text.trim())).toBe(true);
    }
    // span 拼回应等于原文（无重叠无丢字）
    expect(chunks.map((c) => c.text).join("")).toBe(text);
});

test("chunkBySentence：span 偏移正确（可回指原文）", () => {
    const text = "甲。乙乙乙乙乙乙乙乙。丙。";
    const chunks = chunkBySentence(text, 4, 1);
    for (const c of chunks) {
        expect(text.slice(c.start, c.end)).toBe(c.text);
    }
});

test("chunkBySentence：尾块过短并入前块", () => {
    const text = "这是一段比较长的话足够触发切块了对吧。短。";
    const chunks = chunkBySentence(text, 10, 5);
    // "短。" 只有 1 个可见字 < minTail 5 → 并入前块，不单独成块
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.text).toBe(text);
});

test("chunkBySentence：无句末标点兜底成一块", () => {
    const text = "这段话完全没有句末标点符号就这样一直写下去";
    const chunks = chunkBySentence(text, 5);
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.text).toBe(text);
});
