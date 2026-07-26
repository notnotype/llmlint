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
import {llmlintRevisionTextSource} from "../web/server/agent/neuro-agent-harness/revision-text-workspace";
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
        await createRevision(client, "revision-empty");
        const store = new PrismaSessionStore(client);
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model"}));
        const core = new NeuroAgentHarness({
            store,
            profiles,
            model: new ScriptedModelRuntime<LlmlintModelConfig>([]),
            capabilities: adapterCapabilities(""),
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
            activeWorkspace: null,
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
        await createRevision(client, "revision-1");
        const store = new PrismaSessionStore(client);
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model"}));
        const scripted = new ScriptedModelRuntime<LlmlintModelConfig>([
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "edit", name: "edit", arguments: {edits: [{oldText: "旧", newText: "新"}]}}}], timestamp: 1}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "finish", name: "finish", arguments: {summary: "完成"}}}], timestamp: 2}},
        ]);
        const core = new NeuroAgentHarness({store, profiles, model: scripted, capabilities: adapterCapabilities("")});
        const adapter = new NeuroAgentHarnessAdapter({
            core,
            store,
            projector: new MachineLlmReviewProjector(client),
            client,
        });
        const created = await adapter.createSession("revision-1", 7);
        const accepted = await adapter.invoke(created.sessionId, 7, {mode: "prompt", phase: "optimize", revisionId: "revision-1", objective: "polish_ai_risk", message: "改写", body: "旧文"});
        expect(accepted.status).toBe("accepted");

        for (let attempt = 0; attempt < 20; attempt += 1) {
            const row = await client.agentInvocation.findUnique({where: {id: accepted.invocationId}, select: {status: true}});
            if (row?.status === "completed") break;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        const snapshot = await adapter.getSnapshot(created.sessionId, 7);
        expect(snapshot.invocations[0]?.input).toMatchObject({objective: "polish_ai_risk"});
        expect(snapshot.invocations[0]?.result).toMatchObject({body: "新文", edits: [{oldText: "旧", newText: "新"}]});
        expect(snapshot.entries.some((entry) => entry.kind === "edit")).toBe(true);
        expect(snapshot.entries.filter((entry) => entry.kind === "user").map((entry) => entry.payload.text)).toEqual(["改写", expect.stringContaining("用户要求：改写")]);
        expect(snapshot.entries.some((entry) => entry.kind === "system")).toBe(true);
        expect(snapshot.activeWorkspace).toBeNull();
        await expect(adapter.retry(created.sessionId, 7)).rejects.toMatchObject({statusCode: 409});

        const subscription = adapter.subscribeEvents(created.sessionId, {after: 0});
        expect(subscription.connected.snapshotRequired).toBe(false);
        const replay = await collectUntil(subscription, (event) => event.kind === "runtime" && event.event.type === "agent_end");
        expect(replay).toContainEqual(expect.objectContaining({
            kind: "session",
            invocationId: accepted.invocationId,
            event: {type: "workspace", invocationId: accepted.invocationId, body: "新文"},
        }));
        expect(replay.some((event) => event.kind === "runtime" && event.event.type === "agent_end")).toBe(true);
        await subscription.close();
    });

    it("active optimize 可从 snapshot 恢复最新 durable workspace", async () => {
        directory = await mkdtemp(join(tmpdir(), "llmlint-harness-active-workspace-"));
        client = createPrismaClient(`file:${join(directory, "active-workspace.db")}`);
        await createHarnessTables(client);
        await createRevision(client, "revision-active-workspace");
        const store = new PrismaSessionStore(client);
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model"}));
        let release!: () => void;
        const blocked = new Promise<void>((resolve) => { release = resolve; });
        const scripted = new ScriptedModelRuntime<LlmlintModelConfig>([
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "edit", name: "edit", arguments: {edits: [{oldText: "旧", newText: "新"}]}}}], timestamp: 1}},
            async () => {
                await blocked;
                return {message: {role: "assistant", content: [{type: "toolCall", call: {id: "finish", name: "finish", arguments: {summary: "完成"}}}], timestamp: 2}};
            },
        ]);
        const core = new NeuroAgentHarness({store, profiles, model: scripted, capabilities: adapterCapabilities("")});
        const adapter = new NeuroAgentHarnessAdapter({core, store, projector: new MachineLlmReviewProjector(client), client});
        const created = await adapter.createSession("revision-active-workspace", 8);
        const accepted = await adapter.invoke(created.sessionId, 8, {mode: "prompt", phase: "optimize", revisionId: "revision-active-workspace", message: "改写", body: "旧文"});

        let active = await adapter.getSnapshot(created.sessionId, 8);
        for (let attempt = 0; attempt < 30 && active.activeWorkspace === null; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 5));
            active = await adapter.getSnapshot(created.sessionId, 8);
        }
        expect(active.activeWorkspace).toEqual({invocationId: accepted.invocationId, body: "新文"});

        release();
        for (let attempt = 0; attempt < 30; attempt += 1) {
            const finished = await adapter.getSnapshot(created.sessionId, 8);
            if (finished.invocations[0]?.status === "completed") break;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
    });

    it("新建 neuro session 的 analysis 通过 observer 写入 MachineLlmReview", async () => {
        directory = await mkdtemp(join(tmpdir(), "llmlint-harness-analysis-"));
        client = createPrismaClient(`file:${join(directory, "analysis.db")}`);
        await createHarnessTables(client);
        await createRevision(client, "revision-analysis");
        const body = "正文没有明显命中。";
        const store = new PrismaSessionStore(client);
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model", analysisModelKey: "test/model"}));
        const scripted = new ScriptedModelRuntime<LlmlintModelConfig>([
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "lint", name: "lint_check", arguments: {review: "all"}}}], timestamp: 1}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "read", name: "read", arguments: {lineNumbers: true}}}], timestamp: 2}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "report", name: "report_result", arguments: {confidence: 0.8, conclusion: "未发现明确命中", suggestions: []}}}], timestamp: 3}},
        ]);
        const core = new NeuroAgentHarness({
            store,
            profiles,
            model: scripted,
            capabilities: adapterCapabilities(body, {body, chunks: [{start: 0, end: body.length, text: body}], scanStats: {hitCount: 0, docScore: 0}, ruleIds: new Set<string>(), ruleLevels: new Map(), rulesText: "无"}),
        });
        const adapter = new NeuroAgentHarnessAdapter({core, store, projector: new MachineLlmReviewProjector(client), client});
        const created = await adapter.createSession("revision-analysis", 9);
        const accepted = await adapter.invoke(created.sessionId, 9, {mode: "prompt", phase: "analysis", revisionId: "revision-analysis"});

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

    it("abort 绑定 active invocation，拒绝取消已经被替换的调用", async () => {
        directory = await mkdtemp(join(tmpdir(), "llmlint-harness-abort-"));
        client = createPrismaClient(`file:${join(directory, "abort.db")}`);
        await createHarnessTables(client);
        await createRevision(client, "revision-abort");
        const store = new PrismaSessionStore(client);
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>().add(createLlmlintProfile({repairModelKey: "test/model"}));
        let started!: () => void;
        const pending = new Promise<void>((resolve) => { started = resolve; });
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([async (request) => {
            started();
            return new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(new Error("aborted")), {once: true}));
        }]);
        const core = new NeuroAgentHarness({store, profiles, model, capabilities: adapterCapabilities("")});
        const adapter = new NeuroAgentHarnessAdapter({core, store, projector: new MachineLlmReviewProjector(client), client});
        const created = await adapter.createSession("revision-abort", 11);
        const accepted = await adapter.invoke(created.sessionId, 11, {mode: "prompt", phase: "optimize", revisionId: "revision-abort", message: "等待", body: "正文"});
        await pending;

        await expect(adapter.abort(created.sessionId, 11, "stale-invocation")).rejects.toMatchObject({statusCode: 409});
        await expect(adapter.abort(created.sessionId, 11, accepted.invocationId)).resolves.toEqual({status: "aborting"});
        for (let attempt = 0; attempt < 20; attempt += 1) {
            const snapshot = await adapter.getSnapshot(created.sessionId, 11);
            if (snapshot.invocations[0]?.status === "aborted") break;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect((await adapter.getSnapshot(created.sessionId, 11)).invocations[0]?.status).toBe("aborted");
    });

    it("rev0 到 rev1 再到 rev2 始终推进同一 Session，并分别记录 analysis Revision", async () => {
        directory = await mkdtemp(join(tmpdir(), "llmlint-harness-advance-"));
        client = createPrismaClient(`file:${join(directory, "advance.db")}`);
        await createHarnessTables(client);
        await createRevision(client, "revision-parent", "text-shared", 0);
        await createRevision(client, "revision-child", "text-shared", 1, "revision-parent");
        await createRevision(client, "revision-grandchild", "text-shared", 2, "revision-child");
        const store = new PrismaSessionStore(client);
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model", analysisModelKey: "test/model"}));
        const body = "正文";
        const scripted = new ScriptedModelRuntime<LlmlintModelConfig>([
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "lint", name: "lint_check", arguments: {review: "all"}}}], timestamp: 1}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "read", name: "read", arguments: {lineNumbers: true}}}], timestamp: 2}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "report", name: "report_result", arguments: {confidence: 1, conclusion: "rev0 完成", suggestions: []}}}], timestamp: 3}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "lint-1", name: "lint_check", arguments: {review: "all"}}}], timestamp: 4}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "read-1", name: "read", arguments: {lineNumbers: true}}}], timestamp: 5}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "report-1", name: "report_result", arguments: {confidence: 1, conclusion: "rev1 完成", suggestions: []}}}], timestamp: 6}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "lint-2", name: "lint_check", arguments: {review: "all"}}}], timestamp: 7}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "read-2", name: "read", arguments: {lineNumbers: true}}}], timestamp: 8}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "report-2", name: "report_result", arguments: {confidence: 1, conclusion: "rev2 完成", suggestions: []}}}], timestamp: 9}},
        ]);
        const core = new NeuroAgentHarness({store, profiles, model: scripted, capabilities: adapterCapabilities(body, {body, chunks: [{start: 0, end: body.length, text: body}], scanStats: {hitCount: 0, docScore: 0}, ruleIds: new Set<string>(), ruleLevels: new Map(), rulesText: "无"})});
        const adapter = new NeuroAgentHarnessAdapter({core, store, projector: new MachineLlmReviewProjector(client), client});
        const created = await adapter.createSession("revision-parent", 12);
        const parent = await adapter.invoke(created.sessionId, 12, {mode: "prompt", phase: "analysis", revisionId: "revision-parent"});
        for (let attempt = 0; attempt < 30; attempt += 1) {
            if ((await client.agentInvocation.findUnique({where: {id: parent.invocationId}, select: {status: true}}))?.status === "completed") break;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }

        const child = await adapter.advanceRevision(created.sessionId, 12, "revision-child");

        for (let attempt = 0; attempt < 30; attempt += 1) {
            if ((await adapter.getSnapshot(created.sessionId, 12)).invocations.at(-1)?.status === "completed") break;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        const grandchild = await adapter.advanceRevision(created.sessionId, 12, "revision-grandchild");
        for (let attempt = 0; attempt < 30; attempt += 1) {
            if ((await adapter.getSnapshot(created.sessionId, 12)).invocations.at(-1)?.status === "completed") break;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(await client.agentSession.count()).toBe(1);
        expect(await client.agentSession.findUnique({where: {id: created.sessionId}, select: {revisionId: true}})).toEqual({revisionId: "revision-grandchild"});
        expect(await client.agentInvocation.findMany({where: {id: {in: [parent.invocationId, child.invocationId, grandchild.invocationId]}}, orderBy: {createdAt: "asc"}, select: {sessionId: true, revisionId: true}})).toEqual([
            {sessionId: created.sessionId, revisionId: "revision-parent"},
            {sessionId: created.sessionId, revisionId: "revision-child"},
            {sessionId: created.sessionId, revisionId: "revision-grandchild"},
        ]);
        const finalSnapshot = await adapter.getSnapshot(created.sessionId, 12);
        expect(finalSnapshot.invocations.map((invocation) => invocation.id)).toEqual([parent.invocationId, child.invocationId, grandchild.invocationId]);
        expect(finalSnapshot.eventCursor.after).toBeGreaterThan(0);
        const subscription = adapter.subscribeEvents(created.sessionId, {after: 0});
        let terminalCount = 0;
        const replay = await collectUntil(subscription, (event) => {
            if (event.kind === "runtime" && event.event.type === "agent_end") terminalCount += 1;
            return terminalCount === 3;
        });
        expect(replay.filter((event) => event.kind === "runtime" && event.event.type === "agent_start").map((event) => event.invocationId)).toEqual([
            parent.invocationId,
            child.invocationId,
            grandchild.invocationId,
        ]);
        await subscription.close();
    });

    it("并发推进同一 Revision 时复用同一个 analysis Invocation", async () => {
        directory = await mkdtemp(join(tmpdir(), "llmlint-harness-advance-idempotent-"));
        client = createPrismaClient(`file:${join(directory, "advance-idempotent.db")}`);
        await createHarnessTables(client);
        await createRevision(client, "revision-parent", "text-shared", 0);
        await createRevision(client, "revision-child", "text-shared", 1, "revision-parent");
        const body = "正文";
        const analysis = {body, chunks: [{start: 0, end: body.length, text: body}], scanStats: {hitCount: 0, docScore: 0}, ruleIds: new Set<string>(), ruleLevels: new Map<string, "high" | "medium" | "low">(), rulesText: "无"};
        const store = new PrismaSessionStore(client);
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model", analysisModelKey: "test/model"}));
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "lint", name: "lint_check", arguments: {review: "all"}}}], timestamp: 1}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "read", name: "read", arguments: {lineNumbers: true}}}], timestamp: 2}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "report", name: "report_result", arguments: {confidence: 1, conclusion: "完成", suggestions: []}}}], timestamp: 3}},
        ]);
        const core = new NeuroAgentHarness({store, profiles, model, capabilities: adapterCapabilities(body, analysis)});
        const adapter = new NeuroAgentHarnessAdapter({core, store, projector: new MachineLlmReviewProjector(client), client});
        const created = await adapter.createSession("revision-parent", 17);
        const subscription = adapter.subscribeEvents(created.sessionId, {after: 0});

        const [first, second] = await Promise.all([
            adapter.advanceRevision(created.sessionId, 17, "revision-child"),
            adapter.advanceRevision(created.sessionId, 17, "revision-child"),
        ]);

        expect(second.invocationId).toBe(first.invocationId);
        expect(await client.agentInvocation.count({where: {sessionId: created.sessionId, revisionId: "revision-child", phase: "analysis"}})).toBe(1);
        const events = await collectUntil(subscription, (event) => event.kind === "runtime" && event.event.type === "agent_start");
        expect(events[0]).toMatchObject({kind: "session", event: {type: "status", status: "idle"}});
        await subscription.close();
        for (let attempt = 0; attempt < 30; attempt += 1) {
            if ((await client.agentInvocation.findUnique({where: {id: first.invocationId}, select: {status: true}}))?.status === "completed") break;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
    });

    it("Session 已推进但缺少 Invocation 时补建目标 analysis", async () => {
        directory = await mkdtemp(join(tmpdir(), "llmlint-harness-advance-recover-"));
        client = createPrismaClient(`file:${join(directory, "advance-recover.db")}`);
        await createHarnessTables(client);
        await createRevision(client, "revision-child", "text-shared", 1, "revision-parent");
        const body = "正文";
        const analysis = {body, chunks: [{start: 0, end: body.length, text: body}], scanStats: {hitCount: 0, docScore: 0}, ruleIds: new Set<string>(), ruleLevels: new Map<string, "high" | "medium" | "low">(), rulesText: "无"};
        const store = new PrismaSessionStore(client);
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model", analysisModelKey: "test/model"}));
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "lint", name: "lint_check", arguments: {review: "all"}}}], timestamp: 1}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "read", name: "read", arguments: {lineNumbers: true}}}], timestamp: 2}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "report", name: "report_result", arguments: {confidence: 1, conclusion: "完成", suggestions: []}}}], timestamp: 3}},
        ]);
        const core = new NeuroAgentHarness({store, profiles, model, capabilities: adapterCapabilities(body, analysis)});
        const adapter = new NeuroAgentHarnessAdapter({core, store, projector: new MachineLlmReviewProjector(client), client});
        const created = await adapter.createSession("revision-child", 18);

        const accepted = await adapter.advanceRevision(created.sessionId, 18, "revision-child");

        expect(await client.agentInvocation.findUnique({where: {id: accepted.invocationId}, select: {revisionId: true}})).toEqual({revisionId: "revision-child"});
        for (let attempt = 0; attempt < 30; attempt += 1) {
            if ((await client.agentInvocation.findUnique({where: {id: accepted.invocationId}, select: {status: true}}))?.status === "completed") break;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
    });

    it("Agent 正在运行时拒绝推进 Revision，且 Session 仍停留在原版本", async () => {
        directory = await mkdtemp(join(tmpdir(), "llmlint-harness-advance-conflict-"));
        client = createPrismaClient(`file:${join(directory, "advance-conflict.db")}`);
        await createHarnessTables(client);
        await createRevision(client, "revision-parent", "text-shared", 0);
        await createRevision(client, "revision-child", "text-shared", 1, "revision-parent");
        const store = new PrismaSessionStore(client);
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model", analysisModelKey: "test/model"}));
        let started!: () => void;
        const modelStarted = new Promise<void>((resolve) => { started = resolve; });
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([async (request) => {
            started();
            return new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(new Error("aborted")), {once: true}));
        }]);
        const core = new NeuroAgentHarness({store, profiles, model, capabilities: adapterCapabilities("正文")});
        const adapter = new NeuroAgentHarnessAdapter({core, store, projector: new MachineLlmReviewProjector(client), client});
        const created = await adapter.createSession("revision-parent", 13);
        const active = await adapter.invoke(created.sessionId, 13, {mode: "prompt", phase: "optimize", revisionId: "revision-parent", message: "等待", body: "正文"});
        await modelStarted;

        await expect(adapter.advanceRevision(created.sessionId, 13, "revision-child")).rejects.toMatchObject({statusCode: 409});
        expect(await client.agentSession.findUnique({where: {id: created.sessionId}, select: {revisionId: true}})).toEqual({revisionId: "revision-parent"});

        await adapter.abort(created.sessionId, 13, active.invocationId);
    });

    it("新版本 analysis 启动失败时回滚 Session 当前 Revision", async () => {
        directory = await mkdtemp(join(tmpdir(), "llmlint-harness-advance-rollback-"));
        client = createPrismaClient(`file:${join(directory, "advance-rollback.db")}`);
        await createHarnessTables(client);
        await createRevision(client, "revision-parent", "text-shared", 0);
        await createRevision(client, "revision-child", "text-shared", 1, "revision-parent");
        const store = new PrismaSessionStore(client);
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model", analysisModelKey: "test/model"}));
        const core = new NeuroAgentHarness({store, profiles, model: new ScriptedModelRuntime<LlmlintModelConfig>([]), capabilities: adapterCapabilities("正文")});
        const adapter = new NeuroAgentHarnessAdapter({core, store, projector: new MachineLlmReviewProjector(client), client});
        const created = await adapter.createSession("revision-parent", 14);
        core.invoke = async () => { throw new Error("analysis start failed"); };

        await expect(adapter.advanceRevision(created.sessionId, 14, "revision-child")).rejects.toThrow("analysis start failed");
        expect(await client.agentSession.findUnique({where: {id: created.sessionId}, select: {revisionId: true}})).toEqual({revisionId: "revision-parent"});
        expect((await core.snapshot(created.sessionId)).session.metadata.hostContext).toEqual({revisionId: "revision-parent", userId: 14});
    });

    it("只允许推进同一 Text 的直接子 Revision", async () => {
        directory = await mkdtemp(join(tmpdir(), "llmlint-harness-advance-lineage-"));
        client = createPrismaClient(`file:${join(directory, "advance-lineage.db")}`);
        await createHarnessTables(client);
        await createRevision(client, "revision-parent", "text-shared", 0);
        await createRevision(client, "revision-grandchild", "text-shared", 2, "revision-middle");
        await createRevision(client, "revision-foreign", "text-foreign", 1, "revision-parent");
        await createRevision(client, "revision-unrevealed", "text-shared", 1, "revision-parent");
        await client.$executeRawUnsafe("UPDATE Revision SET revealedAt = NULL WHERE id = ?", "revision-unrevealed");
        const store = new PrismaSessionStore(client);
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model", analysisModelKey: "test/model"}));
        const core = new NeuroAgentHarness({store, profiles, model: new ScriptedModelRuntime<LlmlintModelConfig>([]), capabilities: adapterCapabilities("正文")});
        const adapter = new NeuroAgentHarnessAdapter({core, store, projector: new MachineLlmReviewProjector(client), client});
        const created = await adapter.createSession("revision-parent", 15);

        await expect(adapter.advanceRevision(created.sessionId, 15, "revision-grandchild")).rejects.toMatchObject({statusCode: 409});
        await expect(adapter.advanceRevision(created.sessionId, 15, "revision-foreign")).rejects.toMatchObject({statusCode: 409});
        await expect(adapter.advanceRevision(created.sessionId, 15, "revision-unrevealed")).rejects.toMatchObject({statusCode: 409});
        expect(await client.agentSession.findUnique({where: {id: created.sessionId}, select: {revisionId: true}})).toEqual({revisionId: "revision-parent"});
    });

    it("重试历史 Revision 的 analysis 不会让 Session 当前 Revision 倒退", async () => {
        directory = await mkdtemp(join(tmpdir(), "llmlint-harness-history-analysis-"));
        client = createPrismaClient(`file:${join(directory, "history-analysis.db")}`);
        await createHarnessTables(client);
        await createRevision(client, "revision-parent", "text-shared", 0);
        await createRevision(client, "revision-child", "text-shared", 1, "revision-parent");
        const body = "正文";
        const analysis = {body, chunks: [{start: 0, end: body.length, text: body}], scanStats: {hitCount: 0, docScore: 0}, ruleIds: new Set<string>(), ruleLevels: new Map<string, "high" | "medium" | "low">(), rulesText: "无"};
        const store = new PrismaSessionStore(client);
        const profiles = new ProfileRegistry<string, LlmlintSessionInitial, LlmlintModelConfig>()
            .add(createLlmlintProfile({repairModelKey: "test/model", analysisModelKey: "test/model"}));
        const model = new ScriptedModelRuntime<LlmlintModelConfig>([
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "lint", name: "lint_check", arguments: {review: "all"}}}], timestamp: 1}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "read", name: "read", arguments: {lineNumbers: true}}}], timestamp: 2}},
            {message: {role: "assistant", content: [{type: "toolCall", call: {id: "report", name: "report_result", arguments: {confidence: 1, conclusion: "完成", suggestions: []}}}], timestamp: 3}},
        ]);
        const core = new NeuroAgentHarness({store, profiles, model, capabilities: adapterCapabilities(body, analysis)});
        const adapter = new NeuroAgentHarnessAdapter({core, store, projector: new MachineLlmReviewProjector(client), client});
        const created = await adapter.createSession("revision-child", 16);

        const accepted = await adapter.invoke(created.sessionId, 16, {mode: "prompt", phase: "analysis", revisionId: "revision-parent"});
        for (let attempt = 0; attempt < 30; attempt += 1) {
            const invocation = await client.agentInvocation.findUnique({where: {id: accepted.invocationId}, select: {status: true}});
            if (invocation?.status === "completed") break;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }

        expect(await client.agentSession.findUnique({where: {id: created.sessionId}, select: {revisionId: true}})).toEqual({revisionId: "revision-child"});
        expect(await client.agentInvocation.findUnique({where: {id: accepted.invocationId}, select: {revisionId: true}})).toEqual({revisionId: "revision-parent"});
    });
});

