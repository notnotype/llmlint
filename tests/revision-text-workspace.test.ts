import {describe, expect, it} from "vitest";
import registryData from "../web/app/data/registry.json";
import {RevisionTextWorkspace, type RevisionTextSource} from "../web/server/agent/neuro-agent-harness/revision-text-workspace";

describe("RevisionTextWorkspace", () => {
    it("默认读取当前工作副本，历史版本只读", async () => {
        const source = fakeSource();
        const workspace = new RevisionTextWorkspace({
            current: {revisionId: "r2", ordinal: 2, body: "第一行\n当前正文"},
            source,
        });

        expect((await workspace.read({lineNumbers: true})).content).toBe("1 | 第一行\n2 | 当前正文");
        expect((await workspace.read({revision: {ordinal: 1}, lineNumbers: true})).content).toBe("1 | 历史正文");
        await expect(workspace.edit({revision: {ordinal: 1}, edits: [{oldText: "历史", newText: "修改"}]})).rejects.toThrow("历史 Revision 只读");
    });

    it("批量 edit 基于同一快照匹配并只修改工作副本", async () => {
        const source = fakeSource();
        const workspace = new RevisionTextWorkspace({
            current: {revisionId: "r2", ordinal: 2, body: "甲很空泛。\n乙也很空泛。"},
            source,
        });

        const result = await workspace.edit({edits: [
            {oldText: "甲很空泛", newText: "甲推开窗"},
            {oldText: "乙也很空泛", newText: "乙收起信"},
        ]});

        expect(result.body).toBe("甲推开窗。\n乙收起信。");
        expect(result.firstChangedLine).toBe(1);
        expect(result.diff).toContain("-甲很空泛。");
        expect(source.savedBodies).toEqual([]);
    });

    it("拒绝重复命中与重叠替换", async () => {
        const workspace = new RevisionTextWorkspace({
            current: {revisionId: "r2", ordinal: 2, body: "重复，重复"},
            source: fakeSource(),
        });

        await expect(workspace.edit({edits: [{oldText: "重复", newText: "唯一"}]})).rejects.toThrow("命中 2 处");
        await expect(new RevisionTextWorkspace({
            current: {revisionId: "r2", ordinal: 2, body: "abcdef"},
            source: fakeSource(),
        }).edit({edits: [
            {oldText: "abcd", newText: "x"},
            {oldText: "cdef", newText: "y"},
        ]})).rejects.toThrow("互相重叠");
    });

    it("允许精确删除，并限制选区编辑范围", async () => {
        const workspace = new RevisionTextWorkspace({
            current: {revisionId: "r2", ordinal: 2, body: "保留【删除】结尾"},
            source: fakeSource(),
            selection: {from: 2, to: 6},
        });

        expect((await workspace.edit({edits: [{oldText: "【删除】", newText: ""}]})).body).toBe("保留结尾");
        await expect(workspace.edit({edits: [{oldText: "结尾", newText: "结束"}]})).rejects.toThrow("超出本次选区范围");
    });

    it("返回 CLI 同构带行号报告，并只应用 auto 机械修复", async () => {
        const workspace = new RevisionTextWorkspace({
            current: {revisionId: "r2", ordinal: 2, body: "第一行正常。\n这里！！重复，尾巴……...。"},
            source: fakeSource(),
        });

        const checked = await workspace.lintCheck({review: "all", showLines: true});
        expect(checked.report).toContain("2:");
        expect(checked.report).toContain("cn.punctuation.dedup.repeated-symbols");
        expect(checked.issues.find((issue) => issue.rule.id === "cn.punctuation.dedup.repeated-symbols"))
            .toMatchObject({line: 2, match: "！！", rule: {review: "human", fixability: "manual"}});

        const fixed = await workspace.lintFix();
        expect(fixed.body).toBe("第一行正常。\n这里！！重复，尾巴……。");
        expect(fixed.changes).toMatchObject([{ruleId: "cn.punctuation.dedup.ellipsis-dash-tail"}]);
    });

    it("lint_check 将强判别和 AI 敏感词标为必修，弱判别留给语境判断", async () => {
        const body = "不是因为天气，而是因为心情。\n他笑了一声。\n他的脊柱发紧。";
        const workspace = new RevisionTextWorkspace({current: {revisionId: "r2", ordinal: 2, body}, source: fakeSource()});

        const checked = await workspace.lintCheck({review: "all", showLines: true});

        expect(checked.report).toContain("story-deslop.not-is-comparison");
        expect(checked.issues.find((issue) => issue.rule.id === "story-deslop.not-is-comparison")?.repairPolicy)
            .toEqual({required: true, reason: "strong", verdict: null, effectiveLift: null});
        expect(checked.issues.find((issue) => issue.rule.id === "cn.sound.once.laugh-one-sound")?.repairPolicy)
            .toEqual({required: false, reason: "weak", verdict: "weak", effectiveLift: expect.any(Number)});
        expect(checked.issues.find((issue) => issue.rule.id === "cn.vocabulary.body.spine-column")?.repairPolicy)
            .toEqual({required: true, reason: "sensitive_vocabulary", verdict: "insufficient", effectiveLift: expect.any(Number)});
    });

    it("评测报告缺失时降级为上下文判断，AI 敏感词仍保持必修", async () => {
        const verdicts = registryData.ruleVerdicts;
        Reflect.deleteProperty(registryData, "ruleVerdicts");
        try {
            const body = "不是因为天气，而是因为心情。\n他的脊柱发紧。";
            const workspace = new RevisionTextWorkspace({current: {revisionId: "r2", ordinal: 2, body}, source: fakeSource()});

            const checked = await workspace.lintCheck({review: "all", showLines: true});

            expect(checked.issues.find((issue) => issue.rule.id === "story-deslop.not-is-comparison")?.repairPolicy)
                .toEqual({required: true, reason: "strong", verdict: null, effectiveLift: null});
            expect(checked.issues.find((issue) => issue.rule.id === "cn.vocabulary.body.spine-column")?.repairPolicy)
                .toEqual({required: true, reason: "sensitive_vocabulary", verdict: null, effectiveLift: null});
        } finally {
            Reflect.set(registryData, "ruleVerdicts", verdicts);
        }
    });

    it("lint_check 截断时明确报告总命中、展示数和省略数", async () => {
        const body = Array.from({length: 60}, (_, index) => `第${index + 1}行！！`).join("\n");
        const workspace = new RevisionTextWorkspace({current: {revisionId: "r2", ordinal: 2, body}, source: fakeSource()});

        const result = await workspace.lintCheck({review: "all", showLines: true});

        expect(result.issues).toHaveLength(50);
        expect(result.truncated).toBe(true);
        expect(result.report).toContain("总命中 61 条，当前展示 50 条，省略 11 条");
    });

    it("逐检测器返回原始热力图行号，并标记脏工作副本结果过期", async () => {
        const source = fakeSource();
        source.detections = async () => detectionRecords([{
            detectorName: "detector-a", detectorVersion: "v1", chunkChars: 100, docPAi: 0.7, maxPAi: 0.9, checkedAt: "now",
            chunks: [{span: {start: 3, end: 8}, pAi: 0.9}],
        }, {detectorName: "detector-b", detectorVersion: "v2", chunkChars: 100, docPAi: 0.4, maxPAi: null, checkedAt: "now", chunks: []}]);
        const workspace = new RevisionTextWorkspace({
            current: {revisionId: "r2", ordinal: 2, body: "甲乙\n丙丁戊\n己"},
            source,
        });
        await workspace.edit({edits: [{oldText: "甲乙", newText: "甲"}]});

        const heatmap = await workspace.revisionDetections();

        expect(heatmap.stale).toBe(true);
        expect(heatmap.detectors).toHaveLength(2);
        expect(heatmap.detectors[0]?.chunks[0]).toMatchObject({startLine: 2, endLine: 3, pAi: 0.9});
    });

    it("统一返回指定 Revision 的 regex、LLM 与 AIGC 持久化记录", async () => {
        const source = fakeSource();
        source.detections = async () => ({
            status: {scan: "completed", llmReview: "completed", detectors: "completed"},
            scan: {engineVersion: "engine-v1", docScore: 2.5, scannedAt: "now", hits: [{ruleId: "not-but-structure", span: {start: 3, end: 5}, level: "high", review: "agent"}]},
            llmReview: {model: "test/model", promptVersion: "v1", score: 20, confidence: 0.8, hits: [], report: {score: 20, confidence: 0.8, conclusion: "有一处风险", evidence: [], suggestions: []}, judgedAt: "now"},
            detectors: [{detectorName: "detector", detectorVersion: "v1", chunkChars: 100, docPAi: 0.5, maxPAi: 0.6, checkedAt: "now", chunks: []}],
        });
        const workspace = new RevisionTextWorkspace({current: {revisionId: "r2", ordinal: 2, body: "甲乙\n丙丁"}, source});

        const result = await workspace.revisionDetections();

        expect(result.status).toEqual({scan: "completed", llmReview: "completed", detectors: "completed"});
        expect(result.scan?.hits[0]).toMatchObject({ruleId: "not-but-structure", startLine: 2, endLine: 2, repairPolicy: {required: true, reason: "strong", verdict: "strong"}});
        expect(result.llmReview).toMatchObject({model: "test/model", score: 20});
        expect(result.detectors[0]).toMatchObject({detectorName: "detector", chunkChars: 100});
    });

    it("检测记录访问拒绝会原样向工具层传播", async () => {
        const source = fakeSource();
        source.detections = async () => { throw new Error("Revision 检测记录尚未揭示"); };
        const workspace = new RevisionTextWorkspace({current: {revisionId: "r2", ordinal: 2, body: "正文"}, source});

        await expect(workspace.revisionDetections()).rejects.toThrow("尚未揭示");
    });

    it("未提交草稿与基底 Revision 不同时，热力图从 invocation 开始即标记过期", async () => {
        const source = fakeSource();
        source.detections = async () => detectionRecords([{detectorName: "detector", detectorVersion: "v1", chunkChars: 100, docPAi: 0.5, maxPAi: 0.5, checkedAt: "now", chunks: []}]);
        const workspace = new RevisionTextWorkspace({
            current: {revisionId: "r2", ordinal: 2, body: "已提交正文"},
            workingBody: "尚未提交的草稿",
            source,
        });

        expect((await workspace.revisionDetections()).stale).toBe(true);
        expect((await workspace.read()).content).toBe("尚未提交的草稿");
    });

    it("多个检测器共享热力图总 chunk 预算", async () => {
        const source = fakeSource();
        source.detections = async () => detectionRecords(Array.from({length: 3}, (_, detectorIndex) => ({
            detectorName: `detector-${detectorIndex}`,
            detectorVersion: "v1",
            chunkChars: 100,
            docPAi: 0.5,
            maxPAi: 0.5,
            checkedAt: "now",
            chunks: Array.from({length: 300}, (_, index) => ({span: {start: 0, end: 1}, pAi: index / 300})),
        })));
        const workspace = new RevisionTextWorkspace({current: {revisionId: "r2", ordinal: 2, body: "正文"}, source});

        const result = await workspace.revisionDetections();

        expect(result.detectors.flatMap((detector) => detector.chunks)).toHaveLength(500);
        expect(result.chunksOmitted).toBe(400);
        expect(result.detectors.reduce((sum, detector) => sum + detector.chunksOmitted, 0)).toBe(400);
    });

    it("单个超长行也遵守 read 字节预算，并可从字符游标续读", async () => {
        const body = "甲".repeat(70_000);
        const workspace = new RevisionTextWorkspace({current: {revisionId: "r2", ordinal: 2, body}, source: fakeSource()});

        const first = await workspace.read({lineNumbers: true});
        expect(Buffer.byteLength(first.content, "utf-8")).toBeLessThanOrEqual(64 * 1024);
        expect(first.truncated).toBe(true);
        expect(first.nextOffset).toBe(1);
        expect(first.nextCharacterOffset).toBeGreaterThan(0);
        expect(first.coverage).toEqual([{line: 1, start: 0, end: first.nextCharacterOffset}]);

        const second = await workspace.read({offset: first.nextOffset, characterOffset: first.nextCharacterOffset, lineNumbers: true});
        expect(second.nextCharacterOffset ?? body.length).toBeGreaterThan(first.nextCharacterOffset ?? 0);
        expect(second.startLine).toBe(1);
        expect(second.coverage[0]).toMatchObject({line: 1, start: first.nextCharacterOffset});
    }, 15000);

    it("read coverage 使用逐行 UTF-16 区间并记录空行", async () => {
        const body = "甲😀\r\n\n乙";
        const workspace = new RevisionTextWorkspace({current: {revisionId: "r2", ordinal: 2, body}, source: fakeSource()});

        const first = await workspace.read({offset: 1, limit: 2, lineNumbers: true});
        const last = await workspace.read({offset: 3, limit: 1, lineNumbers: true});

        expect(first.coverage).toEqual([
            {line: 1, start: 0, end: 4},
            {line: 2, start: 0, end: 0},
        ]);
        expect(last.coverage).toEqual([{line: 3, start: 0, end: 1}]);
    });
});

function fakeSource(): RevisionTextSource & {savedBodies: string[]} {
    return {
        savedBodies: [],
        async current() {
            return {revisionId: "r2", ordinal: 2, body: "当前正文"};
        },
        async revision(selector) {
            if ("ordinal" in selector && selector.ordinal === 1) return {revisionId: "r1", ordinal: 1, body: "历史正文"};
            if ("revisionId" in selector && selector.revisionId === "r1") return {revisionId: "r1", ordinal: 1, body: "历史正文"};
            throw new Error("Revision 不属于当前 Text");
        },
        async detections() {
            return detectionRecords([]);
        },
    };
}

function detectionRecords(detectors: Awaited<ReturnType<RevisionTextSource["detections"]>>["detectors"]): Awaited<ReturnType<RevisionTextSource["detections"]>> {
    return {
        status: {scan: "waiting", llmReview: "waiting", detectors: detectors.length > 0 ? "completed" : "waiting"},
        scan: null,
        llmReview: null,
        detectors,
    };
}
