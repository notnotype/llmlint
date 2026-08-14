import {describe, expect, test} from "bun:test";
import {Value} from "typebox/value";
import {ANALYZE_STYLE_TOOL, buildStyleSynthesisUser, SYNTHESIZE_STYLE_TOOL, STYLE_DISTILL_PROMPT_VERSION} from "./style-distill-prompt";

describe("style distill prompt contract", () => {
    test("版本化 schema 接受完整分析和汇总结果", () => {
        expect(STYLE_DISTILL_PROMPT_VERSION).toBe("style-distill-v1");
        expect(Value.Check(ANALYZE_STYLE_TOOL.parameters, {
            sentenceRhythm: [], paragraphStructure: [], dictionImagery: [], viewpointInformation: [],
            emotionNarration: [], dialogueAction: [], rhetoricNovelty: [], sceneFeatures: [], stableSignals: [], avoidSignals: [],
        })).toBe(true);
        expect(Value.Check(SYNTHESIZE_STYLE_TOOL.parameters, {
            label: "通用叙事",
            suggestedKey: "general-narrative",
            sceneTags: ["日常对话"],
            whenToUse: "用于常见叙事场景。",
            coreRules: ["用动作承载信息。"],
            prohibitions: ["不要复刻来源原句。"],
            styleMarkdown: "# 文体定位\n\n## 核心禁区\n\n不要复刻来源原句。",
        })).toBe(true);
    });

    test("汇总输入按匿名样本携带分析而不携正文", () => {
        const prompt = buildStyleSynthesisUser([{
            sampleKey: "reference-0001.md",
            sentenceRhythm: ["长短句交替"],
            paragraphStructure: [],
            dictionImagery: [],
            viewpointInformation: [],
            emotionNarration: [],
            dialogueAction: [],
            rhetoricNovelty: [],
            sceneFeatures: [],
            stableSignals: [],
            avoidSignals: [],
        }]);
        expect(prompt).toContain("reference-0001.md");
        expect(prompt).toContain("长短句交替");
        expect(prompt).not.toContain("【正文");
    });
});
