-- Reviews 22/10/2026: databases that ran the first version of 20261023000000_sdk_money_binding_evidence lost bindings that observation
-- commands had written correctly (a reading with the same figure, which moves only amountObservedAt, and a failed reading whose own
-- command placed the code after the observation moment). They are given back here from the same evidence the corrected migrations
-- use: the command's AMOUNT / OBSERVE event (observedAt = amountObservedAt / amountFailedAt), made after the VM's last closed round and
-- not followed by a move / hold / place / remove / recreate event. Only currently unbound readings of a current code are touched;
-- a database that ran the corrected migrations finds nothing to do.
UPDATE "SdkRecord" s SET "amountVmId"=s."vmId","amountCycle"=COALESCE(o."cycle",1)
  FROM "VirtualMachine" v LEFT JOIN "VmOperation" o ON o."vmId"=v."id"
  WHERE s."vmId"=v."id" AND s."amount" IS NOT NULL AND s."amountVmId" IS NULL AND s."amountObservedAt" IS NOT NULL
    AND EXISTS (SELECT 1 FROM (SELECT (SELECT MAX(e."createdAt") FROM "SdkEvent" e WHERE e."sdkId"=s."id" AND e."kind" IN ('AMOUNT','OBSERVE')
                                        AND e."detail"->>'observedAt'=to_char(s."amountObservedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS w) x
                WHERE x.w IS NOT NULL AND x.w > COALESCE((SELECT MAX(c."closedAt") FROM "VmCycle" c WHERE c."vmId"=v."id"), TIMESTAMP '1970-01-01')
                  AND NOT EXISTS (SELECT 1 FROM "SdkEvent" m WHERE m."sdkId"=s."id" AND m."kind" IN ('MOVE','HOLD','PLACE','REMOVE','RECREATE') AND m."createdAt" > x.w));
UPDATE "SdkRecord" s SET "amountFailedVmId"=s."vmId","amountFailedCycle"=COALESCE(o."cycle",1)
  FROM "VirtualMachine" v LEFT JOIN "VmOperation" o ON o."vmId"=v."id"
  WHERE s."vmId"=v."id" AND s."amountFailedAt" IS NOT NULL AND s."amountFailedVmId" IS NULL
    AND EXISTS (SELECT 1 FROM (SELECT (SELECT MAX(e."createdAt") FROM "SdkEvent" e WHERE e."sdkId"=s."id" AND e."kind"='OBSERVE' AND e."detail"->>'readable'='false'
                                        AND e."detail"->>'observedAt'=to_char(s."amountFailedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS w) x
                WHERE x.w IS NOT NULL AND x.w > COALESCE((SELECT MAX(c."closedAt") FROM "VmCycle" c WHERE c."vmId"=v."id"), TIMESTAMP '1970-01-01')
                  AND NOT EXISTS (SELECT 1 FROM "SdkEvent" m WHERE m."sdkId"=s."id" AND m."kind" IN ('MOVE','HOLD','PLACE','REMOVE','RECREATE') AND m."createdAt" > x.w));
