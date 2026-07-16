import {expect, test} from "bun:test";
import {assertRenderPromptVersion} from "./corpus";
import type {Sample} from "./types";

/** 构造只覆盖 prompt 版本合同的最小 render 样本。 */
function renderSample(file: string, promptVersion?: string): Sample {
    return {
        role: "render",
        genre: "test",
        plotId: "g1",
        model: "model-a",
        promptVersion,
        pairRef: "reference.md",
        file,
        absPath: file,
        text: "正文",
        charCount: 2,
    };
}

test("render prompt 版本完整且一致时返回唯一版本", () => {
    expect(assertRenderPromptVersion([
        renderSample("render-a.md", "render-v1"),
        renderSample("render-b.md", "render-v1"),
    ])).toBe("render-v1");
});

test("任一 render 缺 promptVersion 时拒绝生成报告", () => {
    expect(() => assertRenderPromptVersion([
        renderSample("render-a.md", "render-v1"),
        renderSample("render-b.md"),
    ])).toThrow("render 样本缺 promptVersion，拒绝生成报告");
});

test("render prompt 版本混用时拒绝生成报告", () => {
    expect(() => assertRenderPromptVersion([
        renderSample("render-a.md", "render-v1"),
        renderSample("render-b.md", "render-v2"),
    ])).toThrow("render prompt 版本混用，拒绝生成报告");
});
