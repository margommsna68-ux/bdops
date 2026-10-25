ALTER TABLE "AppleCheckJob" ADD COLUMN "claimKey" TEXT;
CREATE UNIQUE INDEX "AppleCheckJob_workerId_claimKey_key" ON "AppleCheckJob"("workerId","claimKey");
CREATE TABLE "AppleCheckRequest" (
 "id" TEXT NOT NULL PRIMARY KEY,"projectId" TEXT NOT NULL,"key" TEXT NOT NULL,
 "accountId" TEXT NOT NULL,"accountRevision" INTEGER NOT NULL,"jobId" TEXT NOT NULL,
 CONSTRAINT "AppleCheckRequest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AppleCheckJob"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "AppleCheckRequest_projectId_key_key" ON "AppleCheckRequest"("projectId","key");