async function createRevision(prisma: PrismaClient, id: string, textId = id, ordinal = 0, parentId: string | null = null): Promise<void> {
    await prisma.$executeRawUnsafe("INSERT INTO Revision (id, textId, ordinal, parentId, body, revealedAt) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)", id, textId, ordinal, parentId, "正文");
}

function adapterCapabilities(body: string, analysis?: {body: string; chunks: Array<{start: number; end: number; text: string}>; scanStats: {hitCount: number; docScore: number}; ruleIds: Set<string>; ruleLevels: Map<string, "high" | "medium" | "low">; rulesText: string}) {
    return [{
        capability: llmlintAnalysisContext,
        open: () => ({load: async () => {
            if (!analysis) throw new Error("optimize 不应加载 analysis context");
            return analysis;
        }}),
    }, {
        capability: llmlintRevisionTextSource,
        open: () => ({
            forRevision: async (revisionId: string) => ({
                current: async () => ({revisionId, ordinal: 0, body}),
                revision: async () => { throw new Error("测试没有历史 Revision"); },
                detections: async () => ({status: {scan: "waiting", llmReview: "waiting", detectors: "waiting"}, scan: null, llmReview: null, detectors: []}),
            }),
        }),
    }];
}

/** 消费 replay 直到目标事件；订阅仍由调用方显式关闭。 */
async function collectUntil(subscription: AgentEventSubscription, predicate: (event: AgentSessionEvent) => boolean): Promise<AgentSessionEvent[]> {
    const events: AgentSessionEvent[] = [];
    for await (const event of subscription) {
        events.push(event);
        if (predicate(event)) break;
    }
    return events;
}
