CREATE TYPE "VMProxySlotState" AS ENUM ('BLANK','FORMULA','PLACEHOLDER','UNRESOLVED','FULL');
CREATE TYPE "VMConfigurationStatus" AS ENUM ('PLANNED','IN_PROGRESS','FAILED','CONFIRMED','CANCELLED');
CREATE TYPE "VMAllocationRole" AS ENUM ('DESIRED','INSTALLED','UNCERTAIN');
ALTER TABLE "Server" ADD COLUMN "managed" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "archivedAt" TIMESTAMP(3), ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "VirtualMachine" ADD COLUMN "managed" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "proxySlotState" "VMProxySlotState" NOT NULL DEFAULT 'UNRESOLVED', ADD COLUMN "slotSourceRef" TEXT, ADD COLUMN "originalSlotCipher" TEXT, ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "configurationSequence" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "archivedAt" TIMESTAMP(3), ADD COLUMN "desiredConfigurationId" TEXT, ADD COLUMN "installedConfigurationId" TEXT;
ALTER TABLE "OperationJournal" ADD COLUMN "reversible" BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE "VMConfiguration" (
  "id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE RESTRICT,
  "vmId" TEXT NOT NULL REFERENCES "VirtualMachine"("id") ON DELETE RESTRICT,
  "version" INTEGER NOT NULL, "endpointId" TEXT REFERENCES "ProxyIP"("id") ON DELETE RESTRICT,
  "snapshotCipher" TEXT NOT NULL, "configurationHash" TEXT NOT NULL,
  "status" "VMConfigurationStatus" NOT NULL DEFAULT 'PLANNED', "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "startedAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3), "confirmedById" TEXT, "failureNote" TEXT, "revision" INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX "VMConfiguration_vmId_version_key" ON "VMConfiguration"("vmId","version");
CREATE INDEX "VMConfiguration_projectId_status_idx" ON "VMConfiguration"("projectId","status");
ALTER TABLE "VirtualMachine" ADD CONSTRAINT "VirtualMachine_desiredConfigurationId_fkey" FOREIGN KEY ("desiredConfigurationId") REFERENCES "VMConfiguration"("id") ON DELETE RESTRICT;
ALTER TABLE "VirtualMachine" ADD CONSTRAINT "VirtualMachine_installedConfigurationId_fkey" FOREIGN KEY ("installedConfigurationId") REFERENCES "VMConfiguration"("id") ON DELETE RESTRICT;
CREATE UNIQUE INDEX "VirtualMachine_desiredConfigurationId_key" ON "VirtualMachine"("desiredConfigurationId");
CREATE UNIQUE INDEX "VirtualMachine_installedConfigurationId_key" ON "VirtualMachine"("installedConfigurationId");
CREATE TABLE "VMProxyAllocation" (
  "id" TEXT PRIMARY KEY,"projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE RESTRICT,
  "vmId" TEXT NOT NULL REFERENCES "VirtualMachine"("id") ON DELETE RESTRICT,
  "endpointId" TEXT NOT NULL REFERENCES "ProxyIP"("id") ON DELETE RESTRICT,
  "configurationId" TEXT NOT NULL REFERENCES "VMConfiguration"("id") ON DELETE RESTRICT,
  "allocationKey" TEXT NOT NULL,"role" "VMAllocationRole" NOT NULL DEFAULT 'DESIRED',
  "createdById" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),"releaseReason" TEXT,"revision" INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX "VMProxyAllocation_active_key" ON "VMProxyAllocation"("allocationKey") WHERE "releasedAt" IS NULL;
CREATE UNIQUE INDEX "VMProxyAllocation_desired_vm" ON "VMProxyAllocation"("vmId") WHERE "releasedAt" IS NULL AND "role"='DESIRED';
CREATE UNIQUE INDEX "VMProxyAllocation_installed_vm" ON "VMProxyAllocation"("vmId") WHERE "releasedAt" IS NULL AND "role"='INSTALLED';
CREATE INDEX "VMProxyAllocation_projectId_vmId_idx" ON "VMProxyAllocation"("projectId","vmId");
CREATE INDEX "VMProxyAllocation_endpointId_idx" ON "VMProxyAllocation"("endpointId");
ALTER TABLE "VMTask" ADD COLUMN "configurationId" TEXT REFERENCES "VMConfiguration"("id") ON DELETE RESTRICT;
CREATE UNIQUE INDEX "VMTask_configurationId_key" ON "VMTask"("configurationId");
CREATE FUNCTION validate_managed_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "VirtualMachine" v JOIN "Server" s ON s.id=v."serverId" WHERE v.id=NEW."vmId" AND s."projectId"=NEW."projectId" AND v.managed AND s.managed) THEN RAISE EXCEPTION 'Managed VM configuration scope mismatch'; END IF;
 IF NEW."endpointId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "ProxyIP" p WHERE p.id=NEW."endpointId" AND p."projectId"=NEW."projectId") THEN RAISE EXCEPTION 'Configuration endpoint scope mismatch'; END IF;
 IF TG_OP='UPDATE' AND (NEW."vmId",NEW."projectId",NEW.version,NEW."endpointId",NEW."snapshotCipher",NEW."configurationHash") IS DISTINCT FROM (OLD."vmId",OLD."projectId",OLD.version,OLD."endpointId",OLD."snapshotCipher",OLD."configurationHash") THEN RAISE EXCEPTION 'Configuration snapshot is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER managed_configuration_scope BEFORE INSERT OR UPDATE ON "VMConfiguration" FOR EACH ROW EXECUTE FUNCTION validate_managed_configuration();
CREATE FUNCTION validate_managed_vm_pointers() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."desiredConfigurationId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "VMConfiguration" c WHERE c.id=NEW."desiredConfigurationId" AND c."vmId"=NEW.id) THEN RAISE EXCEPTION 'Desired config belongs to a different VM'; END IF;
 IF NEW."installedConfigurationId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "VMConfiguration" c WHERE c.id=NEW."installedConfigurationId" AND c."vmId"=NEW.id) THEN RAISE EXCEPTION 'Installed config belongs to a different VM'; END IF;
 IF TG_OP='UPDATE' THEN NEW.revision:=GREATEST(NEW.revision,OLD.revision+1); NEW."configurationSequence":=GREATEST(NEW."configurationSequence",OLD."configurationSequence"); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER managed_vm_pointers BEFORE INSERT OR UPDATE ON "VirtualMachine" FOR EACH ROW EXECUTE FUNCTION validate_managed_vm_pointers();
CREATE FUNCTION validate_managed_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "VMConfiguration" c JOIN "ProxyIP" p ON p.id=NEW."endpointId" WHERE c.id=NEW."configurationId" AND c."vmId"=NEW."vmId" AND c."projectId"=NEW."projectId" AND c."endpointId"=NEW."endpointId" AND p."projectId"=NEW."projectId" AND p."inventoryKey"=NEW."allocationKey") THEN RAISE EXCEPTION 'Allocation scope/key mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER managed_allocation_scope BEFORE INSERT OR UPDATE ON "VMProxyAllocation" FOR EACH ROW EXECUTE FUNCTION validate_managed_allocation();
