-- Invocation 必须记录自己的目标 Revision；Session.revisionId 只表示当前工作版本。
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_AgentInvocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
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
    "terminationReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "AgentInvocation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentInvocation_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_AgentInvocation" (
    "id", "sessionId", "revisionId", "profileKey", "mode", "phase", "status", "inputJson", "callerJson", "retryOf",
    "resultJson", "error", "errorJson", "pendingApprovalsJson", "turns", "terminationReason", "createdAt", "finishedAt"
)
SELECT
    invocation."id", invocation."sessionId", session."revisionId", invocation."profileKey", invocation."mode", invocation."phase",
    invocation."status", invocation."inputJson", invocation."callerJson", invocation."retryOf", invocation."resultJson", invocation."error",
    invocation."errorJson", invocation."pendingApprovalsJson", invocation."turns", invocation."terminationReason", invocation."createdAt",
    invocation."finishedAt"
FROM "AgentInvocation" invocation
JOIN "AgentSession" session ON session."id" = invocation."sessionId";

DROP TABLE "AgentInvocation";
ALTER TABLE "new_AgentInvocation" RENAME TO "AgentInvocation";
CREATE INDEX "AgentInvocation_sessionId_createdAt_idx" ON "AgentInvocation"("sessionId", "createdAt");
CREATE INDEX "AgentInvocation_revisionId_createdAt_idx" ON "AgentInvocation"("revisionId", "createdAt");
CREATE INDEX "AgentInvocation_status_idx" ON "AgentInvocation"("status");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
