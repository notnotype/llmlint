-- 三维报告 + Harness 风格 Agent session。开发阶段直接清理旧 LLM review，不保留旧 payload 分支。

DROP TABLE IF EXISTS "MachineLlmReview";

CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "revisionId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "profileKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "activeLeafId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentSession_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AgentSessionEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "invocationId" TEXT,
    "parentId" TEXT,
    "kind" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentSessionEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AgentInvocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "inputJson" TEXT NOT NULL,
    "resultJson" TEXT,
    "error" TEXT,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "AgentInvocation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "MachineLlmReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "revisionId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "invocationId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "confidence" REAL NOT NULL,
    "hitsJson" TEXT NOT NULL,
    "reportJson" TEXT NOT NULL,
    "judgedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MachineLlmReview_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MachineLlmReview_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MachineLlmReview_invocationId_fkey" FOREIGN KEY ("invocationId") REFERENCES "AgentInvocation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "MachineDetectRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "revisionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempt" INTEGER NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "MachineDetectRun_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentSession_revisionId_profileKey_key" ON "AgentSession"("revisionId", "profileKey");
CREATE INDEX "AgentSession_userId_updatedAt_idx" ON "AgentSession"("userId", "updatedAt");
CREATE INDEX "AgentSessionEntry_sessionId_createdAt_idx" ON "AgentSessionEntry"("sessionId", "createdAt");
CREATE INDEX "AgentSessionEntry_invocationId_idx" ON "AgentSessionEntry"("invocationId");
CREATE INDEX "AgentInvocation_sessionId_createdAt_idx" ON "AgentInvocation"("sessionId", "createdAt");
CREATE INDEX "AgentInvocation_status_idx" ON "AgentInvocation"("status");
CREATE UNIQUE INDEX "MachineLlmReview_invocationId_key" ON "MachineLlmReview"("invocationId");
CREATE INDEX "MachineLlmReview_revisionId_judgedAt_idx" ON "MachineLlmReview"("revisionId", "judgedAt");
CREATE INDEX "MachineLlmReview_sessionId_idx" ON "MachineLlmReview"("sessionId");
CREATE UNIQUE INDEX "MachineDetectRun_revisionId_attempt_key" ON "MachineDetectRun"("revisionId", "attempt");
CREATE INDEX "MachineDetectRun_revisionId_createdAt_idx" ON "MachineDetectRun"("revisionId", "createdAt");
CREATE INDEX "MachineDetectRun_status_idx" ON "MachineDetectRun"("status");
