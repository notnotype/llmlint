import {afterEach, describe, expect, it} from "vitest";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {SessionConflictError} from "@notnotype/neuro-agent-harness";
import {createPrismaClient, type PrismaClient} from "../web/server/database/prisma";
import {PrismaSessionStore} from "../web/server/agent/neuro-agent-harness/prisma-session-store";
import {createHarnessTables} from "./helpers/agent-harness-db";

let directory: string | undefined;
let client: PrismaClient | undefined;
let secondClient: PrismaClient | undefined;

afterEach(async () => {
    await client?.$disconnect();
    await secondClient?.$disconnect();
    client = undefined;
    secondClient = undefined;
    if (directory) {
        try {
            await rm(directory, {recursive: true, force: true});
        } catch {
            // Windows 下 libsql 连接释放可能晚于 Prisma disconnect；临时目录可由系统回收。
        }
    }
    directory = undefined;
});

describe("llmlint Prisma SessionStore Adapter", () => {
    it("原子持久化 SessionWritePlan，并执行 optimistic version 校验", async () => {
        directory = await mkdtemp(join(tmpdir(), "llmlint-harness-store-"));
        client = createPrismaClient(`file:${join(directory, "store.db")}`);
        await createHarnessTables(client);
        const store = new PrismaSessionStore(client);
        const created = await store.create({
            sessionId: "session-1",
            profileKey: "llmlint.review",
            initial: {revisionId: "revision-1", userId: 1},
            hostContext: {revisionId: "revision-1", userId: 1},
        });
        expect(created.version).toBe(0);

        await store.commit({
            target: "session-1",
            expectedVersion: 0,
            cause: "test.start",
            operations: [{
                type: "startInvocation",
                invocation: {
                    id: "invocation-1",
                    sessionId: "session-1",
                    profileKey: "llmlint.review",
                    caller: {kind: "user"},
                    input: {mode: "prompt", phase: "optimize", body: "原文"},
                    createdAt: 1,
                },
            }],
        });
        await store.commit({
            target: "session-1",
            expectedVersion: 1,
            cause: "test.entry",
            operations: [{type: "appendEntries", entries: [{kind: "llmlint.edit", invocationId: "invocation-1", payload: {oldText: "原", newText: "新", reason: null}}]}],
        });
        await store.commit({
            target: "session-1",
            expectedVersion: 2,
            cause: "test.finish",
            operations: [{type: "finishInvocation", invocationId: "invocation-1", status: "completed", turnCount: 2, terminationReason: "tool_terminate", output: {body: "新文", edits: [], partial: false, summary: ""}}],
        });

        const restored = await store.read("session-1");
        expect(restored.version).toBe(3);
        expect(restored.status).toBe("idle");
        expect(restored.entries).toHaveLength(1);
        expect(restored.invocations[0]).toMatchObject({status: "completed", turnCount: 2, output: {body: "新文"}});

        await expect(store.commit({target: "session-1", expectedVersion: 0, cause: "test.conflict", operations: []}))
            .rejects.toBeInstanceOf(SessionConflictError);
    });

    it("并发创建同一 revision/profile 时原子返回同一个 Session", async () => {
        directory = await mkdtemp(join(tmpdir(), "llmlint-harness-create-"));
        client = createPrismaClient(`file:${join(directory, "store.db")}`);
        await createHarnessTables(client);
        const store = new PrismaSessionStore(client);

        const [first, second] = await Promise.all([
            store.create({sessionId: "session-first", profileKey: "llmlint.review", initial: {revisionId: "revision-one", userId: 1}, hostContext: {revisionId: "revision-one", userId: 1}}),
            store.create({sessionId: "session-second", profileKey: "llmlint.review", initial: {revisionId: "revision-one", userId: 1}, hostContext: {revisionId: "revision-one", userId: 1}}),
        ]);

        expect(first.metadata.sessionId).toBe(second.metadata.sessionId);
        expect(await client.agentSession.count()).toBe(1);
    });

    it("两个 Prisma client 并发提交同一 Session 时串行化为一次成功和一次版本冲突", async () => {
        directory = await mkdtemp(join(tmpdir(), "llmlint-harness-multi-client-"));
        const databaseUrl = `file:${join(directory, "store.db")}`;
        client = createPrismaClient(databaseUrl);
        secondClient = createPrismaClient(databaseUrl);
        await createHarnessTables(client);
        const firstStore = new PrismaSessionStore(client);
        const secondStore = new PrismaSessionStore(secondClient);
        await firstStore.create({sessionId: "session-shared", profileKey: "llmlint.review", initial: {revisionId: "revision-shared", userId: 1}, hostContext: {revisionId: "revision-shared", userId: 1}});
        const plan = (cause: string) => ({
            target: "session-shared",
            expectedVersion: 0,
            cause,
            operations: [{type: "appendEntries" as const, entries: [{kind: "test.entry", payload: {cause}}]}],
        });

        const settled = await Promise.allSettled([
            firstStore.commit(plan("test.first")),
            secondStore.commit(plan("test.second")),
        ]);

        expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(1);
        const rejected = settled.find((item) => item.status === "rejected");
        expect(rejected?.status === "rejected" ? rejected.reason : null).toBeInstanceOf(SessionConflictError);
    });

    it("恢复时只中断实际 running Invocation，waiting Session 保持 waiting", async () => {
        directory = await mkdtemp(join(tmpdir(), "llmlint-harness-recovery-"));
        client = createPrismaClient(`file:${join(directory, "store.db")}`);
        await createHarnessTables(client);
        const store = new PrismaSessionStore(client);
        await store.create({sessionId: "session-waiting", profileKey: "llmlint.review", initial: {revisionId: "revision-waiting", userId: 1}, hostContext: {revisionId: "revision-waiting", userId: 1}});
        await store.commit({
            target: "session-waiting",
            expectedVersion: 0,
            cause: "test.waiting.start",
            operations: [{type: "startInvocation", invocation: {id: "invocation-waiting", sessionId: "session-waiting", profileKey: "llmlint.review", caller: {kind: "user"}, input: {mode: "prompt", phase: "optimize", body: "正文"}, createdAt: 1}}],
        });
        await store.commit({
            target: "session-waiting",
            expectedVersion: 1,
            cause: "test.waiting.pause",
            operations: [{type: "waitInvocation", invocationId: "invocation-waiting", turnCount: 1, pendingApprovals: [{toolCallId: "tool-1", toolName: "replace", prompt: "确认修改", arguments: {}}]}],
        });
        await store.create({sessionId: "session-running", profileKey: "llmlint.review", initial: {revisionId: "revision-running", userId: 1}, hostContext: {revisionId: "revision-running", userId: 1}});
        await store.commit({
            target: "session-running",
            expectedVersion: 0,
            cause: "test.running.start",
            operations: [{type: "startInvocation", invocation: {id: "invocation-running", sessionId: "session-running", profileKey: "llmlint.review", caller: {kind: "user"}, input: {mode: "prompt", phase: "analysis", body: "正文"}, createdAt: 1}}],
        });

        await store.reconcileInterrupted();

        const waiting = await store.read("session-waiting");
        const running = await store.read("session-running");
        expect(waiting.status).toBe("waiting");
        expect(waiting.invocations[0]?.status).toBe("waiting");
        expect(running.status).toBe("interrupted");
        expect(running.invocations[0]?.status).toBe("interrupted");
    });
});
