-- Proxy groups ("Từ nhóm"): additive only. Existing rows keep owner SELF (= TUT) / GENJY / UNKNOWN and no group.
ALTER TYPE "ProxyOwner" ADD VALUE 'OTHER';
CREATE TABLE "ProxyGroup" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "createdById" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProxyGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProxyGroup_projectId_normalizedName_key" ON "ProxyGroup"("projectId","normalizedName");
ALTER TABLE "ProxyGroup" ADD CONSTRAINT "ProxyGroup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProxyIP" ADD COLUMN "groupId" TEXT;
CREATE INDEX "ProxyIP_projectId_groupId_idx" ON "ProxyIP"("projectId","groupId");
ALTER TABLE "ProxyIP" ADD CONSTRAINT "ProxyIP_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProxyGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
