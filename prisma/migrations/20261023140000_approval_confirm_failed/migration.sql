-- CLI approval confirmation with the ADMIN TOTP: wrong-code counter per approval (23/10/2026). Additive.
ALTER TABLE "OpsApproval" ADD COLUMN "confirmFailed" INTEGER NOT NULL DEFAULT 0;
