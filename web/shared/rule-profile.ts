/** report.json 中可用于创作修复 task profile 的裁决值。 */
export type RepairRuleVerdict = "strong" | "weak" | "noise" | "anti" | "insufficient";

export const CREATIVE_PROFILE_ID = "creative-writing";
export const CREATIVE_PROFILE_VERSION = "1";

export type CreativeProfileExclusion = {
    reason: "noise" | "anti" | "overlap";
    /** overlap 时指向保留的 canonical rule；其它原因为空。 */
    canonicalRuleId?: string;
    detail: string;
};

export type CreativeRuleProfile = {
    id: typeof CREATIVE_PROFILE_ID;
    version: typeof CREATIVE_PROFILE_VERSION;
    verdictSource: "report" | "none";
    includedRuleIds: string[];
    excludedRules: Record<string, CreativeProfileExclusion>;
};

/** 高度重叠规则的稳定收敛表；即使 report 缺失也继续抑制，避免重复候选回流。 */
export const CREATIVE_OVERLAP_SUPPRESSIONS: Record<string, Omit<CreativeProfileExclusion, "reason">> = {
    "cn.modifier.bare-degree-adverb": {
        canonicalRuleId: "cn.modifier.stacked-degree-adverbs",
        detail: "与形副词系规则同 span 重叠率约 99%，保留覆盖更完整的 canonical rule。",
    },
    "cn.modifier.low-information-degree": {
        canonicalRuleId: "cn.modifier.stacked-degree-adverbs",
        detail: "与形副词系规则同 span 重叠率接近 100%，不重复进入创作候选。",
    },
    "cn.modifier.measure.empty-measure-word": {
        canonicalRuleId: "cn.modifier.measure.specific-measure-word",
        detail: "与特定量词规则重叠率约 95%，保留跨题材判别更稳定的 canonical rule。",
    },
    "cn.regex.advanced.empty-quantifier": {
        canonicalRuleId: "cn.modifier.measure.specific-measure-word",
        detail: "与量词规则完全重叠，避免同一“一声/一种”进入三条候选。",
    },
    "cn.metaphor.sentence-final-simile-tail": {
        canonicalRuleId: "cn.metaphor.trailing-simile-clause",
        detail: "命中 100% 被句尾比喻分句规则覆盖，保留覆盖略广且 lift 略高者。",
    },
    "cn.sentence.compound.unrealized-preface": {
        canonicalRuleId: "cn.sentence.compound.contrastive-turn-preface",
        detail: "与特定转折句规则同 span 重叠率超过 90%，统一交给 canonical rule 判断。",
    },
    "cn.sentence.compound.repeated-not-is": {
        canonicalRuleId: "cn.sentence.compound.contrastive-turn-preface",
        detail: "命中全部被更通用的特定转折句规则覆盖。",
    },
    "not-but-structure": {
        canonicalRuleId: "cn.sentence.compound.contrastive-turn-preface",
        detail: "与特定转折句规则高度重叠，避免同一二元对比重复进入问题清单。",
    },
};

/**
 * 创作修复保留 strong/weak、证据不足与未测规则；已有证据显示无判别力或反向的规则不再喂给 LLM。
 */
export function isRepairRuleVerdict(verdict: RepairRuleVerdict | undefined): boolean {
    return verdict !== "noise" && verdict !== "anti";
}

/** 从完整 registry 与可选 report verdict 构建创作任务 profile。 */
export function buildCreativeProfile(
    ruleIds: string[],
    verdicts?: Record<string, {verdict: RepairRuleVerdict; effectiveLift: number | null}>,
): CreativeRuleProfile {
    const includedRuleIds: string[] = [];
    const excludedRules: Record<string, CreativeProfileExclusion> = {};
    for (const ruleId of ruleIds) {
        const overlap = CREATIVE_OVERLAP_SUPPRESSIONS[ruleId];
        if (overlap) {
            excludedRules[ruleId] = {reason: "overlap", ...overlap};
            continue;
        }
        const verdict = verdicts?.[ruleId]?.verdict;
        if (verdict === "noise" || verdict === "anti") {
            excludedRules[ruleId] = {
                reason: verdict,
                detail: verdict === "noise"
                    ? "holdout 训练集未显示足够的 AI 判别力。"
                    : "holdout 训练集显示该规则更偏向人类文本。",
            };
            continue;
        }
        includedRuleIds.push(ruleId);
    }
    return {
        id: CREATIVE_PROFILE_ID,
        version: CREATIVE_PROFILE_VERSION,
        verdictSource: verdicts === undefined ? "none" : "report",
        includedRuleIds,
        excludedRules,
    };
}
