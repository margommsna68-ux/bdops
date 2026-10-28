-- Merged EarnApp payout (owner brief 27/10/2026). Additive: a request without member rows is the existing one-VM request.
CREATE TABLE "EarnPayoutMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "vmId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "sdkId" TEXT,
    "shareAmount" DECIMAL(12,2),
    "shareObservedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,
    "consumedAt" TIMESTAMP(3),
    "consumedReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revision" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "EarnPayoutMember_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EarnPayoutMember_requestId_idx" ON "EarnPayoutMember"("requestId");
CREATE INDEX "EarnPayoutMember_projectId_vmId_cycle_idx" ON "EarnPayoutMember"("projectId", "vmId", "cycle");
ALTER TABLE "EarnPayoutMember" ADD CONSTRAINT "EarnPayoutMember_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "EarnPayoutRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VmCycle" ADD COLUMN "payoutMemberId" TEXT;
CREATE UNIQUE INDEX "VmCycle_payoutMemberId_key" ON "VmCycle"("payoutMemberId");
