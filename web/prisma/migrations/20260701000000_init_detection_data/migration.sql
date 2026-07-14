-- llmlint 检测数据库 · N 版本修订谱系 + 统一数据模型（Task 09 → Task 13 W1）
-- 说明：本仓处于 pre-release、采集库为近 0 的一次性数据，故直接把 init 迁移重写为最终形态。
-- Task 13 W1 增量：OriginKind 三变体（uploaded/curated/generated）、Text 自报与分类三源列、
-- Revision.revealedAt（D-A 揭示时机）、MachineRecord 拆分为 MachineScan + MachineDetect、DocJudgment 四轴可选。
-- 应用方式：删除旧 dev 库后重跑 → `rm web/data.db && bun run db:init && bun run db:generate`。
-- init-db.ts 按分号切分执行，勿在语句内使用触发器或裸分号。

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
    "genre" TEXT,
    "pov" TEXT,
    "textType" TEXT,
    "genreSource" TEXT,
    "povSource" TEXT,
    "textTypeSource" TEXT,
    "originKind" TEXT NOT NULL DEFAULT 'uploaded',
    "declaredProvenance" TEXT,
    "sourceNote" TEXT,
    "modelKey" TEXT,
    "genParamsJson" TEXT,
    "uploaderId" INTEGER NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "consent" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Text_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Revision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "textId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "parentId" TEXT,
    "body" TEXT NOT NULL,
    "charCount" INTEGER NOT NULL,
    "transitionKind" TEXT NOT NULL DEFAULT 'upload',
    "provenanceJson" TEXT,
    "revealedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Revision_textId_fkey" FOREIGN KEY ("textId") REFERENCES "Text" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DocJudgment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "revisionId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "aiFlavor" INTEGER,
    "wantReadOn" INTEGER,
    "improvementScore" INTEGER,
    "comment" TEXT,
    "blind" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocJudgment_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DocJudgment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpanAnnotation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "revisionId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "start" INTEGER NOT NULL,
    "end" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpanAnnotation_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpanAnnotation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MachineScan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "revisionId" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "hitsJson" TEXT NOT NULL,
    "docScore" REAL NOT NULL,
    "scannedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MachineScan_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MachineDetect" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "revisionId" TEXT NOT NULL,
    "detectorName" TEXT NOT NULL,
    "detectorVersion" TEXT NOT NULL,
    "chunkChars" INTEGER NOT NULL,
    "docPAi" REAL NOT NULL,
    "maxPAi" REAL,
    "chunksJson" TEXT NOT NULL,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MachineDetect_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
CREATE UNIQUE INDEX "Revision_textId_ordinal_key" ON "Revision"("textId", "ordinal");

-- CreateIndex
CREATE INDEX "Revision_textId_idx" ON "Revision"("textId");

-- CreateIndex
CREATE UNIQUE INDEX "DocJudgment_userId_revisionId_key" ON "DocJudgment"("userId", "revisionId");

-- CreateIndex
CREATE INDEX "DocJudgment_revisionId_idx" ON "DocJudgment"("revisionId");

-- CreateIndex
CREATE INDEX "SpanAnnotation_revisionId_idx" ON "SpanAnnotation"("revisionId");

-- CreateIndex
CREATE INDEX "SpanAnnotation_userId_createdAt_idx" ON "SpanAnnotation"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MachineScan_revisionId_engineVersion_key" ON "MachineScan"("revisionId", "engineVersion");

-- CreateIndex
CREATE INDEX "MachineScan_engineVersion_idx" ON "MachineScan"("engineVersion");

-- CreateIndex
CREATE UNIQUE INDEX "MachineDetect_revisionId_detectorName_detectorVersion_chunkChars_key" ON "MachineDetect"("revisionId", "detectorName", "detectorVersion", "chunkChars");
