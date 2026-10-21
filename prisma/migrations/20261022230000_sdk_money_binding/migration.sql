-- Tiền VM (independent review 22/10/2026): where a money reading belongs. The stored figure of an SDK code is the money checked on ONE
-- VM in ONE round; the row shows it only for that VM and round (a code put back after a recreation, or moved to another VM, reads
-- "Chưa kiểm tra" there until it is checked again). The same for the latest failed reading. Additive.
ALTER TABLE "SdkRecord" ADD COLUMN "amountVmId" TEXT;
ALTER TABLE "SdkRecord" ADD COLUMN "amountCycle" INTEGER;
ALTER TABLE "SdkRecord" ADD COLUMN "amountFailedVmId" TEXT;
ALTER TABLE "SdkRecord" ADD COLUMN "amountFailedCycle" INTEGER;
-- Backfill ONLY with evidence (reviews 22/10/2026): the current placement alone proves nothing. The figure's write moment is the
-- observation command that recorded it (the AMOUNT / OBSERVE event whose observedAt equals amountObservedAt; a reading with the same
-- figure moves only amountObservedAt, never amountAt) or, for a web edit, amountAt. The figure is bound to the code's current VM +
-- current round only when that moment is after the VM's last closed round (VmCycle.closedAt) and no move / hold / place / remove /
-- recreate event comes AFTER it (events of the same command share its timestamp and do not count). A failed reading is bound only
-- through its own OBSERVE event (readable:false). Anything else stays unbound: the figure and its history remain on the code
-- (history, "Chưa kiểm tra" at the row). No observation time is invented from a write time.
UPDATE "SdkRecord" s SET "amountVmId"=s."vmId","amountCycle"=COALESCE(o."cycle",1)
  FROM "VirtualMachine" v LEFT JOIN "VmOperation" o ON o."vmId"=v."id"
  WHERE s."vmId"=v."id" AND s."amount" IS NOT NULL AND s."amountVmId" IS NULL
    AND EXISTS (SELECT 1 FROM (SELECT COALESCE((SELECT MAX(e."createdAt") FROM "SdkEvent" e WHERE e."sdkId"=s."id" AND e."kind" IN ('AMOUNT','OBSERVE')
                                                 AND s."amountObservedAt" IS NOT NULL AND e."detail"->>'observedAt'=to_char(s."amountObservedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
                                       s."amountAt") AS w) x
                WHERE x.w IS NOT NULL AND x.w > COALESCE((SELECT MAX(c."closedAt") FROM "VmCycle" c WHERE c."vmId"=v."id"), TIMESTAMP '1970-01-01')
                  AND NOT EXISTS (SELECT 1 FROM "SdkEvent" m WHERE m."sdkId"=s."id" AND m."kind" IN ('MOVE','HOLD','PLACE','REMOVE','RECREATE') AND m."createdAt" > x.w));
UPDATE "SdkRecord" s SET "amountFailedVmId"=s."vmId","amountFailedCycle"=COALESCE(o."cycle",1)
  FROM "VirtualMachine" v LEFT JOIN "VmOperation" o ON o."vmId"=v."id"
  WHERE s."vmId"=v."id" AND s."amountFailedAt" IS NOT NULL AND s."amountFailedVmId" IS NULL
    AND EXISTS (SELECT 1 FROM (SELECT (SELECT MAX(e."createdAt") FROM "SdkEvent" e WHERE e."sdkId"=s."id" AND e."kind"='OBSERVE' AND e."detail"->>'readable'='false'
                                        AND e."detail"->>'observedAt'=to_char(s."amountFailedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS w) x
                WHERE x.w IS NOT NULL AND x.w > COALESCE((SELECT MAX(c."closedAt") FROM "VmCycle" c WHERE c."vmId"=v."id"), TIMESTAMP '1970-01-01')
                  AND NOT EXISTS (SELECT 1 FROM "SdkEvent" m WHERE m."sdkId"=s."id" AND m."kind" IN ('MOVE','HOLD','PLACE','REMOVE','RECREATE') AND m."createdAt" > x.w));
