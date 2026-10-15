-- Proxy package terms (site, price, cycle, due date): additive only, existing packages keep code/label/credentials.
ALTER TABLE "ProxyProviderAccount"
  ADD COLUMN "site" TEXT,
  ADD COLUMN "note" TEXT,
  ADD COLUMN "price" DECIMAL(24,8),
  ADD COLUMN "priceCurrency" TEXT,
  ADD COLUMN "cycleMonths" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "nextDueDate" DATE,
  ADD COLUMN "lastPaidAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "ProxyProviderAccount_projectId_nextDueDate_idx" ON "ProxyProviderAccount"("projectId","nextDueDate");
