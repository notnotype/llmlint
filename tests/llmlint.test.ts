import {execFile} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {promisify} from "node:util";
import {afterEach, describe, expect, it, vi} from "vitest";
import {runCli} from "../skill/src/cli";
import {loadConfig} from "../skill/src/config";
import {importCuratedRulesets} from "../skill/src/curated-import";
import {CURATED_RULE_SLUGS} from "../skill/src/curated-slugs";
import {computeMaskedRanges, isMasked} from "../skill/src/markdown-mask";
import {applyAutoFixWithChanges, applySingleIssueReplacement} from "../skill/src/fix";
import {formatCheckReport} from "../skill/src/reporter";
import {materializeRules} from "../skill/src/rule-registry";
import {loadRuleCatalog, loadRules} from "../skill/src/rules";
import {scanText} from "../skill/src/scanner";
import type {Issue, LintRuleRecord, RegexRuleRecord} from "../skill/src/types";
import {messages, type MessageKey} from "../web/app/i18n/messages";
import {markdownSelectionLinkInputHref} from "../web/app/utils/markdown-selection-state";
import {isIssueAutoApplicable, isIssueReplacementApplicable, reviewIssueActionLabel, reviewIssueLevelLabel, reviewReplacementActionLabel, reviewReplacementTitle} from "../web/app/utils/review-issue-ui";
import {type ReviewIssueMark} from "../web/app/utils/review-ranges";
import {normalizeWebSettings} from "../web/app/utils/web-settings";

const SKILL_ROOT = resolve("skill");
const RULESETS_ROOT = resolve("skill/rulesets");
const LLMLINT_BIN = resolve("skill/bin/llmlint.ts");
const CURATED_SOURCE_FILES = [
    "轻量规则集1.2.json",
    "轻量规则集v1.1.json",
    "通用规则集1.2.json",
    "Claude-保守版.json",
    "Claude-日常版.json",
    "Claude-强力版.json",
    "Gemini-保守版.json",
    "Gemini-日常版.json",
    "Gemini-强力版.json",
    "deepseekv4pro专用.json",
    "极其杀手.json",
];
const execFileAsync = promisify(execFile);

