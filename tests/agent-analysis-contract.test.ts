import {describe, expect, it} from "vitest";
import {chunkBody, parseReport, parseRuleHit} from "../web/server/agent/analysis-contract";

describe("LLM 分析 Agent 工具合同", () => {
    it("按可见字切块并保持 UTF-16 span 连续", () => {
        const body = "甲 乙\n丙😀丁";
        const chunks = chunkBody(body, 2);
        expect(chunks.map((chunk) => chunk.text)).toEqual(["甲 乙", "\n丙😀", "丁"]);
        expect(chunks.map((chunk) => body.slice(chunk.start, chunk.end))).toEqual(chunks.map((chunk) => chunk.text));
        expect(chunks.at(-1)?.end).toBe(body.length);
    });

    it("规则命中必须使用有效 ruleId 和正文逐字引文", () => {
        const rules = new Set(["llm.test"]);
        expect(parseRuleHit({id: "1", name: "record_rule_hit", arguments: {ruleId: "llm.test", quote: "乙丙", reason: "证据"}}, "甲乙丙", rules)).toMatchObject({ok: true, hit: {span: {start: 1, end: 3}}});
        expect(parseRuleHit({id: "2", name: "record_rule_hit", arguments: {ruleId: "llm.bad", quote: "乙", reason: "证据"}}, "甲乙丙", rules)).toMatchObject({ok: false});
        expect(parseRuleHit({id: "3", name: "record_rule_hit", arguments: {ruleId: "llm.test", quote: "不存在", reason: "证据"}}, "甲乙丙", rules)).toMatchObject({ok: false});
    });

    it("report_result 由服务器生成证据，并拒绝非法置信度和零命中泛建议", () => {
        const hits = [{ruleId: "llm.test", quote: "甲乙", reason: "节奏单一", span: {start: 0, end: 2}}];
        const valid = {confidence: 0.8, conclusion: "命中一处节奏模式", suggestions: ["调整句式"]};
        expect(parseReport(valid, hits)).toMatchObject({
            ok: true,
            report: {confidence: 0.8, evidence: [{quote: "甲乙", reason: "节奏单一", ruleIds: ["llm.test"]}]},
        });
        expect(parseReport({...valid, confidence: -1}, hits)).toMatchObject({ok: false});
        expect(parseReport({...valid, suggestions: ["泛泛优化"]}, [])).toMatchObject({ok: false});
    });
});
