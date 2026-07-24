import {execFile} from "node:child_process";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {promisify} from "node:util";
import {afterEach, describe, expect, it} from "vitest";
import {scanDensity} from "../skill/src/density";
import {loadRules} from "../skill/src/rules";
import {prepareScanContext} from "../skill/src/scan-context";
import {scanHandlerRules, scanWithContext} from "../skill/src/scanner";
import type {CheckJsonReport, LoadedRules, NormalizedLlmlintConfig} from "../skill/src/types";

const LLMLINT_BIN = resolve("skill/bin/llmlint.ts");
const execFileAsync = promisify(execFile);

const STORY_DESLOP_BLOCKING_IDS = new Set([
    "story-deslop.voice-contrast",
    "story-deslop.trailer-ending",
    "story-deslop.stage-leak.tier1",
    "story-deslop.not-is-comparison",
    "story-deslop.reverse-not-is",
    "story-deslop.negation-parade.repeated-none",
    "story-deslop.negation-parade.only-turn",
]);

function defaultConfig(): NormalizedLlmlintConfig {
    return {
        rulesets: ["builtin/default"],
        trustedRulesets: [],
        rulesetOverrides: {},
        namespaces: {},
        rules: {},
        ignoreTerms: [],
        output: "stylish",
    };
}

async function loadDefault(): Promise<LoadedRules> {
    return loadRules(defaultConfig());
}

function scanAll(content: string, loaded: LoadedRules) {
    const ctx = prepareScanContext(content);
    return {
        issues: [...scanWithContext(ctx, loaded.regexRules), ...scanHandlerRules(ctx, loaded.handlerRules)],
        densityIssues: scanDensity(ctx, loaded.densityRules),
    };
}

function storyBlockingIds(content: string, loaded: LoadedRules): string[] {
    return scanAll(content, loaded).issues
        .filter((issue) => issue.rule.level === "high" && STORY_DESLOP_BLOCKING_IDS.has(issue.rule.id))
        .map((issue) => issue.rule.id);
}

function densityIds(content: string, loaded: LoadedRules): string[] {
    return scanAll(content, loaded).densityIssues.map((issue) => issue.rule.id);
}

async function runCheck(filePath: string): Promise<{code: number; stdout: string; stderr: string}> {
    try {
        const result = await execFileAsync("bun", [LLMLINT_BIN, "check", filePath, "--review", "all", "--format", "json"], {
            encoding: "utf-8",
            timeout: 10000,
        });
        return {code: 0, stdout: result.stdout, stderr: result.stderr};
    } catch (error) {
        const failed = error as {code?: number; stdout?: string; stderr?: string};
        return {
            code: failed.code ?? 1,
            stdout: failed.stdout ?? "",
            stderr: failed.stderr ?? "",
        };
    }
}

describe("story-deslop calibration rules", () => {
    const tempRoots: string[] = [];

    afterEach(async () => {
        await Promise.all(tempRoots.map((root) => rm(root, {recursive: true, force: true})));
        tempRoots.length = 0;
    });

    it("真人校准句不触发 story-deslop blocking 规则", async () => {
        const loaded = await loadDefault();
        const safeCases = [
            "是的，他还记得。",
            "这件事不是A就是B。",
            "还是雨声，不是脚步声。",
            "只是旧账，不是证据。",
            "但是结果，不是问题。",
            "你是不是看错了？",
            "这不是吗？",
            "「不是我干的，是他。」",
            "钟声再度响起，比赛正式拉开序幕。",
        ];

        for (const sample of safeCases) {
            expect(storyBlockingIds(sample, loaded), sample).toEqual([]);
        }
    });

    it("漏网例句命中对应规则，并尊重章尾 position 窗口", async () => {
        const loaded = await loadDefault();
        const cases = [
            {text: "这不是普通的雨，而是一场预谋。", id: "story-deslop.not-is-comparison"},
            {text: "这不是错觉。\n\n是门外有人。", id: "story-deslop.not-is-comparison"},
            {text: "声音不高，第一句却稳稳压住了整个大厅。", id: "story-deslop.voice-contrast"},
            {text: "没有伴奏，没有和声，没有提词器。", id: "story-deslop.negation-parade.repeated-none"},
            {text: "他没炫技，没有那种故作高深的架势。他只是唱。", id: "story-deslop.negation-parade.only-turn"},
            {text: "是真嗓子，不是修音修出来的。", id: "story-deslop.reverse-not-is"},
        ];

        for (const item of cases) {
            expect(storyBlockingIds(item.text, loaded), item.id).toContain(item.id);
        }

        const insideEnding = `${"风继续吹。".repeat(80)}\n没人知道，这才刚刚开始。`;
        expect(storyBlockingIds(insideEnding, loaded)).toContain("story-deslop.trailer-ending");

        const outsideEnding = `没人知道，这才刚刚开始。\n${"风继续吹。".repeat(220)}`;
        expect(storyBlockingIds(outsideEnding, loaded)).not.toContain("story-deslop.trailer-ending");
    });

    it("长段落规则只看叙述层可见字符，不把长对白占位算作叙述段", async () => {
        const loaded = await loadDefault();
        const longDialogue = `「${"你".repeat(210)}」`;
        const longNarrative = `${"风继续吹".repeat(70)}。`;

        expect(densityIds(longDialogue, loaded)).not.toContain("story-deslop.long-paragraph");
        expect(densityIds(longNarrative, loaded)).toContain("story-deslop.long-paragraph");
    });

    it("CLI fixture：真人校准句 0 blocking，漏网例句命中并在 --review all 落桶", async () => {
        const root = await mkdtemp(join(tmpdir(), "llmlint-calibration-"));
        tempRoots.push(root);
        const humanPath = join(root, "human.md");
        const aiPath = join(root, "leak.md");
        await writeFile(humanPath, [
            "是的，他还记得。",
            "这件事不是A就是B。",
            "还是雨声，不是脚步声。",
            "只是旧账，不是证据。",
            "但是结果，不是问题。",
            "你是不是看错了？",
            "这不是吗？",
            "「不是我干的，是他。」",
            "钟声再度响起，比赛正式拉开序幕。",
        ].join("\n"), "utf-8");
        await writeFile(aiPath, [
            "这不是普通的雨，而是一场预谋。",
            "声音不高，第一句却稳稳压住了整个大厅。",
            "没有伴奏，没有和声，没有提词器。",
            "是真嗓子，不是修音修出来的。",
            "本章伏笔会在下一章展开。",
            `${"风继续吹。".repeat(80)}没人知道，这才刚刚开始。`,
        ].join("\n"), "utf-8");

        const human = await runCheck(humanPath);
        expect(human.code).toBe(0);
        const humanReport = JSON.parse(human.stdout) as CheckJsonReport;
        expect(humanReport.issues.filter((issue) => issue.rule.level === "high" && STORY_DESLOP_BLOCKING_IDS.has(issue.rule.id))).toHaveLength(0);

        const leak = await runCheck(aiPath);
        expect(leak.code).toBe(1);
        const leakReport = JSON.parse(leak.stdout) as CheckJsonReport;
        const ids = leakReport.issues.map((issue) => issue.rule.id);
        expect(ids).toEqual(expect.arrayContaining([
            "story-deslop.not-is-comparison",
            "story-deslop.voice-contrast",
            "story-deslop.negation-parade.repeated-none",
            "story-deslop.reverse-not-is",
            "story-deslop.trailer-ending",
        ]));
        expect(leakReport.issues.find((issue) => issue.rule.id === "story-deslop.stage-leak.tier2")?.rule.review).toBe("human");
    });
});
