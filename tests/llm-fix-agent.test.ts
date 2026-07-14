// applyReplace 纯函数守门（Task 18）：oldText 唯一性校验与自纠指令文案是 agent 自纠闭环的地基。
import {describe, it, expect} from "vitest";
import {applyReplace} from "../web/server/utils/llm-fix-agent";

describe("applyReplace", () => {
    it("唯一命中：原位替换", () => {
        const result = applyReplace("春天来了，花开了。", "花开了", "花都开好了");
        expect(result).toEqual({ok: true, next: "春天来了，花都开好了。"});
    });

    it("0 命中：提示原样摘录", () => {
        const result = applyReplace("春天来了。", "夏天", "秋天");
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toContain("未在正文中找到");
    });

    it("多处命中：提示扩大摘录范围", () => {
        const result = applyReplace("他点了点头。他点了点头。", "点了点头", "颔首");
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toContain("命中多处");
    });

    it("空 oldText：拒绝", () => {
        const result = applyReplace("正文", "", "x");
        expect(result.ok).toBe(false);
    });

    it("oldText === newText：拒绝（未产生修改）", () => {
        const result = applyReplace("正文一段。", "正文", "正文");
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toContain("相同");
    });

    it("命中在文首/文末边界都正确拼接", () => {
        expect(applyReplace("abc", "a", "A")).toEqual({ok: true, next: "Abc"});
        expect(applyReplace("abc", "c", "C")).toEqual({ok: true, next: "abC"});
    });
});
