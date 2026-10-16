-- Retired proxies ("Ngừng quản lý"), archived groups and package reminder terms: additive only.
ALTER TYPE "ProxyInventoryState" ADD VALUE 'RETIRED';
ALTER TABLE "ProxyGroup" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "ProxyProviderAccount"
  ADD COLUMN "reminderDays" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "renewalStoppedAt" TIMESTAMP(3),
  ADD COLUMN "renewalStopNote" TEXT;
