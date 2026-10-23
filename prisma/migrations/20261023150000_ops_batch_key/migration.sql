CREATE TABLE "OpsBatchKey" (
 "key" TEXT NOT NULL PRIMARY KEY,
 "tokenId" TEXT NOT NULL,
 "projectId" TEXT NOT NULL,
 "payloadHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "OpsBatchKey_projectId_idx" ON "OpsBatchKey"("projectId");
