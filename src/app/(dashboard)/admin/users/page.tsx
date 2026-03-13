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
import { useT } from "@/lib/i18n";

const APP_MODULES = ["FUNDS", "WITHDRAWALS", "PAYPALS", "INFRASTRUCTURE", "COSTS", "PROFIT"] as const;

const roleColors: Record<string, string> = {
  ADMIN: "bg-red-100 text-red-800",
  MODERATOR: "bg-blue-100 text-blue-800",
  USER: "bg-green-100 text-green-800",
};

export default function AdminUsersPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const t = useT();
  const [showForm, setShowForm] = useState(false);
  const [editingMember, setEditingMember] = useState<any>(null);

  // Create user form state - order: Tên, User, Mật khẩu, PIN
  const [formName, setFormName] = useState("");
  const [formUsername, setFormUsername] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formPin, setFormPin] = useState("");
  const [formRole, setFormRole] = useState<"ADMIN" | "MODERATOR" | "USER">("USER");
  const [formModules, setFormModules] = useState<string[]>([]);
  const [showPassword, setShowPassword] = useState(false);

  // Edit form state
  const [editRole, setEditRole] = useState<"ADMIN" | "MODERATOR" | "USER">("USER");
  const [editModules, setEditModules] = useState<string[]>([]);
  const [editName, setEditName] = useState("");
  const [editUsername, setEditUsername] = useState("");

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
  const updateUserInfo = trpc.project.updateUserInfo.useMutation({
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
    setFormName("");
    setFormUsername("");
    setFormPassword("");
    setFormPin("");
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
    setEditName(member.user.name || "");
    setEditUsername(member.user.username || "");
  }

  function saveEdit(member: any) {
    // Save user info (name, username) if changed
    const nameChanged = editName !== (member.user.name || "");
    const usernameChanged = editUsername !== (member.user.username || "");
    if (nameChanged || usernameChanged) {
      updateUserInfo.mutate({
        projectId: projectId!,
        userId: member.user.id,
        ...(nameChanged ? { name: editName } : {}),
        ...(usernameChanged ? { username: editUsername } : {}),
      });
    }
    // Save role/modules
    updateMember.mutate({
      projectId: projectId!,
      memberId: member.id,
      role: editRole,
      allowedModules: editRole === "USER" ? editModules : [],
    });
  }

  // Build online status map
  const onlineMap = new Map<string, { isOnline: boolean; hasPin: boolean; lastActiveAt: Date | null }>();
  onlineData?.forEach((u) => {
    onlineMap.set(u.userId, { isOnline: u.isOnline, hasPin: u.hasPin, lastActiveAt: u.lastActiveAt ? new Date(u.lastActiveAt) : null });
  });

  if (!projectId) return <p className="text-gray-500 p-8">{t("select_project")}</p>;
  if (isLoading) return <p className="p-8">{t("loading")}</p>;

  const onlineCount = onlineData?.filter((u) => u.isOnline).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("user_title")}</h1>
          <p className="text-gray-500">{t("user_subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Online indicator */}
          <div className="flex items-center gap-2 bg-white border rounded-lg px-3 py-1.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
            </span>
            <span className="text-sm font-medium text-gray-700">{onlineCount} {t("online")}</span>
          </div>
          <Button onClick={() => setShowForm(true)}>{t("user_create")}</Button>
        </div>
      </div>

      {/* Create User Form */}
      {showForm && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t("user_create_title")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* 1. Họ tên */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Họ tên</label>
              <Input placeholder="Nguyễn Văn A" value={formName} onChange={(e) => setFormName(e.target.value)} />
            </div>
            {/* 2. Tên đăng nhập */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tên đăng nhập</label>
              <Input placeholder="nguyenvana" value={formUsername}
                onChange={(e) => setFormUsername(e.target.value.replace(/[^a-zA-Z0-9._-]/g, "").toLowerCase())} />
              <p className="text-xs text-gray-400 mt-0.5">Chữ thường, số, dấu chấm, gạch ngang</p>
            </div>
            {/* 3. Mật khẩu */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mật khẩu</label>
              <div className="relative">
                <Input type={showPassword ? "text" : "password"} placeholder="Tối thiểu 6 ký tự" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} className="pr-10" />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M3 3l18 18" /></svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  )}
                </button>
              </div>
            </div>
            {/* 4. PIN */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">PIN</label>
              <Input type="text" placeholder="Để trống → user tự set khi đăng nhập" value={formPin} onChange={(e) => setFormPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                maxLength={6} inputMode="numeric" />
              <p className="text-xs text-gray-400 mt-0.5">4-6 số. Để trống nếu muốn user tự đặt.</p>
            </div>
            {/* 5. Role */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("role")}</label>
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
              <label className="block text-sm font-medium text-gray-700 mb-2">{t("user_allowed_modules")}</label>
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-2 text-sm font-medium text-blue-700">
                  <input type="checkbox" checked={formModules.length === APP_MODULES.length}
                    onChange={() => setFormModules(formModules.length === APP_MODULES.length ? [] : [...APP_MODULES])}
                    className="rounded border-blue-400" />
                  Select All
                </label>
                <span className="text-gray-300">|</span>
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
              if (!formUsername || !formName || !formPassword) return;
              createUser.mutate({ projectId: projectId!, username: formUsername, name: formName, password: formPassword, pin: formPin || undefined, role: formRole, allowedModules: formRole === "USER" ? formModules : [] });
            }} disabled={!formUsername || !formName || !formPassword || createUser.isLoading}>
              {createUser.isLoading ? t("creating") : t("user_create_user")}
            </Button>
            <Button variant="outline" onClick={resetForm}>{t("cancel")}</Button>
          </div>
          {createUser.error && <p className="text-sm text-red-600 mt-2">{createUser.error.message}</p>}
        </div>
      )}

      {/* Members List */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {t("user_team_members")} ({project?.members.length ?? 0})
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Họ tên</label>
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Họ tên" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Tên đăng nhập</label>
                        <Input value={editUsername}
                          onChange={(e) => setEditUsername(e.target.value.replace(/[^a-zA-Z0-9._-]/g, "").toLowerCase())}
                          placeholder="username" />
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
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
                        <label className="block text-sm font-medium text-gray-700 mb-2">{t("user_allowed_modules")}</label>
                        <div className="flex flex-wrap gap-3">
                          <label className="flex items-center gap-2 text-sm font-medium text-blue-700">
                            <input type="checkbox" checked={editModules.length === APP_MODULES.length}
                              onChange={() => setEditModules(editModules.length === APP_MODULES.length ? [] : [...APP_MODULES])}
                              className="rounded border-blue-400" />
                            Select All
                          </label>
                          <span className="text-gray-300">|</span>
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
                      <Button size="sm" onClick={() => saveEdit(m)}
                        disabled={updateMember.isLoading || updateUserInfo.isLoading}>
                        {(updateMember.isLoading || updateUserInfo.isLoading) ? t("saving") : t("save")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingMember(null)}>{t("cancel")}</Button>
                    </div>
                    {updateUserInfo.error && <p className="text-sm text-red-600 mt-1">{updateUserInfo.error.message}</p>}
                  </div>
                ) : (
                  /* View mode */
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        {/* Online dot */}
                        <span className={`inline-block w-2 h-2 rounded-full ${isOnline ? "bg-green-500" : "bg-gray-300"}`} />
                        <p className="font-medium text-sm">{m.user.name || m.user.username || m.user.email}</p>
                        {!hasPin && (
                          <Badge variant="outline" className="text-[10px] border-orange-300 text-orange-600">{t("user_no_pin")}</Badge>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 ml-4">
                        @{m.user.username || "—"}
                        {m.user.memberships && m.user.memberships.length > 1 && (
                          <span className="ml-2">
                            {m.user.memberships.map((ms: any) => (
                              <span key={ms.project.id} className={`inline-block text-[10px] px-1.5 py-0.5 rounded mr-1 ${
                                ms.project.id === projectId ? "bg-blue-100 text-blue-700 font-medium" : "bg-gray-100 text-gray-500"
                              }`}>
                                {ms.project.code}
                              </span>
                            ))}
                          </span>
                        )}
                        {m.user.memberships && m.user.memberships.length === 1 && (
                          <span className="ml-2 inline-block text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">
                            {m.user.memberships[0].project.code}
                          </span>
                        )}
                      </p>
                      {m.role === "USER" && m.allowedModules?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1 ml-4">
                          {m.allowedModules.map((mod: string) => (
                            <Badge key={mod} variant="outline" className="text-xs">{mod}</Badge>
                          ))}
                        </div>
                      )}
                      {m.role !== "USER" && <p className="text-xs text-gray-400 mt-1 ml-4">{t("user_all_modules")}</p>}
                      {userStatus?.lastActiveAt && (
                        <p className="text-[10px] text-gray-400 ml-4">
                          {t("user_last_active")} {new Date(userStatus.lastActiveAt).toLocaleString("vi-VN")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      <Badge className={`${roleColors[m.role] ?? ""} text-xs`}>{m.role}</Badge>
                      <Button size="sm" variant="outline" onClick={() => startEdit(m)}>{t("edit")}</Button>
                      <Button size="sm" variant="outline" onClick={() => setResetPinDialog({ userId: m.user.id, name: m.user.name || m.user.username || m.user.email })}>
                        {t("user_reset_pin")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setResetPassDialog({ userId: m.user.id, name: m.user.name || m.user.username || m.user.email })}>
                        {t("user_reset_pass")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 hover:bg-red-50"
                        onClick={() => {
                          if (!window.confirm(`${m.user.username || m.user.email} - ${t("user_remove_confirm")}`)) return;
                          removeMember.mutate({ projectId: projectId!, memberId: m.id });
                        }}
                        disabled={removeMember.isLoading}
                      >
                        {t("remove")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {(!project?.members || project.members.length === 0) && (
            <div className="p-8 text-center text-gray-500">{t("user_no_members")}</div>
          )}
        </div>
      </div>

      {/* Reset PIN Dialog */}
      <Dialog open={!!resetPinDialog} onOpenChange={(v) => { if (!v) { setResetPinDialog(null); setNewPin(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("user_reset_pin_title")} - {resetPinDialog?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              placeholder={t("user_new_pin")}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
              className="text-center text-xl tracking-[0.3em]"
              autoFocus
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setResetPinDialog(null); setNewPin(""); }}>{t("cancel")}</Button>
              <Button className="flex-1" disabled={newPin.length < 4 || adminResetPin.isLoading} onClick={() => {
                if (resetPinDialog) adminResetPin.mutate({ projectId: projectId!, userId: resetPinDialog.userId, newPin });
              }}>
                {adminResetPin.isLoading ? "..." : t("user_reset_pin")}
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
            <DialogTitle>{t("user_reset_pass_title")} - {resetPassDialog?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <Input
              type="password"
              placeholder={t("user_new_pass")}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setResetPassDialog(null); setNewPassword(""); }}>{t("cancel")}</Button>
              <Button className="flex-1" disabled={newPassword.length < 6 || adminResetPassword.isLoading} onClick={() => {
                if (resetPassDialog) adminResetPassword.mutate({ projectId: projectId!, userId: resetPassDialog.userId, newPassword });
              }}>
                {adminResetPassword.isLoading ? "..." : t("user_reset_pass_title")}
              </Button>
            </div>
            {adminResetPassword.error && <p className="text-sm text-red-600 text-center">{adminResetPassword.error.message}</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
