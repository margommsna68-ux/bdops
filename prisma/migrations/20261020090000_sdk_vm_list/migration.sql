-- Owner brief 20/10/2026: a VM keeps a list of SDK codes (to use now or later). Additive: a nullable holder column; every code that
-- is on a VM today joins that VM's list. Nothing is deleted, no state changes, history (SdkEvent / VMSdkHistory) stays as it is.
ALTER TABLE "SdkRecord" ADD COLUMN "holderVmId" TEXT;
ALTER TABLE "SdkRecord" ADD COLUMN "heldAt" TIMESTAMP(3);
ALTER TABLE "SdkRecord" ADD COLUMN "heldById" TEXT;
UPDATE "SdkRecord" SET "holderVmId" = "vmId", "heldAt" = COALESCE("placedAt", "createdAt"), "heldById" = "placedById" WHERE "vmId" IS NOT NULL;
CREATE INDEX "SdkRecord_holderVmId_idx" ON "SdkRecord"("holderVmId");
ALTER TABLE "SdkRecord" ADD CONSTRAINT "SdkRecord_holderVmId_fkey" FOREIGN KEY ("holderVmId") REFERENCES "VirtualMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
