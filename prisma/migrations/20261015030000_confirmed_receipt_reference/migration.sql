-- SQL CHECK treats NULL as unknown; confirmed receipts require actual text too.
ALTER TABLE "TeamReceipt" DROP CONSTRAINT "TeamReceipt_confirmed_complete";
ALTER TABLE "TeamReceipt" ADD CONSTRAINT "TeamReceipt_confirmed_complete"
CHECK ("status" <> 'CONFIRMED' OR (
  "amountUsdt" IS NOT NULL AND "referenceId" IS NOT NULL
  AND length(trim("referenceId")) > 0 AND "referenceKey" IS NOT NULL
));
