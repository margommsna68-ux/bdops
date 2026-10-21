-- AI VM operations (owner brief 21/10/2026). Additive only: a new status value, proxy-on-machine markers, VM jobs.
ALTER TYPE "VmOpsStatus" ADD VALUE IF NOT EXISTS 'PROXY_PENDING';

ALTER TABLE "VmOperation" ADD COLUMN "proxyPendingConfigId" TEXT,
  ADD COLUMN "proxyPendingAt" TIMESTAMP(3),
  ADD COLUMN "proxyAppliedConfigId" TEXT,
  ADD COLUMN "proxyAppliedAt" TIMESTAMP(3),
  ADD COLUMN "proxyAppliedById" TEXT;

CREATE TABLE "VmJob" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "vmId" TEXT NOT NULL,
  "cycle" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'ACTIVE',
  "claimedById" TEXT NOT NULL,
  "tokenId" TEXT,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "step" TEXT,
  "stepNote" TEXT,
  "stepAt" TIMESTAMP(3),
  "machineRef" TEXT,
  "configurationId" TEXT,
  "sdkId" TEXT,
  "resumeOf" TEXT,
  "statusRevision" INTEGER NOT NULL DEFAULT 0,
  "result" TEXT,
  "finishedAt" TIMESTAMP(3),
  "revision" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "VmJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VmJob_vmId_state_idx" ON "VmJob"("vmId", "state");
CREATE INDEX "VmJob_projectId_state_idx" ON "VmJob"("projectId", "state");
