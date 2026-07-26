import type {PrismaClient} from "../../web/server/database/prisma";

/** 创建独立 Harness Adapter 测试所需的最小 Prisma 表。 */
export async function createHarnessTables(prisma: PrismaClient): Promise<void> {
    await prisma.$executeRawUnsafe(`CREATE TABLE Revision (
        id TEXT PRIMARY KEY NOT NULL,
        textId TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        parentId TEXT,
        body TEXT NOT NULL DEFAULT '',
        revealedAt DATETIME
    )`);
    await prisma.$executeRawUnsafe(`CREATE TABLE AgentSession (
        id TEXT PRIMARY KEY NOT NULL,
        revisionId TEXT NOT NULL,
        userId INTEGER NOT NULL,
        profileKey TEXT NOT NULL,
        initialJson TEXT NOT NULL DEFAULT '{}',
        hostContextJson TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'idle',
        activeLeafId TEXT,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await prisma.$executeRawUnsafe("CREATE UNIQUE INDEX AgentSession_revisionId_profileKey_key ON AgentSession(revisionId, profileKey)");
    await prisma.$executeRawUnsafe(`CREATE TABLE AgentSessionEntry (
        id TEXT PRIMARY KEY NOT NULL,
        sessionId TEXT NOT NULL,
        invocationId TEXT,
        parentId TEXT,
        kind TEXT NOT NULL,
        payloadJson TEXT NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await prisma.$executeRawUnsafe(`CREATE TABLE AgentInvocation (
        id TEXT PRIMARY KEY NOT NULL,
        sessionId TEXT NOT NULL,
        revisionId TEXT NOT NULL,
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
        finishedAt DATETIME
    )`);
    await prisma.$executeRawUnsafe("CREATE INDEX AgentInvocation_revisionId_createdAt_idx ON AgentInvocation(revisionId, createdAt)");
    await prisma.$executeRawUnsafe(`CREATE TABLE MachineScan (
        id TEXT PRIMARY KEY NOT NULL,
        revisionId TEXT NOT NULL,
        engineVersion TEXT NOT NULL,
        hitsJson TEXT NOT NULL,
        docScore REAL NOT NULL,
        scannedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await prisma.$executeRawUnsafe(`CREATE TABLE MachineDetect (
        id TEXT PRIMARY KEY NOT NULL,
        revisionId TEXT NOT NULL,
        detectorName TEXT NOT NULL,
        detectorVersion TEXT NOT NULL,
        chunkChars INTEGER NOT NULL,
        docPAi REAL NOT NULL,
        maxPAi REAL,
        chunksJson TEXT NOT NULL,
        checkedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await prisma.$executeRawUnsafe(`CREATE TABLE MachineDetectRun (
        id TEXT PRIMARY KEY NOT NULL,
        revisionId TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        error TEXT,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        startedAt DATETIME,
        finishedAt DATETIME
    )`);
    await prisma.$executeRawUnsafe(`CREATE TABLE MachineLlmReview (
        id TEXT PRIMARY KEY NOT NULL,
        revisionId TEXT NOT NULL,
        sessionId TEXT NOT NULL,
        invocationId TEXT NOT NULL UNIQUE,
        model TEXT NOT NULL,
        promptVersion TEXT NOT NULL,
        score INTEGER NOT NULL,
        confidence REAL NOT NULL,
        hitsJson TEXT NOT NULL,
        reportJson TEXT NOT NULL,
        judgedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
}
