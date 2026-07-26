import {afterEach, describe, expect, it} from "vitest";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {once} from "node:events";
import {spawn, type ChildProcessWithoutNullStreams} from "node:child_process";
import {createPrismaClient, type PrismaClient} from "../web/server/database/prisma";
import {MachineLlmReviewProjector} from "../web/server/agent/neuro-agent-harness/review-observer";
import {PrismaSessionStore} from "../web/server/agent/neuro-agent-harness/prisma-session-store";
import {createHarnessTables} from "./helpers/agent-harness-db";

let directory: string | undefined;
let client: PrismaClient | undefined;

afterEach(async () => {
    await client?.$disconnect();
    client = undefined;
    if (directory) await rm(directory, {recursive: true, force: true}).catch(() => undefined);
    directory = undefined;
});

describe("MachineLlmReviewProjector", () => {
    it("全量恢复只物化缺失 review，不再解析或写入已有业务投影", async () => {
        directory = await mkdtemp(join(tmpdir(), "llmlint-review-projector-"));
        client = createPrismaClient(`file:${join(directory, "projector.db")}`);
        await createHarnessTables(client);
        await createSession(client, "session-existing", "revision-existing");
        await createSession(client, "session-missing", "revision-missing");
        await client.agentInvocation.create({
            data: {
                id: "invocation-existing",
                sessionId: "session-existing",
                revisionId: "revision-existing",
                mode: "prompt",
                phase: "analysis",
                status: "completed",
                inputJson: JSON.stringify({mode: "prompt", phase: "analysis", revisionId: "revision-existing"}),
                resultJson: "{}",
            },
        });
        await client.machineLlmReview.create({
            data: {
                id: "review-existing",
                revisionId: "revision-existing",
                sessionId: "session-existing",
                invocationId: "invocation-existing",
                model: "preserved/model",
                promptVersion: "preserved",
                score: 1,
                confidence: 0.5,
                hitsJson: "[]",
                reportJson: "{}",
            },
        });
        await client.agentInvocation.create({
            data: {
                id: "invocation-missing",
                sessionId: "session-missing",
                revisionId: "revision-missing",
                mode: "prompt",
                phase: "analysis",
                status: "completed",
                inputJson: JSON.stringify({mode: "prompt", phase: "analysis", revisionId: "revision-missing"}),
                resultJson: JSON.stringify(analysisResult()),
            },
        });
        const projector = new MachineLlmReviewProjector(client);
        const store = new PrismaSessionStore(client);

        await projector.afterCommit({
            plan: {
                target: "session-existing",
                expectedVersion: 0,
                cause: "test.observer",
                operations: [{
                    type: "finishInvocation",
                    invocationId: "invocation-existing",
                    status: "completed",
                    turnCount: 1,
                    terminationReason: "natural_stop",
                    output: {},
                }],
            },
            result: {snapshot: await store.read("session-existing"), entries: []},
        });
        const lockProcess = await holdDatabaseLock(`file:${join(directory, "projector.db")}`, "session-existing");

        await Promise.all([projector.reconcileAll(), projector.reconcileAll()]);
        if (lockProcess.exitCode === null) await once(lockProcess, "exit");
        await projector.reconcileSession("session-existing");

        expect(await client.machineLlmReview.findUnique({where: {invocationId: "invocation-existing"}}))
            .toMatchObject({model: "preserved/model", promptVersion: "preserved", score: 1});
        expect(await client.machineLlmReview.findUnique({where: {invocationId: "invocation-missing"}}))
            .toMatchObject({model: "test/model", promptVersion: "test-v1", score: 0, confidence: 0.8});
        expect(await client.machineLlmReview.count()).toBe(2);
    });

    it("同一 Session 的多次 analysis 按 Invocation revisionId 分别投影", async () => {
        directory = await mkdtemp(join(tmpdir(), "llmlint-review-multi-revision-"));
        client = createPrismaClient(`file:${join(directory, "projector.db")}`);
        await createHarnessTables(client);
        await createSession(client, "session-shared", "revision-2");
        for (const revisionId of ["revision-1", "revision-2"]) {
            await client.agentInvocation.create({
                data: {
                    id: `invocation-${revisionId}`,
                    sessionId: "session-shared",
                    revisionId,
                    mode: "prompt",
                    phase: "analysis",
                    status: "completed",
                    inputJson: JSON.stringify({mode: "prompt", phase: "analysis", revisionId}),
                    resultJson: JSON.stringify(analysisResult()),
                },
            });
        }

        await new MachineLlmReviewProjector(client).reconcileSession("session-shared");

        expect(await client.machineLlmReview.findMany({where: {sessionId: "session-shared"}, orderBy: {revisionId: "asc"}, select: {revisionId: true}}))
            .toEqual([{revisionId: "revision-1"}, {revisionId: "revision-2"}]);
    });
});

/** 创建 projector fixture 所需的最小 Harness session。 */
async function createSession(prisma: PrismaClient, sessionId: string, revisionId: string): Promise<void> {
    await prisma.agentSession.create({
        data: {
            id: sessionId,
            revisionId,
            userId: 1,
            profileKey: "llmlint.review",
            initialJson: "{}",
            hostContextJson: JSON.stringify({revisionId, userId: 1}),
        },
    });
}

/** 返回 Profile validator 可接受的 durable analysis output。 */
function analysisResult() {
    return {
        model: "test/model",
        promptVersion: "test-v1",
        score: 0,
        hits: [],
        report: {
            score: 0,
            confidence: 0.8,
            conclusion: "未发现明确命中",
            evidence: [],
            suggestions: [],
        },
    };
}

/** 用独立 Bun 进程短暂持有全库 write lock，复现 dev 重启期间的外部 SQLite 竞争。 */
async function holdDatabaseLock(databaseUrl: string, sessionId: string): Promise<ChildProcessWithoutNullStreams> {
    const script = `
        import {createClient} from "@libsql/client";
        const client = createClient({url: process.env.LOCK_DATABASE_URL});
        const transaction = await client.transaction("write");
        await transaction.execute({sql: "UPDATE AgentSession SET status = ? WHERE id = ?", args: ["running", process.env.LOCK_SESSION_ID]});
        console.log("locked");
        setTimeout(async () => {
            await transaction.commit();
            transaction.close();
            client.close();
        }, 250);
    `;
    const child = spawn(process.execPath, ["-e", script], {
        cwd: join(process.cwd(), "web"),
        env: {...process.env, LOCK_DATABASE_URL: databaseUrl, LOCK_SESSION_ID: sessionId},
    });
    await new Promise<void>((resolve, reject) => {
        let stderr = "";
        const timeout = setTimeout(() => reject(new Error(`SQLite lock 子进程启动超时：${stderr}`)), 5_000);
        child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
        child.stdout.on("data", (chunk: Buffer) => {
            if (!chunk.toString("utf8").includes("locked")) return;
            clearTimeout(timeout);
            resolve();
        });
        child.once("exit", (code) => {
            clearTimeout(timeout);
            if (code !== 0) reject(new Error(`SQLite lock 子进程异常退出（${String(code)}）：${stderr}`));
        });
    });
    return child;
}
