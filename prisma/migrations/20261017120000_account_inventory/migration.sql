-- Account inventory (owner brief 17 Oct 2026). Additive: login stock type and purchase batch, PayPal batch and first EarnApp
-- payout, explicit EarnApp accounts (one login, at most one VM, at most one PayPal), and a kind on work items.
-- No account, VM link, PayPal or cost is created, merged or deleted here. Legacy VirtualMachine.gmailId links stay as they are and
-- are listed for review in the app; they are not converted into EarnApp accounts.
-- CreateEnum
CREATE TYPE "AccountLoginType" AS ENUM ('GMAIL', 'APPLE_ID');

-- AlterTable
ALTER TABLE "GmailAccount" ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "loginType" "AccountLoginType";

-- AlterTable
ALTER TABLE "PayPalAccount" ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "firstEarnAppId" TEXT;

-- AlterTable
ALTER TABLE "BusinessWorkItem" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'TASK';

-- CreateTable
CREATE TABLE "AccountPurchaseBatch" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "loginType" "AccountLoginType",
    "code" TEXT NOT NULL,
    "source" TEXT,
    "purchasedAt" TIMESTAMP(3) NOT NULL,
    "priceMode" TEXT NOT NULL DEFAULT 'NONE',
    "unitPrice" DECIMAL(24,8),
    "totalPaid" DECIMAL(24,8),
    "currency" TEXT,
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "costRecordId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountPurchaseBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EarnAppAccount" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "loginId" TEXT NOT NULL,
    "vmId" TEXT,
    "paypalId" TEXT,
    "registeredAt" TIMESTAMP(3),
    "registeredById" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EarnAppAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountPurchaseBatch_costRecordId_key" ON "AccountPurchaseBatch"("costRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountPurchaseBatch_projectId_kind_code_key" ON "AccountPurchaseBatch"("projectId", "kind", "code");

-- CreateIndex
CREATE UNIQUE INDEX "EarnAppAccount_loginId_key" ON "EarnAppAccount"("loginId");

-- CreateIndex
CREATE UNIQUE INDEX "EarnAppAccount_vmId_key" ON "EarnAppAccount"("vmId");

-- CreateIndex
CREATE UNIQUE INDEX "EarnAppAccount_paypalId_key" ON "EarnAppAccount"("paypalId");

-- CreateIndex
CREATE INDEX "EarnAppAccount_projectId_idx" ON "EarnAppAccount"("projectId");

-- AddForeignKey
ALTER TABLE "GmailAccount" ADD CONSTRAINT "GmailAccount_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AccountPurchaseBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayPalAccount" ADD CONSTRAINT "PayPalAccount_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AccountPurchaseBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountPurchaseBatch" ADD CONSTRAINT "AccountPurchaseBatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountPurchaseBatch" ADD CONSTRAINT "AccountPurchaseBatch_costRecordId_fkey" FOREIGN KEY ("costRecordId") REFERENCES "CostRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarnAppAccount" ADD CONSTRAINT "EarnAppAccount_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarnAppAccount" ADD CONSTRAINT "EarnAppAccount_loginId_fkey" FOREIGN KEY ("loginId") REFERENCES "GmailAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarnAppAccount" ADD CONSTRAINT "EarnAppAccount_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "VirtualMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarnAppAccount" ADD CONSTRAINT "EarnAppAccount_paypalId_fkey" FOREIGN KEY ("paypalId") REFERENCES "PayPalAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Work items that came from the old Sheet import (known reconciliation titles "<reason> — <server> / <VM>") are reconciliation
-- rows, not staff tasks. Only the exact import prefixes are reclassified; status, notes and history stay unchanged.
UPDATE "BusinessWorkItem" SET "kind" = 'SHEET_REVIEW'
WHERE "title" ~ '^(Proxiware|Chưa rõ nhóm sở hữu|Xác minh dòng không có VM|Proxy của Genjy đang ghi trên VM) — [^/]+ / [^/]+$';
