"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";

export default function SettingsPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("VIEWER");

  const { data: project, isLoading, refetch } = trpc.project.getById.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const addMember = trpc.project.addMember.useMutation({
    onSuccess: () => {
      refetch();
      setInviteEmail("");
    },
  });

  const roleColors: Record<string, string> = {
    ADMIN: "bg-red-100 text-red-800",
    MANAGER: "bg-blue-100 text-blue-800",
    OPERATOR: "bg-green-100 text-green-800",
    PARTNER: "bg-purple-100 text-purple-800",
    VIEWER: "bg-gray-100 text-gray-800",
  };

  if (!projectId) return <p className="text-gray-500 p-8">Select a project first.</p>;
  if (isLoading) return <p className="p-8">Loading...</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500">Project configuration and member management</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Project Info */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Project Info</h2>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-gray-500">Name</dt>
              <dd className="font-medium">{project?.name}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Code</dt>
              <dd className="font-medium">{project?.code}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Description</dt>
              <dd>{project?.description || "—"}</dd>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-2 border-t">
              <div>
                <dt className="text-gray-500">Servers</dt>
                <dd className="text-xl font-bold">{project?._count.servers ?? 0}</dd>
              </div>
              <div>
                <dt className="text-gray-500">PayPal Accounts</dt>
                <dd className="text-xl font-bold">{project?._count.paypalAccounts ?? 0}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Fund Transactions</dt>
                <dd className="text-xl font-bold">{project?._count.fundTransactions ?? 0}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Withdrawals</dt>
                <dd className="text-xl font-bold">{project?._count.withdrawals ?? 0}</dd>
              </div>
            </div>
          </dl>
        </div>

        {/* Members */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Team Members ({project?.members.length ?? 0})
          </h2>

          <div className="space-y-3 mb-6">
            {project?.members.map((m) => (
              <div key={m.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div>
                  <p className="font-medium text-sm">{m.user.name || m.user.email}</p>
                  <p className="text-xs text-gray-500">{m.user.email}</p>
                </div>
                <Badge className={`${roleColors[m.role] ?? ""} text-xs`}>{m.role}</Badge>
              </div>
            ))}
          </div>

          {/* Invite form */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Invite Member</h3>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="email@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="flex-1"
              />
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["VIEWER", "OPERATOR", "MANAGER", "PARTNER", "ADMIN"].map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={() => {
                  if (inviteEmail && projectId) {
                    addMember.mutate({
                      projectId,
                      email: inviteEmail,
                      role: inviteRole as any,
                    });
                  }
                }}
                disabled={!inviteEmail || addMember.isLoading}
                size="sm"
              >
                Invite
              </Button>
            </div>
            {addMember.error && (
              <p className="text-xs text-red-600 mt-1">{addMember.error.message}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
