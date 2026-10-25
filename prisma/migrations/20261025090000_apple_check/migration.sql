ALTER TABLE "ProxyIP" ADD COLUMN "appleCheckLeaseJobId" TEXT;
CREATE UNIQUE INDEX "ProxyIP_appleCheckLeaseJobId_key" ON "ProxyIP"("appleCheckLeaseJobId");
CREATE TABLE "AppleCheckWorker" (
 "id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL, "createdById" TEXT NOT NULL,
 "name" TEXT NOT NULL, "proxyGroupId" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "previousTokenHash" TEXT,
 "enabled" BOOLEAN NOT NULL DEFAULT true, "state" TEXT NOT NULL DEFAULT 'OFFLINE',
 "lastSeenAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "AppleCheckWorker_projectId_key" ON "AppleCheckWorker"("projectId");
CREATE UNIQUE INDEX "AppleCheckWorker_tokenHash_key" ON "AppleCheckWorker"("tokenHash");
CREATE TABLE "AppleCheckJob" (
 "id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL, "accountId" TEXT NOT NULL, "accountRevision" INTEGER NOT NULL,
 "appliedRevision" INTEGER, "requestedById" TEXT NOT NULL, "requestKey" TEXT NOT NULL,
 "activeAccountId" TEXT, "activeWorkerId" TEXT, "workerId" TEXT, "proxyId" TEXT, "proxyRevision" INTEGER,
 "leaseHash" TEXT, "expiresAt" TIMESTAMP(3), "hardDeadline" TIMESTAMP(3),
 "phase" TEXT NOT NULL DEFAULT 'QUEUED', "result" TEXT, "reasonCode" TEXT,
 "cleanup" TEXT NOT NULL DEFAULT 'PENDING', "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
 "routeReadAt" TIMESTAMP(3), "submittedAt" TIMESTAMP(3), "observedAt" TIMESTAMP(3), "resultHash" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "AppleCheckJob_activeAccountId_key" ON "AppleCheckJob"("activeAccountId");
CREATE UNIQUE INDEX "AppleCheckJob_activeWorkerId_key" ON "AppleCheckJob"("activeWorkerId");
CREATE UNIQUE INDEX "AppleCheckJob_projectId_requestKey_key" ON "AppleCheckJob"("projectId", "requestKey");
CREATE INDEX "AppleCheckJob_projectId_createdAt_idx" ON "AppleCheckJob"("projectId", "createdAt");
CREATE INDEX "AppleCheckJob_accountId_createdAt_idx" ON "AppleCheckJob"("accountId", "createdAt");
ALTER TABLE "AppleCheckWorker" ADD CONSTRAINT "AppleCheckWorker_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT;
ALTER TABLE "AppleCheckJob" ADD CONSTRAINT "AppleCheckJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GmailAccount"("id") ON DELETE RESTRICT;
