-- Purchase quantity separate from pasted lines. Additive: existing batches keep their recorded money untouched and are marked
-- costRule = 1 so the app can list possibly merged purchases for review; new batches default to 2.
ALTER TABLE "AccountPurchaseBatch" ADD COLUMN "paidQuantity" INTEGER;
ALTER TABLE "AccountPurchaseBatch" ADD COLUMN "costRule" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AccountPurchaseBatch" ALTER COLUMN "costRule" SET DEFAULT 2;
