ALTER TYPE "ProxyInventoryState" ADD VALUE 'VOID';
ALTER TABLE "ProxyStatusEvent" ADD COLUMN "reversedAt" TIMESTAMP(3);
ALTER TABLE "ProxyProviderAccount" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ProjectMember" ADD COLUMN "accessRevision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "OperationJournal" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
  "actorId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "summary" JSONB NOT NULL,
  "snapshotCipher" TEXT NOT NULL,
  "batchId" TEXT,
  "undoOfId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "OperationJournal_batchId_key" ON "OperationJournal"("batchId");
CREATE UNIQUE INDEX "OperationJournal_undoOfId_key" ON "OperationJournal"("undoOfId");
CREATE INDEX "OperationJournal_projectId_createdAt_idx" ON "OperationJournal"("projectId","createdAt");
CREATE FUNCTION proxy_member_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW."accessRevision" := OLD."accessRevision" + 1; RETURN NEW; END $$;
CREATE TRIGGER project_member_revision BEFORE UPDATE ON "ProjectMember" FOR EACH ROW EXECUTE FUNCTION proxy_member_revision();
CREATE FUNCTION proxy_catalog_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW."revision" := OLD."revision" + 1; RETURN NEW; END $$;
CREATE TRIGGER proxy_catalog_revision BEFORE UPDATE ON "ProxyProviderAccount" FOR EACH ROW EXECUTE FUNCTION proxy_catalog_revision();
