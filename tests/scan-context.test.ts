import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {loadConfig} from "../skill/src/config";
import {computeMaskedRanges} from "../skill/src/markdown-mask";
import {computeIgnoreTermRanges, computePositionWindow, computeQuotedRanges, overlapsRanges, prepareScanContext, splitScanLines, visibleLength} from "../skill/src/scan-context";
import {scanText, scanWithContext} from "../skill/src/scanner";
import {loadRules} from "../skill/src/rules";
import type {NormalizedLlmlintConfig, RegexRuleRecord, ScanScope} from "../skill/src/types";

const RULESETS_ROOT = resolve("skill/rulesets");

/** 构造 scope 化的最小 regex 规则（suggest 形态，manual 修复）。 */
function scopedRule(id: string, target: string, scope?: ScanScope): RegexRuleRecord {
    return {
        id,
        namespace: "test",
        ruleset: "test",
        title: id,
        level: "medium",
        review: "agent",
        fixability: "manual",
        detector: {type: "regex", targets: [target]},
        action: {type: "suggest", message: id},
        scope: {
            layer: scope?.layer ?? "all",
            ...(scope?.position ? {position: scope.position} : {}),
        },
    };
}

describe("scan-context", () => {
    const tempRoots: string[] = [];

    afterEach(async () => {
        await Promise.all(tempRoots.map((root) => rm(root, {recursive: true, force: true})));
        tempRoots.length = 0;
    });

    it("成对引号行内配对，未闭合与跨行引号不遮罩", () => {
        const paired = prepareScanContext("「你好。」他说。");
        expect(paired.quotedRanges).toEqual([[0, 5]]);

        const unclosed = prepareScanContext("「他说到一半");
        expect(unclosed.quotedRanges).toEqual([]);

        const crossLine = prepareScanContext("「他说\n完了」");
        expect(crossLine.quotedRanges).toEqual([]);

        // 错配的闭引号当普通字符忽略，未闭合的开引号在行尾丢弃。
        const mismatched = prepareScanContext("『好」的");
        expect(mismatched.quotedRanges).toEqual([]);
    });

    it("quoted 支持五组有方向分隔符且拒绝 ASCII 直引号", () => {
        const content = "甲「一」乙『二』丙“三”丁‘四’戊【五】己\"六\"庚'七'";
        const ctx = prepareScanContext(content);
        expect(ctx.quotedRanges.map(([start, end]) => content.slice(start, end))).toEqual(["「一」", "『二』", "“三”", "‘四’", "【五】"]);
        expect(ctx.layers.quoted).not.toContain("六");
        expect(ctx.layers.quoted).not.toContain("七");
    });

    it("嵌套引号取每一层配对并合并为外层区间", () => {
        const content = "「他说『好』了」之后。";
        const ctx = prepareScanContext(content);
        expect(ctx.quotedRanges).toEqual([[0, 8]]);
        expect(ctx.layers.narrative.slice(0, 8)).toBe("。。。。。。。。");
        expect(ctx.layers.narrative.slice(8)).toBe("之后。");
    });

    it("代码块里的引号不参与配对", () => {
        const content = "```\n「代码里的引号\n```\n「正文。」";
        const maskedRanges = computeMaskedRanges(content);
        const ctx = prepareScanContext(content, {maskedRanges});
        const bodyStart = content.indexOf("「正文");
        expect(ctx.quotedRanges).toEqual([[bodyStart, bodyStart + 5]]);
    });

    it("三层视图与原文等长且换行保留", () => {
        const content = "叙述一。\n「对白。」\n叙述二。";
        const ctx = prepareScanContext(content);
        expect(ctx.layers.narrative.length).toBe(content.length);
        expect(ctx.layers.quoted.length).toBe(content.length);
        expect(ctx.layers.all).toBe(content);
        // 换行符在两个派生视图中原样保留，行结构不破坏。
        expect(ctx.layers.narrative.split("\n").length).toBe(3);
        expect(ctx.layers.quoted.split("\n").length).toBe(3);
        // narrative 视图里引号内文本是占位；quoted 视图里叙述是占位。
        expect(ctx.layers.narrative).toContain("叙述一。");
        expect(ctx.layers.narrative).not.toContain("对白");
        expect(ctx.layers.quoted).toContain("「对白。」");
        expect(ctx.layers.quoted).not.toContain("叙述");
    });

    it("narrative 规则不扫引号内文本，quoted 规则只扫引号内文本，命中 excerpt 取原文", () => {
        const content = "他不是不想去。\n「不是我干的。」他说。";
        const ctx = prepareScanContext(content);

        const narrativeIssues = scanWithContext(ctx, [scopedRule("n", "不是", {layer: "narrative"})]);
        expect(narrativeIssues).toHaveLength(1);
        expect(narrativeIssues[0]!.line).toBe(1);
        expect(narrativeIssues[0]!.match).toBe("不是");

        const quotedIssues = scanWithContext(ctx, [scopedRule("d", "不是", {layer: "quoted"})]);
        expect(quotedIssues).toHaveLength(1);
        expect(quotedIssues[0]!.line).toBe(2);

        const allIssues = scanWithContext(ctx, [scopedRule("a", "不是")]);
        expect(allIssues).toHaveLength(2);
    });

    it("占位句号截断跨引号假命中", () => {
        const content = "他不是「乙方」而是甲方。";
        const ctx = prepareScanContext(content);
        const target = "不是[^。，]{1,6}而是";

        // 全文层能拼出跨引号命中；narrative 层被 `。` 占位截断，不报。
        expect(scanWithContext(ctx, [scopedRule("a", target)])).toHaveLength(1);
        expect(scanWithContext(ctx, [scopedRule("n", target, {layer: "narrative"})])).toHaveLength(0);
    });

    it("position 窗口按 narrative 层可见字数生效", () => {
        const content = "预告在开头。中间的字很多很多。尾部预告";
        const ctx = prepareScanContext(content);
        const rule = scopedRule("e", "预告", {layer: "narrative", position: {kind: "ending", chars: 4}});
        const issues = scanWithContext(ctx, [rule]);
        expect(issues).toHaveLength(1);
        expect(issues[0]!.column).toBe(content.indexOf("尾部") + 3);

        const opening = scanWithContext(ctx, [scopedRule("o", "预告", {layer: "narrative", position: {kind: "opening", chars: 4}})]);
        expect(opening).toHaveLength(1);
        expect(opening[0]!.column).toBe(1);
    });

    it("computePositionWindow 不把对白占位计入可见字数", () => {
        const content = "叙述。「很长很长的对白内容」尾";
        const ctx = prepareScanContext(content);
        // ending 2 个可见字：对白整段是占位不计数，窗口必须一直伸到「叙述」里。
        const [start] = computePositionWindow(ctx, {layer: "narrative", position: {kind: "ending", chars: 3}});
        expect(start).toBeLessThanOrEqual(content.indexOf("述"));
    });

    it("position 窗口按当前 layer 计数，跳过结构/遮罩并按 Unicode 码点不切半", () => {
        const content = "# 标题𠀀𠀀\n---\n𠀀甲乙";
        const ctx = prepareScanContext(content, {maskedRanges: computeMaskedRanges(content)});
        const opening = computePositionWindow(ctx, {layer: "narrative", position: {kind: "opening", chars: 2}});
        expect(opening).toEqual([0, content.indexOf("乙")]);
        // 第一个扩展汉字占两个 UTF-16 单元，但只算一个可见码点。
        expect(opening[1] - content.indexOf("𠀀甲")).toBe(3);

        const quoted = prepareScanContext("叙述。『甲乙』尾部");
        const quotedOpening = computePositionWindow(quoted, {layer: "quoted", position: {kind: "opening", chars: 2}});
        expect(quotedOpening[1]).toBe("叙述。『甲乙".length);
    });

    it("position 规则不命中计数时跳过的结构行", () => {
        const content = "# 预告\n正文开场。\n结尾正文\n> 预告";
        const ctx = prepareScanContext(content, {maskedRanges: computeMaskedRanges(content)});
        const opening = scopedRule("opening.structural", "预告", {layer: "all", position: {kind: "opening", chars: 4}});
        const ending = scopedRule("ending.structural", "预告", {layer: "all", position: {kind: "ending", chars: 4}});
        expect(scanWithContext(ctx, [opening])).toHaveLength(0);
        expect(scanWithContext(ctx, [ending])).toHaveLength(0);
    });

    it("scope 完整区间校验阻止 regex/density 穿过 quoted 边界", () => {
        const content = "甲「乙」丙";
        const ctx = prepareScanContext(content);
        const cross = scopedRule("n.cross", "甲.*丙", {layer: "narrative"});
        expect(scanWithContext(ctx, [cross])).toHaveLength(0);
        expect(scanWithContext(ctx, [scopedRule("a.cross", "甲.*丙")])).toHaveLength(1);
    });

    it("结构行标记：markdown 结构与章节标题", () => {
        const lines = splitScanLines("# 标题\n- 列表项\n正文一句。\n第3章 起风\n| a | b |\n---");
        expect(lines.map((line) => line.structural)).toEqual([true, true, false, true, true, true]);
    });

    it("visibleLength 只数字母数字与 CJK", () => {
        expect(visibleLength("。，、 abc12你好")).toBe(7);
        expect(visibleLength("。。。")).toBe(0);
    });

    it("ignoreTerms 重叠语义：命中区间与豁免词区间重叠即丢弃", () => {
        const content = "章名是仿佛山海。他仿佛看见了。";
        const ctx = prepareScanContext(content, {ignoreTerms: ["仿佛山海"]});
        expect(ctx.ignoreRanges).toEqual([[3, 7]]);
        const issues = scanWithContext(ctx, [scopedRule("f", "仿佛")]);
        // 「仿佛山海」里的仿佛被豁免；后一处照报。
        expect(issues).toHaveLength(1);
        expect(issues[0]!.column).toBe(content.indexOf("他仿佛") + 2);
    });

    it("overlapsRanges 半开区间边界", () => {
        expect(overlapsRanges(0, 3, [[3, 7]])).toBe(false);
        expect(overlapsRanges(6, 9, [[3, 7]])).toBe(true);
        expect(overlapsRanges(7, 9, [[3, 7]])).toBe(false);
        expect(computeIgnoreTermRanges("啊啊啊", ["啊啊"])).toEqual([[0, 2]]);
    });

    it("scanText 旧签名行为不变（含遮罩跳过）", () => {
        const content = "```\n其实注释\n```\n其实正文。";
        const issues = scanText(content, [scopedRule("s", "其实")], {maskedRanges: computeMaskedRanges(content)});
        expect(issues).toHaveLength(1);
        expect(issues[0]!.line).toBe(4);
    });

    it("loader 不变量：非全域 scope 的 auto 规则降级 manual 并出 error 诊断", async () => {
        const rulesetId = "test-scan-scope";
        const root = join(RULESETS_ROOT, rulesetId);
        tempRoots.push(root);
        await mkdir(join(root, "rules"), {recursive: true});
        await writeFile(join(root, "ruleset.json"), JSON.stringify({id: rulesetId, title: rulesetId, version: "1.0.0"}), "utf-8");
        await writeFile(join(root, "rules", "index.json"), JSON.stringify([
            {
                id: "scoped-auto",
                namespace: "test",
                title: "scoped auto",
                level: "low",
                fixability: "auto",
                scope: {layer: "narrative"},
                detector: {type: "regex", targets: ["！！"]},
                action: {type: "replace", replacements: ["！"]},
            },
            {
                id: "scoped-suggest",
                namespace: "test",
                title: "scoped suggest",
                level: "low",
                scope: {layer: "narrative"},
                detector: {type: "regex", targets: ["其实"]},
                action: {type: "suggest", message: "x"},
            },
        ]), "utf-8");

        const config: NormalizedLlmlintConfig = {
            rulesets: [rulesetId],
            trustedRulesets: [],
            ignoreTerms: [],
            rulesetOverrides: {},
            namespaces: {},
            rules: {},
            output: "stylish",
        };
        const loaded = await loadRules(config);
        const demoted = loaded.rules.find((rule) => rule.id === "scoped-auto");
        expect(demoted?.fixability).toBe("manual");
        expect(loaded.diagnostics.some((diagnostic) => diagnostic.code === "scoped-rule-not-auto-fixable" && diagnostic.level === "error")).toBe(true);
        // scope 化的 suggest 规则不受影响。
        expect(loaded.rules.find((rule) => rule.id === "scoped-suggest")?.scope).toEqual({layer: "narrative"});
    });

    it("loader 把省略 scope 的磁盘规则归一为 resolved all", async () => {
        const loaded = await loadRules({
            rulesets: ["builtin/default"],
            trustedRulesets: [],
            ignoreTerms: [],
            rulesetOverrides: {},
            namespaces: {},
            rules: {},
            output: "json",
        });
        expect(loaded.rules.every((rule) => ["all", "narrative", "quoted"].includes(rule.scope.layer))).toBe(true);
        expect(loaded.rules.find((rule) => rule.id === "filler-worth-noting")?.scope).toEqual({layer: "all"});
    });

    it("scope 校验拒绝非法 layer 与非正整数 chars", async () => {
        const rulesetId = "test-scan-scope-invalid";
        const root = join(RULESETS_ROOT, rulesetId);
        tempRoots.push(root);
        await mkdir(join(root, "rules"), {recursive: true});
        await writeFile(join(root, "ruleset.json"), JSON.stringify({id: rulesetId, title: rulesetId, version: "1.0.0"}), "utf-8");
        await writeFile(join(root, "rules", "index.json"), JSON.stringify([
            {
                id: "bad-layer",
                namespace: "test",
                title: "bad",
                level: "low",
                scope: {layer: "dialogue"},
                detector: {type: "regex", targets: ["a"]},
                action: {type: "suggest", message: "x"},
            },
        ]), "utf-8");
        const config: NormalizedLlmlintConfig = {
            rulesets: [rulesetId],
            trustedRulesets: [],
            ignoreTerms: [],
            rulesetOverrides: {},
            namespaces: {},
            rules: {},
            output: "stylish",
        };
        await expect(loadRules(config)).rejects.toThrow(/narrative、quoted 或 all/);
    });

    it("llmlint.config.ts 的 ignoreTerms 进入归一配置，非法值报错", async () => {
        const root = await mkdtemp(join(tmpdir(), "llmlint-ignore-"));
        tempRoots.push(root);
        await writeFile(join(root, "llmlint.config.ts"), `export default {ignoreTerms: ["仿佛山海", "老蛟"]};`, "utf-8");
        const {config} = await loadConfig({cwd: root});
        expect(config.ignoreTerms).toEqual(["仿佛山海", "老蛟"]);

        const badRoot = await mkdtemp(join(tmpdir(), "llmlint-ignore-bad-"));
        tempRoots.push(badRoot);
        await writeFile(join(badRoot, "llmlint.config.ts"), `export default {ignoreTerms: [""]};`, "utf-8");
        await expect(loadConfig({cwd: badRoot})).rejects.toThrow(/ignoreTerms/);
    });

    it("computeQuotedRanges 直接消费行切分结果", () => {
        const lines = splitScanLines("甲「乙」丙【丁】");
        expect(computeQuotedRanges(lines, [])).toEqual([[1, 4], [5, 8]]);
    });
});
