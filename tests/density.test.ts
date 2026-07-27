import {mkdir, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {scanDensity} from "../skill/src/density";
import {computeMaskedRanges} from "../skill/src/markdown-mask";
import {prepareScanContext} from "../skill/src/scan-context";
import {createCheckJsonReport, formatCheckReport} from "../skill/src/reporter";
import {loadRules} from "../skill/src/rules";
import type {DensityDetector, DensityRuleRecord, LoadedRules, NormalizedLlmlintConfig, ScanScope} from "../skill/src/types";

const RULESETS_ROOT = resolve("skill/rulesets");

/** 构造最小 density 规则。 */
function densityRule(id: string, detector: Omit<DensityDetector, "type">, scope?: ScanScope): DensityRuleRecord {
    return {
        id,
        namespace: "test",
        ruleset: "test",
        title: id,
        level: "medium",
        review: "agent",
        fixability: "manual",
        detector: {type: "density", ...detector},
        action: {type: "suggest", message: id},
        ...(scope ? {scope} : {}),
    };
}

function emptyLoadedRules(): LoadedRules {
    return {
        rules: [],
        regexRules: [],
        semanticRules: [],
        densityRules: [],
        handlerRules: [],
        diagnostics: [],
        summary: {rulesets: [], totalRules: 0, activeRules: 0, disabledRules: 0, namespaces: []},
    };
}

describe("density detector", () => {
    const tempRoots: string[] = [];

    afterEach(async () => {
        await Promise.all(tempRoots.map((root) => rm(root, {recursive: true, force: true})));
        tempRoots.length = 0;
    });

    // 三句共 15 个可见字、3 处「忽然」→ 200/千字。
    const stutterText = "他忽然想到。他忽然停住。他忽然笑了。";

    it("minHits 与 perKilo 是 AND 门槛", () => {
        const ctx = prepareScanContext(stutterText);
        const pass = scanDensity(ctx, [densityRule("p", {patterns: [{target: "忽然"}], minHits: 3, perKilo: 150})]);
        expect(pass).toHaveLength(1);
        expect(pass[0]!.hits).toBe(3);
        expect(pass[0]!.perKilo).toBe(200);
        expect(pass[0]!.line).toBe(1);
        expect(pass[0]!.column).toBe(2);
        expect(pass[0]!.samples).toEqual(["忽然"]);

        // 密度不够 / 次数不够，各自单独就能拦下。
        expect(scanDensity(ctx, [densityRule("k", {patterns: [{target: "忽然"}], minHits: 3, perKilo: 300})])).toHaveLength(0);
        expect(scanDensity(ctx, [densityRule("h", {patterns: [{target: "忽然"}], minHits: 4})])).toHaveLength(0);
    });

    it("coreMinHits 与 minBuckets 多样性门槛", () => {
        const ctx = prepareScanContext(stutterText);
        const patterns = [
            {target: "忽然", bucket: "adverb"},
            {target: "想到", bucket: "verb", core: true},
        ];
        expect(scanDensity(ctx, [densityRule("b", {patterns, minHits: 2, minBuckets: 2, coreMinHits: 1})])).toHaveLength(1);
        expect(scanDensity(ctx, [densityRule("c", {patterns, minHits: 2, coreMinHits: 2})])).toHaveLength(0);
        expect(scanDensity(ctx, [densityRule("d", {patterns: [{target: "忽然", bucket: "adverb"}], minHits: 2, minBuckets: 2})])).toHaveLength(0);
    });

    it("minChars：文本太短不评密度", () => {
        const ctx = prepareScanContext(stutterText);
        expect(scanDensity(ctx, [densityRule("m", {patterns: [{target: "忽然"}], minHits: 2, minChars: 100})])).toHaveLength(0);
    });

    it("paragraph 粒度逐行评估、逐行报", () => {
        const content = "他忽然想到。他忽然停住。\n平静的一句。\n他忽然笑了。他忽然走了。";
        const ctx = prepareScanContext(content);
        const issues = scanDensity(ctx, [densityRule("g", {patterns: [{target: "忽然"}], minHits: 2, granularity: "paragraph"})]);
        expect(issues).toHaveLength(2);
        expect(issues.map((issue) => issue.line).sort()).toEqual([1, 3]);
        expect(issues.every((issue) => issue.hits === 2)).toBe(true);
    });

    it("结构行豁免：计数与分母都跳过列表/标题行", () => {
        const content = "- 忽然一\n- 忽然二\n正文忽然出现。";
        const ctx = prepareScanContext(content);
        expect(scanDensity(ctx, [densityRule("s", {patterns: [{target: "忽然"}], minHits: 2})])).toHaveLength(0);
        const single = scanDensity(ctx, [densityRule("s1", {patterns: [{target: "忽然"}], minHits: 1})]);
        expect(single).toHaveLength(1);
        expect(single[0]!.line).toBe(3);
        // 分母只有第三行的 6 个可见字：1/6*1000 ≈ 166.67。
        expect(single[0]!.perKilo).toBeCloseTo(166.67, 1);
    });

    it("narrative scope：对白内命中不计数", () => {
        const content = "「忽然忽然忽然」他忽然笑。";
        const ctx = prepareScanContext(content);
        expect(scanDensity(ctx, [densityRule("n2", {patterns: [{target: "忽然"}], minHits: 2}, {layer: "narrative"})])).toHaveLength(0);
        const one = scanDensity(ctx, [densityRule("n1", {patterns: [{target: "忽然"}], minHits: 1}, {layer: "narrative"})]);
        expect(one).toHaveLength(1);
        expect(one[0]!.hits).toBe(1);
        // all 层照常 4 处。
        expect(scanDensity(ctx, [densityRule("a4", {patterns: [{target: "忽然"}], minHits: 4})])[0]!.hits).toBe(4);
    });

    it("markdown 遮罩区不计数也不进分母", () => {
        const content = "```\n忽然忽然忽然\n```\n他忽然笑了。";
        const ctx = prepareScanContext(content, {maskedRanges: computeMaskedRanges(content)});
        const issues = scanDensity(ctx, [densityRule("mask", {patterns: [{target: "忽然"}], minHits: 1})]);
        expect(issues).toHaveLength(1);
        expect(issues[0]!.hits).toBe(1);
        // 分母只有正文行 5 个可见字。
        expect(issues[0]!.perKilo).toBe(200);
    });

    it("reporter 呈现密度指纹段，JSON 报告含 densityIssues", () => {
        const ctx = prepareScanContext(stutterText);
        const issues = scanDensity(ctx, [densityRule("r", {patterns: [{target: "忽然"}], minHits: 3})]);
        const stylish = formatCheckReport("demo.md", [], emptyLoadedRules(), {densityIssues: issues});
        expect(stylish).toContain("密度指纹 (1)");
        expect(stylish).toContain("3 处命中");
        expect(stylish).not.toContain("No problems found");

        const json = createCheckJsonReport("demo.md", null, [], emptyLoadedRules(), {densityIssues: issues});
        expect(json.densityIssues).toHaveLength(1);
    });

    it("loader：density 规则入册、fixability 恒 manual、未知 detector.type 优雅跳过", async () => {
        const rulesetId = "test-density";
        const root = join(RULESETS_ROOT, rulesetId);
        tempRoots.push(root);
        await mkdir(join(root, "rules"), {recursive: true});
        await writeFile(join(root, "ruleset.json"), JSON.stringify({id: rulesetId, title: rulesetId, version: "1.0.0"}), "utf-8");
        await writeFile(join(root, "rules", "index.json"), JSON.stringify([
            {
                id: "density-ok",
                namespace: "test",
                title: "ok",
                level: "medium",
                detector: {type: "density", patterns: [{target: "忽然"}], minHits: 3, perKilo: 8},
                action: {type: "suggest", message: "x"},
            },
            {
                id: "density-bad-fixability",
                namespace: "test",
                title: "bad",
                level: "low",
                fixability: "candidate",
                detector: {type: "density", patterns: [{target: "仿佛"}], minHits: 2},
                action: {type: "suggest", message: "x"},
            },
            {
                id: "from-the-future",
                namespace: "test",
                title: "future",
                level: "low",
                detector: {type: "quantum", targets: ["?"]},
                action: {type: "suggest", message: "x"},
            },
        ]), "utf-8");

        const config: NormalizedLlmlintConfig = {
            rulesets: [rulesetId],
            trustedRulesets: [],
            rulesetOverrides: {},
            namespaces: {},
            rules: {},
            ignoreTerms: [],
            output: "stylish",
        };
        const loaded = await loadRules(config);
        expect(loaded.densityRules.map((rule) => rule.id).sort()).toEqual(["density-bad-fixability", "density-ok"]);
        expect(loaded.densityRules.every((rule) => rule.fixability === "manual")).toBe(true);
        expect(loaded.diagnostics.some((diagnostic) => diagnostic.code === "density-rule-not-fixable")).toBe(true);
        expect(loaded.diagnostics.some((diagnostic) => diagnostic.code === "unknown-detector-type" && diagnostic.level === "warning")).toBe(true);
        expect(loaded.rules.some((rule) => rule.id === "from-the-future")).toBe(false);
    });

    it("loader：density 声明校验（空 patterns / 非法 minHits）抛错", async () => {
        const rulesetId = "test-density-invalid";
        const root = join(RULESETS_ROOT, rulesetId);
        tempRoots.push(root);
        await mkdir(join(root, "rules"), {recursive: true});
        await writeFile(join(root, "ruleset.json"), JSON.stringify({id: rulesetId, title: rulesetId, version: "1.0.0"}), "utf-8");
        await writeFile(join(root, "rules", "index.json"), JSON.stringify([
            {
                id: "no-patterns",
                namespace: "test",
                title: "bad",
                level: "low",
                detector: {type: "density", patterns: [], minHits: 1},
                action: {type: "suggest", message: "x"},
            },
        ]), "utf-8");
        const config: NormalizedLlmlintConfig = {
            rulesets: [rulesetId],
            trustedRulesets: [],
            rulesetOverrides: {},
            namespaces: {},
            rules: {},
            ignoreTerms: [],
            output: "stylish",
        };
        await expect(loadRules(config)).rejects.toThrow(/patterns/);
    });
});
