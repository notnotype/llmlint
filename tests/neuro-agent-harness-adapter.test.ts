import {afterEach, describe, expect, it} from "vitest";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {NeuroAgentHarness, ProfileRegistry} from "@notnotype/neuro-agent-harness";
import {ScriptedModelRuntime} from "@notnotype/neuro-agent-harness/testing";
import {createPrismaClient, type PrismaClient} from "../web/server/database/prisma";
import {NeuroAgentHarnessAdapter} from "../web/server/agent/neuro-agent-harness/adapter";
import type {AgentEventSubscription} from "../web/server/agent/harness-port";
import type {AgentSessionEvent} from "../web/shared/agent-harness";
import {PrismaSessionStore} from "../web/server/agent/neuro-agent-harness/prisma-session-store";
import {LlmlintPiModelRuntime, type LlmlintModelConfig} from "../web/server/agent/neuro-agent-harness/pi-runtime";
import {createLlmlintProfile, type LlmlintSessionInitial} from "../web/server/agent/neuro-agent-harness/profile";
import {llmlintAnalysisContext} from "../web/server/agent/neuro-agent-harness/analysis-context";
import {createHarnessTables} from "./helpers/agent-harness-db";
import {MachineLlmReviewProjector} from "../web/server/agent/neuro-agent-harness/review-observer";

let directory: string | undefined;
let client: PrismaClient | undefined;

afterEach(async () => {
    await client?.$disconnect();
    client = undefined;
    if (directory) {
        try {
            await rm(directory, {recursive: true, force: true});
        } catch {
            // Windows libsql 连接释放存在短暂延迟，临时目录无需影响测试结果。
        }
    }
    directory = undefined;
});

