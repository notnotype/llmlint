import {describe, it, expect} from "vitest";
import {computeLlmHunks, computeLlmHunksWithTimeout, type LlmHunk} from "../web/app/utils/llm-merge";
import {applyDraftSplice, createPlan, foldDraft} from "../web/app/utils/repair-draft";

// llm-merge 是「AI 整篇改写 → 逐处替换 hunk」的纯核心（Task 13 W7 F1）。主断言是核心不变量：
// 对 base 逐 hunk **从后往前**应用（后方替换不影响前方坐标）必须精确还原 rewritten——
// 这正是 TextPanel.applyLlmRewrite 逐 hunk spliceDraft 的应用语义。另覆盖结构良构与超时兜底。

/** 核心不变量助手：对 base 逐 hunk 从后往前做直接字符串替换。 */
function applyHunksReversed(base: string, hunks: LlmHunk[]): string {
    let result = base;
    for (const hunk of [...hunks].reverse()) {
        result = result.slice(0, hunk.from) + hunk.replacement + result.slice(hunk.to);
    }
    return result;
}

/** 计算 hunks 并断言：核心不变量 + 升序互不重叠 + 相邻 hunk 隔非空 EQUAL 段 + 均为真实变更。 */
function hunksAndCheck(base: string, rewritten: string): LlmHunk[] {
    const hunks = computeLlmHunks(base, rewritten);
    expect(applyHunksReversed(base, hunks)).toBe(rewritten);
    for (const [index, hunk] of hunks.entries()) {
        expect(hunk.from).toBeGreaterThanOrEqual(0);
        expect(hunk.to).toBeGreaterThanOrEqual(hunk.from);
        expect(hunk.to).toBeLessThanOrEqual(base.length);
        // 真实变更：非零宽删除或非空插入，不产出空 hunk。
        expect(hunk.to > hunk.from || hunk.replacement.length > 0).toBe(true);
        const previous = hunks[index - 1];
        if (previous) {
            expect(hunk.from).toBeGreaterThan(previous.to);
        }
    }
    return hunks;
}

