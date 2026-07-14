import type {OverlapStat} from "./types";

export type OverlapHit = {ruleId: string; spanKey: string};

const OVERLAP_PAIR_LIMIT = 100;

/**
 * 统计规则同 span 重叠：rawHits 保留原始命中，uniqueSpans 按文档内 span 去重，
 * pairs 用双方命中中落入同一 span 的比例定位近重复 detector。
 */
export function computeOverlapStat(documents: OverlapHit[][]): OverlapStat {
    let rawHits = 0;
    let uniqueSpans = 0;
    const ruleHits = new Map<string, number>();
    const overlappedHits = new Map<string, number>();
    const pairHits = new Map<string, number>();

    for (const hits of documents) {
        rawHits += hits.length;
        const bySpan = new Map<string, Set<string>>();
        for (const hit of hits) {
            ruleHits.set(hit.ruleId, (ruleHits.get(hit.ruleId) ?? 0) + 1);
            const rules = bySpan.get(hit.spanKey) ?? new Set<string>();
            rules.add(hit.ruleId);
            bySpan.set(hit.spanKey, rules);
        }
        uniqueSpans += bySpan.size;
        for (const ruleSet of bySpan.values()) {
            const rules = [...ruleSet].sort((left, right) => left.localeCompare(right));
            if (rules.length < 2) {
                continue;
            }
            for (const ruleId of rules) {
                overlappedHits.set(ruleId, (overlappedHits.get(ruleId) ?? 0) + 1);
            }
            for (let leftIndex = 0; leftIndex < rules.length; leftIndex++) {
                for (let rightIndex = leftIndex + 1; rightIndex < rules.length; rightIndex++) {
                    const leftRuleId = rules[leftIndex]!;
                    const rightRuleId = rules[rightIndex]!;
                    const key = `${leftRuleId}\u0000${rightRuleId}`;
                    pairHits.set(key, (pairHits.get(key) ?? 0) + 1);
                }
            }
        }
    }

    const pairs = [...pairHits.entries()]
        .map(([key, sameSpanHits]) => {
            const [leftRuleId, rightRuleId] = key.split("\u0000") as [string, string];
            return {
                leftRuleId,
                rightRuleId,
                sameSpanHits,
                leftOverlapRate: ratio(overlappedHits.get(leftRuleId) ?? 0, ruleHits.get(leftRuleId) ?? 0),
                rightOverlapRate: ratio(overlappedHits.get(rightRuleId) ?? 0, ruleHits.get(rightRuleId) ?? 0),
            };
        })
        .sort((left, right) => right.sameSpanHits - left.sameSpanHits
            || left.leftRuleId.localeCompare(right.leftRuleId)
            || left.rightRuleId.localeCompare(right.rightRuleId))
        .slice(0, OVERLAP_PAIR_LIMIT);

    return {
        rawHits,
        uniqueSpans,
        duplicateRate: rawHits > 0 ? 1 - uniqueSpans / rawHits : 0,
        pairs,
    };
}

/** 分母为零时返回 0，避免空规则产生 NaN。 */
function ratio(numerator: number, denominator: number): number {
    return denominator > 0 ? numerator / denominator : 0;
}
