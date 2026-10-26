CREATE TABLE "PayPalPayoutDayEmail" (
  "projectId" TEXT NOT NULL,
  "paypalId" TEXT NOT NULL,
  "day" VARCHAR(10) NOT NULL,
  "paypalEmailId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayPalPayoutDayEmail_pkey" PRIMARY KEY ("projectId", "paypalId", "day", "paypalEmailId"),
  CONSTRAINT "PayPalPayoutDayEmail_paypalId_fkey" FOREIGN KEY ("paypalId") REFERENCES "PayPalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PayPalPayoutDayEmail_projectId_day_idx" ON "PayPalPayoutDayEmail"("projectId", "day");

-- Use recorded server timestamps, never requestedAt (editable business date).
-- Older requests retain all observed send/unknown days, even when subsequently failed or cancelled.
WITH evidence AS (
 SELECT r."projectId", r."paypalId", r."paypalEmailId", r.id AS "requestId",
        COALESCE(r."submittedAt", r."createdAt") AS at
 FROM "EarnPayoutRequest" r WHERE r.submission = 'SENT'
 UNION ALL
 SELECT r."projectId", r."paypalId", r."paypalEmailId", r.id,
        (e->>'at')::timestamptz AT TIME ZONE 'UTC'
 FROM "EarnPayoutRequest" r
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.history) = 'array' THEN r.history ELSE '[]'::jsonb END) e
 WHERE (e->>'kind' IN ('SENT','REQUESTED','UNKNOWN') OR (e->>'kind' = 'RETRY' AND r.submission = 'SENT'))
   AND e->>'at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
)
INSERT INTO "PayPalPayoutDayEmail" ("projectId","paypalId","day","paypalEmailId","requestId","usedAt")
 SELECT DISTINCT ON ("projectId","paypalId",day,"paypalEmailId") "projectId","paypalId",day,"paypalEmailId","requestId",at
 FROM (SELECT *,to_char(at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') AS day FROM evidence) d
 ORDER BY "projectId","paypalId",day,"paypalEmailId",at
ON CONFLICT DO NOTHING;
