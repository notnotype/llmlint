import {expect, test} from "bun:test";
import {computeOverlapStat} from "./overlap";

test("overlap：统计原始命中、唯一 span、重复率与规则对覆盖率", () => {
    const stat = computeOverlapStat([
        [
            {ruleId: "a", spanKey: "0:1"},
            {ruleId: "b", spanKey: "0:1"},
            {ruleId: "a", spanKey: "4:5"},
        ],
        [
            {ruleId: "a", spanKey: "0:1"},
            {ruleId: "b", spanKey: "0:1"},
            {ruleId: "c", spanKey: "2:3"},
        ],
    ]);

    expect(stat.rawHits).toBe(6);
    expect(stat.uniqueSpans).toBe(4);
    expect(stat.duplicateRate).toBeCloseTo(1 - 4 / 6);
    expect(stat.pairs[0]).toEqual({
        leftRuleId: "a",
        rightRuleId: "b",
        sameSpanHits: 2,
        leftOverlapRate: 2 / 3,
        rightOverlapRate: 1,
    });
});

test("overlap：同一规则同 span 重复不制造自配对", () => {
    const stat = computeOverlapStat([[
        {ruleId: "a", spanKey: "0:1"},
        {ruleId: "a", spanKey: "0:1"},
    ]]);

    expect(stat.rawHits).toBe(2);
    expect(stat.uniqueSpans).toBe(1);
    expect(stat.pairs).toEqual([]);
});
