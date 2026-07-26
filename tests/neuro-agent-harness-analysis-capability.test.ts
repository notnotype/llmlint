import {afterEach, describe, expect, it} from "vitest";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createPrismaClient, type PrismaClient} from "../web/server/database/prisma";
import {createLlmlintRevisionTextSourceProvider} from "../web/server/agent/neuro-agent-harness/analysis-capability";
import {PrismaSessionStore} from "../web/server/agent/neuro-agent-harness/prisma-session-store";
import {createHarnessTables} from "./helpers/agent-harness-db";

let directory: string | undefined;
let client: PrismaClient | undefined;

afterEach(async () => {
    await client?.$disconnect();
    client = undefined;
    if (directory) {
        try {
            await rm(directory, {recursive: true, force: true});
        } catch {
            // Windows libsql 释放文件句柄存在短暂延迟，临时目录不影响测试事实。
        }
    }
    directory = undefined;
});

describe("llmlint Revision detection capability", () => {
    it("已有旧 Review 但最新 analysis 正在运行时返回 running", async () => {
        directory = await mkdtemp(join(tmpdir(), "llmlint-analysis-capability-"));
        client = createPrismaClient(`file:${join(directory, "capability.db")}`);
        await createHarnessTables(client);
        await client.$executeRawUnsafe("INSERT INTO Revision (id, textId, ordinal, body, revealedAt) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)", "revision-1", "text-1", 0, "正文");
        const store = new PrismaSessionStore(client);
        const session = await store.create({
            profileKey: "llmlint.review",
            initial: {revisionId: "revision-1", userId: 1},
            hostContext: {revisionId: "revision-1", userId: 1},
        });
        await client.agentInvocation.create({data: {
            id: "analysis-completed",
            sessionId: session.metadata.sessionId,
            revisionId: "revision-1",
            profileKey: "llmlint.review",
            mode: "prompt",
            phase: "analysis",
            status: "completed",
            inputJson: JSON.stringify({mode: "prompt", phase: "analysis", revisionId: "revision-1"}),
            callerJson: JSON.stringify({kind: "system"}),
            resultJson: JSON.stringify({}),
            turns: 1,
            createdAt: new Date("2026-07-20T00:00:00.000Z"),
            finishedAt: new Date("2026-07-20T00:00:01.000Z"),
        }});
        await client.machineLlmReview.create({data: {
            id: "review-1",
            revisionId: "revision-1",
            sessionId: session.metadata.sessionId,
            invocationId: "analysis-completed",
            model: "test/model",
            promptVersion: "llm-rules-agent-v6",
            score: 0,
            confidence: 1,
            hitsJson: "[]",
            reportJson: JSON.stringify({score: 0, confidence: 1, conclusion: "完成", evidence: [], suggestions: []}),
            judgedAt: new Date("2026-07-20T00:00:01.000Z"),
        }});
        await client.agentInvocation.create({data: {
            id: "analysis-running",
            sessionId: session.metadata.sessionId,
            revisionId: "revision-1",
            profileKey: "llmlint.review",
            mode: "prompt",
            phase: "analysis",
            status: "running",
            inputJson: JSON.stringify({mode: "prompt", phase: "analysis", revisionId: "revision-1"}),
            callerJson: JSON.stringify({kind: "user"}),
            turns: 0,
            createdAt: new Date("2026-07-20T00:00:02.000Z"),
        }});
        const snapshot = await store.read(session.metadata.sessionId);
        const resolver = await createLlmlintRevisionTextSourceProvider(client).open({
            sessionId: session.metadata.sessionId,
            invocationId: "optimize-1",
            profileKey: "llmlint.review",
            caller: {kind: "user"},
            hostContext: snapshot.metadata.hostContext,
            snapshot,
            signal: new AbortController().signal,
        });

        const records = await (await resolver.forRevision("revision-1")).detections("revision-1");

        expect(records.status.llmReview).toBe("running");
        expect(records.llmReview).toMatchObject({score: 0, hits: []});
    });
});
