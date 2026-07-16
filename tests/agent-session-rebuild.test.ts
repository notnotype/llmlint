import {afterEach, describe, expect, it} from "vitest";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {NeuroAgentHarness, ProfileRegistry} from "@notnotype/neuro-agent-harness";
import {ScriptedModelRuntime, type ScriptedTurn} from "@notnotype/neuro-agent-harness/testing";
import {createPrismaClient, type PrismaClient} from "../web/server/database/prisma";
import {AgentSessionRebuilder} from "../web/server/agent/session-rebuild";
import {NeuroAgentHarnessAdapter} from "../web/server/agent/neuro-agent-harness/adapter";
import {PrismaSessionStore} from "../web/server/agent/neuro-agent-harness/prisma-session-store";
import {createLlmlintProfile, type LlmlintSessionInitial} from "../web/server/agent/neuro-agent-harness/profile";
import {llmlintAnalysisContext} from "../web/server/agent/neuro-agent-harness/analysis-context";
import {MachineLlmReviewProjector} from "../web/server/agent/neuro-agent-harness/review-observer";
import type {LlmlintModelConfig} from "../web/server/agent/neuro-agent-harness/pi-runtime";
import {createHarnessTables} from "./helpers/agent-harness-db";

let directory: string | undefined;
let client: PrismaClient | undefined;

afterEach(async () => {
    await client?.$disconnect();
    client = undefined;
    if (directory) await rm(directory, {recursive: true, force: true}).catch(() => undefined);
    directory = undefined;
});

describe("AgentSessionRebuilder", () => {
    it("删除旧事实、重跑 analysis，并在重复执行时保持幂等", async () => {
        const context = await setup("success");
        const scripts = analysisScripts();
        const {adapter, model} = createAdapter(context.client, scripts, context.body);
        const rebuilder = new AgentSessionRebuilder({client: context.client, harness: adapter, wait: async () => undefined});
        await rebuilder.prepare();

        const first = await rebuilder.run();
        const second = await rebuilder.run();

        expect(first).toMatchObject({total: 1, completed: 1, failed: 0});
        expect(second).toMatchObject({total: 1, completed: 1, failed: 0});
        expect(model.requests).toHaveLength(3);
        expect(await context.client.agentSession.count({where: {id: "old-session"}})).toBe(0);
        expect(await context.client.agentSessionEntry.count({where: {id: "old-entry"}})).toBe(0);
        expect(await context.client.agentInvocation.count({where: {id: "old-invocation"}})).toBe(0);
        expect(await context.client.machineLlmReview.count({where: {id: "old-review"}})).toBe(0);
        expect(await context.client.machineLlmReview.count({where: {revisionId: context.revisionId}})).toBe(1);
    });

    it("失败后保留 ledger，并由新进程从 analysis_started 阶段续跑", async () => {
        const context = await setup("resume");
        const firstAdapter = createAdapter(context.client, [() => { throw new Error("provider down"); }], context.body).adapter;
        const firstRunner = new AgentSessionRebuilder({client: context.client, harness: firstAdapter, wait: async () => undefined, timeoutMilliseconds: 0});
        await firstRunner.prepare();
        const failed = await firstRunner.run();
        expect(failed.failed).toBe(1);
        expect(failed.rows[0]).toMatchObject({stage: "analysis_started"});

        const secondAdapter = createAdapter(context.client, analysisScripts(), context.body).adapter;
        const resumed = await new AgentSessionRebuilder({client: context.client, harness: secondAdapter, wait: async () => undefined}).run();

        expect(resumed).toMatchObject({completed: 1, failed: 0});
        expect(resumed.rows[0]?.attempts).toBe(2);
        expect(await context.client.agentInvocation.count({where: {sessionId: resumed.rows[0]?.newSessionId ?? ""}})).toBeGreaterThanOrEqual(2);
    });
});

/** 创建含旧 Harness 事实的最小 SQLite fixture。 */
async function setup(suffix: string): Promise<{client: PrismaClient; revisionId: string; body: string}> {
    directory = await mkdtemp(join(tmpdir(), `llmlint-agent-rebuild-${suffix}-`));
    client = createPrismaClient(`file:${join(directory, "rebuild.db")}`);
    await client.$executeRawUnsafe(`CREATE TABLE Revision (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL)`);
    await createHarnessTables(client);
    const revisionId = `revision-${suffix}`;
    const body = "正文没有明显命中。";
    await client.$executeRawUnsafe(`INSERT INTO Revision (id, body) VALUES (?, ?)`, revisionId, body);
    await client.agentSession.create({data: {id: "old-session", revisionId, userId: 7, profileKey: "llmlint.review", initialJson: "{}", hostContextJson: "{}"}});
    await client.agentSessionEntry.create({data: {id: "old-entry", sessionId: "old-session", kind: "user", payloadJson: "{}"}});
    await client.agentInvocation.create({data: {id: "old-invocation", sessionId: "old-session", mode: "prompt", phase: "analysis", status: "completed", inputJson: "{}"}});
    await client.machineLlmReview.create({data: {id: "old-review", revisionId, sessionId: "old-session", invocationId: "old-invocation", model: "old", promptVersion: "old", score: 0, confidence: 0, hitsJson: "[]", reportJson: "{}"}});
    return {client, revisionId, body};
}

/** 创建只依赖公开 Core/Adapter 合同的测试 Harness。 */
function createAdapter(clientValue: PrismaClient, scripts: readonly ScriptedTurn<LlmlintModelConfig>[], body: string) {
    const store = new PrismaSessionStore(clientValue);
    const projector = new MachineLlmReviewProjector(clientValue);
    const model = new ScriptedModelRuntime<LlmlintModelConfig>(scripts);
    const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
        .add(createLlmlintProfile({repairModelKey: "test/model", analysisModelKey: "test/model"}));
    const core = new NeuroAgentHarness({
        store,
        profiles,
        model,
        capabilities: [{capability: llmlintAnalysisContext, open: () => ({load: async () => ({body, chunks: [{start: 0, end: body.length, text: body}], scanStats: {hitCount: 0, docScore: 0}, ruleIds: new Set<string>(), ruleLevels: new Map(), rulesText: "无"})})}],
        commitObservers: [projector],
    });
    return {adapter: new NeuroAgentHarnessAdapter({core, store, projector, client: clientValue}), model};
}

/** 一次成功 analysis 所需的 context/chunk/report 三轮。 */
function analysisScripts(): ScriptedTurn<LlmlintModelConfig>[] {
    return [
        {message: {role: "assistant", content: [{type: "toolCall", call: {id: "context", name: "get_lint_context", arguments: {}}}], timestamp: 1}},
        {message: {role: "assistant", content: [{type: "toolCall", call: {id: "chunk", name: "read_document_chunk", arguments: {index: 0}}}], timestamp: 2}},
        {message: {role: "assistant", content: [{type: "toolCall", call: {id: "report", name: "report_result", arguments: {confidence: 0.8, conclusion: "未发现明确命中", suggestions: []}}}], timestamp: 3}},
    ];
}
