import {describe, expect, it} from "vitest";
import {hydrateWorkspace, summarizeScanHits, type ScanHitsMeta, type ServerDetect, type ServerScan, type ServerScanHit, type WorkspaceJudgmentPayload, type WorkspacePayload, type WorkspaceRevisionPayload} from "../web/app/utils/contribute-workspace";

// hydrateWorkspace 是「历史恢复」的纯映射核心（Task 15 P1-C）：把工作台恢复端点的全量 payload
// 重建为前端流程状态。关键断言：D2 未揭示不带机器数据、盲评/复评判定分流（rev0 blind → 盲评
// 基线；rev_k 非盲四维齐全 → 该版 judgment）、editDraft=head 正文、防御分支不冒充已提交。

/** 造一个最小 scan（内容不参与映射断言，仅透传）。 */
function makeScan(id: string): ServerScan {
    return {id, engineVersion: "2.0.0+test", hits: [], docScore: 1.5, scannedAt: "2026-07-09T00:00:00.000Z"};
}

/** 造一行检测结果（chunks 透传给热力图层）。 */
function makeDetect(id: string): ServerDetect {
    return {id, detectorName: "hf-test", detectorVersion: "v1", chunkChars: 400, docPAi: 0.8, maxPAi: 0.9, chunks: [{span: {start: 0, end: 4}, pAi: 0.8}], checkedAt: "2026-07-09T00:00:10.000Z"};
}

/** 造一个 revision payload（默认已揭示）。 */
function makeRevision(overrides: Partial<WorkspaceRevisionPayload> & Pick<WorkspaceRevisionPayload, "revisionId" | "ordinal">): WorkspaceRevisionPayload {
    return {
        body: `body-${overrides.ordinal}`,
        transitionKind: overrides.ordinal === 0 ? "upload" : "user_fix",
        revealedAt: "2026-07-09T00:00:01.000Z",
        scan: makeScan(`scan-${overrides.ordinal}`),
        detects: [],
        llmReview: null,
        ...overrides,
        analysis: overrides.analysis ?? null,
    };
}

/** 组装完整 payload。 */
function makePayload(revisions: WorkspaceRevisionPayload[], myJudgments: WorkspaceJudgmentPayload[] = [], annotationCount = 0): WorkspacePayload {
    return {
        text: {textId: "text-1"},
        revisions,
        myJudgments,
        annotations: Array.from({length: annotationCount}, (_, index) => ({id: `ann-${index}`, revisionId: revisions[0]?.revisionId ?? "r0"})),
    };
}

describe("hydrateWorkspace", () => {
    it("未揭示的 rev0：revealed=false、无盲评基线、草稿=rev0 正文", () => {
        const payload = makePayload([makeRevision({revisionId: "r0", ordinal: 0, revealedAt: null, scan: null})]);
        const hydrated = hydrateWorkspace(payload);
        expect(hydrated.revealed).toBe(false);
        expect(hydrated.submittedScores).toBeNull();
        expect(hydrated.editDraft).toBe("body-0");
        expect(hydrated.activeOrdinal).toBe(0);
        expect(hydrated.revisions[0]?.scan).toBeNull();
        expect(hydrated.revisions[0]?.detectState).toBe("idle");
    });

    it("完整谱系：盲评→submittedScores、rev_k 非盲四维→judgment、head 成为草稿基底", () => {
        const payload = makePayload(
            [
                makeRevision({revisionId: "r0", ordinal: 0, detects: [makeDetect("d0")]}),
                makeRevision({revisionId: "r1", ordinal: 1, transitionKind: "llm_fix", detects: [makeDetect("d1")]}),
            ],
            [
                {revisionId: "r0", aiFlavor: 4, wantReadOn: 2, improvementScore: null, comment: null, blind: true},
                {revisionId: "r1", aiFlavor: 2, wantReadOn: 3, improvementScore: 4, comment: "更顺了", blind: false},
            ],
            3,
        );
        const hydrated = hydrateWorkspace(payload);
        expect(hydrated.revealed).toBe(true);
        expect(hydrated.submittedScores).toEqual({aiFlavor: 4, wantReadOn: 2});
        expect(hydrated.revisions[0]?.judgment).toBeNull(); // rev0 两轴走盲评通道，不进复评表单
        expect(hydrated.revisions[1]?.judgment).toEqual({aiFlavor: 2, wantReadOn: 3, improvementScore: 4, comment: "更顺了"});
        expect(hydrated.editDraft).toBe("body-1");
        expect(hydrated.activeOrdinal).toBe(1);
        expect(hydrated.annotationCount).toBe(3);
        // 机器断言原样透传（scan/detects 即落库真相）
        expect(hydrated.revisions[1]?.scan?.id).toBe("scan-1");
        expect(hydrated.revisions[1]?.detects[0]?.chunks).toHaveLength(1);
    });

    it("防御：跳过盲评 / rev_k 判定四维不全（无 improvementScore）均按未提交处理", () => {
        const payload = makePayload(
            [
                makeRevision({revisionId: "r0", ordinal: 0}),
                makeRevision({revisionId: "r1", ordinal: 1}),
            ],
            [
                // rev_k 判定缺 improvementScore（脏数据）→ 不冒充已复评
                {revisionId: "r1", aiFlavor: 2, wantReadOn: 3, improvementScore: null, comment: null, blind: false},
            ],
        );
        const hydrated = hydrateWorkspace(payload);
        expect(hydrated.submittedScores).toBeNull();
        expect(hydrated.revisions[1]?.judgment).toBeNull();
    });
});

