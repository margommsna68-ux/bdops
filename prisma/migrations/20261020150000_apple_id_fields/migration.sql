-- Apple ID lists (owner brief 20/10/2026): link to fetch the 2FA code, link to the SMS box (both encrypted) and the phone as text.
-- Additive only: existing accounts keep every field.
ALTER TABLE "GmailAccount" ADD COLUMN "twoFaLink" TEXT;
ALTER TABLE "GmailAccount" ADD COLUMN "smsLink" TEXT;
ALTER TABLE "GmailAccount" ADD COLUMN "phone" TEXT;
