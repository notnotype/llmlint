// gates.ts 闸门谓词守门（bun test）：D1/I5 的代码化断言，防后续消费点绕过闸门或改错口径。
// 除真值表外，还守 metrics 接线：往 computeMetrics 塞 repair 扫描，判别指标必须逐位不变。
import {test, expect} from "bun:test";
import {liftAdmissibleOrigin, liftAdmissibleRole} from "./gates";
import {computeMetrics} from "./metrics";
import type {RuleMeta} from "./scan";
import type {Sample, SampleScan} from "./types";

test("corpus 口径：reference/render 进 lift，repair 永不进（I5/D1）", () => {
    expect(liftAdmissibleRole("reference")).toBe(true);
    expect(liftAdmissibleRole("render")).toBe(true);
    expect(liftAdmissibleRole("repair")).toBe(false);
});

test("统一模型口径：originKind ∈ {curated, generated} 且 rev0 才进 lift", () => {
    expect(liftAdmissibleOrigin({originKind: "curated", ordinal: 0})).toBe(true);
    expect(liftAdmissibleOrigin({originKind: "generated", ordinal: 0})).toBe(true);
    // D1：uploaded 自述不可信，即使 rev0 也不进。
    expect(liftAdmissibleOrigin({originKind: "uploaded", ordinal: 0})).toBe(false);
    // revision 维度：rev_k(k≥1) 是改写后继（≙ corpus repair），不进 lift。
    expect(liftAdmissibleOrigin({originKind: "curated", ordinal: 1})).toBe(false);
    expect(liftAdmissibleOrigin({originKind: "generated", ordinal: 2})).toBe(false);
    expect(liftAdmissibleOrigin({originKind: "uploaded", ordinal: 1})).toBe(false);
});

// —— metrics 接线守门：repair 扫描进入 computeMetrics 不得影响任何判别指标 ——

function mkScan(role: Sample["role"], plotId: string, rawHits: Record<string, number>, dedupSpanCount: number): SampleScan {
    const sample: Sample = {role, genre: "t", plotId, file: `${role}-x.md`, absPath: "x.md", text: "", charCount: 1000};
    return {sample, rawHitsByRule: new Map(Object.entries(rawHits)), dedupSpanCount, agentRawHits: 0};
}

test("metrics 接线：塞入 repair 扫描，lift/AUC/排名逐位不变（只有 counts.repair 变）", () => {
    const ruleMetas = new Map<string, RuleMeta>([["r1", {id: "r1", namespace: "ns", review: "human", level: "medium"}]]);
    const base: SampleScan[] = [
        mkScan("reference", "g1", {r1: 1}, 1),
        mkScan("reference", "g1", {r1: 0}, 0),
        mkScan("render", "g1", {r1: 4}, 4),
        mkScan("render", "g1", {r1: 5}, 5),
    ];
    // repair 命中故意拉满：若泄漏进判别，docScore 中位 / lift / AUC 必然改变。
    const withRepair = [...base, mkScan("repair", "g1", {r1: 99}, 99)];

    const clean = computeMetrics(base, ruleMetas, 1);
    const gated = computeMetrics(withRepair, ruleMetas, 1);

    expect(gated.detector).toEqual(clean.detector);
    expect(gated.rules).toEqual(clean.rules);
    expect(gated.modelRanking).toEqual(clean.modelRanking);
    expect(gated.counts.repair).toBe(1);
    expect(clean.counts.repair).toBe(0);
});
