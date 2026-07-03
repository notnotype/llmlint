-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "identityRole" TEXT NOT NULL DEFAULT 'reader',
    "status" TEXT NOT NULL DEFAULT 'active',
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Text" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "body" TEXT NOT NULL,
    "charCount" INTEGER NOT NULL,
    "genre" TEXT,
    "pov" TEXT,
    "textType" TEXT,
    "originKind" TEXT NOT NULL DEFAULT 'user_upload',
    "declaredProvenance" TEXT,
    "goldProvenance" TEXT,
    "uploaderId" INTEGER NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "consent" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Text_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DocJudgment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "textId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "aiFlavor" INTEGER NOT NULL,
    "wantReadOn" INTEGER NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'pre_edit',
    "blind" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocJudgment_textId_fkey" FOREIGN KEY ("textId") REFERENCES "Text" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DocJudgment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpanAnnotation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "textId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "target" TEXT NOT NULL DEFAULT 'original',
    "start" INTEGER NOT NULL,
    "end" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpanAnnotation_textId_fkey" FOREIGN KEY ("textId") REFERENCES "Text" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpanAnnotation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MachineRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "textId" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "hitsJson" TEXT NOT NULL,
    "editContent" TEXT,
    "llmAiFlavor" INTEGER,
    "llmNote" TEXT,
    "scannedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MachineRecord_textId_fkey" FOREIGN KEY ("textId") REFERENCES "Text" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");

-- CreateIndex
CREATE INDEX "User_updatedAt_idx" ON "User"("updatedAt");

-- CreateIndex
CREATE INDEX "Text_uploaderId_createdAt_idx" ON "Text"("uploaderId", "createdAt");

-- CreateIndex
CREATE INDEX "Text_originKind_idx" ON "Text"("originKind");

-- CreateIndex
CREATE INDEX "DocJudgment_textId_idx" ON "DocJudgment"("textId");

-- CreateIndex
CREATE UNIQUE INDEX "DocJudgment_userId_textId_phase_key" ON "DocJudgment"("userId", "textId", "phase");

-- CreateIndex
CREATE INDEX "SpanAnnotation_textId_target_idx" ON "SpanAnnotation"("textId", "target");

-- CreateIndex
CREATE INDEX "SpanAnnotation_userId_createdAt_idx" ON "SpanAnnotation"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MachineRecord_textId_key" ON "MachineRecord"("textId");

-- CreateIndex
CREATE INDEX "MachineRecord_engineVersion_idx" ON "MachineRecord"("engineVersion");
