-- Additive: a fee taken on the receiving side of a PayPal transfer (review 18/10/2026).
ALTER TABLE "Withdrawal" ADD COLUMN "receiverFeeAmount" DECIMAL(18,6);
