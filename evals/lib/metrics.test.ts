// metrics.ts 数学守门（bun test）。只测度量层，不碰引擎/语料 IO：直接喂合成 SampleScan。
// 关键守门点：docScore 必须走「去重 span」而非「原始命中求和」——故意让两者不相等来证明口径。
import {test, expect} from "bun:test";
import {computeMetrics, computeRepairStat, countPairedGroups} from "./metrics";
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

// ── repair 配对统计（I5：单独统计，不进 lift/AUC）──

/** 合成 repair 场景：render-a（span 10）修出 repair-a（6，改善）、render-b（4）修出 repair-b（8，恶化）、repair-x 孤儿。 */
function repairScans(): SampleScan[] {
    const ren = (file: string, span: number): SampleScan => mkScan({...mkSample("render", "g1", "m-render"), file}, {}, span, 0);
    const rep = (file: string, repairOf: string, span: number): SampleScan => mkScan({...mkSample("repair", "g1", "m-fixer"), file, repairOf}, {}, span, 0);
    return [
        mkScan(mkSample("reference", "g1", undefined), {}, 1, 0),
        ren("render-a.md", 10),
        ren("render-b.md", 4),
        rep("repair-a.md", "render-a.md", 6),
        rep("repair-b.md", "render-b.md", 8),
        rep("repair-x.md", "render-gone.md", 2), // 源 render 不存在 → 孤儿
    ];
}

test("computeRepairStat：docScore before/after 逐对配对 + 孤儿计数", () => {
    const stat = computeRepairStat(repairScans())!;
    expect(stat.total).toBe(2);
    expect(stat.orphans).toBe(1);
    expect(stat.docScoreMedianBefore).toBe(7);  // median(10, 4)
    expect(stat.docScoreMedianAfter).toBe(7);   // median(6, 8)
    expect(stat.docScoreMedianDelta).toBe(0);   // median(-4, +4)
    expect(stat.docScoreImproved).toBe(1);      // 仅 a 对改善
    expect(stat.pairs.find((p) => p.repairFile === "repair-a.md")!.renderModel).toBe("m-render");
    expect(stat.pairs.find((p) => p.repairFile === "repair-a.md")!.repairModel).toBe("m-fixer");
    expect(stat.externalCovered).toBe(0);       // 未给外部查表 → 缺省
    expect(stat.externalMedianBefore).toBeNull();
});

test("computeRepairStat：外部检测器只统计两侧都覆盖的对；无 repair 样本返回 null", () => {
    // 仅 a 对两侧都有分；b 对缺 after 分 → 不进外部口径。key = `${genre}/${plotId}/${file}`（genre 恒 "t"）。
    const ext = new Map([
        ["t/g1/render-a.md", 0.9],
        ["t/g1/repair-a.md", 0.4],
        ["t/g1/render-b.md", 0.8],
    ]);
    const stat = computeRepairStat(repairScans(), ext)!;
    expect(stat.externalCovered).toBe(1);
    expect(stat.externalMedianBefore).toBe(0.9);
    expect(stat.externalMedianAfter).toBe(0.4);
    expect(stat.externalMedianDelta).toBeCloseTo(-0.5, 10);
    expect(stat.externalImproved).toBe(1);
    // docScore 口径不受外部覆盖影响（两对照报）。
    expect(stat.total).toBe(2);
    // 无 repair 样本 → null（report.repair = null）。
    expect(computeRepairStat(repairScans().filter((s) => s.sample.role !== "repair"))).toBeNull();
});

test("repair 样本不进主判别统计（I5）：detector/counts 口径", () => {
    const metrics = computeMetrics(repairScans(), new Map(), 1);
    expect(metrics.detector.aiCount).toBe(2);      // 只有 render 算 AI 类
    expect(metrics.detector.humanCount).toBe(1);
    expect(metrics.counts.repair).toBe(3);         // counts 如实报 repair 数
    expect(metrics.modelRanking.map((r) => r.model)).toEqual(["m-render"]); // 修复模型不进模型榜
});

test("holdout 只切有效 reference/render 配对题组", () => {
    const pair = (plotId: string): SampleScan[] => [
        mkScan({...mkSample("reference", plotId, undefined), file: "reference.md"}, {r1: 0}, 0, 0),
        mkScan({...mkSample("render", plotId, "m"), file: "render.md", pairRef: "reference.md"}, {r1: 2}, 2, 2),
    ];
    const paired = ["a", "b", "c", "d"].flatMap(pair);
    const referenceOnly = ["y", "z"].map((plotId) => (
        mkScan({...mkSample("reference", plotId, undefined), file: "reference.md"}, {r1: 100}, 100, 100)
    ));
    const result = computeMetrics([...paired, ...referenceOnly], ruleMetas, 1, 0.25);

    expect(result.holdout?.trainGroups).toBe(3);
    expect(result.holdout?.testGroups).toBe(1);
    expect(result.holdout?.trainAuc).toBe(1);
    expect(result.holdout?.testAuc).toBe(1);
    // reference-only 题组不进入 train 拟合，否则这里会混入 200 次人类命中。
    expect(result.rules.find((rule) => rule.id === "r1")?.humanHits).toBe(0);
});

test("无效 pairRef 和 reference-only 题组不能解锁 holdout", () => {
    const paired = ["a", "b", "c"].flatMap((plotId): SampleScan[] => [
        mkScan({...mkSample("reference", plotId, undefined), file: "reference.md"}, {r1: 0}, 0, 0),
        mkScan({...mkSample("render", plotId, "m"), file: "render.md", pairRef: "reference.md"}, {r1: 1}, 1, 1),
    ]);
    const dangling = [
        mkScan({...mkSample("reference", "d", undefined), file: "reference.md"}, {r1: 0}, 0, 0),
        mkScan({...mkSample("render", "d", "m"), file: "render.md", pairRef: "missing.md"}, {r1: 1}, 1, 1),
        mkScan({...mkSample("reference", "e", undefined), file: "reference.md"}, {r1: 0}, 0, 0),
    ];
    const all = [...paired, ...dangling];

    expect(countPairedGroups(all)).toBe(3);
    expect(computeMetrics(all, ruleMetas, 1, 0.25).holdout).toBeNull();
});

