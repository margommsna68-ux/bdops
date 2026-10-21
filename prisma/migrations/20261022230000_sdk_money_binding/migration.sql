-- Tiền VM (independent review 22/10/2026): where a money reading belongs. The stored figure of an SDK code is the money checked on ONE
-- VM in ONE round; the row shows it only for that VM and round (a code put back after a recreation, or moved to another VM, reads
-- "Chưa kiểm tra" there until it is checked again). The same for the latest failed reading. Additive.
ALTER TABLE "SdkRecord" ADD COLUMN "amountVmId" TEXT;
ALTER TABLE "SdkRecord" ADD COLUMN "amountCycle" INTEGER;
ALTER TABLE "SdkRecord" ADD COLUMN "amountFailedVmId" TEXT;
ALTER TABLE "SdkRecord" ADD COLUMN "amountFailedCycle" INTEGER;
-- Backfill ONLY with evidence (second review 22/10/2026): the current placement alone proves nothing. An existing figure is bound to
-- the code's current VM + current round only when it was written (amountAt) after that VM's last round closed (VmCycle.closedAt) and
-- the code has not moved, been held, placed, removed or recreated since (SdkEvent). Anything else stays unbound: the figure and its
-- history remain on the code (history, "Chưa kiểm tra" at the row). No observation time is invented from a write time.
UPDATE "SdkRecord" s SET "amountVmId"=s."vmId","amountCycle"=COALESCE(o."cycle",1)
  FROM "VirtualMachine" v LEFT JOIN "VmOperation" o ON o."vmId"=v."id"
  WHERE s."vmId"=v."id" AND s."amount" IS NOT NULL AND s."amountAt" IS NOT NULL
    AND s."amountAt" > COALESCE((SELECT MAX(c."closedAt") FROM "VmCycle" c WHERE c."vmId"=v."id"), TIMESTAMP '1970-01-01')
    AND NOT EXISTS (SELECT 1 FROM "SdkEvent" e WHERE e."sdkId"=s."id" AND e."kind" IN ('MOVE','HOLD','PLACE','REMOVE','RECREATE') AND e."createdAt" > s."amountAt");
UPDATE "SdkRecord" s SET "amountFailedVmId"=s."vmId","amountFailedCycle"=COALESCE(o."cycle",1)
  FROM "VirtualMachine" v LEFT JOIN "VmOperation" o ON o."vmId"=v."id"
  WHERE s."vmId"=v."id" AND s."amountFailedAt" IS NOT NULL
    AND s."amountFailedAt" > COALESCE((SELECT MAX(c."closedAt") FROM "VmCycle" c WHERE c."vmId"=v."id"), TIMESTAMP '1970-01-01')
    AND NOT EXISTS (SELECT 1 FROM "SdkEvent" e WHERE e."sdkId"=s."id" AND e."kind" IN ('MOVE','HOLD','PLACE','REMOVE','RECREATE') AND e."createdAt" > s."amountFailedAt");
