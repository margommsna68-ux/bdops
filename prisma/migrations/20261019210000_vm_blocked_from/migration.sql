-- Owner decision 19/10/2026: remember the VM status before "Blocked" per VM, round and proxy. Additive only.
ALTER TABLE "VmOperation" ADD COLUMN "blockedFrom" "VmOpsStatus";
ALTER TABLE "VmOperation" ADD COLUMN "blockedFromKnown" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "VmOperation" ADD COLUMN "blockedEndpointId" TEXT;
ALTER TABLE "VmOperation" ADD COLUMN "blockedCycle" INTEGER;
ALTER TABLE "VmOperation" ADD COLUMN "blockedAt" TIMESTAMP(3);
