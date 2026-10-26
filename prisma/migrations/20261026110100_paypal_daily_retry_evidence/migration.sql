-- Add historical UNKNOWN resend days omitted by the initial backfill; never remove consumed slots.
WITH evidence AS (
 SELECT r."projectId", r."paypalId", r."paypalEmailId", r.id AS "requestId",
        COALESCE(r."submittedAt", r."createdAt") AS at
 FROM "EarnPayoutRequest" r WHERE r.submission = 'SENT'
 UNION ALL
 SELECT r."projectId", r."paypalId", r."paypalEmailId", r.id,
        (e.ev->>'at')::timestamptz AT TIME ZONE 'UTC'
 FROM "EarnPayoutRequest" r
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.history) = 'array' THEN r.history ELSE '[]'::jsonb END) WITH ORDINALITY e(ev,seq)
 WHERE (e.ev->>'kind' IN ('SENT','REQUESTED','UNKNOWN') OR (e.ev->>'kind' = 'RETRY' AND EXISTS (
   SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.history) = 'array' THEN r.history ELSE '[]'::jsonb END) WITH ORDINALITY prev(ev,seq)
   WHERE prev.seq < e.seq AND prev.ev->>'kind' IN ('SENT','REQUESTED','UNKNOWN')
 )))
   AND e.ev->>'at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
)
INSERT INTO "PayPalPayoutDayEmail" ("projectId","paypalId","day","paypalEmailId","requestId","usedAt")
 SELECT DISTINCT ON ("projectId","paypalId",day,"paypalEmailId") "projectId","paypalId",day,"paypalEmailId","requestId",at
 FROM (SELECT *,to_char(at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') AS day FROM evidence) d
 ORDER BY "projectId","paypalId",day,"paypalEmailId",at
ON CONFLICT DO NOTHING;
