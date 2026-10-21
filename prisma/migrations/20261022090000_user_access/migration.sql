-- User administration (owner brief 22/10/2026). Additive only: disabling a user, server-side web sessions / PIN unlock, token create key.
ALTER TABLE "User" ADD COLUMN "disabledAt" TIMESTAMP(3),
  ADD COLUMN "disabledById" TEXT,
  ADD COLUMN "disabledReason" TEXT,
  ADD COLUMN "authEpoch" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pinVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "UserSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "epoch" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "revokeReason" TEXT,
  "pinUnlockedAt" TIMESTAMP(3),
  "pinVersion" INTEGER,
  CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UserSession_userId_revokedAt_idx" ON "UserSession"("userId", "revokedAt");
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OpsToken" ADD COLUMN "createKey" TEXT;
CREATE UNIQUE INDEX "OpsToken_createKey_key" ON "OpsToken"("createKey");
