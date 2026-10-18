-- PayPal usage per email (owner decision 18/10/2026, replacing "one PayPal code for one EarnApp"): one PayPal code has many
-- receiving emails; each EarnApp account has one current receiving email; one email serves one EarnApp account forever.
-- Additive except the unique index on EarnAppAccount.paypalId (several EarnApp accounts may now share a PayPal through
-- different emails). No row is deleted; ids, money, links and history are kept.

DROP INDEX "EarnAppAccount_paypalId_key";
CREATE INDEX "EarnAppAccount_paypalId_idx" ON "EarnAppAccount"("paypalId");
ALTER TABLE "EarnAppAccount" ADD COLUMN "paypalEmailId" TEXT;
CREATE UNIQUE INDEX "EarnAppAccount_paypalEmailId_key" ON "EarnAppAccount"("paypalEmailId");
ALTER TABLE "EarnAppAccount" ADD CONSTRAINT "EarnAppAccount_paypalEmailId_fkey" FOREIGN KEY ("paypalEmailId") REFERENCES "PayPalEmail"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PayPalEmail" ADD COLUMN "usedEarnAppId" TEXT, ADD COLUMN "usedAt" TIMESTAMP(3), ADD COLUMN "reviewHold" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "reviewNote" TEXT;
CREATE INDEX "PayPalEmail_usedEarnAppId_idx" ON "PayPalEmail"("usedEarnAppId");

ALTER TABLE "FundTransaction" ADD COLUMN "entryKind" TEXT NOT NULL DEFAULT 'RECEIPT', ADD COLUMN "earnAppId" TEXT, ADD COLUMN "distinctConfirmed" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "noTxId" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Withdrawal" ADD COLUMN "ledgerVersion" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "feeAmount" DECIMAL(12,2), ADD COLUMN "receivedAmount" DECIMAL(18,6), ADD COLUMN "receivedCurrency" TEXT, ADD COLUMN "fxRate" DECIMAL(24,12), ADD COLUMN "noTxId" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "EarnAppPayout" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "earnAppId" TEXT NOT NULL,
    "paypalId" TEXT,
    "paypalEmailId" TEXT,
    "vmId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdById" TEXT,
    CONSTRAINT "EarnAppPayout_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EarnAppPayout_projectId_earnAppId_idx" ON "EarnAppPayout"("projectId", "earnAppId");
CREATE INDEX "EarnAppPayout_paypalEmailId_idx" ON "EarnAppPayout"("paypalEmailId");
ALTER TABLE "EarnAppPayout" ADD CONSTRAINT "EarnAppPayout_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EarnAppPayout" ADD CONSTRAINT "EarnAppPayout_earnAppId_fkey" FOREIGN KEY ("earnAppId") REFERENCES "EarnAppAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EarnAppPayout" ADD CONSTRAINT "EarnAppPayout_paypalId_fkey" FOREIGN KEY ("paypalId") REFERENCES "PayPalAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EarnAppPayout" ADD CONSTRAINT "EarnAppPayout_paypalEmailId_fkey" FOREIGN KEY ("paypalEmailId") REFERENCES "PayPalEmail"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data: move an old PayPal link to an email only when the PayPal has exactly one email (the only email it could have been).
WITH single AS (
  SELECT e."paypalId", MIN(e."id") AS "emailId" FROM "PayPalEmail" e GROUP BY e."paypalId" HAVING COUNT(*) = 1
)
UPDATE "EarnAppAccount" a SET "paypalEmailId" = s."emailId", "revision" = a."revision" + 1
FROM single s WHERE a."paypalId" = s."paypalId" AND a."paypalEmailId" IS NULL;

UPDATE "PayPalEmail" e SET "usedEarnAppId" = a."id", "usedAt" = a."updatedAt"
FROM "EarnAppAccount" a WHERE a."paypalEmailId" = e."id" AND e."usedEarnAppId" IS NULL;

-- A PayPal that received for an EarnApp before (firstEarnAppId) and has one email: that email is used.
WITH single AS (
  SELECT e."paypalId", MIN(e."id") AS "emailId" FROM "PayPalEmail" e GROUP BY e."paypalId" HAVING COUNT(*) = 1
)
UPDATE "PayPalEmail" e SET "usedEarnAppId" = p."firstEarnAppId", "usedAt" = p."updatedAt"
FROM "PayPalAccount" p JOIN single s ON s."paypalId" = p."id"
WHERE e."id" = s."emailId" AND p."firstEarnAppId" IS NOT NULL AND e."usedEarnAppId" IS NULL;

-- Usage known but the email is not: hold every email of that PayPal out of new assignments until a person reconciles it.
UPDATE "PayPalEmail" e SET "reviewHold" = true, "reviewNote" = 'Liên kết cũ chưa rõ email (trước 18/10/2026); đối chiếu trước khi cấp'
WHERE e."usedEarnAppId" IS NULL AND (
  EXISTS (SELECT 1 FROM "EarnAppAccount" a WHERE a."paypalId" = e."paypalId" AND a."paypalEmailId" IS NULL)
  OR EXISTS (SELECT 1 FROM "PayPalAccount" p WHERE p."id" = e."paypalId" AND p."firstEarnAppId" IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM "PayPalEmail" x WHERE x."paypalId" = p."id" AND x."usedEarnAppId" = p."firstEarnAppId"))
  OR EXISTS (SELECT 1 FROM "GmailAccount" g WHERE g."paypalId" = e."paypalId"));

-- History of current receiving links (email may be unknown for old links).
INSERT INTO "EarnAppPayout" ("id","projectId","earnAppId","paypalId","paypalEmailId","vmId","startedAt")
SELECT 'mig_' || a."id", a."projectId", a."id", a."paypalId", a."paypalEmailId", a."vmId", a."updatedAt"
FROM "EarnAppAccount" a WHERE a."paypalId" IS NOT NULL;
