import {describe, expect, it} from "vitest";
import {assignIssuesToChunks, buildReport} from "../skill/src/report";
import type {CheckJsonReport, CompactDensityIssue, CompactIssue} from "../skill/src/types";
import type {ReportDetectFile, ReportDetectJson} from "../skill/src/report";

/** 构造最小可用的紧凑 check JSON；只填 buildReport 会读到的字段。 */
function checkJson(overrides: Partial<CheckJsonReport> = {}): CheckJsonReport {
    return {
        kind: "check",
        filePath: "chapter.md",
        configPath: null,
        summary: {total: 0, high: 0, medium: 0, low: 0, visibleChars: 1200},
        filter: {review: "all", minLevel: "low", hiddenByReview: 0, hiddenByLevel: 0},
        registry: {rulesets: ["builtin/default"], totalRules: 360, activeRules: 266, disabledRules: 94},
        diagnostics: [],
        rules: {
            "test.not-compare": {
                namespace: "test",
                title: "不是A，是B",
                level: "high",
                review: "agent",
                fixability: "manual",
                scope: {layer: "all"},
                action: {type: "replace", replacements: [""]},
            },
            "test.fragment": {
                namespace: "test",
                title: "碎句",
                level: "low",
                review: "human",
                fixability: "manual",
                scope: {layer: "all"},
                action: {type: "replace", replacements: [""]},
            },
        },
        issues: [],
        ...overrides,
    };
}

function issue(overrides: Partial<CompactIssue> = {}): CompactIssue {
    return {
        ruleId: "test.not-compare",
        line: 21,
        column: 1,
        endLine: 21,
        endColumn: 3,
        match: "不是A",
        context: {before: "前文", current: "不是A", after: "是B"},
        ...overrides,
    };
}

function densityIssue(overrides: Partial<CompactDensityIssue> = {}): CompactDensityIssue {
    return {
        ruleId: "test.metaphor",
        line: 1,
        column: 1,
        hits: 40,
        perKilo: 4.6,
        samples: ["像", "像是"],
        ...overrides,
    };
}

/** 构造 detect JSON；chunks 的 rank 由调用方显式给，方便构造四象限边界用例。 */
function detectJson(overrides: Partial<ReportDetectFile> = {}): ReportDetectJson {
    const file: ReportDetectFile = {
        filePath: "chapter.md",
        docPAi: 0.3,
        maxPAi: 0.99,
        spread: 0.9,
        cached: false,
        chunks: [
            {span: [0, 200], line: 1, pAi: 0.02, rank: 4, relative: -0.28},
            {span: [200, 400], line: 21, pAi: 0.99, rank: 1, relative: 0.69},
            {span: [400, 600], line: 41, pAi: 0.9, rank: 2, relative: 0.6},
            {span: [600, 800], line: 61, pAi: 0.5, rank: 3, relative: 0.2},
        ],
        ...overrides,
    };
    return {kind: "detect", files: [file]};
}

describe("assignIssuesToChunks", () => {
    it("行号落在 chunk 行区间内归属该 chunk，区间为 [line, 下一 chunk 的 line)", () => {
        const chunks = [
            {line: 1, rank: 4, pAi: 0.02, relative: -0.28, span: [0, 200] as [number, number]},
            {line: 21, rank: 1, pAi: 0.99, relative: 0.69, span: [200, 400] as [number, number]},
            {line: 41, rank: 2, pAi: 0.9, relative: 0.6, span: [400, 600] as [number, number]},
        ];
        const counts = assignIssuesToChunks(
            [{line: 5}, {line: 21}, {line: 40}, {line: 41}, {line: 99}],
            chunks,
        );
        // line 5 在 chunk0（1..21），line 21/40 在 chunk1（21..41），line 41/99 在 chunk2（41..∞）
        expect(counts.get(0)).toBe(1);
        expect(counts.get(1)).toBe(2);
        expect(counts.get(2)).toBe(2);
    });

    it("没有 chunk 时返回空 Map，不抛错", () => {
        const counts = assignIssuesToChunks([{line: 1}], []);
        expect(counts.size).toBe(0);
    });
});

