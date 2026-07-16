-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AgentInvocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "profileKey" TEXT NOT NULL DEFAULT 'llmlint.review',
    "mode" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "inputJson" TEXT NOT NULL,
    "callerJson" TEXT NOT NULL DEFAULT '{"kind":"user"}',
    "retryOf" TEXT,
    "resultJson" TEXT,
    "error" TEXT,
    "errorJson" TEXT,
    "pendingApprovalsJson" TEXT,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "AgentInvocation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AgentInvocation" ("createdAt", "error", "finishedAt", "id", "inputJson", "mode", "phase", "resultJson", "sessionId", "status", "turns") SELECT "createdAt", "error", "finishedAt", "id", "inputJson", "mode", "phase", "resultJson", "sessionId", "status", "turns" FROM "AgentInvocation";
DROP TABLE "AgentInvocation";
ALTER TABLE "new_AgentInvocation" RENAME TO "AgentInvocation";
CREATE INDEX "AgentInvocation_sessionId_createdAt_idx" ON "AgentInvocation"("sessionId", "createdAt");
CREATE INDEX "AgentInvocation_status_idx" ON "AgentInvocation"("status");
CREATE TABLE "new_AgentSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "revisionId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "profileKey" TEXT NOT NULL,
    "initialJson" TEXT NOT NULL DEFAULT '{}',
    "hostContextJson" TEXT NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "activeLeafId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentSession_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AgentSession" ("activeLeafId", "createdAt", "id", "profileKey", "revisionId", "status", "updatedAt", "userId") SELECT "activeLeafId", "createdAt", "id", "profileKey", "revisionId", "status", "updatedAt", "userId" FROM "AgentSession";
DROP TABLE "AgentSession";
ALTER TABLE "new_AgentSession" RENAME TO "AgentSession";
CREATE INDEX "AgentSession_userId_updatedAt_idx" ON "AgentSession"("userId", "updatedAt");
CREATE UNIQUE INDEX "AgentSession_revisionId_profileKey_key" ON "AgentSession"("revisionId", "profileKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
