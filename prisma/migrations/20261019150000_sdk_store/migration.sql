-- SDK store (owner brief 19/10/2026): SDK codes become records of their own. Additive; existing VM sdkId values are kept as the mirror.
-- CreateEnum
CREATE TYPE "SdkLinkState" AS ENUM ('UNLINKED', 'LINKED', 'UNCONFIRMED');

-- CreateTable
CREATE TABLE "SdkRecord" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "vmId" TEXT,
    "placedAt" TIMESTAMP(3),
    "placedById" TEXT,
    "amount" DECIMAL(18,6),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amountAt" TIMESTAMP(3),
    "amountById" TEXT,
    "note" TEXT,
    "noteAt" TIMESTAMP(3),
    "noteById" TEXT,
    "linkState" "SdkLinkState" NOT NULL DEFAULT 'UNLINKED',
    "linkedEarnAppId" TEXT,
    "linkedVmId" TEXT,
    "linkedCycle" INTEGER,
    "linkedAt" TIMESTAMP(3),
    "linkedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SdkRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SdkEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sdkId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromVmId" TEXT,
    "toVmId" TEXT,
    "fromLabel" TEXT,
    "toLabel" TEXT,
    "detail" JSONB,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SdkEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SdkRecord_vmId_key" ON "SdkRecord"("vmId");

-- CreateIndex
CREATE INDEX "SdkRecord_projectId_linkState_idx" ON "SdkRecord"("projectId", "linkState");

-- CreateIndex
CREATE UNIQUE INDEX "SdkRecord_projectId_code_key" ON "SdkRecord"("projectId", "code");

-- CreateIndex
CREATE INDEX "SdkEvent_sdkId_createdAt_idx" ON "SdkEvent"("sdkId", "createdAt");

-- CreateIndex
CREATE INDEX "SdkEvent_projectId_createdAt_idx" ON "SdkEvent"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "SdkRecord" ADD CONSTRAINT "SdkRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SdkRecord" ADD CONSTRAINT "SdkRecord_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "VirtualMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SdkRecord" ADD CONSTRAINT "SdkRecord_linkedEarnAppId_fkey" FOREIGN KEY ("linkedEarnAppId") REFERENCES "EarnAppAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SdkEvent" ADD CONSTRAINT "SdkEvent_sdkId_fkey" FOREIGN KEY ("sdkId") REFERENCES "SdkRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Data: keep every SDK code already known, without inventing evidence ──────────────────────────────────────────────────────────
-- Old data does not say whether a code was ever linked to an EarnApp account, so every migrated code is UNCONFIRMED ("Chưa xác
-- nhận"): kept, shown in the SDK store, never offered for reuse until a person confirms it. No money is written (amount stays NULL).

-- 1. Current SDK of managed VMs: one record per (project, code). When the same code sits on several VMs (an active VM and a deleted
--    one), the active VM keeps it (then the latest recording); the other VMs lose only the mirror value, with a history line.
CREATE TEMP TABLE sdk_mig ON COMMIT DROP AS
SELECT vm.id AS vm_id, s."projectId" AS project_id, btrim(vm."sdkId") AS code, vm."sdkRecordedAt" AS at, vm."sdkRecordedById" AS by,
       s.code || ' / ' || vm.code AS label,
       ROW_NUMBER() OVER (PARTITION BY s."projectId", btrim(vm."sdkId") ORDER BY (vm."archivedAt" IS NULL) DESC, vm."sdkRecordedAt" DESC NULLS LAST, vm.id) AS rn
FROM "VirtualMachine" vm JOIN "Server" s ON s.id = vm."serverId"
WHERE vm.managed AND s.managed AND vm."sdkId" IS NOT NULL AND btrim(vm."sdkId") <> '';

INSERT INTO "SdkRecord" ("id","projectId","code","vmId","placedAt","placedById","linkState","createdById","createdAt","updatedAt")
SELECT 'sdkm' || md5(project_id || ':' || code), project_id, code, vm_id, at, by, 'UNCONFIRMED', by, COALESCE(at, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
FROM sdk_mig WHERE rn = 1;

INSERT INTO "VMSdkHistory" ("id","projectId","vmId","previousSdk","newSdk","actorId","note","recordedAt")
SELECT 'sdkmh' || md5(vm_id || ':' || code), project_id, vm_id, code, NULL, 'migration', 'Kho SDK: mã đang thuộc VM khác, giữ ở đó', CURRENT_TIMESTAMP
FROM sdk_mig WHERE rn > 1;
UPDATE "VirtualMachine" vm SET "sdkId" = NULL FROM sdk_mig m WHERE m.rn > 1 AND vm.id = m.vm_id;
UPDATE "VirtualMachine" vm SET "sdkId" = m.code FROM sdk_mig m WHERE m.rn = 1 AND vm.id = m.vm_id AND vm."sdkId" <> m.code;

-- 2. Codes only known from the SDK history or from closed rounds: kept in the store (no VM), UNCONFIRMED.
INSERT INTO "SdkRecord" ("id","projectId","code","vmId","linkState","createdAt","updatedAt")
SELECT DISTINCT ON (x.project_id, x.code) 'sdkm' || md5(x.project_id || ':' || x.code), x.project_id, x.code, NULL, 'UNCONFIRMED', x.at, CURRENT_TIMESTAMP
FROM (
  SELECT h."projectId" AS project_id, btrim(h."previousSdk") AS code, h."recordedAt" AS at FROM "VMSdkHistory" h WHERE h."previousSdk" IS NOT NULL AND btrim(h."previousSdk") <> ''
  UNION ALL SELECT h."projectId", btrim(h."newSdk"), h."recordedAt" FROM "VMSdkHistory" h WHERE h."newSdk" IS NOT NULL AND btrim(h."newSdk") <> ''
  UNION ALL SELECT c."projectId", btrim(c."sdkId"), c."closedAt" FROM "VmCycle" c WHERE c."sdkId" IS NOT NULL AND btrim(c."sdkId") <> ''
) x
WHERE NOT EXISTS (SELECT 1 FROM "SdkRecord" r WHERE r."projectId" = x.project_id AND r.code = x.code)
ORDER BY x.project_id, x.code, x.at;

-- 3. One MIGRATE event per record (where it was found).
INSERT INTO "SdkEvent" ("id","projectId","sdkId","kind","toVmId","toLabel","detail","actorId","createdAt")
SELECT 'sdkme' || md5(r.id), r."projectId", r.id, 'MIGRATE', r."vmId", m.label,
       jsonb_build_object('note', CASE WHEN r."vmId" IS NULL THEN 'Mã cũ từ lịch sử SDK / lượt đã đóng; chưa xác nhận đã nối EarnApp hay chưa' ELSE 'Mã đang ghi trên VM; chưa xác nhận đã nối EarnApp hay chưa' END),
       'migration', CURRENT_TIMESTAMP
FROM "SdkRecord" r LEFT JOIN sdk_mig m ON m.vm_id = r."vmId" AND m.rn = 1;
