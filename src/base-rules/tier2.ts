import type {LintRuleRecord} from "../types";

/**
 * Tier 2 官腔搭配（modifier 命名空间，已由命名空间策略默认归 human 桶）。
 *
 * 取材自 shuorenhua/references/phrases-zh.md「Tier 2 形容/修饰」段。
 * 注意：shuorenhua 的 Tier 2 是「同段聚集才算」，单次出现往往合理；regex 无法判段内密度，
 * 因此只收「官腔动副搭配」这类单看就偏 AI/公文的组合，并默认归 human 桶；
 * 裸连接词（然而/此外/与此同时）过于常见，故意不收，避免逐次误杀。
 */
export const TIER2_RULES = [
    {
        "id": "tier2-official-collocation",
        "namespace": "modifier",
        "title": "官腔动副搭配",
        "level": "low",
        "note": "「显著提升 / 有效解决 / 全面推进 / 持续优化」式公文腔搭配，单看就偏 AI/官样。改成具体动作与可观察结果；同段聚集时更应处理。",
        "detector": {
            "type": "regex",
            "targets": [
                "(?:显著|有效|全面|积极|持续|进一步|充分|切实|大力)(?:地)?(?:提升|改善|增长|解决|推动|促进|覆盖|推进|升级|探索|参与|优化|深化|加强|完善|发挥|利用|体现|保障|落实)"
            ]
        },
        "action": {"type": "suggest", "message": "改成具体动作 + 可观察结果，说清楚谁做了什么、变化是什么。"}
    },
    {
        "id": "tier2-pseudo-praise",
        "namespace": "modifier",
        "title": "虚化评价副词",
        "level": "low",
        "note": "「可谓 / 堪称 / 追根溯源」是虚化的评价姿态，多数可删或改成直接陈述。",
        "detector": {
            "type": "regex",
            "targets": [
                "可谓|堪称|追根溯源|不失为"
            ]
        },
        "action": {"type": "suggest", "message": "删掉评价姿态，或直接给出事实判断。"}
    }
] satisfies LintRuleRecord[];
