-- CreateEnum
CREATE TYPE "VmOpsStatus" AS ENUM ('OK', 'NOT_LINKED', 'OFF', 'PROXY_BLOCKED', 'LINKED', 'EARN_ERROR', 'SUSPENDED', 'DELETED', 'NEW_VM', 'MAIL_LOGGED');

-- AlterTable
ALTER TABLE "FundTransaction" ADD COLUMN     "payoutRequestId" TEXT;

-- AlterTable
ALTER TABLE "EarnAppAccount" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedReason" TEXT;

-- CreateTable
CREATE TABLE "VmOperation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "vmId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL DEFAULT 1,
    "status" "VmOpsStatus",
    "statusAt" TIMESTAMP(3),
    "statusById" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VmOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VmOpsEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "vmId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "fromStatus" "VmOpsStatus",
    "toStatus" "VmOpsStatus",
    "note" TEXT,
    "detail" JSONB,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VmOpsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VmCycle" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "vmId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "earnAppId" TEXT,
    "loginId" TEXT,
    "paypalEmailId" TEXT,
    "sdkId" TEXT,
    "status" "VmOpsStatus",
    "desiredConfigurationId" TEXT,
    "installedConfigurationId" TEXT,
    "proxyKept" TEXT,
    "payoutRequestId" TEXT,
    "note" TEXT,
    "closedById" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VmCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EarnPayoutRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "earnAppId" TEXT NOT NULL,
    "vmId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "paypalId" TEXT NOT NULL,
    "paypalEmailId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "requestedById" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'REQUESTED',
    "stateNote" TEXT,
    "settledAt" TIMESTAMP(3),
    "settledById" TEXT,
    "settleNote" TEXT,
    "shortfall" DECIMAL(12,2),
    "consumedAt" TIMESTAMP(3),
    "history" JSONB NOT NULL DEFAULT '[]',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EarnPayoutRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VmOperation_vmId_key" ON "VmOperation"("vmId");

-- CreateIndex
CREATE INDEX "VmOperation_projectId_idx" ON "VmOperation"("projectId");

-- CreateIndex
CREATE INDEX "VmOpsEvent_vmId_createdAt_idx" ON "VmOpsEvent"("vmId", "createdAt");

-- CreateIndex
CREATE INDEX "VmOpsEvent_projectId_createdAt_idx" ON "VmOpsEvent"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VmCycle_payoutRequestId_key" ON "VmCycle"("payoutRequestId");

-- CreateIndex
CREATE INDEX "VmCycle_projectId_idx" ON "VmCycle"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "VmCycle_vmId_number_key" ON "VmCycle"("vmId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "EarnPayoutRequest_earnAppId_key" ON "EarnPayoutRequest"("earnAppId");

-- CreateIndex
CREATE INDEX "EarnPayoutRequest_projectId_paypalId_idx" ON "EarnPayoutRequest"("projectId", "paypalId");

-- CreateIndex
CREATE INDEX "EarnPayoutRequest_vmId_idx" ON "EarnPayoutRequest"("vmId");

-- CreateIndex
CREATE INDEX "FundTransaction_payoutRequestId_idx" ON "FundTransaction"("payoutRequestId");

-- AddForeignKey
ALTER TABLE "FundTransaction" ADD CONSTRAINT "FundTransaction_payoutRequestId_fkey" FOREIGN KEY ("payoutRequestId") REFERENCES "EarnPayoutRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VmOperation" ADD CONSTRAINT "VmOperation_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "VirtualMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarnPayoutRequest" ADD CONSTRAINT "EarnPayoutRequest_earnAppId_fkey" FOREIGN KEY ("earnAppId") REFERENCES "EarnAppAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarnPayoutRequest" ADD CONSTRAINT "EarnPayoutRequest_paypalId_fkey" FOREIGN KEY ("paypalId") REFERENCES "PayPalAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarnPayoutRequest" ADD CONSTRAINT "EarnPayoutRequest_paypalEmailId_fkey" FOREIGN KEY ("paypalEmailId") REFERENCES "PayPalEmail"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