describe("NeuroAgentHarness llmlint Port Adapter", () => {
    it("新建 neuro session 在首次 invocation 前也通过 Core 返回快照和 SSE cursor", async () => {
        directory = await mkdtemp(join(tmpdir(), "llmlint-harness-empty-session-"));
        client = createPrismaClient(`file:${join(directory, "empty-session.db")}`);
        await createHarnessTables(client);
        const store = new PrismaSessionStore(client);
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model"}));
        const core = new NeuroAgentHarness({
            store,
            profiles,
            model: new ScriptedModelRuntime<LlmlintModelConfig>([]),
            capabilities: [{capability: llmlintAnalysisContext, open: () => ({load: async () => { throw new Error("空 session 不应加载 analysis context"); }})}],
        });
        const adapter = new NeuroAgentHarnessAdapter({core, store, projector: new MachineLlmReviewProjector(client), client});

        const created = await adapter.createSession("revision-empty", 6);
        const snapshot = await adapter.getSnapshot(created.sessionId, 6);
        const subscription = adapter.subscribeEvents(created.sessionId, snapshot.eventCursor);

        expect(snapshot).toMatchObject({
            sessionId: created.sessionId,
            revisionId: "revision-empty",
            status: "idle",
            invocations: [],
            entries: [],
        });
        expect(subscription.connected.snapshotRequired).toBe(false);
        await subscription.close();
        const invalid = adapter.subscribeEvents(created.sessionId, {eventEpoch: "stale-epoch", after: 0});
        expect(invalid.connected.snapshotRequired).toBe(true);
        await invalid.close();
    });

    it("在现有 AgentHarnessPort 上暴露 optimize 结果、快照和 SSE replay", async () => {
        directory = await mkdtemp(join(tmpdir(), "llmlint-harness-adapter-"));
        client = createPrismaClient(`file:${join(directory, "adapter.db")}`);
        await createHarnessTables(client);
        const store = new PrismaSessionStore(client);
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model"}));
        const scripted = new ScriptedModelRuntime<LlmlintModelConfig>([
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "replace", name: "replace", arguments: {oldText: "旧", newText: "新"}}}], timestamp: 1}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "finish", name: "finish", arguments: {summary: "完成"}}}], timestamp: 2}},
        ]);
        const core = new NeuroAgentHarness({store, profiles, model: scripted, capabilities: [{capability: llmlintAnalysisContext, open: () => ({load: async () => { throw new Error("optimize 不应加载 analysis context"); }})}]});
        const adapter = new NeuroAgentHarnessAdapter({
            core,
            store,
            projector: new MachineLlmReviewProjector(client),
            client,
        });
        const created = await adapter.createSession("revision-1", 7);
        const accepted = await adapter.invoke(created.sessionId, 7, {mode: "prompt", phase: "optimize", message: "改写", body: "旧文"});
        expect(accepted.status).toBe("accepted");

        for (let attempt = 0; attempt < 20; attempt += 1) {
            const row = await client.agentInvocation.findUnique({where: {id: accepted.invocationId}, select: {status: true}});
            if (row?.status === "completed") break;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        const snapshot = await adapter.getSnapshot(created.sessionId, 7);
        expect(snapshot.invocations[0]?.result).toMatchObject({body: "新文", edits: [{oldText: "旧", newText: "新"}]});
        expect(snapshot.entries.some((entry) => entry.kind === "edit")).toBe(true);
        expect(snapshot.entries.filter((entry) => entry.kind === "user").map((entry) => entry.payload.text)).toEqual(["改写"]);
        await expect(adapter.retry(created.sessionId, 7)).rejects.toMatchObject({statusCode: 409});

        const subscription = adapter.subscribeEvents(created.sessionId, {after: 0});
        expect(subscription.connected.snapshotRequired).toBe(false);
        const replay = await collectUntil(subscription, (event) => event.kind === "runtime" && event.event.type === "agent_end");
        expect(replay.some((event) => event.kind === "runtime" && event.event.type === "agent_end")).toBe(true);
        await subscription.close();
    });

    it("新建 neuro session 的 analysis 通过 observer 写入 MachineLlmReview", async () => {
        directory = await mkdtemp(join(tmpdir(), "llmlint-harness-analysis-"));
        client = createPrismaClient(`file:${join(directory, "analysis.db")}`);
        await createHarnessTables(client);
        const body = "正文没有明显命中。";
        const store = new PrismaSessionStore(client);
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model", analysisModelKey: "test/model"}));
        const scripted = new ScriptedModelRuntime<LlmlintModelConfig>([
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "context", name: "get_lint_context", arguments: {}}}], timestamp: 1}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "chunk", name: "read_document_chunk", arguments: {index: 0}}}], timestamp: 2}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "report", name: "report_result", arguments: {confidence: 0.8, conclusion: "未发现明确命中", suggestions: []}}}], timestamp: 3}},
        ]);
        const core = new NeuroAgentHarness({
            store,
            profiles,
            model: scripted,
            capabilities: [{capability: llmlintAnalysisContext, open: () => ({load: async () => ({body, chunks: [{start: 0, end: body.length, text: body}], scanStats: {hitCount: 0, docScore: 0}, ruleIds: new Set<string>(), ruleLevels: new Map(), rulesText: "无"})})}],
        });
        const adapter = new NeuroAgentHarnessAdapter({core, store, projector: new MachineLlmReviewProjector(client), client});
        const created = await adapter.createSession("revision-analysis", 9);
        const accepted = await adapter.invoke(created.sessionId, 9, {mode: "prompt", phase: "analysis", body});

        for (let attempt = 0; attempt < 20; attempt += 1) {
            const row = await client.agentInvocation.findUnique({where: {id: accepted.invocationId}, select: {status: true}});
            if (row?.status === "completed") break;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        const snapshot = await adapter.getSnapshot(created.sessionId, 9);
        expect(snapshot.report).toMatchObject({score: 0, confidence: 0.8, conclusion: "未发现明确命中"});
        expect(snapshot.hits).toEqual([]);
        expect(snapshot.invocations[0]?.phase).toBe("analysis");
        expect(snapshot.invocations[0]?.result).toBeNull();

        const subscription = adapter.subscribeEvents(created.sessionId, {after: 0});
        const replay = await collectUntil(subscription, (event) => event.kind === "runtime" && event.event.type === "agent_end");
        const start = replay.find((event) => event.kind === "runtime" && event.event.type === "agent_start");
        expect(start && start.kind === "runtime" && start.event.type === "agent_start" ? start.event.phase : null).toBe("analysis");
        await subscription.close();
    });
});

/** 消费 replay 直到目标事件；订阅仍由调用方显式关闭。 */
async function collectUntil(subscription: AgentEventSubscription, predicate: (event: AgentSessionEvent) => boolean): Promise<AgentSessionEvent[]> {
    const events: AgentSessionEvent[] = [];
    for await (const event of subscription) {
        events.push(event);
        if (predicate(event)) break;
    }
    return events;
}
