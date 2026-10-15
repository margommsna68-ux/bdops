-- EarnApp SDK recording per managed VM: additive only, legacy sdkId values untouched.
ALTER TABLE "VirtualMachine" ADD COLUMN "sdkRecordedAt" TIMESTAMP(3), ADD COLUMN "sdkRecordedById" TEXT;
CREATE TABLE "VMSdkHistory" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE RESTRICT,
  "vmId" TEXT NOT NULL REFERENCES "VirtualMachine"("id") ON DELETE RESTRICT,
  "previousSdk" TEXT, "newSdk" TEXT,
  "actorId" TEXT NOT NULL, "note" TEXT,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "VMSdkHistory_vmId_recordedAt_idx" ON "VMSdkHistory"("vmId","recordedAt");
CREATE INDEX "VMSdkHistory_projectId_recordedAt_idx" ON "VMSdkHistory"("projectId","recordedAt");
-- One current SDK belongs to one active managed VM. Legacy (unmanaged) rows are not constrained.
CREATE UNIQUE INDEX "VirtualMachine_managed_sdk_key" ON "VirtualMachine"("sdkId") WHERE managed AND "archivedAt" IS NULL AND "sdkId" IS NOT NULL;
