CREATE TABLE "MonitorHeartbeat" (
 "serverId" TEXT NOT NULL,
 "source" TEXT NOT NULL CHECK ("source" IN ('CENTRAL', 'AGENT')),
 "projectId" TEXT NOT NULL,
 "serverUuid" TEXT NOT NULL,
 "instanceUuid" TEXT NOT NULL,
 "startedAt" TIMESTAMP(3) NOT NULL,
 "seq" INTEGER NOT NULL CHECK ("seq" >= 0),
 "configVersion" INTEGER NOT NULL,
 "observedAt" TIMESTAMP(3) NOT NULL,
 "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "counts" JSONB NOT NULL,
 "requestKey" TEXT NOT NULL,
 "requestHash" TEXT NOT NULL,
 "actorId" TEXT NOT NULL,
 CONSTRAINT "MonitorHeartbeat_pkey" PRIMARY KEY ("serverId", "source"),
 CONSTRAINT "MonitorHeartbeat_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MonitorHeartbeat_projectId_idx" ON "MonitorHeartbeat"("projectId");
CREATE UNIQUE INDEX "MonitorHeartbeat_projectId_requestKey_key" ON "MonitorHeartbeat"("projectId", "requestKey");
