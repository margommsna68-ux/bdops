-- Tiền VM (owner brief 22/10/2026): the time of the latest reading that could NOT read the money of an SDK code (additive; the last
-- good figure and its own observation time stay in amount / amountObservedAt).
ALTER TABLE "SdkRecord" ADD COLUMN "amountFailedAt" TIMESTAMP(3);
