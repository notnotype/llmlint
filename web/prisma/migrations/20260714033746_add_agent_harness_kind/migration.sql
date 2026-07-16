-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AgentSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "revisionId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "profileKey" TEXT NOT NULL,
    "harnessKind" TEXT NOT NULL DEFAULT 'local',
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
INSERT INTO "new_AgentSession" ("activeLeafId", "createdAt", "hostContextJson", "id", "initialJson", "profileKey", "revisionId", "status", "updatedAt", "userId", "version") SELECT "activeLeafId", "createdAt", "hostContextJson", "id", "initialJson", "profileKey", "revisionId", "status", "updatedAt", "userId", "version" FROM "AgentSession";
DROP TABLE "AgentSession";
ALTER TABLE "new_AgentSession" RENAME TO "AgentSession";
CREATE INDEX "AgentSession_userId_updatedAt_idx" ON "AgentSession"("userId", "updatedAt");
CREATE UNIQUE INDEX "AgentSession_revisionId_profileKey_key" ON "AgentSession"("revisionId", "profileKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