describe("llmlint", () => {
    const tempRoots: string[] = [];

    afterEach(async () => {
        vi.restoreAllMocks();
        process.exitCode = undefined;
        await Promise.all(tempRoots.map((root) => rm(root, {recursive: true, force: true})));
        tempRoots.length = 0;
    });

    it("默认启用 builtin/default ruleset 并加载 LLM rules", async () => {
        const {config} = await loadConfig({cwd: process.cwd()});
        const loadedRules = await loadRules(config);

        const issues = scanText("首先要分析问题，其次要制定方案，最后执行。他抬起头颅。", loadedRules.regexRules);

        expect(loadedRules.summary.rulesets).toEqual(["builtin/default"]);
        expect(issues.some((issue) => issue.rule.id === "firstly-secondly")).toBe(true);
        expect(issues.some((issue) => issue.rule.ruleset === "builtin/default")).toBe(true);
        expect(issues.find((issue) => issue.rule.id === "firstly-secondly")?.rule.level).toBe("high");
        expect(loadedRules.llmRules.map((rule) => rule.id)).toContain("mechanical-elevation-ending");
        expect(issues.map((issue) => issue.rule.id)).toContain("cn.vocabulary.body.skull-head");
    });

    it("rules 和中文 namespace alias 能关闭和改写规则级别", async () => {
        const root = await mkdtemp(join(tmpdir(), "llmlint-config-"));
        tempRoots.push(root);
        const configPath = join(root, "llmlint.config.ts");
        await writeFile(configPath, `export default {
    rulesets: ["builtin/default"],
    namespaces: {
        "二元对比": "low",
    },
    rules: {
        "filler-word-actually": "off",
        "not-but-structure": {enabled: true},
    },
};
`, "utf-8");

        const {config} = await loadConfig({cwd: process.cwd(), configPath});
        const loadedRules = await loadRules(config);
        const issues = scanText("其实不是因为天气不好，而是因为路况复杂。", loadedRules.regexRules);

        expect(issues.some((issue) => issue.rule.id === "filler-word-actually")).toBe(false);
        expect(issues.find((issue) => issue.rule.id === "not-but-structure")?.rule.level).toBe("low");
    });

    it("vocabulary.r18 namespace 能关闭默认中文精选规则集中的 R18 规则", async () => {
        const loadedRules = await loadRules({
            rulesets: ["builtin/default"],
            trustedRulesets: [],
            ignoreTerms: [],
            rulesetOverrides: {},
            namespaces: {
                "vocabulary.r18": {enabled: false},
            },
            rules: {},
            output: "stylish",
        });

        expect(loadedRules.rules.some((rule) => rule.namespace === "vocabulary.r18")).toBe(false);
    });

    it("多个 ruleset 可向同 namespace append，并按同 id override 产生 diagnostics", async () => {
        const firstRuleset = `test/${randomUUID()}`;
        const secondRuleset = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(firstRuleset, [
            regexRule("test.shared.A", "modifier", "旧规则 A", "旧词"),
            regexRule("test.shared.B", "modifier", "规则 B", "新词"),
        ]);
        await writeRuleset(secondRuleset, [
            regexRule("test.shared.C", "modifier", "规则 C", "追加词"),
            regexRule("test.shared.A", "modifier", "覆盖规则 A", "覆盖词"),
        ]);

        const loadedRules = await loadRules({
            rulesets: [firstRuleset, secondRuleset],
            trustedRulesets: [],
            ignoreTerms: [],
            rulesetOverrides: {},
            namespaces: {},
            rules: {},
            output: "stylish",
        });

        const issues = scanText("旧词 新词 追加词 覆盖词", loadedRules.regexRules);

        expect(loadedRules.summary.namespaces.find((item) => item.namespace === "modifier")?.totalRules).toBe(3);
        expect(issues.some((issue) => issue.rule.id === "test.shared.B")).toBe(true);
        expect(issues.some((issue) => issue.rule.id === "test.shared.C")).toBe(true);
        expect(issues.find((issue) => issue.rule.id === "test.shared.A")?.match).toBe("覆盖词");
        expect(loadedRules.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: "rule-override",
                ruleId: "test.shared.A",
                previousRuleset: firstRuleset,
                nextRuleset: secondRuleset,
            }),
        ]));
    });

    it("ruleset 会递归扫描 rules 目录并按路径稳定加载", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeMultiFileRuleset(rulesetId, {
            "rules/a.json": [
                regexRule("test.multi.first", "test.multi", "第一条", "甲词"),
            ],
            "rules/nested/b.json": [
                regexRule("test.multi.second", "test.multi", "第二条", "乙词"),
            ],
        });

        const loadedRules = await loadRules(emptyConfig([rulesetId]));
        const issues = scanText("甲词 乙词", loadedRules.regexRules);

        expect(loadedRules.rules.map((rule) => rule.id)).toEqual([
            "test.multi.first",
            "test.multi.second",
        ]);
        expect(issues.map((issue) => issue.rule.id)).toEqual([
            "test.multi.first",
            "test.multi.second",
        ]);
    });

    it("rules 目录层级不参与 namespace 语义", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeMultiFileRuleset(rulesetId, {
            "rules/unrelated/path.json": [
                regexRule("test.path.semantic", "semantic.namespace", "路径不参与语义", "甲词"),
            ],
        });

        const loadedRules = await loadRules(emptyConfig([rulesetId]));
        const rule = loadedRules.rules.find((item) => item.id === "test.path.semantic");

        expect(rule?.namespace).toBe("semantic.namespace");
    });

    it("ruleset 硬切拒绝旧 ruleFiles / rulesRoot / 根 rules.json 入口", async () => {
        const ruleFilesRuleset = `test/${randomUUID()}`;
        const rulesRootRuleset = `test/${randomUUID()}`;
        const rootRulesJsonRuleset = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeMultiFileRuleset(ruleFilesRuleset, {
            "rules/index.json": [regexRule("test.removed.ruleFiles", "test.removed", "旧 ruleFiles", "甲词")],
        }, {ruleFiles: ["rules/index.json"]});
        await writeMultiFileRuleset(rulesRootRuleset, {
            "rules/index.json": [regexRule("test.removed.rulesRoot", "test.removed", "旧 rulesRoot", "乙词")],
        }, {rulesRoot: "rules"});
        await writeLegacyRootRulesJsonRuleset(rootRulesJsonRuleset, [
            regexRule("test.removed.root", "test.removed", "旧 rules.json", "丙词"),
        ]);

        await expect(loadRules(emptyConfig([ruleFilesRuleset]))).rejects.toThrow("不再支持 ruleFiles");
        await expect(loadRules(emptyConfig([rulesRootRuleset]))).rejects.toThrow("不再支持 rulesRoot");
        await expect(loadRules(emptyConfig([rootRulesJsonRuleset]))).rejects.toThrow("不再支持根目录 rules.json");
    });

    it("ruleset 会明确报告 rules 目录形态和 JSON 语法错误", async () => {
        const fileRulesPathRuleset = `test/${randomUUID()}`;
        const invalidJsonRuleset = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRulesPathAsFileRuleset(fileRulesPathRuleset);
        await writeInvalidJsonRuleset(invalidJsonRuleset);

        await expect(loadRules(emptyConfig([fileRulesPathRuleset]))).rejects.toThrow("rules/ 必须是规则目录");
        await expect(loadRules(emptyConfig([invalidJsonRuleset]))).rejects.toThrow(`规则包 ${invalidJsonRuleset} 的 rules/broken.json 不是合法 JSON`);
    });

    it("rulesetOverrides off 的规则包不参与同 ID 覆盖", async () => {
        const firstRuleset = `test/${randomUUID()}`;
        const secondRuleset = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(firstRuleset, [
            regexRule("test.shared.A", "modifier", "旧规则 A", "旧词"),
        ]);
        await writeRuleset(secondRuleset, [
            regexRule("test.shared.A", "modifier", "覆盖规则 A", "覆盖词"),
        ]);

        const loadedRules = await loadRules({
            rulesets: [firstRuleset, secondRuleset],
            trustedRulesets: [],
            ignoreTerms: [],
            rulesetOverrides: {
                [secondRuleset]: "off",
            },
            namespaces: {},
            rules: {},
            output: "stylish",
        });
        const issues = scanText("旧词 覆盖词", loadedRules.regexRules);

        expect(issues).toHaveLength(1);
        expect(issues[0]?.rule.ruleset).toBe(firstRuleset);
        expect(issues[0]?.match).toBe("旧词");
        expect(loadedRules.diagnostics.some((diagnostic) => diagnostic.code === "rule-override")).toBe(false);
    });

    it("rulesetOverrides off 的规则包可被 rule 或 namespace 显式启用", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            regexRule("test.explicit.rule", "modifier", "按 rule 启用", "规则词"),
            regexRule("test.explicit.namespace", "tone", "按 namespace 启用", "语气词"),
            regexRule("test.explicit.skipped", "cliche", "保持关闭", "关闭词"),
        ]);

        const loadedRules = await loadRules({
            rulesets: [rulesetId],
            trustedRulesets: [],
            ignoreTerms: [],
            rulesetOverrides: {
                [rulesetId]: "off",
            },
            namespaces: {
                tone: {enabled: true, level: "low"},
            },
            rules: {
                "test.explicit.rule": {enabled: true, level: "high"},
            },
            output: "stylish",
        });
        const issues = scanText("规则词 语气词 关闭词", loadedRules.regexRules);

        expect(issues.map((issue) => issue.rule.id)).toEqual([
            "test.explicit.rule",
            "test.explicit.namespace",
        ]);
        expect(issues.find((issue) => issue.rule.id === "test.explicit.rule")?.rule.level).toBe("high");
        expect(issues.find((issue) => issue.rule.id === "test.explicit.namespace")?.rule.level).toBe("low");
        expect(loadedRules.summary.rulesets).toContain(rulesetId);
    });

    it("regex detector 支持 flags 和多个 targets", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [{
            ...regexRule("test.flags", "test.regex", "大小写规则", "alpha"),
            detector: {type: "regex", targets: ["alpha", "beta"], flags: "i"},
        }]);

        const loadedRules = await loadRules(emptyConfig([rulesetId]));
        const issues = scanText("ALPHA beta", loadedRules.regexRules);

        expect(issues.map((issue) => issue.match)).toEqual(["ALPHA", "beta"]);
        expect(issues.map((issue) => `${issue.line}:${issue.column}-${issue.endColumn}`)).toEqual(["1:1-5", "1:7-10"]);
    });

    it("regex detector 的结束列按人类可读字符计算", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [{
            ...regexRule("test.codepoint-range", "test.regex", "字符列规则", "😀"),
            detector: {type: "regex", targets: ["😀", "😀A", "甲\n乙"]},
        }]);

        const loadedRules = await loadRules(emptyConfig([rulesetId]));
        const issues = scanText("😀 😀A\n甲\n乙", loadedRules.regexRules);

        expect(issues.map((issue) => `${issue.line}:${issue.column}-${issue.endLine}:${issue.endColumn}`)).toEqual([
            "1:1-1:1",
            "1:3-1:3",
            "1:3-1:4",
            "2:1-3:1",
        ]);
    });

    it("stylish check 默认输出紧凑位置范围，不重复完整命中行", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            {...regexRule("test.high", "test.output", "高等级规则", "高风险词"), level: "high"},
            {...regexRule("test.low", "test.output", "低等级规则", "低风险词"), level: "low"},
        ]);
        const loadedRules = await loadRules(emptyConfig([rulesetId]));
        const text = "同一行有高风险词，也有低风险词。";
        const issues = scanText(text, loadedRules.regexRules);

        const output = formatCheckReport("input.md", issues, loadedRules);

        expect(output.indexOf("high (1 problem)")).toBeLessThan(output.indexOf("low (1 problem)"));
        expect(output).toContain("1:5-8  match: 高风险词");
        expect(output).toContain("1:12-15  match: 低风险词");
        expect(output).not.toContain("同一行有高风险词，也有低风险词。");
        expect(output).not.toContain("<mark>");
        expect(output).not.toContain("^^");
    });

    it("stylish check showLines 模式输出完整行并用 mark 标注", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            {...regexRule("test.high.lines", "test.output", "高等级规则", "高风险词"), level: "high"},
        ]);
        const loadedRules = await loadRules(emptyConfig([rulesetId]));
        const text = "这是一个很长的完整行，前面有足够多的上下文用于验证不会被截断，高风险词后面也应该保留完整上下文。";
        const issues = scanText(text, loadedRules.regexRules);

        const output = formatCheckReport("input.md", issues, loadedRules, {showLines: true});

        expect(output).toContain("1:32-35  这是一个很长的完整行，前面有足够多的上下文用于验证不会被截断，<mark>高风险词</mark>后面也应该保留完整上下文。");
    });

    it("handler rule：module 形态拒载，未注册 builtin 名跳过并产生 warning", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [{
            id: "test.handler",
            namespace: "test.handler",
            title: "handler",
            level: "medium",
            handler: {type: "module", path: "handler.ts"},
        } as never]);

        // v3 起 handler 只支持编译进包的 builtin 具名形态，module 路径直接拒载。
        await expect(loadRules(emptyConfig([rulesetId]))).rejects.toThrow(/builtin/);

        await writeRuleset(rulesetId, [{
            id: "test.handler.unknown",
            namespace: "test.handler",
            title: "handler",
            level: "medium",
            handler: {type: "builtin", name: "not-registered-anywhere"},
            action: {type: "suggest", message: "x"},
        } as never]);
        const loadedRules = await loadRules(emptyConfig([rulesetId]));

        expect(loadedRules.rules).toHaveLength(0);
        expect(loadedRules.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({code: "unknown-handler-name", ruleId: "test.handler.unknown"}),
        ]));
    });

    it("rule source 只接受当前 schema 明确允许的字段", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRawRuleset(rulesetId, [{
            id: "test.source.extra",
            namespace: "test.source",
            title: "来源字段收紧",
            level: "medium",
            source: {
                importedFrom: "fixture",
                unexpected: "not allowed",
            },
            detector: {type: "regex", targets: ["来源词"]},
            action: {type: "replace", replacements: [""]},
        }]);

        await expect(loadRules(emptyConfig([rulesetId]))).rejects.toThrow("不是允许的 source 字段");
    });

    it("配置 output json 时 CLI 输出 check JSON，包含 registry 和 diagnostics", async () => {
        const root = await mkdtemp(join(tmpdir(), "llmlint-json-output-"));
        tempRoots.push(root);
        const configPath = join(root, "llmlint.config.ts");
        const textPath = join(root, "input.md");
        await writeFile(configPath, `export default {
    rulesets: ["builtin/default"],
    output: "json",
};
`, "utf-8");
        await writeFile(textPath, "alpha beta", "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "--config", configPath, "check", textPath]);

        const report = JSON.parse(String(log.mock.calls[0]?.[0])) as {kind: string; registry: {rulesets: string[]}; diagnostics: unknown[]; issues: unknown[]};
        expect(report).toMatchObject({
            kind: "check",
            registry: {rulesets: ["builtin/default"]},
            diagnostics: [],
            issues: [],
        });
    });

    it("命令行 --format json 覆盖 config output 并输出 LLM rules JSON", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "--format", "json", "show-llm-rules"]);

        const report = JSON.parse(String(log.mock.calls[0]?.[0])) as {kind: string; rules: Array<{id: string}>};
        expect(report.kind).toBe("llm-rules");
        expect(report.rules.map((rule) => rule.id)).toContain("mechanical-elevation-ending");
    });

    it("JSON check 输出保留 context 并包含结束位置", async () => {
        const rulesetId = `test/${randomUUID()}`;
        const root = await mkdtemp(join(tmpdir(), "llmlint-json-issue-"));
        tempRoots.push(root, join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            regexRule("test.json.issue", "test.output", "JSON 规则", "高风险词"),
        ]);
        const configPath = join(root, "llmlint.config.ts");
        const textPath = join(root, "input.md");
        await writeFile(configPath, `export default {
    rulesets: ["${rulesetId}"],
};
`, "utf-8");
        await writeFile(textPath, "前文高风险词后文", "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "--config", configPath, "--format", "json", "check", textPath]);

        const report = JSON.parse(String(log.mock.calls[0]?.[0])) as {issues: Array<{line: number; column: number; endLine: number; endColumn: number; context: {before: string; current: string; after: string}}>};
        expect(report.issues[0]).toMatchObject({
            line: 1,
            column: 3,
            endLine: 1,
            endColumn: 6,
            context: {
                before: "前文",
                current: "高风险词",
                after: "后文",
            },
        });
    });

    it("CLI check 支持按最低级别过滤输出", async () => {
        const rulesetId = `test/${randomUUID()}`;
        const root = await mkdtemp(join(tmpdir(), "llmlint-min-level-"));
        tempRoots.push(root, join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            {...regexRule("test.high.filter", "test.output", "高等级过滤", "高风险词"), level: "high"},
            {...regexRule("test.low.filter", "test.output", "低等级过滤", "低风险词"), level: "low"},
        ]);
        const configPath = join(root, "llmlint.config.ts");
        const textPath = join(root, "input.md");
        await writeFile(configPath, `export default {
    rulesets: ["${rulesetId}"],
};
`, "utf-8");
        await writeFile(textPath, "高风险词 低风险词", "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "--config", configPath, "check", textPath, "--min-level", "medium", "--show-lines"]);

        const output = String(log.mock.calls[0]?.[0]);
        expect(output).toContain("显示级别：medium 及以上；已隐藏 1 条较低级别命中。");
        expect(output).toContain("test.high.filter");
        expect(output).toContain("<mark>高风险词</mark>");
        expect(output).not.toContain("test.low.filter");
    });

    it("CLI help 只暴露硬切后的公开命令", async () => {
        const {stdout} = await execFileAsync("bun", [LLMLINT_BIN, "--help"], {
            encoding: "utf-8",
            timeout: 10000,
        });

        expect(stdout).toContain("check [options] <files...>");
        expect(stdout).toContain("show-llm-rules [options]");
        expect(stdout).not.toContain("import-legacy");
        expect(stdout).not.toContain("import-curated");
        expect(stdout).not.toContain("兼容旧用法");
        expect(stdout).not.toContain("llmlint [options] [file]");
    });

    it("CLI 不再支持 llmlint <file> 旧 positional 用法", async () => {
        const result = await runFailedCommand([
            LLMLINT_BIN,
            "skill/SKILL.md",
        ]);

        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain("unknown command");
    });

    it("llmlint 源码不保留旧规则导入入口", async () => {
        const files = await listFiles(SKILL_ROOT);
        const fileNames = files.map((file) => file.replace(/\\/g, "/"));
        const source = (await Promise.all(files
            .filter((file) => /\.(ts|md|json)$/.test(file))
            .map((file) => readFile(file, "utf-8"))))
            .join("\n");

        expect(fileNames.some((file) => file.endsWith("legacy-import.ts"))).toBe(false);
        expect(source).not.toContain("import-legacy");
        expect(source).not.toContain("LegacyImport");
        expect(source).not.toContain("source.legacy");
    });

    it("curated import 会生成按 namespace 拆分的内置默认 ruleset", async () => {
        const root = await mkdtemp(join(tmpdir(), "llmlint-curated-"));
        tempRoots.push(root);
        const sourceRoot = join(root, "source");
        await writeCuratedSourceFixture(sourceRoot);
        const report = await importCuratedRulesets({
            sourceRoot,
            outputRoot: root,
        });
        const rulesetRoot = join(root, "builtin", "default");
        const manifest = JSON.parse(await readFile(join(rulesetRoot, "ruleset.json"), "utf-8")) as Record<string, unknown>;
        const rules = await readRulesetRules(rulesetRoot) as Array<{
            id: string;
            namespace: string;
            enabled?: boolean;
            detector: {type: "regex"; targets: string[]} | {type: "llm"; prompt: string};
            action: {replacements?: string[]};
            source?: {canonicalKey?: string; importedFrom?: string};
        }>;
        const r18Rules = JSON.parse(await readFile(join(rulesetRoot, "rules", "vocabulary", "r18.json"), "utf-8")) as Array<{namespace: string}>;

        expect(report.rulesets.map((ruleset) => ruleset.rulesetId)).toEqual([
            "builtin/default",
        ]);
        await expect(readFile(join(rulesetRoot, "rules.json"), "utf-8")).rejects.toMatchObject({code: "ENOENT"});
        expect(manifest.ruleFiles).toBeUndefined();
        expect(manifest.rulesRoot).toBeUndefined();
        expect(r18Rules).toHaveLength(1);
        expect(r18Rules.every((rule) => rule.namespace === "vocabulary.r18")).toBe(true);
        expect(report.skipped).toHaveLength(0);
        expect(report.converted.text).toBeGreaterThan(0);
        expect(report.converted.simple).toBeGreaterThan(0);
        expect(report.converted.regex).toBeGreaterThan(0);
        expect(report.uniqueRules).toBe(rules.length);
        expect(rules.filter((rule) => rule.id.startsWith("cn."))).toHaveLength(4);
        expect(rules.some((rule) => rule.id === "mechanical-elevation-ending")).toBe(true);
        expect(rules.some((rule) => rule.id === "opening-cliche-announce" && rule.namespace === "opening.cliche")).toBe(true);
        expect(rules.some((rule) => rule.id === "inflation-novelty" && rule.namespace === "inflation.significance")).toBe(true);
        expect(rules.some((rule) => rule.id === "mechanical-zero-width" && rule.namespace === "mechanical.zero-width")).toBe(true);
        expect(rules.some((rule) => /^cn\..+\.[0-9a-f]{10}$/.test(rule.id))).toBe(false);
        expect(rules.some((rule) => rule.namespace === "vocabulary.r18" && rule.enabled !== false)).toBe(true);
        expect(rules.some((rule) => rule.namespace === "modifier.extreme" && rule.enabled !== false)).toBe(false);
        expect(JSON.stringify(rules)).not.toContain(`leg${"acy"}`);
        expect(rules.filter((rule) => rule.id.startsWith("cn.")).every((rule) => rule.source?.importedFrom === "curated-cn-rule-samples")).toBe(true);
        expect(rules.some((rule) => rule.id === "cn.vocabulary.body.skull-head")).toBe(true);
        const cnSlugs = rules
            .filter((rule) => rule.id.startsWith("cn."))
            .map((rule) => rule.id.split(".").at(-1) ?? "");
        expect(cnSlugs.every((slug) => slug.length <= 40)).toBe(true);
        expect(cnSlugs).not.toEqual(expect.arrayContaining([
            "tou-lu",
            "cu-zhong-cu-bao-feng-kuang-de-di",
            "zhi-shan-mo-wei-huo-dui-hua-qian-zhi-fen-ju",
            "punctuation-4",
        ]));
        const headRule = rules.find((rule) => rule.detector.type === "regex" && rule.detector.targets.includes("头颅"));
        expect(headRule?.action.replacements)
            .toEqual(expect.arrayContaining(["头", "脑袋"]));
    });

    it("curated import 遇到缺失 slug 映射会失败", async () => {
        const root = await mkdtemp(join(tmpdir(), "llmlint-curated-missing-slug-"));
        tempRoots.push(root);
        const sourceRoot = join(root, "source");
        await writeCuratedSourceFixture(sourceRoot);
        const key = "vocabulary.body\t\t头颅";
        const original = CURATED_RULE_SLUGS[key];
        delete CURATED_RULE_SLUGS[key];

        try {
            await expect(importCuratedRulesets({
                sourceRoot,
                outputRoot: root,
            })).rejects.toThrow("缺少中文规则 slug 映射");
        } finally {
            if (original) {
                CURATED_RULE_SLUGS[key] = original;
            }
        }
    });

    it("loader 解析 review / fixability：命名空间策略优先于 detector/action 推导", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            regexRule("test.policy.dash", "punctuation.dash", "破折号", "甲词"),
            {
                id: "test.policy.dedup",
                namespace: "punctuation.dedup",
                title: "连续符号去重",
                level: "medium",
                detector: {type: "regex", targets: ["乙词"]},
                action: {type: "replace", replacements: ["乙"]},
            },
            regexRule("test.policy.plain", "test.plain", "普通替换", "丙词"),
            {
                id: "test.policy.suggest",
                namespace: "test.plain",
                title: "纯提示",
                level: "medium",
                detector: {type: "regex", targets: ["丁词"]},
                action: {type: "suggest", message: "读取上下文"},
            },
        ]);

        const loadedRules = await loadRules(emptyConfig([rulesetId]));
        const byId = new Map(loadedRules.rules.map((rule) => [rule.id, rule]));

        expect(byId.get("test.policy.dash")).toMatchObject({review: "human", fixability: "manual"});
        expect(byId.get("test.policy.dedup")).toMatchObject({review: "none", fixability: "auto"});
        expect(byId.get("test.policy.plain")).toMatchObject({review: "agent", fixability: "manual"});
        expect(byId.get("test.policy.suggest")).toMatchObject({review: "agent", fixability: "manual"});
    });

    it("当前创作报告中的 strong 规则可覆盖粗粒度 namespace 路由进入 Agent 桶", async () => {
        const loadedRules = await loadRules(emptyConfig(["builtin/default"]));
        const byId = new Map(loadedRules.rules.map((rule) => [rule.id, rule]));
        const strongOverrides = [
            "cn.modifier.measure.subject-measure-word",
            "cn.proliferation.mixed.repeated-de-pairs",
        ];

        for (const ruleId of strongOverrides) {
            expect(byId.get(ruleId)?.review).toBe("agent");
        }
        expect(byId.get("cn.modifier.absolute-claim-modifier")?.review).toBe("human");
        expect(byId.get("cn.modifier.optional-mood-modifiers")?.review).toBe("human");
        expect(byId.get("cn.sentence.compound.contrastive-turn-preface")?.review).toBe("human");
        expect(byId.get("cn.action-expression.mouth-corner-arc")?.review).toBe("human");
        expect(byId.get("opening-cliche-era")?.review).toBe("human");
        expect(byId.get("transition-summary-restate")?.review).toBe("human");
        expect(byId.get("inflation-superlative")?.review).toBe("human");
        expect(byId.get("inflation-novelty")?.review).toBe("human");
        expect(byId.get("story-deslop.action-list")?.review).toBe("human");
        expect(byId.get("cn.cliche.trailing-sound-clause")?.review).toBe("human");
        expect(byId.get("cn.cliche.direct-mouth-arc")?.review).toBe("human");
        expect(byId.get("cn.cliche.trailing-mouth-arc-clause")?.review).toBe("human");
        expect(byId.get("cn.cliche.hand-color-clause")?.review).toBe("human");
        expect(byId.get("cn.cliche.body-reaction.physiological-tears")?.review).toBe("human");
        expect(byId.get("cn.punctuation.dedup.repeated-symbols")).toMatchObject({review: "human", fixability: "manual"});
        expect(byId.get("cn.cliche.baguwen.irrefutable-tone-colon")?.review).toBe("human");
        expect(byId.get("cn.cliche.baguwen.irresistible-but")?.review).toBe("human");
        expect(byId.get("cn.cliche.baguwen.taut-neck")?.review).toBe("human");
        expect(byId.get("cn.cliche.baguwen.unquestionable-claim")?.review).toBe("human");
        expect(byId.get("cn.sentence.compound.dialogue-echo-after-quote")?.review).toBe("human");
        expect(byId.get("cn.sentence.compound.setting-space-preface")?.review).toBe("human");
        expect(byId.get("cn.regex.advanced.few-degree")?.review).toBe("human");
        expect(byId.get("cn.action-expression.flat-tone-shell")?.review).toBe("human");
        expect(byId.get("cn.action-expression.force-white-knuckle")?.review).toBe("human");
        expect(byId.get("cn.action-expression.explicit-teasing-tone")?.review).toBe("human");
        expect(byId.get("cn.action-expression.rough-manner-modifier")?.review).toBe("human");
        expect(byId.get("cn.action-expression.teasing-attitude-shell")?.review).toBe("human");
        expect(byId.get("cn.action-expression.tightly-clenched")?.review).toBe("human");
        expect(byId.get("cn.cliche.cup-collision")?.review).toBe("human");
        expect(byId.get("cn.cliche.table-cup-touch")?.review).toBe("human");
        expect(byId.get("cn.cliche.knuckle-crack")?.review).toBe("human");
        expect(byId.get("cn.cliche.chest-rise")?.review).toBe("human");
        expect(byId.get("cn.cliche.chest-vibration")?.review).toBe("human");
        expect(byId.get("cn.cliche.cold-touch-shell")?.review).toBe("human");
        expect(byId.get("cn.cliche.drained-face")?.review).toBe("human");
        expect(byId.get("cn.cliche.hand-appearance-shell")?.review).toBe("human");
        expect(byId.get("cn.cliche.rough-fingertip-touch")?.review).toBe("human");
        expect(byId.get("cn.cliche.teeth-pressed-speech")?.review).toBe("human");
        expect(byId.get("cn.cliche.throat-roll")?.review).toBe("human");
        expect(byId.get("cn.cliche.tongue-roll")?.review).toBe("human");
        expect(byId.get("cn.cliche.voice-evaluation-abrupt")?.review).toBe("human");
        expect(byId.get("cn.cliche.voice-evaluation-clear")?.review).toBe("human");
        expect(byId.get("cn.cliche.voice-travel-shell")?.review).toBe("human");
        expect(byId.get("cn.cliche.warm-palm-touch")?.review).toBe("human");
        expect(byId.get("cn.cliche.words-chewing")?.review).toBe("human");
        expect(byId.get("cn.sentence.compound.generic-comparison-tone")?.review).toBe("human");
        expect(byId.get("cn.sentence.compound.weather-tone-chat")?.review).toBe("human");
        expect(byId.get("cn.sentence.compound.weather-tone-chat-today")?.review).toBe("human");
        expect(byId.get("cn.sentence.compound.weather-tone-direct-state")?.review).toBe("human");
        expect(byId.get("cn.sentence.compound.weather-tone-discuss")?.review).toBe("human");
        expect(byId.get("cn.sentence.compound.weather-tone-discussion")?.review).toBe("human");
        expect(scanText("过了几分钟，他安心了几分。", [byId.get("cn.regex.advanced.few-degree") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["了几分"]);
        expect(scanText("拿到了近乎成本价的新灯，取而代之的是旧灯。", [byId.get("cn.cliche.vague-transition-phrase") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["取而代之的是"]);
        expect(scanText("她停下，一股寒意涌来，心里有一股火，那股压力还在。", [byId.get("cn.cliche.baguwen.vague-amount-noun") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["一股", "那股"]);
        expect(scanText("她停下，一股寒意涌来，心里有一股火，那股压力还在。", [byId.get("cn.modifier.measure.subject-measure-word") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["一股"]);
        expect(scanText("这具身体还能思考，那具身体已经不见了。", [byId.get("cn.modifier.measure.subject-measure-word") as RegexRuleRecord]))
            .toHaveLength(0);
        expect(scanText("这种场面、那种职业、心里有一股火，那股压力还在，语气带着几分冷意。", [byId.get("cn.modifier.measure.specific-measure-word") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["几分"]);
        expect(scanText("他还有一丝丝犹豫和一丝不安。", [byId.get("cn.modifier.measure.specific-measure-word") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["一丝丝", "一丝"]);
        expect(scanText("这句话沉甸甸的，落下来时沉甸甸。", [byId.get("cn.modifier.heavy-degree-shell") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["沉甸甸"]);
        expect(scanText("这句话沉甸甸的，落下来时沉甸甸。", [byId.get("cn.modifier.sensory-atmosphere-modifier") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["沉甸甸的"]);
        expect(scanText("她露出戏谑的笑，低哑的声音压下来。", [byId.get("cn.modifier.sensory-atmosphere-modifier") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["低哑的"]);
        expect(scanText("她露出戏谑的笑，低哑的声音压下来。", [byId.get("cn.action-expression.teasing-modifier") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["戏谑的"]);
        expect(scanText("生理性的反应与生理眼泪、生理快感、生理性快感不同。", [byId.get("cn.modifier.measure.physiological-label") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["生理", "生理", "生理性"]);
        expect(scanText("生理性的反应、生理性快感、生理眼泪、生理层面的解释、生理本能的冲动。", [byId.get("cn.vocabulary.academic-anatomy.physiological-academic-label") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["生理性的", "生理层面的", "生理本能的"]);
        expect(scanText("非常清楚，极其细微，本质上来说如此，根本上不同。", [byId.get("adverb-intensifier") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["非常", "根本上"]);
        expect(scanText("十分清楚，过了十分钟，又卡了二十分钟。", [byId.get("adverb-intensifier") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["十分"]);
        expect(scanText("“嘎噢噢！！”她问：“真的？？？”", [byId.get("cn.punctuation.dedup.repeated-symbols") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["！！", "？？？"]);
        expect(scanText("非常清楚，极其细微，本质上来说如此。", [byId.get("cn.modifier.stacked-degree-adverbs") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["极其"]);
        expect(scanText("他突然回头，忽然笑了，稍微停顿，略微弯腰，凶猛的怪兽，下意识抬手。", [byId.get("cn.modifier.stacked-degree-adverbs") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual([]);
        expect(scanText("他下意识地回头，微微一笑，完全陌生，死死盯着，一丝丝不安近乎于窒息。", [byId.get("cn.modifier.stacked-degree-adverbs") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["下意识地", "微微", "完全", "死死"]);
        expect(scanText("她近乎于宣判地开口，取而代之的是沉默。", [byId.get("cn.cliche.vague-transition-phrase") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["近乎于", "取而代之的是"]);
        expect(scanText("她快要崩溃，崩溃的边缘仍有一点清醒。", [byId.get("cn.modifier.near-collapse-modifier") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["快要崩溃"]);
        expect(scanText("非常清楚，极其细微，本质上来说如此。", [byId.get("transition-summary-essence") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["本质上来说"]);
        expect(scanText("并不是这个地方，而是另一处。这里不是终点，而是新的开始。", [byId.get("cn.sentence.compound.single-negative-contrast") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["这里不是终点，而是"]);
        expect(scanText("并不是这个地方，而是另一处。这里不是终点，而是新的开始。", [byId.get("cn.sentence.compound.contrastive-turn-preface") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["并不是这个地方，而是", "不是终点，而是"]);
        expect(scanText("这是不容置疑的权威感。", [byId.get("cn.cliche.baguwen.unquestionable-claim") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual([]);
        expect(scanText("这是不容置疑的权威感。", [byId.get("cn.modifier.absolute-claim-modifier") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["不容置疑的"]);
        expect(scanText("这事不容置疑。", [byId.get("cn.cliche.baguwen.unquestionable-claim") as RegexRuleRecord])
            .map((issue) => issue.match)).toEqual(["不容置疑"]);

        const trailingSensoryRule = byId.get("cn.cliche.trailing-sensory-clause") as RegexRuleRecord;
        expect(trailingSensoryRule.scope).toEqual({layer: "narrative"});
        expect(scanText("她停在门口，带着一点倦意。", [trailingSensoryRule])
            .map((issue) => issue.match)).toEqual(["，带着一点倦意"]);
        expect(scanText("她问道，语气里带着一丝无奈。", [trailingSensoryRule])
            .map((issue) => issue.match)).toEqual(["，语气里带着一丝无奈"]);
        expect(scanText("大剑撕裂空气，带着破风声斜斩而下。指甲锋利如刀，空气带着灰尘和血腥气。", [trailingSensoryRule]))
            .toHaveLength(0);
        expect(scanText("【成为闪耀的魔法少女，让所有人记住你的名字，带着她的那份一起活下去吧。】", [trailingSensoryRule])
            .map((issue) => issue.match)).toEqual([]);
        expect(scanText("三个夜班，三室一厅，凌晨三点。", loadedRules.regexRules)
            .some((issue) => issue.rule.id === "cn.numeral.three.numeral-three")).toBe(false);
        expect(byId.get("cn.proliferation.mixed.extra-punctuation")).toBeUndefined();
        expect(byId.get("cn.punctuation.dash.dash-alone-to-comma")).toBeUndefined();

        const catalog = await loadRuleCatalog(emptyConfig(["builtin/default"]));
        const catalogById = new Map(catalog.catalog.map((item) => [item.rule.id, item.rule]));
        expect(catalogById.get("cn.proliferation.mixed.extra-punctuation")).toMatchObject({enabled: false});
        expect(catalogById.get("cn.punctuation.dash.dash-alone-to-comma")).toMatchObject({enabled: false});
        expect(catalogById.get("cn.modifier.ineffable-absolute-modifier")).toMatchObject({enabled: false});
        expect(catalogById.get("cn.modifier.sticky-optional")).toMatchObject({enabled: false});

        const businessRule = byId.get("business-jargon") as RegexRuleRecord;
        expect(scanText("眼珠一转，飞快地理清思绪。她轻巧落地，走到落地镜前。", [businessRule])).toHaveLength(0);
        expect(scanText("灵魂链路锁定，这种打法太暴力，情绪最终沉淀下来。", [businessRule])).toHaveLength(0);
        expect(scanText("团队需要对齐业务链路，推动方案落地，并沉淀增长打法。", [businessRule]).map((issue) => issue.match))
            .toEqual(["对齐", "业务链路", "方案落地", "增长打法"]);

        const lazyExtremesRule = byId.get("lazy-extremes") as RegexRuleRecord;
        expect(scanText("所有人都会死，包括我。她一定会回来，那只猫永远没货。", [lazyExtremesRule]))
            .toHaveLength(0);
        expect(scanText("没有人能例外，任何人都必然如此。", [lazyExtremesRule]).map((issue) => issue.match))
            .toEqual(["没有人", "任何人都", "必然"]);
    });

    it("默认 ruleset 只有确定性机械规则可自动修复，语义 replace 全部为 manual", async () => {
        const loadedRules = await loadRules(emptyConfig(["builtin/default"]));
        const counts = {auto: 0, candidate: 0, manual: 0};
        for (const rule of loadedRules.regexRules) {
            counts[rule.fixability] += 1;
        }

        expect(counts).toEqual({auto: 2, candidate: 0, manual: 259});
        expect(loadedRules.regexRules
            .filter((rule) => rule.fixability === "auto")
            .every((rule) => rule.action.type === "replace")).toBe(true);
    });

    it("用户配置仍可把指定语义 replace 显式提升为 candidate", async () => {
        const loadedRules = await loadRules({
            ...emptyConfig(["builtin/default"]),
            rules: {"not-but-structure": {enabled: true, fixability: "candidate"}},
        });

        expect(loadedRules.regexRules.find((rule) => rule.id === "not-but-structure")?.fixability).toBe("candidate");
    });

    it("config 对象覆盖能调整 review，rule id 优先于 namespace", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            regexRule("test.review.a", "test.review", "规则 A", "甲词"),
            regexRule("test.review.b", "test.review", "规则 B", "乙词"),
        ]);

        const loadedRules = await loadRules({
            rulesets: [rulesetId],
            trustedRulesets: [],
            ignoreTerms: [],
            rulesetOverrides: {},
            namespaces: {"test.review": {review: "human"}},
            rules: {"test.review.a": {review: "none"}},
            output: "stylish",
        });
        const byId = new Map(loadedRules.rules.map((rule) => [rule.id, rule]));

        expect(byId.get("test.review.a")?.review).toBe("none");
        expect(byId.get("test.review.b")?.review).toBe("human");
    });

    it("规则文件中的 review / fixability 会被读取，但非 replace 规则不能伪装成可修复", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            {
                id: "test.explicit.replace",
                namespace: "test.explicit",
                title: "显式候选替换",
                level: "medium",
                review: "human",
                fixability: "candidate",
                detector: {type: "regex", targets: ["甲词"]},
                action: {type: "replace", replacements: ["乙词"]},
            },
            {
                id: "test.explicit.suggest",
                namespace: "test.explicit",
                title: "伪候选提示",
                level: "medium",
                review: "human",
                fixability: "candidate",
                detector: {type: "regex", targets: ["丙词"]},
                action: {type: "suggest", message: "只提示"},
            },
            {
                id: "test.explicit.llm",
                namespace: "test.explicit",
                title: "伪候选语义规则",
                level: "medium",
                review: "agent",
                fixability: "candidate",
                detector: {type: "llm", prompt: "读全文判断"},
                action: {type: "suggest", message: "只提示"},
            },
        ]);

        const loadedRules = await loadRules(emptyConfig([rulesetId]));
        const byId = new Map(loadedRules.rules.map((rule) => [rule.id, rule]));

        expect(byId.get("test.explicit.replace")).toMatchObject({review: "human", fixability: "candidate"});
        expect(byId.get("test.explicit.suggest")).toMatchObject({review: "human", fixability: "manual"});
        expect(byId.get("test.explicit.llm")).toMatchObject({review: "agent", fixability: "manual"});
    });

    it("CLI check 默认按 review=agent 过滤，--review human 显示人工桶", async () => {
        const rulesetId = `test/${randomUUID()}`;
        const root = await mkdtemp(join(tmpdir(), "llmlint-review-"));
        tempRoots.push(root, join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            regexRule("test.review.agent", "test.plain", "Agent 桶", "甲词"),
            regexRule("test.review.human", "punctuation.dash", "人工桶", "乙词"),
        ]);
        const configPath = join(root, "llmlint.config.ts");
        const textPath = join(root, "input.md");
        await writeFile(configPath, `export default {\n    rulesets: ["${rulesetId}"],\n};\n`, "utf-8");
        await writeFile(textPath, "甲词 乙词", "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "--config", configPath, "check", textPath]);
        const defaultOutput = String(log.mock.calls[0]?.[0]);
        expect(defaultOutput).toContain("test.review.agent");
        expect(defaultOutput).not.toContain("test.review.human");
        expect(defaultOutput).toContain("显示范围：review=agent；已隐藏 1 条非 agent 命中。");

        log.mockClear();
        await runCli(["bun", "llmlint", "--config", configPath, "check", textPath, "--review", "human"]);
        const humanOutput = String(log.mock.calls[0]?.[0]);
        expect(humanOutput).toContain("test.review.human");
        expect(humanOutput).not.toContain("test.review.agent");
    });

    it("JSON check filter 暴露 review 过滤与隐藏统计，issues[].rule 带 review/fixability", async () => {
        const rulesetId = `test/${randomUUID()}`;
        const root = await mkdtemp(join(tmpdir(), "llmlint-review-json-"));
        tempRoots.push(root, join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            regexRule("test.json.agent", "test.plain", "Agent 桶", "甲词"),
            regexRule("test.json.human", "punctuation.dash", "人工桶", "乙词"),
        ]);
        const configPath = join(root, "llmlint.config.ts");
        const textPath = join(root, "input.md");
        await writeFile(configPath, `export default {\n    rulesets: ["${rulesetId}"],\n    output: "json",\n};\n`, "utf-8");
        await writeFile(textPath, "甲词 乙词", "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "--config", configPath, "check", textPath]);
        const report = JSON.parse(String(log.mock.calls[0]?.[0])) as {
            filter: {review: string; hiddenByReview: number; minLevel: string; hiddenByLevel: number};
            issues: Array<{rule: {review: string; fixability: string}}>;
        };
        expect(report.filter).toMatchObject({review: "agent", hiddenByReview: 1, minLevel: "low", hiddenByLevel: 0});
        expect(report.issues).toHaveLength(1);
        expect(report.issues[0]?.rule).toMatchObject({review: "agent", fixability: "manual"});
    });

    it("candidate 只允许显式应用，不能进入一键机械修复", () => {
        const candidate = issueForRule({...makeAutoRule("test.candidate", "甲词", ""), review: "agent", fixability: "candidate"});
        const automatic = issueForRule(makeAutoRule("test.auto", "乙词", ""));

        expect(isIssueReplacementApplicable(candidate)).toBe(true);
        expect(isIssueAutoApplicable(candidate)).toBe(false);
        expect(isIssueReplacementApplicable(automatic)).toBe(true);
        expect(isIssueAutoApplicable(automatic)).toBe(true);
    });

    it("config review 非法值返回明确 schema 错误", async () => {
        const root = await mkdtemp(join(tmpdir(), "llmlint-bad-review-"));
        tempRoots.push(root);
        const configPath = join(root, "llmlint.config.ts");
        await writeFile(configPath, `export default {\n    rulesets: ["builtin/default"],\n    rules: {"filler-word-actually": {review: "robot"}},\n};\n`, "utf-8");

        await expect(loadConfig({cwd: process.cwd(), configPath})).rejects.toThrow("review 无效");
    });

    it("对象覆盖 {enabled:true} 能启用默认禁用的规则并同时设级别与受众", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            {...regexRule("test.enable.obj", "test.enable", "默认禁用规则", "甲词"), enabled: false},
        ]);

        const baseline = await loadRules(emptyConfig([rulesetId]));
        expect(baseline.rules.some((rule) => rule.id === "test.enable.obj")).toBe(false);

        const loadedRules = await loadRules({
            rulesets: [rulesetId],
            trustedRulesets: [],
            ignoreTerms: [],
            rulesetOverrides: {},
            namespaces: {},
            rules: {"test.enable.obj": {enabled: true, level: "high", review: "human"}},
            output: "stylish",
        });
        const rule = loadedRules.rules.find((item) => item.id === "test.enable.obj");
        expect(rule).toMatchObject({level: "high", review: "human"});
    });

    it("浏览器端 materializeRules 能从 catalog 启用默认禁用规则，并与 loadRules 覆盖语义一致", async () => {
        const baseConfig = emptyConfig(["builtin/default"]);
        const source = await loadRuleCatalog(baseConfig);
        const disabled = source.catalog.find((item) => !item.defaultEnabled);
        expect(disabled).toBeDefined();

        const config = {
            ...baseConfig,
            rules: {
                [disabled!.rule.id]: {enabled: true, level: "high" as const, review: "human" as const},
            },
        };
        const materialized = materializeRules({
            catalog: source.catalog,
            config,
            diagnostics: source.diagnostics,
            namespaceAliases: source.namespaceAliases,
            loadedRulesets: source.loadedRulesets,
        });
        const loaded = await loadRules(config);

        expect(materialized.rules.find((rule) => rule.id === disabled!.rule.id)).toMatchObject({level: "high", review: "human"});
        expect(loaded.rules.find((rule) => rule.id === disabled!.rule.id)).toEqual(materialized.rules.find((rule) => rule.id === disabled!.rule.id));
        expect(materialized.summary.activeRules).toBe(loaded.summary.activeRules);
    });

    it("Web 设置归一化会丢弃非法旧值，并保留合法规则覆盖", () => {
        const settings = normalizeWebSettings({
            locale: "ja-JP",
            theme: "sepia",
            review: "robot",
            minLevel: "medium",
            namespaces: ["filler", 123],
            scanAll: true,
            highlight: false,
            namespaceOverrides: {
                filler: {enabled: false, level: "high", extra: "drop"},
                allReview: {enabled: true, review: "all"},
                bad: {},
            },
            ruleOverrides: {
                "filler-word-actually": {enabled: true, review: "human", fixability: "candidate"},
                allOnly: {review: "all"},
                broken: {review: "robot"},
            },
        });
        const filterSettings = normalizeWebSettings({review: "all"});

        expect(settings.locale).toBe("zh-CN");
        expect(settings.theme).toBe("sepia");
        expect(settings.review).toBe("agent");
        expect(settings.minLevel).toBe("medium");
        expect(settings.namespaces).toEqual(["filler"]);
        expect(settings.scanAll).toBe(true);
        expect(settings.highlight).toBe(false);
        expect(settings.namespaceOverrides.filler).toEqual({enabled: false, level: "high"});
        expect(settings.namespaceOverrides.allReview).toEqual({enabled: true});
        expect(settings.namespaceOverrides.bad).toBeUndefined();
        expect(settings.ruleOverrides["filler-word-actually"]).toEqual({enabled: true, review: "human", fixability: "candidate"});
        expect(settings.ruleOverrides.allOnly).toBeUndefined();
        expect(settings.ruleOverrides.broken).toBeUndefined();
        expect(filterSettings.review).toBe("all");
    });

    it("纯属性对象覆盖不复活被关闭 ruleset 的规则，显式 {enabled:true} 才复活", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            regexRule("test.resurrect.rule", "test.resurrect", "规则", "甲词"),
        ]);

        const attrOnly = await loadRules({
            rulesets: [rulesetId],
            trustedRulesets: [],
            ignoreTerms: [],
            rulesetOverrides: {[rulesetId]: "off"},
            namespaces: {"test.resurrect": {review: "human"}},
            rules: {},
            output: "stylish",
        });
        expect(attrOnly.rules.some((rule) => rule.id === "test.resurrect.rule")).toBe(false);

        const withEnable = await loadRules({
            rulesets: [rulesetId],
            trustedRulesets: [],
            ignoreTerms: [],
            rulesetOverrides: {[rulesetId]: "off"},
            namespaces: {"test.resurrect": {enabled: true, review: "human"}},
            rules: {},
            output: "stylish",
        });
        expect(withEnable.rules.some((rule) => rule.id === "test.resurrect.rule")).toBe(true);
    });

    it("config 文件中的字符串简写仍能启用被关闭 ruleset 的规则", async () => {
        const rulesetId = `test/${randomUUID()}`;
        const root = await mkdtemp(join(tmpdir(), "llmlint-sugar-"));
        tempRoots.push(root, join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            regexRule("test.sugar.rule", "test.sugar", "规则", "甲词"),
        ]);
        const configPath = join(root, "llmlint.config.ts");
        await writeFile(configPath, `export default {\n    rulesets: ["${rulesetId}"],\n    rulesetOverrides: {"${rulesetId}": "off"},\n    rules: {"test.sugar.rule": "high"},\n};\n`, "utf-8");

        const {config} = await loadConfig({cwd: process.cwd(), configPath});
        const loadedRules = await loadRules(config);
        const rule = loadedRules.rules.find((item) => item.id === "test.sugar.rule");
        expect(rule?.level).toBe("high");
    });

    it("显式配置路径不存在时返回明确错误", async () => {
        await expect(loadConfig({
            cwd: process.cwd(),
            configPath: join(tmpdir(), "missing-llmlint.config.ts"),
        })).rejects.toThrow("配置文件不存在");
    });

    it("computeMaskedRanges 覆盖 frontmatter / 代码块 / 行内代码 / 链接", () => {
        const content = [
            "---",
            "title: x",
            "---",
            "正文 `code` 与 [note](http://e.com)。",
            "```js",
            "const a = 1;",
            "```",
        ].join("\n");
        const ranges = computeMaskedRanges(content);

        expect(ranges[0]?.[0]).toBe(0); // frontmatter 从文件首字符开始
        expect(isMasked(content.indexOf("`code`"), ranges)).toBe(true);
        expect(isMasked(content.indexOf("[note]"), ranges)).toBe(true);
        expect(isMasked(content.indexOf("const a"), ranges)).toBe(true);
        expect(isMasked(content.indexOf("正文 "), ranges)).toBe(false);
    });

    it("scanText 跳过 Markdown 遮罩区域内的命中，但保留正文命中与定位", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [regexRule("test.mask.filler", "test.plain", "填充", "其实")]);
        const loadedRules = await loadRules(emptyConfig([rulesetId]));
        const content = "正文其实在这。\n\n```\n代码其实不算\n```\n";

        const unmasked = scanText(content, loadedRules.regexRules);
        const masked = scanText(content, loadedRules.regexRules, {maskedRanges: computeMaskedRanges(content)});

        expect(unmasked).toHaveLength(2);
        expect(masked).toHaveLength(1);
        expect(masked[0]?.line).toBe(1);
        expect(masked[0]?.match).toBe("其实");
    });

    it("CLI check 单文件 JSON 仍为 check 形态（回归保护）", async () => {
        const root = await mkdtemp(join(tmpdir(), "llmlint-single-"));
        tempRoots.push(root);
        const textPath = join(root, "input.md");
        await writeFile(textPath, "其实甲。", "utf-8");
        const configPath = join(root, "llmlint.config.ts");
        await writeFile(configPath, `export default {rulesets:["builtin/default"], output:"json"};\n`, "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "--config", configPath, "check", textPath, "--review", "all"]);
        const report = JSON.parse(String(log.mock.calls[0]?.[0])) as {kind: string; filePath: string};
        expect(report.kind).toBe("check");
        expect(report.filePath).toContain("input.md");
    });

    it("CLI check 多文件目录递归聚合，JSON 为 check-multi 形态", async () => {
        const root = await mkdtemp(join(tmpdir(), "llmlint-multi-"));
        tempRoots.push(root);
        await writeFile(join(root, "a.md"), "其实甲。", "utf-8");
        await mkdir(join(root, "sub"), {recursive: true});
        await writeFile(join(root, "sub", "b.md"), "其实乙。", "utf-8");
        const configPath = join(root, "llmlint.config.ts");
        await writeFile(configPath, `export default {rulesets:["builtin/default"], output:"json"};\n`, "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "--config", configPath, "check", root, "--review", "all"]);
        const report = JSON.parse(String(log.mock.calls[0]?.[0])) as {kind: string; files: Array<{filePath: string; issues: unknown[]}>; summary: {total: number}};
        expect(report.kind).toBe("check-multi");
        expect(report.files).toHaveLength(2);
        expect(report.summary.total).toBeGreaterThanOrEqual(2);
    });

    it("CLI check --scan-all 关闭 Markdown 遮罩，代码块命中回来", async () => {
        const root = await mkdtemp(join(tmpdir(), "llmlint-scanall-"));
        tempRoots.push(root);
        const textPath = join(root, "input.md");
        await writeFile(textPath, "正文。\n\n```\n其实代码\n```\n", "utf-8");
        const configPath = join(root, "llmlint.config.ts");
        await writeFile(configPath, `export default {rulesets:["builtin/default"]};\n`, "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "--config", configPath, "check", textPath, "--review", "all"]);
        expect(String(log.mock.calls[0]?.[0])).not.toContain("其实");

        log.mockClear();
        await runCli(["bun", "llmlint", "--config", configPath, "check", textPath, "--review", "all", "--scan-all"]);
        expect(String(log.mock.calls[0]?.[0])).toContain("其实");
    });

    it("CLI check 输入路径不存在时报错并非零退出", async () => {
        const result = await runFailedCommand([LLMLINT_BIN, "check", join(tmpdir(), `missing-${randomUUID()}.md`)]);

        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain("不存在");
    });

    it("fix dry-run 检出 auto 修复但不改文件，退出码非零", async () => {
        const root = await mkdtemp(join(tmpdir(), "llmlint-fix-dry-"));
        tempRoots.push(root);
        const filePath = join(root, "doc.md");
        const zwsp = String.fromCharCode(0x200B);
        const original = `正文${zwsp}有零宽。\n\n真的？？？\n`;
        await writeFile(filePath, original, "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "fix", filePath]);

        expect(process.exitCode).toBe(1);
        expect(await readFile(filePath, "utf-8")).toBe(original);
        expect(String(log.mock.calls[0]?.[0])).toContain("dry-run");
    });

    it("fix --write 落盘：删零宽、省略号尾巴，不自动压缩对白重复符号", async () => {
        const root = await mkdtemp(join(tmpdir(), "llmlint-fix-write-"));
        tempRoots.push(root);
        const filePath = join(root, "doc.md");
        const zwsp = String.fromCharCode(0x200B);
        await writeFile(filePath, `正文${zwsp}有零宽。\n\n尾巴……...\n\n真的？？？\n`, "utf-8");
        vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "fix", filePath, "--write"]);

        expect(await readFile(filePath, "utf-8")).toBe("正文有零宽。\n\n尾巴……\n\n真的？？？\n");
        expect(process.exitCode).not.toBe(1);
    });

    it("fix 尊重 Markdown 遮罩：代码块内机械标点不被修复", async () => {
        const root = await mkdtemp(join(tmpdir(), "llmlint-fix-mask-"));
        tempRoots.push(root);
        const filePath = join(root, "doc.md");
        await writeFile(filePath, "真的……...\n\n```\n代码……...保留\n```\n", "utf-8");
        vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "fix", filePath, "--write"]);
        const fixed = await readFile(filePath, "utf-8");

        expect(fixed).toContain("真的……\n");
        expect(fixed).toContain("代码……...保留");
    });

    it("单条 auto 替换保留全文上下文，支持 lookbehind 删除", () => {
        const content = "他说……...";
        const rule = makeAutoRule("test.punctuation.ellipsis-tail", "(?<=……)[….]+", "");
        const startOffset = content.indexOf("...");
        const issue = makeIssue(content, rule, startOffset, "...");

        const result = applySingleIssueReplacement(content, issue, startOffset);

        expect(result).toEqual({
            replacement: "",
            fixed: "他说……",
        });
    });

    it("单条 auto 替换支持连续标点收敛和零宽删除", () => {
        const punctuationContent = "测试！！！";
        const punctuationRule = makeAutoRule("test.punctuation.dedup", "([！？!?.。])\\1+", "$1");
        const punctuationIssue = makeIssue(punctuationContent, punctuationRule, 2, "！！！");
        const zeroWidthContent = `测${String.fromCharCode(0x200B)}试`;
        const zeroWidthRule = makeAutoRule("test.mechanical.zero-width", "[\\u200B-\\u200D\\uFEFF]", "");
        const zeroWidthIssue = makeIssue(zeroWidthContent, zeroWidthRule, 1, String.fromCharCode(0x200B));

        expect(applySingleIssueReplacement(punctuationContent, punctuationIssue, 2)).toEqual({
            replacement: "！",
            fixed: "测试！",
        });
        expect(applySingleIssueReplacement(zeroWidthContent, zeroWidthIssue, 1)).toEqual({
            replacement: "",
            fixed: "测试",
        });
    });

    it("单条 auto 替换支持捕获组模板", () => {
        const content = "第12章";
        const rule = makeAutoRule("test.capture.chapter", "(第)(\\d+)(章)", "$1$2节");
        const issue = makeIssue(content, rule, 0, content);

        const result = applySingleIssueReplacement(content, issue, 0);

        expect(result).toEqual({
            replacement: "第12节",
            fixed: "第12节",
        });
    });

    it("单条替换默认不应用 candidate，显式允许后可供 Web 修复模式人工确认", () => {
        const content = "其实很好";
        const rule: RegexRuleRecord = {
            ...makeAutoRule("test.candidate.filler", "其实", ""),
            review: "human",
            fixability: "candidate",
        };
        const issue = makeIssue(content, rule, 0, "其实");

        expect(applySingleIssueReplacement(content, issue, 0)).toBeNull();
        expect(applySingleIssueReplacement(content, issue, 0, {allowedFixabilities: ["auto", "candidate"]})).toEqual({
            replacement: "",
            fixed: "很好",
        });
    });

    it("Review issue UI 文案统一区分候选删除和应用候选删除", () => {
        const t = (key: MessageKey, params: Record<string, string | number> = {}) => Object.entries(params).reduce(
            (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
            messages["zh-CN"][key],
        );
        const candidateDelete: ReviewIssueMark = {
            id: "issue-1",
            ruleId: "filler-word-actually",
            level: "medium",
            from: 0,
            to: 2,
            title: "删除口头填充词",
            match: "其实",
            replacement: "",
            fixability: "candidate",
        };

        expect(reviewIssueLevelLabel(candidateDelete, t)).toBe("中");
        expect(reviewIssueActionLabel(candidateDelete, t)).toBe("候选可删除");
        expect(reviewReplacementTitle(candidateDelete, t)).toBe("候选 · 删除口头填充词: 删除「其实」");
        expect(reviewReplacementActionLabel(candidateDelete, t)).toBe("候选删除");
        expect(reviewReplacementActionLabel(candidateDelete, t, {applyPrefix: true})).toBe("应用候选删除");
    });

    it("批量 auto 修复返回最终文本中的 diff 标注区间", () => {
        const zeroWidth = String.fromCharCode(0x200B);
        const content = `测试！！！\n测${zeroWidth}试\n\`\`\`\n保留！！！\n\`\`\``;
        const punctuationRule = makeAutoRule("test.punctuation.dedup", "([！？!?.。])\\1+", "$1");
        const zeroWidthRule = makeAutoRule("test.mechanical.zero-width", "[\\u200B-\\u200D\\uFEFF]", "");

        const result = applyAutoFixWithChanges(content, [punctuationRule, zeroWidthRule], computeMaskedRanges(content));

        expect(result.fixed).toBe("测试！\n测试\n```\n保留！！！\n```");
        expect(result.changes).toMatchObject([
            {from: 2, to: 3, deleted: "！！！", inserted: "！", ruleId: punctuationRule.id},
            {from: 5, to: 5, deleted: zeroWidth, inserted: "", ruleId: zeroWidthRule.id},
        ]);
        expect(result.fixed.slice(result.changes[0]!.from, result.changes[0]!.to)).toBe("！");
        expect(result.fixed.slice(result.changes[1]!.from, result.changes[1]!.to)).toBe("");
    });

    it("Markdown 链接输入会从选中的 URL 和邮箱预填 href", () => {
        const source = "参考 https://example.com/path，也可联系 editor@example.com，或访问 www.example.com。";
        const urlStart = source.indexOf("https://example.com/path");
        const emailStart = source.indexOf("editor@example.com");
        const wwwStart = source.indexOf("www.example.com");

        expect(markdownSelectionLinkInputHref(source, urlStart, urlStart + "https://example.com/path".length, "https://example.com/path")).toBe("https://example.com/path");
        expect(markdownSelectionLinkInputHref(source, emailStart, emailStart + "editor@example.com".length, "editor@example.com")).toBe("mailto:editor@example.com");
        expect(markdownSelectionLinkInputHref(source, wwwStart, wwwStart + "www.example.com".length, "www.example.com")).toBe("https://www.example.com");
    });

    it("Markdown 链接输入会清理选中 URL 尾部句末标点和不匹配括号", () => {
        expect(markdownSelectionLinkInputHref("参考 https://example.com/path。", 3, 28, "https://example.com/path。")).toBe("https://example.com/path");
        expect(markdownSelectionLinkInputHref("联系 editor@example.com。", 3, 22, "editor@example.com。")).toBe("mailto:editor@example.com");
        expect(markdownSelectionLinkInputHref("参考 https://example.com/a(b)。", 3, 28, "https://example.com/a(b)。")).toBe("https://example.com/a(b)");
        expect(markdownSelectionLinkInputHref("参考 https://example.com/a)。", 3, 27, "https://example.com/a)。")).toBe("https://example.com/a");
    });

    it("Markdown 链接输入优先使用已有链接 href", () => {
        const source = "参考 [example](https://old.example/path)。";
        const fullStart = source.indexOf("[example]");
        const fullEnd = source.indexOf(")。");
        const labelStart = source.indexOf("example");

        expect(markdownSelectionLinkInputHref(source, fullStart, fullEnd, source.slice(fullStart, fullEnd))).toBe("https://old.example/path");
        expect(markdownSelectionLinkInputHref(source, labelStart, labelStart + "example".length, "example")).toBe("https://old.example/path");
    });

    it("Markdown 链接输入会忽略已有链接 title，只预填 destination", () => {
        const quotedTitle = "参考 [example](https://old.example/path \"旧标题\")。";
        const quotedLabelStart = quotedTitle.indexOf("example");
        const angleTitle = "参考 [example](<https://old.example/a(b)> '旧标题')。";
        const angleLabelStart = angleTitle.indexOf("example");

        expect(markdownSelectionLinkInputHref(quotedTitle, quotedLabelStart, quotedLabelStart + "example".length, "example")).toBe("https://old.example/path");
        expect(markdownSelectionLinkInputHref(angleTitle, angleLabelStart, angleLabelStart + "example".length, "example")).toBe("https://old.example/a(b)");
    });

    it("Markdown 链接输入保留已有空 href 而不重新推断", () => {
        const source = "参考 [https://example.com]()。";
        const labelStart = source.indexOf("https://example.com");
        const fullStart = source.indexOf("[https://example.com]");
        const fullEnd = source.indexOf(")。");

        expect(markdownSelectionLinkInputHref(source, labelStart, labelStart + "https://example.com".length, "https://example.com")).toBe("");
        expect(markdownSelectionLinkInputHref(source, fullStart, fullEnd, source.slice(fullStart, fullEnd))).toBe("");
    });

    it("fix 不自动应用 candidate 规则（filler 其实 不被删）", async () => {
        const root = await mkdtemp(join(tmpdir(), "llmlint-fix-candidate-"));
        tempRoots.push(root);
        const filePath = join(root, "doc.md");
        await writeFile(filePath, "其实没什么。\n", "utf-8");
        vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "fix", filePath, "--write"]);

        expect(await readFile(filePath, "utf-8")).toBe("其实没什么。\n");
    });

    it("fix --format json 输出 kind:fix 与逐文件计数", async () => {
        const root = await mkdtemp(join(tmpdir(), "llmlint-fix-json-"));
        tempRoots.push(root);
        const filePath = join(root, "doc.md");
        await writeFile(filePath, "尾巴……...\n", "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "fix", filePath, "--format", "json"]);

        const report = JSON.parse(String(log.mock.calls[0]?.[0])) as {kind: string; write: boolean; totalOccurrences: number; files: Array<{changed: boolean}>};
        expect(report.kind).toBe("fix");
        expect(report.write).toBe(false);
        expect(report.totalOccurrences).toBeGreaterThanOrEqual(1);
        expect(report.files[0]?.changed).toBe(true);
    });

    it("CLI check 支持 glob 模式与 ! 排除", async () => {
        const dir = `llmlint-glob-${randomUUID()}`;
        const absDir = resolve(process.cwd(), dir);
        tempRoots.push(absDir);
        await mkdir(join(absDir, "drafts"), {recursive: true});
        await writeFile(join(absDir, "a.md"), "其实甲。", "utf-8");
        await writeFile(join(absDir, "b.md"), "其实乙。", "utf-8");
        await writeFile(join(absDir, "drafts", "skip.md"), "其实丙。", "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "check", `${dir}/**/*.md`, `!${dir}/drafts/**`, "--review", "all", "--format", "json"]);
        const report = JSON.parse(String(log.mock.calls[0]?.[0])) as {kind: string; files: Array<{filePath: string}>};
        expect(report.kind).toBe("check-multi");
        expect(report.files).toHaveLength(2);
        expect(report.files.every((file) => !file.filePath.includes("drafts"))).toBe(true);
    });

    it("formatCheckReport color 门控：true 含 ANSI、false 纯文本", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [{...regexRule("test.color", "test.output", "颜色规则", "高风险词"), level: "high"}]);
        const loadedRules = await loadRules(emptyConfig([rulesetId]));
        const issues = scanText("有高风险词。", loadedRules.regexRules);

        const colored = formatCheckReport("input.md", issues, loadedRules, {color: true});
        const plain = formatCheckReport("input.md", issues, loadedRules, {color: false});
        const esc = String.fromCharCode(0x1B);
        expect(colored).toContain(esc);
        expect(plain).not.toContain(esc);
    });

    it("CLI check 被抓取（非 TTY）输出纯文本，无 ANSI", async () => {
        const root = await mkdtemp(join(tmpdir(), "llmlint-noansi-"));
        tempRoots.push(root);
        const filePath = join(root, "input.md");
        await writeFile(filePath, "其实甲。", "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "check", filePath, "--review", "all"]);

        expect(String(log.mock.calls[0]?.[0])).not.toContain(String.fromCharCode(0x1B));
    });
});

function emptyConfig(rulesets: string[]) {
    return {
        rulesets,
        trustedRulesets: [],
        ignoreTerms: [],
        rulesetOverrides: {},
        namespaces: {},
        rules: {},
        output: "stylish" as const,
    };
}

function regexRule(id: string, namespace: string, title: string, target: string): LintRuleRecord {
    return {
        id,
        namespace,
        title,
        level: "medium",
        detector: {type: "regex", targets: [target]},
        action: {type: "replace", replacements: [""]},
    };
}

async function writeRuleset(id: string, rules: LintRuleRecord[]): Promise<void> {
    await writeRawRuleset(id, rules);
}

async function writeMultiFileRuleset(id: string, ruleFiles: Record<string, LintRuleRecord[]>, manifestExtra: Record<string, unknown> = {}): Promise<void> {
    const root = join(RULESETS_ROOT, ...id.split("/"));
    await mkdir(root, {recursive: true});
    await writeFile(join(root, "ruleset.json"), JSON.stringify({
        id,
        title: id,
        version: "1.0.0",
        ...manifestExtra,
    }), "utf-8");
    for (const [ruleFile, rules] of Object.entries(ruleFiles)) {
        const filePath = join(root, ruleFile);
        await mkdir(dirname(filePath), {recursive: true});
        await writeFile(filePath, JSON.stringify(rules), "utf-8");
    }
}

async function writeRawRuleset(id: string, rules: object[]): Promise<void> {
    const root = join(RULESETS_ROOT, ...id.split("/"));
    await mkdir(root, {recursive: true});
    await writeFile(join(root, "ruleset.json"), JSON.stringify({
        id,
        title: id,
        version: "1.0.0",
    }), "utf-8");
    await mkdir(join(root, "rules"), {recursive: true});
    await writeFile(join(root, "rules", "index.json"), JSON.stringify(rules), "utf-8");
}

async function writeLegacyRootRulesJsonRuleset(id: string, rules: object[]): Promise<void> {
    const root = join(RULESETS_ROOT, ...id.split("/"));
    await mkdir(root, {recursive: true});
    await writeFile(join(root, "ruleset.json"), JSON.stringify({
        id,
        title: id,
        version: "1.0.0",
    }), "utf-8");
    await writeFile(join(root, "rules.json"), JSON.stringify(rules), "utf-8");
}

async function writeRulesPathAsFileRuleset(id: string): Promise<void> {
    const root = join(RULESETS_ROOT, ...id.split("/"));
    await mkdir(root, {recursive: true});
    await writeFile(join(root, "ruleset.json"), JSON.stringify({
        id,
        title: id,
        version: "1.0.0",
    }), "utf-8");
    await writeFile(join(root, "rules"), "not a directory", "utf-8");
}

function makeAutoRule(id: string, target: string, replacement: string): RegexRuleRecord {
    return {
        id,
        namespace: "test",
        ruleset: "test",
        title: id,
        level: "low",
        review: "none",
        fixability: "auto",
        detector: {
            type: "regex",
            targets: [target],
            flags: "g",
        },
        action: {
            type: "replace",
            replacements: [replacement],
        },
    };
}

/** 构造仅供 UI 修复能力判断使用的最小命中。 */
function issueForRule(rule: RegexRuleRecord): Issue {
    return {
        rule,
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 1,
        match: "甲",
        target: rule.detector.targets[0] ?? "甲",
        context: {before: "", current: "甲", after: ""},
    };
}

function makeIssue(content: string, rule: RegexRuleRecord, startOffset: number, match: string): Issue {
    return {
        rule,
        line: 1,
        column: startOffset + 1,
        endLine: 1,
        endColumn: startOffset + match.length + 1,
        match,
        target: rule.detector.targets[0] ?? "",
        context: {
            before: content.slice(0, startOffset),
            current: match,
            after: content.slice(startOffset + match.length),
        },
    };
}

async function writeInvalidJsonRuleset(id: string): Promise<void> {
    const root = join(RULESETS_ROOT, ...id.split("/"));
    await mkdir(join(root, "rules"), {recursive: true});
    await writeFile(join(root, "ruleset.json"), JSON.stringify({
        id,
        title: id,
        version: "1.0.0",
    }), "utf-8");
    await writeFile(join(root, "rules", "broken.json"), "[", "utf-8");
}

async function writeCuratedSourceFixture(root: string): Promise<void> {
    await mkdir(root, {recursive: true});
    for (const fileName of CURATED_SOURCE_FILES) {
        await writeFile(join(root, fileName), "[]\n", "utf-8");
    }
    await writeFile(join(root, "轻量规则集1.2.json"), JSON.stringify([
        {
            name: "人体词汇",
            enabled: true,
            subRules: [{
                targets: ["头颅"],
                replacements: ["头", "脑袋"],
                mode: "text",
                remark: "头颅",
            }],
        },
        {
            name: "R18词汇",
            enabled: false,
            subRules: [{
                targets: ["乳房"],
                replacements: ["胸部"],
                mode: "text",
                remark: "R18 词汇",
            }],
        },
        {
            name: "由于删除",
            enabled: true,
            subRules: [{
                targets: ["由于(?:的|地|得)?"],
                replacements: [],
                mode: "regex",
                remark: "由于删除",
            }],
        },
    ], null, 2), "utf-8");
    await writeFile(join(root, "极其杀手.json"), JSON.stringify([
        {
            name: "极其删除",
            enabled: true,
            subRules: [{
                targets: ["极其{的,地,得}?"],
                replacements: [],
                mode: "simple",
                remark: "极其删除",
            }],
        },
    ], null, 2), "utf-8");
}

async function readRulesetRules(root: string): Promise<unknown[]> {
    const ruleFiles = (await listFiles(join(root, "rules")))
        .filter((file) => file.endsWith(".json"))
        .sort((left, right) => left.localeCompare(right));
    const rules = await Promise.all(ruleFiles.map(async (ruleFile) => {
        const source = await readFile(ruleFile, "utf-8");
        return JSON.parse(source) as unknown[];
    }));
    return rules.flat();
}

async function listFiles(root: string): Promise<string[]> {
    const entries = await readdir(root, {withFileTypes: true});
    const files = await Promise.all(entries.map(async (entry) => {
        const entryPath = join(root, entry.name);
        if (entry.isDirectory()) {
            return listFiles(entryPath);
        }
        return [entryPath];
    }));
    return files.flat();
}

async function runFailedCommand(args: string[]): Promise<{code: number | null; stdout: string; stderr: string}> {
    try {
        await execFileAsync("bun", args, {
            encoding: "utf-8",
            timeout: 10000,
        });
    } catch (error) {
        const failed = error as {code?: number | null; stdout?: string; stderr?: string};
        return {
            code: failed.code ?? null,
            stdout: failed.stdout ?? "",
            stderr: failed.stderr ?? "",
        };
    }
    throw new Error("命令预期失败，但实际成功。");
}
