-- CreateEnum
CREATE TYPE "ProxyOwner" AS ENUM ('SELF', 'GENJY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ProxySubgroup" AS ENUM ('PC_CHUNG');

-- CreateEnum
CREATE TYPE "ProxyAllocationMode" AS ENUM ('SINGLE_IP', 'APPROVED_PORT_STREAM');

-- CreateEnum
CREATE TYPE "ProxyInventoryState" AS ENUM ('NEW', 'LIVE', 'BLOCKED', 'REPLACED', 'DIE', 'QUARANTINED');

-- AlterEnum
ALTER TYPE "ProjectRole" ADD VALUE 'VIEWER';

-- AlterTable
ALTER TABLE "ProjectMember" ADD COLUMN     "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "ProxyIP" ADD COLUMN     "credentialCipher" TEXT,
ADD COLUMN     "hasManualMetadata" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "identityId" TEXT,
ADD COLUMN     "inventoryKey" TEXT,
ADD COLUMN     "inventoryState" "ProxyInventoryState" NOT NULL DEFAULT 'QUARANTINED',
ADD COLUMN     "notesCipher" TEXT,
ADD COLUMN     "packageCode" TEXT,
ADD COLUMN     "retiredAt" TIMESTAMP(3),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "statusAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProxyIdentity" (
    "id" TEXT NOT NULL,
    "ip" INET NOT NULL,
    "owner" "ProxyOwner" NOT NULL DEFAULT 'UNKNOWN',
    "subgroup" "ProxySubgroup",
    "allocationMode" "ProxyAllocationMode" NOT NULL DEFAULT 'SINGLE_IP',
    "policyEvidenceCipher" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProxyIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProxyProviderAccount" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "credentialCipher" TEXT NOT NULL,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProxyProviderAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProxySourceSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scanSucceeded" BOOLEAN NOT NULL,
    "metadata" JSONB,
    "encryptedPayload" TEXT,

    CONSTRAINT "ProxySourceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProxySourceReference" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "endpointId" TEXT,
    "sourceRef" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "owner" "ProxyOwner" NOT NULL,
    "subgroup" "ProxySubgroup",
    "hasFullCredentials" BOOLEAN NOT NULL DEFAULT false,
    "hasManualMetadata" BOOLEAN NOT NULL DEFAULT false,
    "dataCipher" TEXT,

    CONSTRAINT "ProxySourceReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProxyBatch" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "encryptedPlan" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "revisionFacts" JSONB NOT NULL,
    "previewRows" JSONB NOT NULL,
    "result" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "ProxyBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProxyStatusEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "endpointId" TEXT,
    "batchId" TEXT,
    "ip" INET NOT NULL,
    "kind" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "reason" TEXT,
    "sourceRef" TEXT,

    CONSTRAINT "ProxyStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProxyReplacement" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "oldEndpointId" TEXT NOT NULL,
    "newEndpointId" TEXT NOT NULL,
    "ownerSnapshot" "ProxyOwner" NOT NULL,
    "subgroupSnapshot" "ProxySubgroup",
    "receivedDate" DATE,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "batchId" TEXT NOT NULL,

    CONSTRAINT "ProxyReplacement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProxyIdentity_ip_key" ON "ProxyIdentity"("ip");

-- CreateIndex
CREATE UNIQUE INDEX "ProxyProviderAccount_projectId_code_key" ON "ProxyProviderAccount"("projectId", "code");

-- CreateIndex
CREATE INDEX "ProxySourceSnapshot_projectId_sourceKey_fetchedAt_idx" ON "ProxySourceSnapshot"("projectId", "sourceKey", "fetchedAt");

-- CreateIndex
CREATE INDEX "ProxySourceReference_identityId_snapshotId_idx" ON "ProxySourceReference"("identityId", "snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "ProxySourceReference_snapshotId_sourceRef_identityId_key" ON "ProxySourceReference"("snapshotId", "sourceRef", "identityId");

-- CreateIndex
CREATE UNIQUE INDEX "ProxyBatch_token_key" ON "ProxyBatch"("token");

-- CreateIndex
CREATE INDEX "ProxyBatch_projectId_createdAt_idx" ON "ProxyBatch"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProxyBatch_projectId_idempotencyKey_key" ON "ProxyBatch"("projectId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ProxyStatusEvent_projectId_identityId_recordedAt_idx" ON "ProxyStatusEvent"("projectId", "identityId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProxyReplacement_newEndpointId_key" ON "ProxyReplacement"("newEndpointId");

-- CreateIndex
CREATE INDEX "ProxyReplacement_projectId_oldEndpointId_idx" ON "ProxyReplacement"("projectId", "oldEndpointId");

-- CreateIndex
CREATE INDEX "ProxyIP_identityId_idx" ON "ProxyIP"("identityId");

-- CreateIndex
CREATE INDEX "ProxyIP_projectId_inventoryState_idx" ON "ProxyIP"("projectId", "inventoryState");

-- AddForeignKey
ALTER TABLE "ProxyIP" ADD CONSTRAINT "ProxyIP_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "ProxyIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyProviderAccount" ADD CONSTRAINT "ProxyProviderAccount_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxySourceSnapshot" ADD CONSTRAINT "ProxySourceSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxySourceReference" ADD CONSTRAINT "ProxySourceReference_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProxySourceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxySourceReference" ADD CONSTRAINT "ProxySourceReference_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "ProxyIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxySourceReference" ADD CONSTRAINT "ProxySourceReference_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "ProxyIP"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyBatch" ADD CONSTRAINT "ProxyBatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyStatusEvent" ADD CONSTRAINT "ProxyStatusEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyStatusEvent" ADD CONSTRAINT "ProxyStatusEvent_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "ProxyIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyStatusEvent" ADD CONSTRAINT "ProxyStatusEvent_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "ProxyIP"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyStatusEvent" ADD CONSTRAINT "ProxyStatusEvent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProxyBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyReplacement" ADD CONSTRAINT "ProxyReplacement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyReplacement" ADD CONSTRAINT "ProxyReplacement_oldEndpointId_fkey" FOREIGN KEY ("oldEndpointId") REFERENCES "ProxyIP"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyReplacement" ADD CONSTRAINT "ProxyReplacement_newEndpointId_fkey" FOREIGN KEY ("newEndpointId") REFERENCES "ProxyIP"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Physical inventory lock. Retired rows keep their keys as historical evidence.
CREATE UNIQUE INDEX "ProxyIP_active_inventoryKey_key" ON "ProxyIP"("inventoryKey")
WHERE "inventoryKey" IS NOT NULL AND "retiredAt" IS NULL;
ALTER TABLE "ProxyIdentity" ADD CONSTRAINT "ProxyIdentity_pc_owner_check"
CHECK ("subgroup" IS NULL OR "owner" = 'GENJY');
ALTER TABLE "ProxyIdentity" ADD CONSTRAINT "ProxyIdentity_ipv4_check"
CHECK (family("ip") = 4 AND masklen("ip") = 32);
CREATE FUNCTION preserve_genjy_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."owner" = 'GENJY' AND NEW."owner" <> 'GENJY' THEN
    RAISE EXCEPTION 'GENJY ownership is permanent';
  END IF;
  IF OLD."subgroup" = 'PC_CHUNG' AND NEW."subgroup" IS DISTINCT FROM 'PC_CHUNG' THEN
    RAISE EXCEPTION 'PC_CHUNG classification is permanent';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProxyIdentity_preserve_genjy" BEFORE UPDATE ON "ProxyIdentity"
FOR EACH ROW EXECUTE FUNCTION preserve_genjy_owner();

-- AddForeignKey
ALTER TABLE "ProxyReplacement" ADD CONSTRAINT "ProxyReplacement_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProxyBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
