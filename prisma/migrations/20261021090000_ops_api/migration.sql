-- API vận hành AI (21/10/2026): additive only.
CREATE TABLE "OpsToken" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "prefix" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectIds" TEXT[],
  "scopes" TEXT[],
  "allowedIps" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "revokedById" TEXT,
  "lastUsedAt" TIMESTAMP(3),
  "lastUsedIp" TEXT,
  CONSTRAINT "OpsToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OpsToken_prefix_key" ON "OpsToken"("prefix");
CREATE UNIQUE INDEX "OpsToken_tokenHash_key" ON "OpsToken"("tokenHash");
CREATE INDEX "OpsToken_userId_idx" ON "OpsToken"("userId");
CREATE TABLE "OpsRateBucket" (
  "key" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL,
  CONSTRAINT "OpsRateBucket_pkey" PRIMARY KEY ("key")
);
CREATE TABLE "OpsAudit" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "tokenId" TEXT,
  "userId" TEXT,
  "projectId" TEXT,
  "action" TEXT NOT NULL,
  "objectId" TEXT,
  "ip" TEXT,
  "httpStatus" INTEGER NOT NULL,
  "result" TEXT NOT NULL,
  "replay" BOOLEAN NOT NULL DEFAULT false,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpsAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OpsAudit_tokenId_at_idx" ON "OpsAudit"("tokenId", "at");
CREATE INDEX "OpsAudit_projectId_at_idx" ON "OpsAudit"("projectId", "at");
