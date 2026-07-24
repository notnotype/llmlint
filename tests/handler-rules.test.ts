import {mkdir, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {prepareScanContext} from "../skill/src/scan-context";
import {scanHandlerRules} from "../skill/src/scanner";
import {loadRules} from "../skill/src/rules";
import type {ActiveHandlerRuleRecord, NormalizedLlmlintConfig} from "../skill/src/types";

const RULESETS_ROOT = resolve("skill/rulesets");

/** 构造最小 handler 规则，供扫描管线测试直接消费。 */
function handlerRule(id: string, name: string): ActiveHandlerRuleRecord {
    return {
        id,
        namespace: "test",
        ruleset: "test",
        title: id,
        level: "medium",
        review: "agent",
        fixability: "manual",
        handler: {type: "builtin", name},
        action: {type: "suggest", message: id},
    };
}

describe("handler rules", () => {
    const tempRoots: string[] = [];

    afterEach(async () => {
        await Promise.all(tempRoots.map((root) => rm(root, {recursive: true, force: true})));
        tempRoots.length = 0;
    });

    it("scanHandlerRules 映射坐标、target 与原文切片", () => {
        const content = "这不是普通的雨，而是一场预谋。";
        const issues = scanHandlerRules(prepareScanContext(content), [handlerRule("h.not-is", "not-is-comparison")]);

        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({
            line: 1,
            column: 2,
            endLine: 1,
            endColumn: 14,
            target: "not-is-comparison",
            match: "不是普通的雨，而是一场预谋",
        });
        expect(issues[0]!.match).toBe(content.slice(1, 14));
    });

    it("对白内 not-is-comparison 豁免", () => {
        const issues = scanHandlerRules(prepareScanContext("「不是我干的，是他。」"), [handlerRule("h.dialogue", "not-is-comparison")]);

        expect(issues).toHaveLength(0);
    });

    it("handler 动态 detail 进入 Issue.detail", () => {
        const content = "他站住。风停了。灯灭了。门开了。人走了。夜深了。";
        const issues = scanHandlerRules(prepareScanContext(content), [handlerRule("h.stutter", "period-stutter")]);

        expect(issues).toHaveLength(1);
        expect(issues[0]!.detail).toContain("连续 6 个短句");
    });

    it("ignoreTerms 与 handler 命中重叠时丢弃命中", () => {
        const content = "这不是普通的雨，而是一场预谋。";
        const ctx = prepareScanContext(content, {ignoreTerms: ["普通的雨"]});
        const issues = scanHandlerRules(ctx, [handlerRule("h.ignore", "not-is-comparison")]);

        expect(issues).toHaveLength(0);
    });

    it("quote-emphasis 统计叙述层短词引号强调，并全文只报一条", () => {
        const content = "这场胜利像「礼物」，那次失败成了「钥匙」。他把沉默称为「答案」。";
        const issues = scanHandlerRules(prepareScanContext(content), [handlerRule("h.quote", "quote-emphasis")]);

        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({
            line: 1,
            column: 6,
            target: "quote-emphasis",
            match: "「礼物」",
        });
        expect(issues[0]!.detail).toContain("短词加引号强调 3 处");
        expect(issues[0]!.detail).toContain("礼物");
    });

    it("quote-emphasis 豁免极短对白、系统面板与低于阈值的零散强调", () => {
        const rule = handlerRule("h.quote.safe", "quote-emphasis");
        const safeCases = [
            "他说「好」。她问「行吗？」他答「可以」。",
            "【系统】\n【公告】\n【提示】",
            "这场胜利像「礼物」，那次失败成了「钥匙」。",
        ];

        for (const content of safeCases) {
            expect(scanHandlerRules(prepareScanContext(content), [rule]), content).toHaveLength(0);
        }
    });

    it("loader：handler 规则入册，非 manual fixability 诊断并归一 manual", async () => {
        const rulesetId = "test-handler-plumb";
        const root = join(RULESETS_ROOT, rulesetId);
        tempRoots.push(root);
        await mkdir(join(root, "rules"), {recursive: true});
        await writeFile(join(root, "ruleset.json"), JSON.stringify({id: rulesetId, title: rulesetId, version: "1.0.0"}), "utf-8");
        await writeFile(join(root, "rules", "index.json"), JSON.stringify([
            {
                id: "handler-ok",
                namespace: "test",
                title: "ok",
                level: "medium",
                handler: {type: "builtin", name: "not-is-comparison"},
                action: {type: "suggest", message: "x"},
            },
            {
                id: "handler-bad-fixability",
                namespace: "test",
                title: "bad",
                level: "low",
                fixability: "auto",
                handler: {type: "builtin", name: "period-stutter"},
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

        expect(loaded.handlerRules.map((rule) => rule.id).sort()).toEqual(["handler-bad-fixability", "handler-ok"]);
        expect(loaded.handlerRules.every((rule) => rule.fixability === "manual")).toBe(true);
        expect(loaded.diagnostics.some((diagnostic) => diagnostic.code === "handler-rule-not-fixable" && diagnostic.level === "error")).toBe(true);
    });
});
