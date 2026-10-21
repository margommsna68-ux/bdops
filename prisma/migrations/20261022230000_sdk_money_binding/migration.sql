-- Tiền VM (independent review 22/10/2026): where a money reading belongs. The stored figure of an SDK code is the money checked on ONE
-- VM in ONE round; the row shows it only for that VM and round (a code put back after a recreation, or moved to another VM, reads
-- "Chưa kiểm tra" there until it is checked again). The same for the latest failed reading. Additive.
ALTER TABLE "SdkRecord" ADD COLUMN "amountVmId" TEXT;
ALTER TABLE "SdkRecord" ADD COLUMN "amountCycle" INTEGER;
ALTER TABLE "SdkRecord" ADD COLUMN "amountFailedVmId" TEXT;
ALTER TABLE "SdkRecord" ADD COLUMN "amountFailedCycle" INTEGER;
-- Existing figures were recorded while the code was the current code of its VM: they belong to that VM's current round (identity only;
-- no observation time is invented). Figures of codes in a store / list only stay unbound (shown as history, never as current money).
UPDATE "SdkRecord" s SET "amountVmId"=s."vmId","amountCycle"=COALESCE(o."cycle",1)
  FROM "VirtualMachine" v LEFT JOIN "VmOperation" o ON o."vmId"=v."id"
  WHERE s."vmId"=v."id" AND s."amount" IS NOT NULL;
UPDATE "SdkRecord" s SET "amountFailedVmId"=s."vmId","amountFailedCycle"=COALESCE(o."cycle",1)
  FROM "VirtualMachine" v LEFT JOIN "VmOperation" o ON o."vmId"=v."id"
  WHERE s."vmId"=v."id" AND s."amountFailedAt" IS NOT NULL;
