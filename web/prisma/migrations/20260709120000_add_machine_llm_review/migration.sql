-- Task 17 工单 C：LLM 规则检测结果表（机器断言之三，仅服务器写）。
-- init-db.ts 按分号切分执行，勿在语句内使用触发器或裸分号。

-- CreateTable
CREATE TABLE "MachineLlmReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "revisionId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "hitsJson" TEXT NOT NULL,
    "judgedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MachineLlmReview_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MachineLlmReview_revisionId_model_promptVersion_key" ON "MachineLlmReview"("revisionId", "model", "promptVersion");
