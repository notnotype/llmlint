// metrics.ts 数学守门（bun test）。只测度量层，不碰引擎/语料 IO：直接喂合成 SampleScan。
// 关键守门点：docScore 必须走「去重 span」而非「原始命中求和」——故意让两者不相等来证明口径。
import {test, expect} from "bun:test";
import {computeMetrics} from "./metrics";
import type {RuleMeta} from "./scan";
import type {Sample, SampleScan} from "./types";

// charCount 统一 1000，使 fireRate=命中数、docScore=dedupSpanCount，便于手算。
function mkSample(role: Sample["role"], plotId: string, model: string | undefined): Sample {
    return {role, genre: "t", plotId, model, file: "x.md", absPath: "x.md", text: "", charCount: 1000};
}

function mkScan(sample: Sample, rawHits: Record<string, number>, dedupSpanCount: number, agentRawHits: number): SampleScan {
    return {sample, rawHitsByRule: new Map(Object.entries(rawHits)), dedupSpanCount, agentRawHits};
}

// r1=agent 桶、r2=human 桶。
const ruleMetas = new Map<string, RuleMeta>([
    ["r1", {id: "r1", namespace: "ns", review: "agent", level: "high"}],
    ["r2", {id: "r2", namespace: "ns", review: "human", level: "medium"}],
]);

// 2 human + 2 AI。dedupSpanCount 故意 ≠ 原始命中求和（a1 raw=5/span=4，a2 raw=7/span=5）。
const scans: SampleScan[] = [
    mkScan(mkSample("reference", "g1", undefined), {r1: 0, r2: 1}, 1, 0),
    mkScan(mkSample("reference", "g1", undefined), {r1: 1, r2: 0}, 1, 1),
    mkScan(mkSample("render", "g1", "m-low"), {r1: 3, r2: 2}, 4, 3),
    mkScan(mkSample("render", "g1", "m-high"), {r1: 4, r2: 3}, 5, 4),
];

const metrics = computeMetrics(scans, ruleMetas, 1);
const ruleOf = (id: string) => metrics.rules.find((rule) => rule.id === id)!;

test("docScore 走去重 span 而非原始命中求和", () => {
    // 人类 span=[1,1]→中位 1；AI span=[4,5]→中位 4.5。若误用 raw 求和，AI 中位会是 6。
    expect(metrics.detector.humanMedianScore).toBe(1);
    expect(metrics.detector.aiMedianScore).toBe(4.5);
});

test("AUC 清晰分离时为 1", () => {
    // AI docScore [4,5] 全大于人类 [1,1]。
    expect(metrics.detector.auc).toBe(1);
});

test("per-rule lift 仍用原始命中", () => {
    // r1：人类率中位 median(0,1)=0.5，AI 率中位 median(3,4)=3.5 → (3.5+.5)/(0.5+.5)=4。
    expect(ruleOf("r1").lift).toBe(4);
    expect(ruleOf("r1").verdict).toBe("strong");
    // r2：人类 median(1,0)=0.5，AI median(2,3)=2.5 → (2.5+.5)/(0.5+.5)=3。
    expect(ruleOf("r2").lift).toBe(3);
});

test("误杀率 = 人类侧 agent 桶命中率中位", () => {
    // 人类 agentRawHits=[0,1]→中位 0.5；AI=[3,4]→中位 3.5。
    expect(metrics.detector.humanAgentFalseRate).toBe(0.5);
    expect(metrics.detector.aiAgentRate).toBe(3.5);
});

test("模型排名按 docScore 中位升序（越低越像人）", () => {
    expect(metrics.modelRanking[0]!.model).toBe("m-low"); // span 4 < 5
    expect(metrics.modelRanking[1]!.model).toBe("m-high");
});

test("稀疏但 AI-only 的规则靠 prevalence 浮现（problem 2）", () => {
    const meta = new Map<string, RuleMeta>([["sparse", {id: "sparse", namespace: "ns", review: "agent", level: "high"}]]);
    // 5 human 全 0；5 AI 里 2 篇各命中 1 次（40%），3 篇 0 → 中位率两侧都是 0，但命中占比 40% vs 0%。
    const sparse: SampleScan[] = [
        ...Array.from({length: 5}, () => mkScan(mkSample("reference", "g1", undefined), {sparse: 0}, 0, 0)),
        mkScan(mkSample("render", "g1", "m"), {sparse: 1}, 1, 0),
        mkScan(mkSample("render", "g1", "m"), {sparse: 1}, 1, 0),
        ...Array.from({length: 3}, () => mkScan(mkSample("render", "g1", "m"), {sparse: 0}, 0, 0)),
    ];
    const rule = computeMetrics(sparse, meta, 1).rules.find((r) => r.id === "sparse")!;
    expect(rule.lift).toBeCloseTo(1, 5);           // rate 口径：中位 0/0 → ≈1（会误判 noise）
    expect(rule.prevalenceLift).toBeCloseTo(5, 5); // (0.4+0.1)/(0+0.1)=5
    expect(rule.verdict).toBe("strong");           // 取较强桶 → 稀疏 AI-only 不再被埋没
});

test("pairRef 逐章 1:1 配对计数", () => {
    const meta = new Map<string, RuleMeta>([["r", {id: "r", namespace: "ns", review: "agent", level: "high"}]]);
    const ref = (file: string, hits: number): SampleScan => mkScan({...mkSample("reference", "g1", undefined), file}, {r: hits}, hits, 0);
    const ren = (pairRef: string, hits: number): SampleScan => mkScan({...mkSample("render", "g1", "m"), file: `render-${pairRef}`, pairRef}, {r: hits}, hits, 0);
    // 两章：A 章 ref 率2 配 render 率5（AI 高）；B 章 ref 率4 配 render 率1（AI 低）。
    const paired = [ref("a.md", 2), ref("b.md", 4), ren("a.md", 5), ren("b.md", 1)];
    const rule = computeMetrics(paired, meta, 1).rules.find((r) => r.id === "r")!;
    expect(rule.pairsTotal).toBe(2);     // 逐章两对（非题组级一对）
    expect(rule.pairsAiGreater).toBe(1); // 仅 A 章 AI>人类
});