describe("llm-merge computeLlmHunks", () => {
    it("完全相同：返回空数组（含空串）", () => {
        expect(computeLlmHunks("一模一样的文本。", "一模一样的文本。")).toEqual([]);
        expect(computeLlmHunks("", "")).toEqual([]);
    });

    it("纯插入：单 hunk，from === to", () => {
        const hunks = hunksAndCheck("abcdef", "abcXYZdef");
        expect(hunks).toEqual([{from: 3, to: 3, replacement: "XYZ"}]);
    });

    it("纯删除：单 hunk，replacement 为空", () => {
        const hunks = hunksAndCheck("abcXYZdef", "abcdef");
        expect(hunks).toEqual([{from: 3, to: 6, replacement: ""}]);
    });

    it("替换：DELETE/INSERT 连续段折成一个替换 hunk", () => {
        const hunks = hunksAndCheck("他连忙点头答应。", "他赶紧点头答应。");
        expect(hunks).toEqual([{from: 1, to: 3, replacement: "赶紧"}]);
    });

    it("中文文本多处散布改动：拆成一处处 hunk（不并成一条巨型 diff）", () => {
        const base = "少年背着行囊离开村庄，山路崎岖，走了整整三天。客栈里灯火昏黄，掌柜的递来一碗热茶。夜里下起大雨，他伏在窗边听着雨声入眠。";
        const rewritten = "少年背着行囊离开故乡，山路崎岖，走了整整三天。客栈里灯火昏黄，掌柜的端来一碗热茶。夜里下起大雨，他伏在窗边数着雨声入眠。";
        const hunks = hunksAndCheck(base, rewritten);
        expect(hunks).toHaveLength(3);
        expect(hunks.map((hunk) => [base.slice(hunk.from, hunk.to), hunk.replacement])).toEqual([
            ["村庄", "故乡"],
            ["递", "端"],
            ["听", "数"],
        ]);
    });

    it("首尾改动：首 hunk 从 0 起，尾 hunk 到 base 末尾", () => {
        const base = "AAA中间保持不变的一大段文字BBB";
        const rewritten = "XX中间保持不变的一大段文字YYYY";
        const hunks = hunksAndCheck(base, rewritten);
        expect(hunks).toHaveLength(2);
        expect(hunks[0]).toEqual({from: 0, to: 3, replacement: "XX"});
        expect(hunks[1]).toEqual({from: base.length - 3, to: base.length, replacement: "YYYY"});
    });

    it("空串边界：从空到有 = 单条纯插入；从有到空 = 单条整删", () => {
        expect(hunksAndCheck("", "全新内容")).toEqual([{from: 0, to: 0, replacement: "全新内容"}]);
        expect(hunksAndCheck("旧内容", "")).toEqual([{from: 0, to: 3, replacement: ""}]);
    });

    it("UTF-16 码元坐标：含 emoji（代理对）时不变量仍成立", () => {
        // 😀/😢 共享高位代理项，dmp 可能在代理对内部切分——码元级拼接不受影响。
        hunksAndCheck("他笑了😀然后离开。", "他哭了😢然后离开。");
        hunksAndCheck("开头😀😀😀结尾", "开头😢结尾了");
    });

    it("重复模式与整篇重写：不变量成立", () => {
        hunksAndCheck("aaaa", "aaa");
        hunksAndCheck("ababab", "bababa");
        hunksAndCheck("完全不同的一段旧文字。", "毫无交集的新内容！");
        hunksAndCheck("第一行\n第二行\n第三行\n", "第一行\n改掉的第二行\n第三行\n第四行\n");
    });

    it("超时兜底：极小超时下退化为粗块，不变量仍精确成立", () => {
        const paragraphs: string[] = [];
        for (let index = 0; index < 400; index += 1) {
            paragraphs.push(`第${index}段：这里是完全一样的正文内容，用来撑出足够长度。`);
        }
        const base = paragraphs.join("\n");
        const rewritten = base.replaceAll("完全一样", "略有不同");
        // 0.001 秒必然触发 dmp deadline → 粗粒度块；粒度不作断言（超时路径不保证），只锁正确性。
        const hunks = computeLlmHunksWithTimeout(base, rewritten, 0.001);
        expect(hunks.length).toBeGreaterThanOrEqual(1);
        expect(applyHunksReversed(base, hunks)).toBe(rewritten);
    });

    it("核心不变量（piece-table 应用语义）：含既有手改的 plan 逐 hunk 从后往前 splice 后 fold === rewritten", () => {
        // 模拟 TextPanel.applyLlmRewrite：base = 当前草稿（含一条手改），AI 连手改处也一并改写。
        let plan = createPlan("原文第一句。原文第二句。原文第三句。");
        plan = applyDraftSplice(plan, 0, 2, "手改", {id: "user-1", kind: "user", title: "手改"});
        const draft = foldDraft(plan);
        expect(draft).toBe("手改第一句。原文第二句。原文第三句。");
        const rewritten = "重写第一句。改写第二句。原文第三句了。";
        const hunks = hunksAndCheck(draft, rewritten);
        for (const [index, hunk] of [...hunks].reverse().entries()) {
            plan = applyDraftSplice(plan, hunk.from, hunk.to, hunk.replacement, {id: `llm-${index}`, kind: "llm", title: "AI 改写"});
        }
        expect(foldDraft(plan)).toBe(rewritten);
        // 覆盖手改区的 hunk 把既有 user 编辑吸收为 llm 编辑（W7 契约：内容来源如实变为 llm）。
        expect(plan.edits.length).toBeGreaterThan(0);
        expect(plan.edits.every((edit) => edit.kind === "llm")).toBe(true);
    });
});
