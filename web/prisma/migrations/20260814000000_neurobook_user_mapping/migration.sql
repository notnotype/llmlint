ALTER TABLE "User" ADD COLUMN "neuroBookUserId" INTEGER;
CREATE UNIQUE INDEX "User_neuroBookUserId_key" ON "User"("neuroBookUserId");
