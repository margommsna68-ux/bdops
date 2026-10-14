-- AlterTable
ALTER TABLE "OperationJournal" ADD COLUMN     "accessModule" TEXT NOT NULL DEFAULT 'INFRASTRUCTURE',
ADD COLUMN     "commandKey" TEXT,
ADD COLUMN     "requestHash" TEXT,
ADD COLUMN     "resultCipher" TEXT;

-- AlterTable
ALTER TABLE "GmailAccount" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "businessManaged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PayPalAccount" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "businessManaged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PayPalEmail" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "businessManaged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "FundTransaction" ADD COLUMN     "businessManaged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "voidedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Withdrawal" ADD COLUMN     "businessManaged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "voidedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CostRecord" ADD COLUMN     "businessManaged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "proxyAccountId" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "serverId" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProfitSplit" ADD COLUMN     "basis" TEXT NOT NULL DEFAULT 'WITHDRAWN',
ADD COLUMN     "businessManaged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sourceHash" TEXT,
ADD COLUMN     "sourceSnapshotCipher" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SplitAllocation" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BusinessWorkItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "status" "VMTaskStatus" NOT NULL DEFAULT 'PENDING',
    "serverId" TEXT,
    "vmId" TEXT,
    "assigneeId" TEXT,
    "createdById" TEXT NOT NULL,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessWorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessWorkItem_projectId_status_idx" ON "BusinessWorkItem"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OperationJournal_projectId_commandKey_key" ON "OperationJournal"("projectId", "commandKey");

-- AddForeignKey
ALTER TABLE "CostRecord" ADD CONSTRAINT "CostRecord_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostRecord" ADD CONSTRAINT "CostRecord_proxyAccountId_fkey" FOREIGN KEY ("proxyAccountId") REFERENCES "ProxyProviderAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessWorkItem" ADD CONSTRAINT "BusinessWorkItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessWorkItem" ADD CONSTRAINT "BusinessWorkItem_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessWorkItem" ADD CONSTRAINT "BusinessWorkItem_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "VirtualMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessWorkItem" ADD CONSTRAINT "BusinessWorkItem_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


CREATE OR REPLACE FUNCTION business_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW."revision" := GREATEST(OLD."revision" + 1, NEW."revision");
 RETURN NEW;
END;
$$;
DO $$
DECLARE task_table text;
BEGIN
 FOREACH task_table IN ARRAY ARRAY['GmailAccount','PayPalAccount','PayPalEmail','FundTransaction','Withdrawal','CostRecord','ProfitSplit','SplitAllocation','BusinessWorkItem'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION business_revision_guard()', 'business_revision_' || lower(task_table), task_table);
 END LOOP;
END;
$$;
ALTER TABLE "FundTransaction" ADD CONSTRAINT "Fund_confirm_failed_exclusive" CHECK (NOT ("confirmed" AND "failed")) NOT VALID;
ALTER TABLE "FundTransaction" ADD CONSTRAINT "Fund_currency_supported" CHECK ("currency" IN ('USD','VND')) NOT VALID;
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_currency_supported" CHECK ("currency" IN ('USD','VND')) NOT VALID;
ALTER TABLE "CostRecord" ADD CONSTRAINT "Cost_currency_supported" CHECK ("currency" IN ('USD','VND')) NOT VALID;
ALTER TABLE "ProfitSplit" ADD CONSTRAINT "Profit_currency_supported" CHECK ("currency" IN ('USD','VND')) NOT VALID;
