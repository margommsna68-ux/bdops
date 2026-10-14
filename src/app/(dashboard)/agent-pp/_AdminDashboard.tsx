"use client";

import { AdminOverviewCards } from "./_AdminOverviewCards";
import { AdminAgentLedger } from "./_AdminAgentLedger";

export function AgentAdminDashboard({ projectId }: { projectId: string }) {
  return (
    <div className="space-y-6">
      <AdminOverviewCards projectId={projectId} />
      <AdminAgentLedger projectId={projectId} />
    </div>
  );
}
