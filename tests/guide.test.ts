import {describe, expect, it} from "vitest";
import {buildGuide, buildGuideArtifact, fingerprintRuleVerdicts, fingerprintText, GUIDE_TIERS, parseRuleVerdicts, renderGuide, selectGuideRules, type GuideTier, type RuleVerdicts} from "../skill/src/guide";
import {loadRules} from "../skill/src/rules";
import type {LoadedRules, NormalizedLlmlintConfig} from "../skill/src/types";

function defaultConfig(): NormalizedLlmlintConfig {
    return {
        rulesets: ["builtin/default"],
        trustedRulesets: [],
        rulesetOverrides: {},
        namespaces: {},
        rules: {},
        ignoreTerms: [],
        output: "stylish",
    };
}

let cached: LoadedRules | null = null;
async function loaded(): Promise<LoadedRules> {
    cached ??= await loadRules(defaultConfig());
    return cached;
}

describe("写作期摘要 guide", () => {
    it("四档严格嵌套：放宽档位只会增加规则，不会换掉规则", async () => {
        const rules = (await loaded()).rules;
        const verdicts: RuleVerdicts = new Map([["cn.metaphor.trailing-simile-clause", "strong"], ["cn.vocabulary.body.back-spine", "weak"]]);
        const ids = GUIDE_TIERS.map((tier) => new Set(selectGuideRules(rules, tier, verdicts).map((rule) => rule.id)));
        for (let index = 1; index < ids.length; index++) {
            const narrower = ids[index - 1]!;
            const wider = ids[index]!;
            const dropped = [...narrower].filter((id) => !wider.has(id));
            expect(dropped, `${GUIDE_TIERS[index]} 丢掉了 ${GUIDE_TIERS[index - 1]} 里的规则`).toEqual([]);
        }
        // full 必须是全量，否则「都要」这个档位名不成立。
        expect(ids[ids.length - 1]!.size).toBe(rules.length);
    });

    it("语义规则在任何档位都在：CLI 抓不到它们，摘要是唯一执行路径", async () => {
        const {rules, semanticRules} = await loaded();
        expect(semanticRules.length).toBeGreaterThan(0);
        for (const tier of GUIDE_TIERS) {
            const selected = new Set(selectGuideRules(rules, tier, new Map()).map((rule) => rule.id));
            for (const rule of semanticRules) {
                expect(selected.has(rule.id), `${tier} 档漏了语义规则 ${rule.id}`).toBe(true);
            }
        }
    });

    it("没有 profile 时不假装有判别证据：core 只剩语义规则", async () => {
        const {rules, semanticRules} = await loaded();
        expect(selectGuideRules(rules, "core", new Map()).map((rule) => rule.id).sort())
            .toEqual(semanticRules.map((rule) => rule.id).sort());
    });

    it("profile 里 strong 的规则进 core，weak 的只进 wide", async () => {
        const {rules} = await loaded();
        const strongId = "cn.metaphor.trailing-simile-clause";
        const weakId = "cn.vocabulary.body.back-spine";
        const verdicts: RuleVerdicts = new Map([[strongId, "strong"], [weakId, "weak"]]);
        const inTier = (tier: GuideTier, id: string) => selectGuideRules(rules, tier, verdicts).some((rule) => rule.id === id);
        expect(inTier("core", strongId)).toBe(true);
        expect(inTier("core", weakId)).toBe(false);
        expect(inTier("standard", weakId)).toBe(false);
        expect(inTier("wide", weakId)).toBe(true);
    });

    it("对照例不能被写成反例：hit=false 是「形近但不该报」，标成别写成会教模型过度规避", async () => {
        const {rules, semanticRules} = await loaded();
        const markdown = buildGuide({...(await loaded()), rules}, "core", new Map());
        const contrast = semanticRules.flatMap((rule) => (rule.examples ?? []).filter((example) => !example.hit));
        const hits = semanticRules.flatMap((rule) => (rule.examples ?? []).filter((example) => example.hit));
        expect(contrast.length, "内置语义规则应当带对照例").toBeGreaterThan(0);
        for (const example of contrast) {
            expect(markdown).toContain(`这样写没问题：${example.text}`);
            expect(markdown).not.toContain(`别写成：${example.text}`);
        }
        for (const example of hits) {
            expect(markdown).toContain(`别写成：${example.text}`);
        }
    });

    it("摘要抬头声明档位与条数，便于人判断完整度", async () => {
        const markdown = buildGuide(await loaded(), "full", new Map());
        const total = (await loaded()).rules.length;
        expect(markdown).toContain(`档位 full，${total} / ${total} 条 active 规则`);
    });

    it("默认范围写进抬头，只有例外规则带 scope 与位置标签（语义规则同样适用）", async () => {
        const markdown = buildGuide(await loaded(), "full", new Map());
        expect(markdown).toContain("未标注范围的规则默认适用全文");
        expect(markdown).toContain("[叙述]不是A，是B 对比状态机");
        expect(markdown).toContain("[引号内]叙述层短词引号强调");

        const semantic = (await loaded()).semanticRules[0]!;
        const scopedSemantic = {...semantic, scope: {layer: "narrative" as const, position: {kind: "ending" as const, chars: 120}}};
        expect(renderGuide([scopedSemantic], "core", 1, ["test"])).toContain(`[叙述][文末 120 字]${semantic.title}`);
    });

    it("Guide provenance 对 profile 顺序稳定，并对 verdict、规则集合与文本变化敏感", async () => {
        const rules = await loaded();
        const first: RuleVerdicts = new Map([["b", "weak"], ["a", "strong"]]);
        const reordered: RuleVerdicts = new Map([["a", "strong"], ["b", "weak"]]);
        expect(fingerprintRuleVerdicts(first)).toBe(fingerprintRuleVerdicts(reordered));
        expect(fingerprintRuleVerdicts(first)).not.toBe(fingerprintRuleVerdicts(new Map([["a", "weak"], ["b", "weak"]])));

        const standard = buildGuideArtifact(rules, "standard", first, true);
        const core = buildGuideArtifact(rules, "core", first, true);
        expect(standard.provenance.profileFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(standard.provenance.selectedRuleFingerprint).not.toBe(core.provenance.selectedRuleFingerprint);
        expect(standard.provenance.textFingerprint).toBe(fingerprintText(standard.text));
        expect(fingerprintText(`${standard.text}\n`)).not.toBe(standard.provenance.textFingerprint);
        expect(buildGuideArtifact(rules, "standard", first, false).provenance.profileFingerprint).toBeNull();
    });

    it("profile 报告只收 strong / weak，其余裁决桶对写作期没有意义", () => {
        const verdicts = parseRuleVerdicts(JSON.stringify({
            rules: [
                {id: "a", verdict: "strong"},
                {id: "b", verdict: "weak"},
                {id: "c", verdict: "noise"},
                {id: "d", verdict: "insufficient"},
                {verdict: "strong"},
            ],
        }));
        expect([...verdicts.entries()].sort()).toEqual([["a", "strong"], ["b", "weak"]]);
    });

    it("profile 报告缺 rules 数组时报错，不静默降级成空档位", () => {
        expect(() => parseRuleVerdicts(JSON.stringify({summary: {}}))).toThrow("rules 数组");
    });
});
