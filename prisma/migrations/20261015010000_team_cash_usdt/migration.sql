-- AlterTable
ALTER TABLE "CollectorExpense" ADD COLUMN     "businessManaged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "voidedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CostRecord" ADD COLUMN     "fxAppliedAt" TIMESTAMP(3),
ADD COLUMN     "fxNote" TEXT,
ADD COLUMN     "fxSource" TEXT,
ADD COLUMN     "profitTreatment" TEXT NOT NULL DEFAULT 'CASH_COST',
ADD COLUMN     "sourceCollectorExpenseId" TEXT,
ADD COLUMN     "sourceReceiptId" TEXT,
ADD COLUMN     "usdtAmount" DECIMAL(24,6),
ADD COLUMN     "usdtRate" DECIMAL(24,12),
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(24,8),
ALTER COLUMN "total" SET DATA TYPE DECIMAL(24,8);

-- AlterTable
ALTER TABLE "ProfitSplit" ALTER COLUMN "totalWithdrawal" SET DATA TYPE DECIMAL(26,6),
ALTER COLUMN "totalCost" SET DATA TYPE DECIMAL(26,6),
ALTER COLUMN "netProfit" SET DATA TYPE DECIMAL(26,6),
ALTER COLUMN "netProfitUsdt" SET DATA TYPE DECIMAL(26,6);

-- AlterTable
ALTER TABLE "SplitAllocation" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(26,6),
ALTER COLUMN "amountUsdt" SET DATA TYPE DECIMAL(26,6);

-- CreateTable
CREATE TABLE "TeamReceipt" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "amountUsdt" DECIMAL(24,6),
    "referenceId" TEXT,
    "referenceKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "collectorId" TEXT,
    "sourceCollectorExpenseId" TEXT,
    "collectorUsdAmount" DECIMAL(24,8),
    "createdById" TEXT NOT NULL,
    "notes" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamReceipt_referenceKey_key" ON "TeamReceipt"("referenceKey");

-- CreateIndex
CREATE UNIQUE INDEX "TeamReceipt_sourceCollectorExpenseId_key" ON "TeamReceipt"("sourceCollectorExpenseId");

-- CreateIndex
CREATE INDEX "TeamReceipt_projectId_receivedAt_idx" ON "TeamReceipt"("projectId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CostRecord_sourceCollectorExpenseId_key" ON "CostRecord"("sourceCollectorExpenseId");

-- AddForeignKey
ALTER TABLE "CostRecord" ADD CONSTRAINT "CostRecord_sourceReceiptId_fkey" FOREIGN KEY ("sourceReceiptId") REFERENCES "TeamReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostRecord" ADD CONSTRAINT "CostRecord_sourceCollectorExpenseId_fkey" FOREIGN KEY ("sourceCollectorExpenseId") REFERENCES "CollectorExpense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamReceipt" ADD CONSTRAINT "TeamReceipt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamReceipt" ADD CONSTRAINT "TeamReceipt_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamReceipt" ADD CONSTRAINT "TeamReceipt_sourceCollectorExpenseId_fkey" FOREIGN KEY ("sourceCollectorExpenseId") REFERENCES "CollectorExpense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamReceipt" ADD CONSTRAINT "TeamReceipt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeamReceipt" ADD CONSTRAINT "TeamReceipt_amount_positive" CHECK ("amountUsdt" IS NULL OR "amountUsdt" > 0),
ADD CONSTRAINT "TeamReceipt_status_valid" CHECK ("status" IN ('DRAFT','CONFIRMED')),
ADD CONSTRAINT "TeamReceipt_confirmed_complete" CHECK ("status" <> 'CONFIRMED' OR ("amountUsdt" IS NOT NULL AND length(trim("referenceId")) > 0 AND "referenceKey" IS NOT NULL)),
ADD CONSTRAINT "TeamReceipt_revision_valid" CHECK ("revision" >= 0);
ALTER TABLE "CostRecord" ADD CONSTRAINT "CostRecord_fx_positive" CHECK ("usdtRate" IS NULL OR "usdtRate" > 0),
ADD CONSTRAINT "CostRecord_treatment_valid" CHECK ("profitTreatment" IN ('CASH_COST','ALREADY_NETTED'));
ALTER TABLE "CollectorExpense" ADD CONSTRAINT "CollectorExpense_revision_valid" CHECK ("revision" >= 0);
