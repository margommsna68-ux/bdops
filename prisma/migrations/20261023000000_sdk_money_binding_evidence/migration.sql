-- Reviews 22/10/2026: the first backfill of 20261022230000_sdk_money_binding bound every figure of a current code to the code's current
-- VM + current round from the placement alone. Databases that already ran it are corrected here: a binding to the current VM + its
-- current round is kept only with the evidence of the command that wrote it (the AMOUNT / OBSERVE event whose observedAt equals
-- amountObservedAt — also for a reading with the same figure, which never moves amountAt — or a web edit at amountAt) made after the
-- VM's last closed round and not followed by a move / hold / place / remove / recreate event (events of the same command share its
-- timestamp). A failed reading keeps its binding only through its own OBSERVE event (readable:false). Everything else returns to
-- unbound history. Readings bound to another VM or another round came from real observations and are not touched. A database that
-- runs the corrected 20261022230000 first finds nothing to undo.
UPDATE "SdkRecord" s SET "amountVmId"=NULL,"amountCycle"=NULL
  FROM "VirtualMachine" v LEFT JOIN "VmOperation" o ON o."vmId"=v."id"
  WHERE s."vmId"=v."id" AND s."amountVmId"=v."id" AND s."amountCycle"=COALESCE(o."cycle",1)
    AND NOT EXISTS (SELECT 1 FROM (SELECT COALESCE((SELECT MAX(e."createdAt") FROM "SdkEvent" e WHERE e."sdkId"=s."id" AND e."kind" IN ('AMOUNT','OBSERVE')
                                                     AND s."amountObservedAt" IS NOT NULL AND e."detail"->>'observedAt'=to_char(s."amountObservedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
                                           s."amountAt") AS w) x
                    WHERE x.w IS NOT NULL AND x.w > COALESCE((SELECT MAX(c."closedAt") FROM "VmCycle" c WHERE c."vmId"=v."id"), TIMESTAMP '1970-01-01')
                      AND NOT EXISTS (SELECT 1 FROM "SdkEvent" m WHERE m."sdkId"=s."id" AND m."kind" IN ('MOVE','HOLD','PLACE','REMOVE','RECREATE') AND m."createdAt" > x.w));
UPDATE "SdkRecord" s SET "amountFailedVmId"=NULL,"amountFailedCycle"=NULL
  FROM "VirtualMachine" v LEFT JOIN "VmOperation" o ON o."vmId"=v."id"
  WHERE s."vmId"=v."id" AND s."amountFailedVmId"=v."id" AND s."amountFailedCycle"=COALESCE(o."cycle",1)
    AND NOT EXISTS (SELECT 1 FROM (SELECT (SELECT MAX(e."createdAt") FROM "SdkEvent" e WHERE e."sdkId"=s."id" AND e."kind"='OBSERVE' AND e."detail"->>'readable'='false'
                                            AND e."detail"->>'observedAt'=to_char(s."amountFailedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS w) x
                    WHERE x.w IS NOT NULL AND x.w > COALESCE((SELECT MAX(c."closedAt") FROM "VmCycle" c WHERE c."vmId"=v."id"), TIMESTAMP '1970-01-01')
                      AND NOT EXISTS (SELECT 1 FROM "SdkEvent" m WHERE m."sdkId"=s."id" AND m."kind" IN ('MOVE','HOLD','PLACE','REMOVE','RECREATE') AND m."createdAt" > x.w));
