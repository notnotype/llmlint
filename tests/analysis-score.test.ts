import {describe, expect, it} from "vitest";
import {compositeScore, DOC_SCORE_BASELINE, llmReviewStatus, ruleFaceScore} from "../web/shared/analysis";

describe("三维综合评分", () => {
    it("规则面基线保持 S 型锚点", () => {
        expect(Math.round(ruleFaceScore(DOC_SCORE_BASELINE.humanMedian))).toBe(27);
        expect(Math.round(ruleFaceScore(DOC_SCORE_BASELINE.aiMedian))).toBe(73);
        expect(Math.round(ruleFaceScore((DOC_SCORE_BASELINE.humanMedian + DOC_SCORE_BASELINE.aiMedian) / 2))).toBe(50);
    });

    it("单路结果按自身分数展示并标记部分", () => {
        expect(compositeScore({rules: 60})).toEqual({score: 60, complete: false, available: ["rules"]});
    });

    it("双路按已有权重重新归一", () => {
        // rules=30 / detector=45，总权重 75：30*0.3 + 90*0.45 = 49.5；/0.75 = 66。
        expect(compositeScore({rules: 30, detector: 90})).toEqual({score: 66, complete: false, available: ["rules", "detector"]});
    });

    it("三路按 30/45/25 合成并标记完整", () => {
        expect(compositeScore({rules: 20, detector: 80, llm: 60})).toEqual({score: 57, complete: true, available: ["rules", "detector", "llm"]});
    });

    it("无完成通道返回空分", () => {
        expect(compositeScore({})).toEqual({score: null, complete: false, available: []});
    });

    it("LLM Review 状态以最新 Invocation 为准，旧物化结果不能掩盖重试状态", () => {
        expect(llmReviewStatus({reviewExists: true, invocationStatus: "running"})).toBe("running");
        expect(llmReviewStatus({reviewExists: true, invocationStatus: "failed", error: "provider failed"})).toBe("failed");
        expect(llmReviewStatus({reviewExists: true, invocationStatus: "aborted"})).toBe("cancelled");
        expect(llmReviewStatus({reviewExists: true, invocationStatus: "completed"})).toBe("completed");
        expect(llmReviewStatus({reviewExists: false, invocationStatus: "completed"})).toBe("waiting");
    });
});
