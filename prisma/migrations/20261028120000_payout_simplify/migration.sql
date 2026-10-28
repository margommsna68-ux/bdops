-- Payout simplification (owner brief 28/10/2026). Additive only: new nullable columns and two new tables, no data change.

-- EarnApp payout request: money lost because the account went SUS after the request was sent (state 'LOST_SUS' is a plain string value).
ALTER TABLE "EarnPayoutRequest" ADD COLUMN     "lostAmount" DECIMAL(12,2),
ADD COLUMN     "lostAt" TIMESTAMP(3);

-- Ops approval: the approval session that covered it (null = approved on its own).
ALTER TABLE "OpsApproval" ADD COLUMN     "sessionId" TEXT;

-- Voided payout requests keep a full JSON snapshot, so removing a request never loses history.
CREATE TABLE "EarnPayoutRequestVoid" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "vmId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "earnAppId" TEXT NOT NULL,
    "paypalEmailId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "voidedById" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EarnPayoutRequestVoid_pkey" PRIMARY KEY ("id")
);

-- A time-boxed approval window for one AI token.
CREATE TABLE "OpsApprovalSession" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "via" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,

    CONSTRAINT "OpsApprovalSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EarnPayoutRequestVoid_projectId_vmId_idx" ON "EarnPayoutRequestVoid"("projectId", "vmId");

CREATE INDEX "EarnPayoutRequestVoid_projectId_voidedAt_idx" ON "EarnPayoutRequestVoid"("projectId", "voidedAt");

CREATE INDEX "OpsApprovalSession_projectId_tokenId_expiresAt_idx" ON "OpsApprovalSession"("projectId", "tokenId", "expiresAt");
