-- Second review 22/10/2026: the first backfill of 20261022230000_sdk_money_binding bound every figure of a current code to the code's
-- current VM + current round from the placement alone. Databases that already ran it (local test / trial) are corrected here with the
-- evidence rule; a database that runs the corrected 20261022230000 first finds nothing to undo. Only rows the old backfill could have
-- set are touched (bound to the current VM and its current round); readings bound elsewhere came from real observations and stay.
UPDATE "SdkRecord" s SET "amountVmId"=NULL,"amountCycle"=NULL
  FROM "VirtualMachine" v LEFT JOIN "VmOperation" o ON o."vmId"=v."id"
  WHERE s."vmId"=v."id" AND s."amountVmId"=v."id" AND s."amountCycle"=COALESCE(o."cycle",1)
    AND NOT (s."amount" IS NOT NULL AND s."amountAt" IS NOT NULL
      AND s."amountAt" > COALESCE((SELECT MAX(c."closedAt") FROM "VmCycle" c WHERE c."vmId"=v."id"), TIMESTAMP '1970-01-01')
      AND NOT EXISTS (SELECT 1 FROM "SdkEvent" e WHERE e."sdkId"=s."id" AND e."kind" IN ('MOVE','HOLD','PLACE','REMOVE','RECREATE') AND e."createdAt" > s."amountAt"));
UPDATE "SdkRecord" s SET "amountFailedVmId"=NULL,"amountFailedCycle"=NULL
  FROM "VirtualMachine" v LEFT JOIN "VmOperation" o ON o."vmId"=v."id"
  WHERE s."vmId"=v."id" AND s."amountFailedVmId"=v."id" AND s."amountFailedCycle"=COALESCE(o."cycle",1)
    AND NOT (s."amountFailedAt" IS NOT NULL
      AND s."amountFailedAt" > COALESCE((SELECT MAX(c."closedAt") FROM "VmCycle" c WHERE c."vmId"=v."id"), TIMESTAMP '1970-01-01')
      AND NOT EXISTS (SELECT 1 FROM "SdkEvent" e WHERE e."sdkId"=s."id" AND e."kind" IN ('MOVE','HOLD','PLACE','REMOVE','RECREATE') AND e."createdAt" > s."amountFailedAt"));
