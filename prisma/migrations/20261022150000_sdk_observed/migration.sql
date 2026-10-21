-- AI SDK money (owner brief 22/10/2026): when an SDK amount was observed on the machine and where it was read. Additive only.
ALTER TABLE "SdkRecord" ADD COLUMN "amountObservedAt" TIMESTAMP(3);
ALTER TABLE "SdkRecord" ADD COLUMN "amountSource" TEXT;
