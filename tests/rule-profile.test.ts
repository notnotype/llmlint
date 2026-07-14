import {describe, expect, it} from "vitest";
import {buildCreativeProfile, CREATIVE_PROFILE_ID, CREATIVE_PROFILE_VERSION, isRepairRuleVerdict} from "../web/shared/rule-profile";

describe("创作修复 task profile", () => {
    it("排除已有证据表明无判别力的规则，保留证据不足和未测规则", () => {
        expect(isRepairRuleVerdict("strong")).toBe(true);
        expect(isRepairRuleVerdict("weak")).toBe(true);
        expect(isRepairRuleVerdict("insufficient")).toBe(true);
        expect(isRepairRuleVerdict(undefined)).toBe(true);
        expect(isRepairRuleVerdict("noise")).toBe(false);
        expect(isRepairRuleVerdict("anti")).toBe(false);
    });

    it("构建版本化 profile：overlap 抑制优先，noise/anti 按报告排除", () => {
        const profile = buildCreativeProfile([
            "cn.modifier.stacked-degree-adverbs",
            "cn.modifier.bare-degree-adverb",
            "noise-rule",
            "anti-rule",
            "unmeasured-rule",
        ], {
            "cn.modifier.bare-degree-adverb": {verdict: "noise", effectiveLift: 1.4},
            "noise-rule": {verdict: "noise", effectiveLift: 1.2},
            "anti-rule": {verdict: "anti", effectiveLift: 0.4},
        });

        expect(profile.id).toBe(CREATIVE_PROFILE_ID);
        expect(profile.version).toBe(CREATIVE_PROFILE_VERSION);
        expect(profile.verdictSource).toBe("report");
        expect(profile.includedRuleIds).toEqual([
            "cn.modifier.stacked-degree-adverbs",
            "unmeasured-rule",
        ]);
        expect(profile.excludedRules["cn.modifier.bare-degree-adverb"]).toMatchObject({
            reason: "overlap",
            canonicalRuleId: "cn.modifier.stacked-degree-adverbs",
        });
        expect(profile.excludedRules["noise-rule"]?.reason).toBe("noise");
        expect(profile.excludedRules["anti-rule"]?.reason).toBe("anti");
    });

    it("report 缺失时保留全量规则，但仍应用稳定 overlap 抑制", () => {
        const profile = buildCreativeProfile([
            "cn.modifier.stacked-degree-adverbs",
            "cn.modifier.bare-degree-adverb",
            "unmeasured-rule",
        ]);

        expect(profile.verdictSource).toBe("none");
        expect(profile.includedRuleIds).toEqual([
            "cn.modifier.stacked-degree-adverbs",
            "unmeasured-rule",
        ]);
        expect(profile.excludedRules["cn.modifier.bare-degree-adverb"]?.reason).toBe("overlap");
    });
});
