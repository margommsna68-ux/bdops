CREATE TABLE "FleetCommand" (
 "operationId" TEXT PRIMARY KEY,
 "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "serverId" TEXT NOT NULL, "serverUuid" TEXT NOT NULL, "vmId" TEXT NOT NULL, "vmCode" TEXT NOT NULL,
 "machineUuid" TEXT NOT NULL, "expectedCycle" INTEGER NOT NULL CHECK ("expectedCycle">0),
 "expectedVmRevision" INTEGER NOT NULL CHECK ("expectedVmRevision">=0), "configurationId" TEXT,
 "action" TEXT NOT NULL CHECK ("action" IN ('START_VM','SHUTDOWN_VM','POWER_OFF_VM','CHECK_HEALTH')),
 "source" TEXT NOT NULL CHECK ("source" IN ('WEB','OPS','TELEGRAM')),
 "requesterId" TEXT NOT NULL, "requesterTokenId" TEXT, "requestHash" TEXT NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'QUEUED' CHECK ("state" IN ('QUEUED','CLAIMED','DISPATCHED','UNKNOWN','SUCCEEDED','FAILED','CANCELLED','EXPIRED','REFUSED')),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL,
 "workerId" TEXT, "workerUserId" TEXT, "leaseEpoch" INTEGER NOT NULL DEFAULT 0 CHECK ("leaseEpoch">=0),
 "leaseUntil" TIMESTAMP(3), "dispatchedAt" TIMESTAMP(3), "cancelRequestedAt" TIMESTAMP(3),
 "completedAt" TIMESTAMP(3), "result" JSONB
);
CREATE INDEX "FleetCommand_projectId_serverId_state_createdAt_idx" ON "FleetCommand"("projectId","serverId","state","createdAt");
CREATE INDEX "FleetCommand_projectId_vmId_state_idx" ON "FleetCommand"("projectId","vmId","state");
CREATE TABLE "FleetCommandEvent" (
 "operationId" TEXT NOT NULL REFERENCES "FleetCommand"("operationId") ON DELETE CASCADE ON UPDATE CASCADE,
 "eventId" TEXT NOT NULL, "kind" TEXT NOT NULL, "requestHash" TEXT NOT NULL, "detail" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("operationId","eventId")
);
