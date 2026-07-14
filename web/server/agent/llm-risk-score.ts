import type {LlmRuleHit} from "../../shared/agent-harness";

/** LLM 语义规则命中 → 0–100 AI 痕迹风险；模型不再自由打分。 */
export function llmRiskScore(body: string, hits: LlmRuleHit[], levels: ReadonlyMap<string, "high" | "medium" | "low">): number {
    const unique = new Map<string, LlmRuleHit>();
    for (const hit of hits) unique.set(`${hit.ruleId}:${hit.span?.start ?? hit.quote}:${hit.span?.end ?? ""}`, hit);
    const weights = {high: 1.4, medium: 1, low: 0.7} as const;
    const weightedHits = [...unique.values()].reduce((sum, hit) => sum + weights[levels.get(hit.ruleId) ?? "medium"], 0);
    const visibleChars = [...body.replace(/\s/gu, "")].length;
    const perThousand = weightedHits / Math.max(0.5, visibleChars / 1000);
    return Math.round(100 * (1 - Math.exp(-perThousand / 3)));
}
