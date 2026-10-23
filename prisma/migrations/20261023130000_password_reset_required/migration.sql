-- Owner request 23/10/2026: a person sets their own password after an ADMIN reset. Additive.
ALTER TABLE "User" ADD COLUMN "passwordResetRequiredAt" TIMESTAMP(3);