// summarizeScanHits 是报告 tab 汇总卡（Task 16 R8）的统计核心：逐 hit join 规则元数据。
// 关键断言：分级计数、strong join、autoFixable 判据、hidden 判据（∈catalog 且 ∉active）、
// 未知 ruleId 兜底（历史数据规则已删：只进 total，不算隐藏/强判别）、报告缺失 strongHits=null。

/** 造一条服务器 hit（span 不参与统计断言）。 */
function makeHit(ruleId: string, level: string): ServerScanHit {
    return {ruleId, span: {start: 0, end: 1}, level, review: "agent"};
}

/** 基准元数据：目录 a/b/c 三规则，b 可自动修复，c 被用户隐藏，a 强判别。 */
function makeMeta(overrides: Partial<ScanHitsMeta> = {}): ScanHitsMeta {
    return {
        verdicts: {"rule-a": {verdict: "strong"}, "rule-b": {verdict: "weak"}},
        autoRuleIds: new Set(["rule-b"]),
        activeRuleIds: new Set(["rule-a", "rule-b"]),
        catalogRuleIds: new Set(["rule-a", "rule-b", "rule-c"]),
        ...overrides,
    };
}

describe("summarizeScanHits", () => {
    it("分级计数 + strong/autoFixable/hidden 三路 join", () => {
        const hits = [
            makeHit("rule-a", "high"),
            makeHit("rule-a", "high"),
            makeHit("rule-b", "medium"),
            makeHit("rule-c", "low"),
        ];
        const summary = summarizeScanHits(hits, makeMeta());
        expect(summary.total).toBe(4);
        expect(summary.byLevel).toEqual({high: 2, medium: 1, low: 1});
        expect(summary.strongHits).toBe(2);
        expect(summary.autoFixableHits).toBe(1);
        expect(summary.hiddenHits).toBe(1); // rule-c ∈catalog 且 ∉active = 用户隐藏
    });

    it("未知 ruleId（规则已删的历史数据）：进 total/byLevel，不算隐藏也不算强判别", () => {
        const summary = summarizeScanHits([makeHit("rule-gone", "high")], makeMeta());
        expect(summary.total).toBe(1);
        expect(summary.byLevel.high).toBe(1);
        expect(summary.strongHits).toBe(0);
        expect(summary.hiddenHits).toBe(0);
    });

    it("报告缺失（verdicts 未烘焙）：strongHits=null，其余统计照常", () => {
        const summary = summarizeScanHits([makeHit("rule-a", "high"), makeHit("rule-b", "low")], makeMeta({verdicts: undefined}));
        expect(summary.strongHits).toBeNull();
        expect(summary.autoFixableHits).toBe(1);
        expect(summary.total).toBe(2);
    });

    it("未知 level：计入 total 但不进任何分级桶；空 hits 全零", () => {
        const summary = summarizeScanHits([makeHit("rule-a", "weird")], makeMeta());
        expect(summary.total).toBe(1);
        expect(summary.byLevel).toEqual({high: 0, medium: 0, low: 0});
        expect(summarizeScanHits([], makeMeta()).total).toBe(0);
    });
});
