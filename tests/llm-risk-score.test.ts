import {describe, expect, it} from "vitest";
import {llmRiskScore} from "../web/server/agent/llm-risk-score";

const levels = new Map<string, "high" | "medium" | "low">([["medium", "medium"], ["low", "low"]]);
const hit = (ruleId: string, start: number) => ({ruleId, quote: `命中${start}`, reason: "原因", span: {start, end: start + 2}});

describe("LLM 风险服务器校准", () => {
    it("零命中恒为 0，不受模型主观评价影响", () => {
        expect(llmRiskScore("正文".repeat(500), [], levels)).toBe(0);
    });

    it("按严重度和千字密度平滑上升", () => {
        const body = "字".repeat(1000);
        expect(llmRiskScore(body, [hit("medium", 0)], levels)).toBe(28);
        expect(llmRiskScore(body, [hit("medium", 0), hit("medium", 10), hit("medium", 20)], levels)).toBe(63);
        expect(llmRiskScore(body, [hit("low", 0)], levels)).toBeLessThan(28);
    });

    it("同规则同 span 重复记录只计一次", () => {
        const body = "字".repeat(1000);
        expect(llmRiskScore(body, [hit("medium", 0), hit("medium", 0)], levels)).toBe(28);
    });
});
