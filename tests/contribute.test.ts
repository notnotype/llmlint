// contribute 裁剪与发件箱（Task 24 Phase 2）。
//
// ⚠ 同目录还有 tests/contribute-workspace.test.ts（web 侧 /contribute 页面），子串过滤会同时命中，
// 只跑本文件请用精确路径：`bun run test:vitest -- tests/contribute.test.ts`。
//
// 隐私不变量用哨兵串测：「stats 档不得出现文件名」没法泛化断言（无法 grep「任意文件名」），
// 所以 fixture 里每个自由文本字段都填一个唯一串，再断言序列化结果里一个都不出现。
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {contribute, hashTexts, listOutbox, readCheckFacts, trimRoundForTier} from "../skill/src/contribute";
import {beginRound, loadLedger, roundDir, saveLedger, snapshotNamesForFiles, LEDGER_VERSION, type Ledger} from "../skill/src/round";
import {loadUserSettings, saveUserSettings, type SharingMode, type SharingTier} from "../skill/src/user-state";

const SENTINEL = {
    file: "SENTINEL-FILE-7Q.md",
    fragment: "SENTINEL_FRAGMENT_7Q",
    reason: "SENTINEL_REASON_7Q",
    comment: "SENTINEL_COMMENT_7Q",
    suggestion: "SENTINEL_SUGGEST_7Q",
    body: "SENTINEL_BODY_7Q",
    outputBody: "SENTINEL_OUTPUT_7Q",
} as const;

const ALL_SENTINELS = Object.values(SENTINEL);

