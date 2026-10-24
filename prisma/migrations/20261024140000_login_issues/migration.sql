-- Add login health outcomes without rewriting account lifecycle or existing rows.
ALTER TYPE "GmailStatus" ADD VALUE 'APPLE_LOCKED';
ALTER TYPE "GmailStatus" ADD VALUE 'GOOGLE_VERIFY';
ALTER TYPE "GmailStatus" ADD VALUE 'GOOGLE_DISABLED';
ALTER TABLE "GmailAccount"
  ADD COLUMN "loginIssueNote" TEXT,
  ADD COLUMN "loginIssueAt" TIMESTAMP(3);
