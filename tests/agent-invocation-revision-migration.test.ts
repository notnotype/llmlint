import {afterEach, describe, expect, it} from "bun:test";
import {Database} from "bun:sqlite";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

let directory: string | undefined;
let database: Database | undefined;

afterEach(async () => {
    database?.close();
    database = undefined;
    if (directory) await rm(directory, {recursive: true, force: true});
    directory = undefined;
});

describe("AgentInvocation revision migration", () => {
    it("从 Session 回填历史 Invocation revisionId，并保留既有 MachineLlmReview", async () => {
        directory = await mkdtemp(join(tmpdir(), "llmlint-invocation-revision-migration-"));
        database = new Database(join(directory, "migration.db"), {create: true});
        database.run("PRAGMA foreign_keys=ON");
        database.run("CREATE TABLE Revision (id TEXT PRIMARY KEY NOT NULL)");
        database.run("CREATE TABLE AgentSession (id TEXT PRIMARY KEY NOT NULL, revisionId TEXT NOT NULL, FOREIGN KEY (revisionId) REFERENCES Revision(id))");
        database.run(`CREATE TABLE AgentInvocation (
            id TEXT PRIMARY KEY NOT NULL,
            sessionId TEXT NOT NULL,
            profileKey TEXT NOT NULL DEFAULT 'llmlint.review',
            mode TEXT NOT NULL,
            phase TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'running',
            inputJson TEXT NOT NULL,
            callerJson TEXT NOT NULL DEFAULT '{"kind":"user"}',
            retryOf TEXT,
            resultJson TEXT,
            error TEXT,
            errorJson TEXT,
            pendingApprovalsJson TEXT,
            turns INTEGER NOT NULL DEFAULT 0,
            terminationReason TEXT,
            createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            finishedAt DATETIME,
            FOREIGN KEY (sessionId) REFERENCES AgentSession(id) ON DELETE CASCADE ON UPDATE CASCADE
        )`);
        database.run(`CREATE TABLE MachineLlmReview (
            id TEXT PRIMARY KEY NOT NULL,
            revisionId TEXT NOT NULL,
            sessionId TEXT NOT NULL,
            invocationId TEXT NOT NULL UNIQUE,
            reportJson TEXT NOT NULL,
            FOREIGN KEY (revisionId) REFERENCES Revision(id),
            FOREIGN KEY (sessionId) REFERENCES AgentSession(id),
            FOREIGN KEY (invocationId) REFERENCES AgentInvocation(id)
        )`);
        database.run("INSERT INTO Revision (id) VALUES (?)", ["revision-1"]);
        database.run("INSERT INTO AgentSession (id, revisionId) VALUES (?, ?)", ["session-1", "revision-1"]);
        database.run("INSERT INTO AgentInvocation (id, sessionId, mode, phase, status, inputJson) VALUES (?, ?, ?, ?, ?, ?)", ["invocation-1", "session-1", "prompt", "analysis", "completed", "{}"]);
        database.run("INSERT INTO MachineLlmReview (id, revisionId, sessionId, invocationId, reportJson) VALUES (?, ?, ?, ?, ?)", ["review-1", "revision-1", "session-1", "invocation-1", "{}"]);

        const migration = await readFile(join(import.meta.dirname, "../web/prisma/migrations/20260720090000_agent_invocation_revision/migration.sql"), "utf8");
        database.exec(migration);

        expect(database.query<{id: string; sessionId: string; revisionId: string}, []>("SELECT id, sessionId, revisionId FROM AgentInvocation WHERE id = 'invocation-1'").all()).toEqual([{id: "invocation-1", sessionId: "session-1", revisionId: "revision-1"}]);
        expect(database.query<{id: string; invocationId: string; revisionId: string}, []>("SELECT id, invocationId, revisionId FROM MachineLlmReview WHERE id = 'review-1'").all()).toEqual([{id: "review-1", invocationId: "invocation-1", revisionId: "revision-1"}]);
        expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
    });
});