describe("contribute", () => {
    const originalHome = process.env.LLMLINT_HOME;
    const tempRoots: string[] = [];
    let home = "";
    let project = "";

    beforeEach(async () => {
        home = await mkdtemp(join(tmpdir(), "llmlint-home-"));
        project = await mkdtemp(join(tmpdir(), "llmlint-proj-"));
        tempRoots.push(home, project);
        process.env.LLMLINT_HOME = home;
        setSharing("fragments", "auto", true);
    });

    afterEach(async () => {
        if (originalHome === undefined) {
            delete process.env.LLMLINT_HOME;
        } else {
            process.env.LLMLINT_HOME = originalHome;
        }
        await Promise.all(tempRoots.map((root) => rm(root, {recursive: true, force: true})));
        tempRoots.length = 0;
    });

    function setSharing(tier: SharingTier, mode: SharingMode, initialized: boolean): void {
        saveUserSettings({...loadUserSettings(), initialized, sharing: {tier, mode, anonymous: false}});
    }

    /** 造一轮「已完成」的审稿：源文件 + 修后稿 + 两份 check JSON + 填满哨兵的台账条目。 */
    function makeCompletedRound(options: {withOutput?: boolean} = {}): void {
        writeFileSync(join(project, SENTINEL.file), `第一段。${SENTINEL.body}\n`, "utf-8");
        const {round} = beginRound({cwd: project, files: [SENTINEL.file], parentRound: null, now: "2026-07-27T00:00:00.000Z"});
        const dir = roundDir(project, round);
        writeFileSync(join(dir, "check-source.json"), JSON.stringify({
            kind: "check",
            summary: {total: 3, high: 1, medium: 1, low: 1, visibleChars: 1200},
            issues: [{ruleId: "cn.a"}, {ruleId: "cn.a"}, {ruleId: "cn.b"}],
            densityIssues: [{ruleId: "cn.density", hits: 9}],
        }), "utf-8");
        if (options.withOutput !== false) {
            mkdirSync(join(dir, "output"), {recursive: true});
            writeFileSync(join(dir, "output", SENTINEL.file), `第一段改。${SENTINEL.outputBody}\n`, "utf-8");
            writeFileSync(join(dir, "check-output.json"), JSON.stringify({
                kind: "check",
                summary: {total: 1, high: 0, medium: 1, low: 0, visibleChars: 1150},
                issues: [{ruleId: "cn.b"}],
            }), "utf-8");
        }
        const ledger = loadLedger(project);
        if (!ledger) {
            throw new Error("台账应已由 beginRound 建好");
        }
        const entry = ledger.rounds[0];
        if (!entry) {
            throw new Error("应有第一轮");
        }
        entry.status = "completed";
        entry.completedAt = "2026-07-27T01:00:00.000Z";
        entry.summary = {staticIssues: 3, densityIssues: 1, docPAi: 0.9, spread: 0.3};
        entry.retest = {staticIssues: 1, densityIssues: 0, docPAi: 0.87, spread: 0.28, verdict: "pass"};
        entry.decisions = [{
            file: SENTINEL.file,
            line: 1,
            ruleId: "cn.a",
            fragment: SENTINEL.fragment,
            verdict: "fix",
            reason: SENTINEL.reason,
        }];
        entry.localConfigSuggestions = [SENTINEL.suggestion];
        entry.judgment = {wantReadOnBefore: 2, wantReadOnAfter: 4, comment: SENTINEL.comment, blind: false};
        saveLedger(project, ledger);
    }

    /** 读发件箱里唯一那条的原文（按档裁剪后的序列化结果，哨兵检查直接打在它上面）。 */
    function readOnlyEntry(): string {
        const dir = join(home, "outbox");
        const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
        expect(files).toHaveLength(1);
        return readFileSync(join(dir, files[0] as string), "utf-8");
    }

    it("stats 档不含任何自由文本：文件名、片段、理由、评语、建议、正文全不出现", async () => {
        setSharing("stats", "auto", true);
        makeCompletedRound();

        const result = await contribute({cwd: project, round: null, write: true, auto: false});
        expect(result.action).toBe("wrote");
        const serialized = readOnlyEntry();
        for (const sentinel of ALL_SENTINELS) {
            expect(serialized).not.toContain(sentinel);
        }
        // 但数量口径要留下：数得出来才有分析价值。
        const parsed = JSON.parse(serialized) as {payload: {sourceFileCount: number; decisionCount: number; localConfigSuggestionCount: number; checkFacts: {source: {ruleHits: Record<string, number>}}}};
        expect(parsed.payload.sourceFileCount).toBe(1);
        expect(parsed.payload.decisionCount).toBe(1);
        expect(parsed.payload.localConfigSuggestionCount).toBe(1);
        expect(parsed.payload.checkFacts.source.ruleHits).toEqual({"cn.a": 2, "cn.b": 1});
    });

    it("导出层逐字段重建嵌套对象，不让新增字段绕过档位白名单", () => {
        makeCompletedRound();
        const entry = loadLedger(project)!.rounds[0]!;
        Object.assign(entry.summary!, {absolutePath: "C:\\Users\\Secret\\summary.md"});
        Object.assign(entry.retest!, {privateNote: "RETEST_PRIVATE_SENTINEL"});
        Object.assign(entry.decisions[0]!, {projectPath: "C:\\Users\\Secret\\novel"});
        const facts = {
            source: {ruleHits: {"cn.a": 2, "../../RULE_PATH_SENTINEL": 9}, densityHits: {}, visibleChars: 1200},
            output: {ruleHits: {}, densityHits: {}, visibleChars: 1150},
        };
        const texts = {
            source: [{name: SENTINEL.file, content: SENTINEL.body}],
            output: [{name: SENTINEL.file, content: SENTINEL.outputBody}],
        };

        for (const tier of ["stats", "fragments", "full"] as const) {
            const serialized = JSON.stringify(trimRoundForTier({entry, tier, facts, texts}));
            expect(serialized).not.toContain("absolutePath");
            expect(serialized).not.toContain("RETEST_PRIVATE_SENTINEL");
            expect(serialized).not.toContain("projectPath");
            expect(serialized).not.toContain("RULE_PATH_SENTINEL");
        }
    });

    it("fragments 档带片段与评语但不带正文", async () => {
        setSharing("fragments", "auto", true);
        makeCompletedRound();

        await contribute({cwd: project, round: null, write: true, auto: false});
        const serialized = readOnlyEntry();
        expect(serialized).toContain(SENTINEL.file);
        expect(serialized).toContain(SENTINEL.fragment);
        expect(serialized).toContain(SENTINEL.reason);
        expect(serialized).toContain(SENTINEL.comment);
        expect(serialized).toContain(SENTINEL.suggestion);
        expect(serialized).not.toContain(SENTINEL.body);
        expect(serialized).not.toContain(SENTINEL.outputBody);
    });

    it("fragments/full 只导出轮内安全快照名，不泄露用户名绝对路径或项目目录", () => {
        makeCompletedRound();
        const ledger = loadLedger(project)!;
        const entry = ledger.rounds[0]!;
        const sensitivePath = "C:\\Users\\SensitiveUser\\SecretNovel\\SENTINEL-FILE-7Q.md";
        entry.sourceFiles = [sensitivePath];
        entry.decisions[0]!.file = sensitivePath;
        const facts = {source: {ruleHits: {}, densityHits: {}, visibleChars: 1200}, output: {ruleHits: {}, densityHits: {}, visibleChars: 1150}};
        const texts = {
            source: [{name: SENTINEL.file, content: SENTINEL.body}],
            output: [{name: SENTINEL.file, content: SENTINEL.outputBody}],
        };

        for (const tier of ["fragments", "full"] as const) {
            const serialized = JSON.stringify(trimRoundForTier({entry, tier, facts, texts}));
            expect(serialized).not.toContain("SensitiveUser");
            expect(serialized).not.toContain("SecretNovel");
            const payload = JSON.parse(serialized) as {sourceFiles: string[]; decisions: Array<{file: string}>};
            expect(payload.sourceFiles).toEqual([SENTINEL.file]);
            expect(payload.decisions[0]?.file).toBe(SENTINEL.file);
        }
    });

    it("full 档带修前修后全文", async () => {
        setSharing("full", "auto", true);
        makeCompletedRound();

        await contribute({cwd: project, round: null, write: true, auto: false});
        const serialized = readOnlyEntry();
        expect(serialized).toContain(SENTINEL.body);
        expect(serialized).toContain(SENTINEL.outputBody);
        const parsed = JSON.parse(serialized) as {outputHash: string | null; degradedFrom: string | null};
        expect(parsed.outputHash).toMatch(/^sha256:/);
        expect(parsed.degradedFrom).toBeNull();
    });

    it("full 档缺修后正文时如实降级 fragments 并写明原档", async () => {
        setSharing("full", "auto", true);
        makeCompletedRound({withOutput: false});

        const result = await contribute({cwd: project, round: null, write: true, auto: false});
        expect(result.written[0]?.tier).toBe("fragments");
        expect(result.written[0]?.degradedFrom).toBe("full");
        const parsed = JSON.parse(readOnlyEntry()) as {tier: string; degradedFrom: string | null; degradedReason: string | null; outputHash: string | null};
        expect(parsed.tier).toBe("fragments");
        expect(parsed.degradedFrom).toBe("full");
        expect(parsed.degradedReason).toBe("output-snapshots-incomplete");
        expect(parsed.outputHash).toBeNull();
    });

    it("source 快照缺失或额外时整轮跳过，不能计算半套 sourceHash", async () => {
        setSharing("stats", "auto", true);
        makeCompletedRound();
        writeFileSync(join(roundDir(project, 1), "source", "unexpected.md"), "额外正文", "utf-8");

        const result = await contribute({cwd: project, round: null, write: true, auto: false});
        expect(result.written).toHaveLength(0);
        expect(result.skipped[0]?.reason).toContain("source 快照集合");
        expect(listOutbox()).toHaveLength(0);
    });

    it("output 快照额外或残缺时不进哈希，full 降级并给机器可读原因", async () => {
        setSharing("full", "auto", true);
        makeCompletedRound();
        writeFileSync(join(roundDir(project, 1), "output", "unexpected.md"), "额外修后稿", "utf-8");

        const result = await contribute({cwd: project, round: null, write: true, auto: false});
        expect(result.written[0]).toMatchObject({tier: "fragments", degradedFrom: "full", degradedReason: "output-snapshots-incomplete"});
        const parsed = JSON.parse(readOnlyEntry()) as {outputHash: string | null; degradedReason: string | null; payload: {texts?: unknown}};
        expect(parsed.outputHash).toBeNull();
        expect(parsed.degradedReason).toBe("output-snapshots-incomplete");
        expect(parsed.payload.texts).toBeUndefined();
    });

    it("未知 decision 文件使单轮跳过；POSIX 路径不做大小写折叠", async () => {
        makeCompletedRound();
        const ledger = loadLedger(project)!;
        ledger.rounds[0]!.decisions[0]!.file = "UNKNOWN.md";
        saveLedger(project, ledger);
        const unknown = await contribute({cwd: project, round: null, write: true, auto: false});
        expect(unknown.written).toHaveLength(0);
        expect(unknown.skipped[0]?.reason).toContain("不属于本轮 sourceFiles");

        const entry = ledger.rounds[0]!;
        entry.sourceFiles = ["Dir/A.md"];
        entry.decisions[0]!.file = "dir/A.md";
        expect(() => trimRoundForTier({
            entry,
            tier: "stats",
            facts: {source: {ruleHits: {}, densityHits: {}, visibleChars: 1}, output: {ruleHits: {}, densityHits: {}, visibleChars: 1}},
            texts: {source: [], output: []},
        })).toThrow(/不属于本轮 sourceFiles/);
    });

    it("--auto 四种结局：off 不做、未初始化不做、ask 只预览、auto 直接写", async () => {
        makeCompletedRound();

        setSharing("off", "auto", true);
        const off = await contribute({cwd: project, round: null, write: false, auto: true});
        expect(off.action).toBe("skipped");
        expect(off.reason).toContain("off");

        setSharing("stats", "auto", false);
        const uninitialized = await contribute({cwd: project, round: null, write: false, auto: true});
        expect(uninitialized.action).toBe("skipped");
        expect(uninitialized.reason).toContain("initialized");

        setSharing("stats", "ask", true);
        const ask = await contribute({cwd: project, round: null, write: false, auto: true});
        expect(ask.action).toBe("preview");
        expect(ask.written).toHaveLength(1);
        expect(ask.written[0]?.file).toBeNull();
        expect(listOutbox()).toHaveLength(0);

        setSharing("stats", "auto", true);
        const auto = await contribute({cwd: project, round: null, write: false, auto: true});
        expect(auto.action).toBe("wrote");
        expect(listOutbox()).toHaveLength(1);
    });

    it("已导出的轮不再重复导出，未完成的轮不参与导出", async () => {
        makeCompletedRound();

        const first = await contribute({cwd: project, round: null, write: true, auto: false});
        expect(first.written).toHaveLength(1);

        const second = await contribute({cwd: project, round: null, write: true, auto: false});
        expect(second.written).toHaveLength(0);
        expect(second.skipped[0]?.reason).toContain("导出过");

        // 再起一轮但不收尾：status=running 不该被导出。
        writeFileSync(join(project, "another.md"), "第二篇。\n", "utf-8");
        beginRound({cwd: project, files: ["another.md"], parentRound: null});
        const third = await contribute({cwd: project, round: null, write: true, auto: false});
        expect(third.written).toHaveLength(0);
        expect(third.skipped.some((entry) => entry.reason.includes("completed"))).toBe(true);
    });

    it("正文哈希按 CRLF 归一，且与文件顺序无关", () => {
        const lf = hashTexts([{name: "a.md", content: "一\n二"}, {name: "b.md", content: "三"}]);
        const crlf = hashTexts([{name: "b.md", content: "三"}, {name: "a.md", content: "一\r\n二"}]);
        expect(crlf).toBe(lf);
        expect(hashTexts([{name: "a.md", content: "一\n三"}, {name: "b.md", content: "三"}])).not.toBe(lf);
    });

    it("check JSON 缺失时命中统计为空而不是让整轮作废", () => {
        expect(readCheckFacts(join(project, "not-exist.json"))).toEqual({ruleHits: {}, densityHits: {}, visibleChars: null});
    });

    it("check-multi 只读对应形态，过滤非法 rule ID/计数并保留聚合字数", () => {
        const file = join(project, "check-multi.json");
        writeFileSync(file, JSON.stringify({
            kind: "check-multi",
            summary: {visibleChars: 321},
            issues: [{ruleId: "top-level-must-not-count"}],
            files: [{
                issues: [{ruleId: "cn.good"}, {ruleId: "../../SECRET_PATH"}],
                densityIssues: [
                    {ruleId: "cn.density", hits: 3},
                    {ruleId: "cn.negative", hits: -1},
                    {ruleId: "cn.fraction", hits: 1.5},
                ],
            }],
        }), "utf-8");

        expect(readCheckFacts(file)).toEqual({
            ruleHits: {"cn.good": 1},
            densityHits: {"cn.density": 3},
            visibleChars: 321,
        });
    });

    it("台账版本不是 v3 时直接报错，不做迁移", () => {
        const dir = join(project, ".agent", "llmlint");
        mkdirSync(dir, {recursive: true});
        writeFileSync(join(dir, "session.json"), JSON.stringify({version: 2, rounds: []}), "utf-8");
        expect(() => loadLedger(project)).toThrow(/v2 台账/);
    });

    it("台账逐层拒绝未知键、非法 UUID、非规范时间与非有限数字", () => {
        makeCompletedRound();
        const file = join(project, ".agent", "llmlint", "session.json");
        const original = JSON.parse(readFileSync(file, "utf-8")) as {
            projectId: string;
            rounds: Array<{startedAt: string; summary: {docPAi: number}; decisions: Array<Record<string, unknown>>}>;
        };
        const cases: Array<{mutate: (ledger: typeof original) => void; pattern: RegExp}> = [
            {mutate: (ledger) => { ledger.projectId = "project-path-C:\\Users\\Secret"; }, pattern: /projectId 必须是 UUID/},
            {mutate: (ledger) => { ledger.rounds[0]!.startedAt = "2026-07-27T00:00:00Z"; }, pattern: /规范 UTC ISO 时间戳/},
            {mutate: (ledger) => { ledger.rounds[0]!.summary.docPAi = Number.POSITIVE_INFINITY; }, pattern: /有限数字/},
            {mutate: (ledger) => { ledger.rounds[0]!.decisions[0]!.projectPath = "SECRET_NESTED_FIELD"; }, pattern: /不是允许的字段/},
        ];
        for (const testCase of cases) {
            const next = structuredClone(original);
            testCase.mutate(next);
            const serialized = JSON.stringify(next).replace('"docPAi":null', '"docPAi":1e999');
            writeFileSync(file, serialized, "utf-8");
            expect(() => loadLedger(project)).toThrow(testCase.pattern);
        }
    });

    it("快照名按跨平台大小写不敏感口径消歧", () => {
        expect(snapshotNamesForFiles(["Dir/A.md", "other/a.md", "third/2-A.md"])).toEqual(["A.md", "2-a.md", "2-2-A.md"]);
    });

    it("轮号取台账与目录的最大值 +1，孤儿目录占号不复用", () => {
        writeFileSync(join(project, "a.md"), "甲\n", "utf-8");
        beginRound({cwd: project, files: ["a.md"], parentRound: null});
        mkdirSync(join(project, ".agent", "llmlint", "rounds", "0007"), {recursive: true});

        const next = beginRound({cwd: project, files: ["a.md"], parentRound: 1});
        expect(next.round).toBe(8);
        const ledger = loadLedger(project) as Ledger;
        expect(ledger.version).toBe(LEDGER_VERSION);
        expect(ledger.rounds.map((entry) => entry.parentRound)).toEqual([null, 1]);
        expect(() => beginRound({cwd: project, files: ["a.md"], parentRound: 99})).toThrow(/没有第 99 轮/);
    });
});
