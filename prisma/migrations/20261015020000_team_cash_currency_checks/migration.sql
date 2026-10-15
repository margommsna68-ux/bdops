-- Extend legacy checks; preserve historical WITHDRAWN currency/basis behavior.
ALTER TABLE "CostRecord" DROP CONSTRAINT "Cost_currency_supported";
ALTER TABLE "CostRecord" ADD CONSTRAINT "Cost_currency_supported" CHECK ("currency" ~ '^[A-Z]{3,8}$');
ALTER TABLE "ProfitSplit" DROP CONSTRAINT "Profit_currency_supported";
ALTER TABLE "ProfitSplit" ADD CONSTRAINT "Profit_currency_supported" CHECK (("basis" = 'TEAM_RECEIVED' AND "currency" = 'USDT') OR ("basis" = 'WITHDRAWN' AND "currency" IN ('USD','VND')));
