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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";

const APP_MODULES = ["FUNDS", "WITHDRAWALS", "PAYPALS", "INFRASTRUCTURE", "COSTS", "PROFIT"] as const;

const roleColors: Record<string, string> = {
  ADMIN: "bg-red-100 text-red-800",
  MODERATOR: "bg-blue-100 text-blue-800",
  USER: "bg-green-100 text-green-800",
};

export default function AdminUsersPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [showForm, setShowForm] = useState(false);
  const [editingMember, setEditingMember] = useState<any>(null);

  // Create user form state
  const [formEmail, setFormEmail] = useState("");
  const [formName, setFormName] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formRole, setFormRole] = useState<"ADMIN" | "MODERATOR" | "USER">("USER");
  const [formModules, setFormModules] = useState<string[]>([]);

  // Edit form state
  const [editRole, setEditRole] = useState<"ADMIN" | "MODERATOR" | "USER">("USER");
  const [editModules, setEditModules] = useState<string[]>([]);

  // Admin reset dialogs
  const [resetPinDialog, setResetPinDialog] = useState<{ userId: string; name: string } | null>(null);
  const [resetPassDialog, setResetPassDialog] = useState<{ userId: string; name: string } | null>(null);
  const [newPin, setNewPin] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const { data: project, isLoading, refetch } = trpc.project.getById.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  // Online users query
  const { data: onlineData } = trpc.user.onlineUsers.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId, refetchInterval: 30000 }
  );

  const createUser = trpc.project.createUser.useMutation({
    onSuccess: () => { refetch(); resetForm(); },
  });
  const updateMember = trpc.project.updateMember.useMutation({
    onSuccess: () => { refetch(); setEditingMember(null); },
  });
  const removeMember = trpc.project.removeMember.useMutation({
    onSuccess: () => refetch(),
  });
  const adminResetPin = trpc.user.adminResetPin.useMutation({
    onSuccess: () => { setResetPinDialog(null); setNewPin(""); },
  });
  const adminResetPassword = trpc.user.adminResetPassword.useMutation({
    onSuccess: () => { setResetPassDialog(null); setNewPassword(""); },
  });

  function resetForm() {
    setShowForm(false);
    setFormEmail("");
    setFormName("");
    setFormPassword("");
    setFormRole("USER");
    setFormModules([]);
  }

  function toggleModule(mod: string, list: string[], setter: (v: string[]) => void) {
    setter(list.includes(mod) ? list.filter((m) => m !== mod) : [...list, mod]);
  }

  function startEdit(member: any) {
    setEditingMember(member);
    setEditRole(member.role);
    setEditModules(member.allowedModules || []);
  }

  // Build online status map
  const onlineMap = new Map<string, { isOnline: boolean; hasPin: boolean; lastActiveAt: Date | null }>();
  onlineData?.forEach((u) => {
    onlineMap.set(u.userId, { isOnline: u.isOnline, hasPin: u.hasPin, lastActiveAt: u.lastActiveAt ? new Date(u.lastActiveAt) : null });
  });

  if (!projectId) return <p className="text-gray-500 p-8">Select a project first.</p>;
  if (isLoading) return <p className="p-8">Loading...</p>;

  const onlineCount = onlineData?.filter((u) => u.isOnline).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-500">Manage project members and their roles</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Online indicator */}
          <div className="flex items-center gap-2 bg-white border rounded-lg px-3 py-1.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
            </span>
            <span className="text-sm font-medium text-gray-700">{onlineCount} online</span>
          </div>
          <Button onClick={() => setShowForm(true)}>+ Create User</Button>
        </div>
      </div>

      {/* Create User Form */}
      {showForm && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Create New User</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <Input type="email" placeholder="user@example.com" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <Input placeholder="Full name" value={formName} onChange={(e) => setFormName(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <Input type="password" placeholder="Min 6 characters" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <Select value={formRole} onValueChange={(v) => setFormRole(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">ADMIN</SelectItem>
                  <SelectItem value="MODERATOR">MODERATOR</SelectItem>
                  <SelectItem value="USER">USER</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {formRole === "USER" && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Allowed Modules</label>
              <div className="flex flex-wrap gap-3">
                {APP_MODULES.map((mod) => (
                  <label key={mod} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={formModules.includes(mod)} onChange={() => toggleModule(mod, formModules, setFormModules)} className="rounded border-gray-300" />
                    {mod}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <Button onClick={() => {
              if (!formEmail || !formName || !formPassword) return;
              createUser.mutate({ projectId: projectId!, email: formEmail, name: formName, password: formPassword, role: formRole, allowedModules: formRole === "USER" ? formModules : [] });
            }} disabled={!formEmail || !formName || !formPassword || createUser.isLoading}>
              {createUser.isLoading ? "Creating..." : "Create User"}
            </Button>
            <Button variant="outline" onClick={resetForm}>Cancel</Button>
          </div>
          {createUser.error && <p className="text-sm text-red-600 mt-2">{createUser.error.message}</p>}
        </div>
      )}

      {/* Members List */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Team Members ({project?.members.length ?? 0})
          </h2>
        </div>
        <div className="divide-y divide-gray-100">
          {project?.members.map((m: any) => {
            const userStatus = onlineMap.get(m.user.id);
            const isOnline = userStatus?.isOnline ?? false;
            const hasPin = userStatus?.hasPin ?? false;

            return (
              <div key={m.id} className="p-4">
                {editingMember?.id === m.id ? (
                  /* Edit mode */
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <p className="font-medium">{m.user.name || m.user.email}</p>
                        <p className="text-sm text-gray-500">{m.user.email}</p>
                      </div>
                      <Select value={editRole} onValueChange={(v) => setEditRole(v as any)}>
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ADMIN">ADMIN</SelectItem>
                          <SelectItem value="MODERATOR">MODERATOR</SelectItem>
                          <SelectItem value="USER">USER</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {editRole === "USER" && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Allowed Modules</label>
                        <div className="flex flex-wrap gap-3">
                          {APP_MODULES.map((mod) => (
                            <label key={mod} className="flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={editModules.includes(mod)} onChange={() => toggleModule(mod, editModules, setEditModules)} className="rounded border-gray-300" />
                              {mod}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => {
                        updateMember.mutate({ projectId: projectId!, memberId: m.id, role: editRole, allowedModules: editRole === "USER" ? editModules : [] });
                      }} disabled={updateMember.isLoading}>
                        {updateMember.isLoading ? "Saving..." : "Save"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingMember(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        {/* Online dot */}
                        <span className={`inline-block w-2 h-2 rounded-full ${isOnline ? "bg-green-500" : "bg-gray-300"}`} />
                        <p className="font-medium text-sm">{m.user.name || m.user.email}</p>
                        {!hasPin && (
                          <Badge variant="outline" className="text-[10px] border-orange-300 text-orange-600">No PIN</Badge>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 ml-4">{m.user.email}</p>
                      {m.role === "USER" && m.allowedModules?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1 ml-4">
                          {m.allowedModules.map((mod: string) => (
                            <Badge key={mod} variant="outline" className="text-xs">{mod}</Badge>
                          ))}
                        </div>
                      )}
                      {m.role !== "USER" && <p className="text-xs text-gray-400 mt-1 ml-4">All modules</p>}
                      {userStatus?.lastActiveAt && (
                        <p className="text-[10px] text-gray-400 ml-4">
                          Last active: {new Date(userStatus.lastActiveAt).toLocaleString("vi-VN")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      <Badge className={`${roleColors[m.role] ?? ""} text-xs`}>{m.role}</Badge>
                      <Button size="sm" variant="outline" onClick={() => startEdit(m)}>Edit</Button>
                      <Button size="sm" variant="outline" onClick={() => setResetPinDialog({ userId: m.user.id, name: m.user.name || m.user.email })}>
                        Reset PIN
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setResetPassDialog({ userId: m.user.id, name: m.user.name || m.user.email })}>
                        Reset Pass
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 hover:bg-red-50"
                        onClick={() => {
                          if (!window.confirm(`Remove ${m.user.email} from this project?`)) return;
                          removeMember.mutate({ projectId: projectId!, memberId: m.id });
                        }}
                        disabled={removeMember.isLoading}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {(!project?.members || project.members.length === 0) && (
            <div className="p-8 text-center text-gray-500">No members found.</div>
          )}
        </div>
      </div>

      {/* Reset PIN Dialog */}
      <Dialog open={!!resetPinDialog} onOpenChange={(v) => { if (!v) { setResetPinDialog(null); setNewPin(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset PIN - {resetPinDialog?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              placeholder="New PIN (4-6 digits)"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
              className="text-center text-xl tracking-[0.3em]"
              autoFocus
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setResetPinDialog(null); setNewPin(""); }}>Cancel</Button>
              <Button className="flex-1" disabled={newPin.length < 4 || adminResetPin.isLoading} onClick={() => {
                if (resetPinDialog) adminResetPin.mutate({ projectId: projectId!, userId: resetPinDialog.userId, newPin });
              }}>
                {adminResetPin.isLoading ? "..." : "Reset PIN"}
              </Button>
            </div>
            {adminResetPin.error && <p className="text-sm text-red-600 text-center">{adminResetPin.error.message}</p>}
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={!!resetPassDialog} onOpenChange={(v) => { if (!v) { setResetPassDialog(null); setNewPassword(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset Password - {resetPassDialog?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <Input
              type="password"
              placeholder="New password (min 6 chars)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setResetPassDialog(null); setNewPassword(""); }}>Cancel</Button>
              <Button className="flex-1" disabled={newPassword.length < 6 || adminResetPassword.isLoading} onClick={() => {
                if (resetPassDialog) adminResetPassword.mutate({ projectId: projectId!, userId: resetPassDialog.userId, newPassword });
              }}>
                {adminResetPassword.isLoading ? "..." : "Reset Password"}
              </Button>
            </div>
            {adminResetPassword.error && <p className="text-sm text-red-600 text-center">{adminResetPassword.error.message}</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
