-- EarnApp balance per VM + payout submission milestones (owner brief 20/10/2026). Additive only: existing requests are SENT.
CREATE TABLE "EarnBalanceCheck" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "vmId" TEXT NOT NULL,
  "cycle" INTEGER NOT NULL,
  "earnAppId" TEXT NOT NULL,
  "checkedAt" TIMESTAMP(3) NOT NULL,
  "outcome" TEXT NOT NULL,
  "amount" DECIMAL(12,2),
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "withdrawable" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "condition" TEXT,
  "failure" TEXT,
  "evidence" TEXT,
  "source" TEXT NOT NULL,
  "recordedById" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EarnBalanceCheck_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EarnBalanceCheck_projectId_vmId_checkedAt_idx" ON "EarnBalanceCheck"("projectId", "vmId", "checkedAt");
CREATE INDEX "EarnBalanceCheck_earnAppId_checkedAt_idx" ON "EarnBalanceCheck"("earnAppId", "checkedAt");
ALTER TABLE "EarnPayoutRequest" ADD COLUMN "submission" TEXT NOT NULL DEFAULT 'SENT';
ALTER TABLE "EarnPayoutRequest" ADD COLUMN "submittedAt" TIMESTAMP(3);
ALTER TABLE "PayPalEmail" ADD COLUMN "holdEarnAppId" TEXT;
ALTER TABLE "PayPalEmail" ADD COLUMN "holdAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "PayPalEmail_holdEarnAppId_key" ON "PayPalEmail"("holdEarnAppId");
