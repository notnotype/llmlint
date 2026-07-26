import {describe, expect, it} from "vitest";
import {COMPACT_CONTEXT_CHARS, mergeCompactRules, projectCheckIssues} from "../skill/src/check-report";
import type {DensityIssue, DensityRuleRecord, Issue, RegexRuleRecord} from "../skill/src/types";

/** 构造一条最小可用的 regex 规则记录；只填投影会读到的字段。 */
function rule(id: string, overrides: Partial<RegexRuleRecord> = {}): RegexRuleRecord {
    return {
        id,
        namespace: "test",
        ruleset: "builtin/default",
        title: `标题 ${id}`,
        level: "medium",
        review: "agent",
        fixability: "manual",
        detector: {type: "regex", targets: ["甲词", "乙词"]},
        action: {type: "replace", replacements: [""]},
        ...overrides,
    };
}

/** 构造一处命中；before/after 可控长度，用于验证前后文裁剪。 */
function issue(ruleRecord: RegexRuleRecord, before = "前文", after = "后文", extra: Partial<Issue> = {}): Issue {
    return {
        rule: ruleRecord,
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 3,
        match: "甲词",
        target: "甲词",
        context: {before, current: "甲词", after},
        ...extra,
    };
}

describe("projectCheckIssues", () => {
    it("规则元数据按 id 去重提到顶层，命中只留 ruleId", () => {
        const shared = rule("test.shared");
        const projected = projectCheckIssues([issue(shared), issue(shared), issue(rule("test.other"))]);

        expect(projected.issues).toHaveLength(3);
        expect(Object.keys(projected.rules).sort()).toEqual(["test.other", "test.shared"]);
        expect(projected.issues.map((entry) => entry.ruleId)).toEqual(["test.shared", "test.shared", "test.other"]);
        // 每条命中都能在 rules 里查到：这是紧凑报告的核心不变量。
        for (const entry of projected.issues) {
            expect(projected.rules[entry.ruleId]).toBeDefined();
        }
    });

    it("只保留审稿决策字段，丢掉 detector / source / scope / ruleset", () => {
        const projected = projectCheckIssues([issue(rule("test.fields", {note: "边界说明"}))]);
        const entry = projected.rules["test.fields"]!;

        expect(entry).toEqual({
            namespace: "test",
            title: "标题 test.fields",
            level: "medium",
            review: "agent",
            fixability: "manual",
            action: {type: "replace", replacements: [""]},
            note: "边界说明",
        });
        // note 缺省时不应输出空字段。
        expect(projectCheckIssues([issue(rule("test.nonote"))]).rules["test.nonote"]).not.toHaveProperty("note");
        // issue 上不再重复 detector 正则。
        expect(projected.issues[0]).not.toHaveProperty("target");
    });

    it("前后文按码点裁到上限，被裁侧补省略号；未超限原样保留", () => {
        const long = "长".repeat(COMPACT_CONTEXT_CHARS + 10);
        const projected = projectCheckIssues([issue(rule("test.trim"), long, long)]);
        const context = projected.issues[0]!.context;

        expect(Array.from(context.before)).toHaveLength(COMPACT_CONTEXT_CHARS + 1);
        expect(context.before.startsWith("…")).toBe(true);
        expect(Array.from(context.after)).toHaveLength(COMPACT_CONTEXT_CHARS + 1);
        expect(context.after.endsWith("…")).toBe(true);
        // 裁剪保留贴近命中的那一侧：before 取尾部、after 取头部。
        expect(context.before.endsWith("长")).toBe(true);
        expect(context.current).toBe("甲词");

        const exact = "短".repeat(COMPACT_CONTEXT_CHARS);
        const untouched = projectCheckIssues([issue(rule("test.exact"), exact, exact)]).issues[0]!.context;
        expect(untouched.before).toBe(exact);
        expect(untouched.after).toBe(exact);
    });

    it("handler 的 detail 保留，regex 命中不产生空 detail 字段", () => {
        const withDetail = projectCheckIssues([issue(rule("test.detail"), "前", "后", {detail: "连续短句 5 处"})]);
        expect(withDetail.issues[0]?.detail).toBe("连续短句 5 处");
        expect(projectCheckIssues([issue(rule("test.plain"))]).issues[0]).not.toHaveProperty("detail");
    });

    it("density 指纹同样收进 rules；未传 densityIssues 时不输出该字段", () => {
        const densityRule: DensityRuleRecord = {
            id: "test.density",
            namespace: "test",
            ruleset: "builtin/default",
            title: "密度",
            level: "medium",
            review: "human",
            fixability: "manual",
            detector: {type: "density", patterns: [{target: "忽然"}], minHits: 3},
            action: {type: "suggest", message: "保留最有功能的少数"},
        };
        const densityIssue: DensityIssue = {rule: densityRule, line: 2, column: 4, hits: 7, perKilo: 10.25, samples: ["忽然"]};

        const projected = projectCheckIssues([issue(rule("test.regex"))], [densityIssue]);
        expect(projected.densityIssues).toEqual([{ruleId: "test.density", line: 2, column: 4, hits: 7, perKilo: 10.25, samples: ["忽然"]}]);
        expect(projected.rules["test.density"]?.review).toBe("human");

        expect(projectCheckIssues([issue(rule("test.regex"))])).not.toHaveProperty("densityIssues");
    });
});

describe("mergeCompactRules", () => {
    it("跨文件合并规则字典，同 id 先到先留", () => {
        const first = projectCheckIssues([issue(rule("test.a"))]).rules;
        const second = projectCheckIssues([issue(rule("test.a", {title: "另一个标题"})), issue(rule("test.b"))]).rules;

        const merged = mergeCompactRules([first, second]);
        expect(Object.keys(merged).sort()).toEqual(["test.a", "test.b"]);
        expect(merged["test.a"]?.title).toBe("标题 test.a");
    });
});