describe("buildReport 静态部分", () => {
    it("按 level × review 桶聚合命中，样本带行号", () => {
        const check = checkJson({
            issues: [
                issue({ruleId: "test.not-compare", line: 21, match: "不是A"}),
                issue({ruleId: "test.not-compare", line: 85, match: "不是B"}),
                issue({ruleId: "test.fragment", line: 15, match: "石板"}),
            ],
        });
        const report = buildReport(check, null);
        expect(report).toContain("### agent 桶");
        expect(report).toContain("### human 桶");
        expect(report).toContain("不是A，是B");
        expect(report).toContain("L21:不是A");
        expect(report).toContain("L85:不是B");
        expect(report).toContain("碎句");
        expect(report).toContain("2");
    });

    it("min-level 过滤掉低于指定级别的命中", () => {
        const check = checkJson({
            issues: [
                issue({ruleId: "test.not-compare", line: 21}),
                issue({ruleId: "test.fragment", line: 15}),
            ],
        });
        const report = buildReport(check, null, {minLevel: "high"});
        expect(report).not.toContain("碎句");
        expect(report).toContain("不是A，是B");
    });

    it("密度指纹单列，样本去重展示", () => {
        const check = checkJson({densityIssues: [densityIssue()]});
        const report = buildReport(check, null);
        expect(report).toContain("40 处 / 4.6 每千字");
        expect(report).toContain("像、像是");
    });

    it("无 detect 时明确标注只有静态部分", () => {
        const report = buildReport(checkJson(), null);
        expect(report).toContain("未提供 detect JSON");
        expect(report).toContain("（无 detect 数据，跳过）");
    });
});

describe("buildReport 四象限", () => {
    it("规则密集 × 文内高位 → 确认疑难", () => {
        // rank1 的 chunk（line 21）有 3 处命中 → confirm
        const check = checkJson({
            issues: [
                issue({line: 21}), issue({line: 22}), issue({line: 23}),
                issue({line: 70, ruleId: "test.fragment"}),
            ],
        });
        const detect = detectJson();
        const report = buildReport(check, detect);
        expect(report).toContain("确认疑难");
        expect(report).toContain("rank 1 L21");
    });

    it("规则密集 × 文内低位 → 分歧需裁决", () => {
        // rank 最低的 chunk（rank4, line 1）有 3 处命中 → dispute
        const check = checkJson({
            issues: [issue({line: 1}), issue({line: 2}), issue({line: 3})],
        });
        const report = buildReport(check, detectJson());
        expect(report).toContain("分歧");
        expect(report).toContain("rank 4 L1");
    });

    it("规则静默 × 文内高位 → 漏网候选", () => {
        // rank1 的 chunk（line 21）无命中，命中集中在低位的 line 61 chunk → rank1 是静默高位
        const check = checkJson({
            issues: [issue({line: 61}), issue({line: 62}), issue({line: 63})],
        });
        const report = buildReport(check, detectJson());
        expect(report).toContain("漏网");
        expect(report).toContain("rank 1 L21");
    });

    it("spread 低于门槛时说明不适用，不硬套象限", () => {
        const check = checkJson({issues: [issue({line: 21})]});
        const detect = detectJson({spread: 0.05, chunks: [
            {span: [0, 200], line: 1, pAi: 0.98, rank: 1, relative: 0.01},
            {span: [200, 400], line: 21, pAi: 0.97, rank: 2, relative: 0},
            {span: [400, 600], line: 41, pAi: 0.96, rank: 3, relative: -0.01},
            {span: [600, 800], line: 61, pAi: 0.95, rank: 4, relative: -0.02},
        ]});
        const report = buildReport(check, detect);
        expect(report).toContain("四象限不适用");
        expect(report).not.toContain("确认疑难");
    });

    it("spread 贴近门槛时给弱适用说明", () => {
        const report = buildReport(checkJson({issues: []}), detectJson({spread: 0.16}));
        expect(report).toContain("弱适用");
    });

    it("报告含语义规则提示", () => {
        const report = buildReport(checkJson(), detectJson());
        expect(report).toContain("语义规则");
        expect(report).toContain("rules --detector semantic");
    });
});
