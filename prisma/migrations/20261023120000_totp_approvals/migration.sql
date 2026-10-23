-- 2FA (TOTP) for users and ADMIN approvals of critical ops-API commands (owner decision 23/10/2026). Additive only.
ALTER TABLE "User" ADD COLUMN "totpSecretCipher" TEXT,
  ADD COLUMN "totpEnabledAt" TIMESTAMP(3),
  ADD COLUMN "totpRequiredAt" TIMESTAMP(3),
  ADD COLUMN "totpLastStep" INTEGER,
  ADD COLUMN "totpFailedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totpLockedAt" TIMESTAMP(3),
  ADD COLUMN "totpVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UserSession" ADD COLUMN "totpUnlockedAt" TIMESTAMP(3),
  ADD COLUMN "totpVersion" INTEGER,
  ADD COLUMN "totpAtLogin" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "UserBackupCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserBackupCode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UserBackupCode_userId_idx" ON "UserBackupCode"("userId");
ALTER TABLE "UserBackupCode" ADD CONSTRAINT "UserBackupCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "OpsApproval" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "tokenId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "objectId" TEXT,
  "requestKey" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "summary" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionNote" TEXT,
  "consumedAt" TIMESTAMP(3),
  "consumedRequestId" TEXT,
  CONSTRAINT "OpsApproval_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OpsApproval_projectId_status_requestedAt_idx" ON "OpsApproval"("projectId", "status", "requestedAt");
CREATE INDEX "OpsApproval_requestKey_status_idx" ON "OpsApproval"("requestKey", "status");
