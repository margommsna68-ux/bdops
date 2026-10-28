-- Approval session (owner brief 28/10/2026): the ADMIN's 2FA version proved when the session was opened. A 2FA reset or re-setup
-- (version change) ends the session at once. Nullable: a row without a version is never treated as active (fail closed).
ALTER TABLE "OpsApprovalSession" ADD COLUMN "totpVersion" INTEGER;
