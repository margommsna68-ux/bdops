-- Existing memberships retain project-wide access. SELECTED + [] grants no servers.
ALTER TABLE "ProjectMember"
ADD COLUMN "serverScope" TEXT NOT NULL DEFAULT 'ALL',
ADD COLUMN "allowedServerIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
