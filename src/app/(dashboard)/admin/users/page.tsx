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
import toast from "react-hot-toast";

const APP_MODULES = ["FUNDS", "WITHDRAWALS", "PAYPALS", "INFRASTRUCTURE", "COSTS", "PROFIT", "AGENT_PP", "AUTOTYPE"] as const;

const roleColors: Record<string, string> = {
  ADMIN: "bg-red-100 text-red-800",
  MODERATOR: "bg-blue-100 text-blue-800",
  USER: "bg-green-100 text-green-800",
};

export default function AdminUsersPage() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const currentRole = useProjectStore((s) => s.currentRole);
  const currentMemberId = useProjectStore((s) => s.currentMemberId);
  const canManageUsers = useProjectStore((s) => s.canManageUsers);
  const currentModules = useProjectStore((s) => s.currentModules);
  const t = useT();

  const isAdmin = currentRole === "ADMIN";
  const isModerator = currentRole === "MODERATOR";
  const canManage = isAdmin || (isModerator && canManageUsers);

  const [showForm, setShowForm] = useState(false);
  const [editingMember, setEditingMember] = useState<any>(null);

  // Create user form state
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

  const { data: onlineData } = trpc.user.onlineUsers.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId, refetchInterval: 30000 }
  );

  const createUser = trpc.project.createUser.useMutation({
    onSuccess: () => { refetch(); resetForm(); toast.success("Tạo user thành công"); },
    onError: (err) => toast.error(err.message),
  });
  const updateMember = trpc.project.updateMember.useMutation({
    onSuccess: () => { refetch(); setEditingMember(null); toast.success("Đã cập nhật"); },
    onError: (err) => toast.error(err.message),
  });
  const updateUserInfo = trpc.project.updateUserInfo.useMutation({
    onSuccess: () => { refetch(); setEditingMember(null); },
    onError: (err) => toast.error(err.message),
  });
  const removeMember = trpc.project.removeMember.useMutation({
    onSuccess: () => { refetch(); toast.success("Đã xóa"); },
    onError: (err) => toast.error(err.message),
  });
  const adminResetPin = trpc.user.adminResetPin.useMutation({
    onSuccess: () => { setResetPinDialog(null); setNewPin(""); toast.success("Đã reset PIN"); },
    onError: (err) => toast.error(err.message),
  });
  const adminResetPassword = trpc.user.adminResetPassword.useMutation({
    onSuccess: () => { setResetPassDialog(null); setNewPassword(""); toast.success("Đã reset mật khẩu"); },
    onError: (err) => toast.error(err.message),
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
    updateMember.mutate({
      projectId: projectId!,
      memberId: member.id,
      role: editRole,
      allowedModules: editModules,
    });
  }

  const kickSession = trpc.user.kickAutotypeSession.useMutation({
    onSuccess: () => { refetch(); toast.success("Đã kick thiết bị"); },
    onError: (err: any) => toast.error(err.message),
  });
  const kickAllSessions = trpc.user.kickAllAutotypeSessions.useMutation({
    onSuccess: () => { refetch(); toast.success("Đã kick tất cả thiết bị"); },
    onError: (err: any) => toast.error(err.message),
  });

  // Autotype device dialog
  const [autotypeDialog, setAutotypeDialog] = useState<{ userId: string; name: string; sessions: any[] } | null>(null);

  // Project assignment dialog
  const [projectDialog, setProjectDialog] = useState<{ userId: string; name: string; memberships: any[] } | null>(null);
  const [addProjectRole, setAddProjectRole] = useState<"ADMIN" | "MODERATOR" | "USER">("USER");
  const [addProjectModules, setAddProjectModules] = useState<string[]>(["AUTOTYPE"]);
  const { data: allProjects } = trpc.project.list.useQuery(undefined, { enabled: !!projectDialog });
  const addMember = trpc.project.addMember.useMutation({
    onSuccess: () => { refetch(); toast.success("Đã thêm vào project"); },
    onError: (err) => toast.error(err.message),
  });

  // Build online status map
  const onlineMap = new Map<string, any>();
  onlineData?.forEach((u) => {
    onlineMap.set(u.userId, {
      isOnline: u.isOnline,
      hasPin: u.hasPin,
      lastActiveAt: u.lastActiveAt ? new Date(u.lastActiveAt) : null,
      managerId: u.managerId,
      canManageUsers: u.canManageUsers,
      allowedModules: u.allowedModules,
      maxAutotypeDevices: u.maxAutotypeDevices,
      autotypeActiveDevices: u.autotypeActiveDevices,
      autotypeSessions: u.autotypeSessions,
    });
  });

  if (!projectId) return <p className="text-gray-500 p-8">{t("select_project")}</p>;
  if (isLoading) return <p className="p-8">{t("loading")}</p>;

  const allMembers = project?.members ?? [];
  const onlineCount = onlineData?.filter((u) => u.isOnline).length ?? 0;

  // For moderator: filter to only their team members
  const visibleMembers = isModerator
    ? allMembers.filter((m: any) => {
        const info = onlineMap.get(m.user.id);
        return info?.managerId === currentMemberId || m.id === currentMemberId;
      })
    : allMembers;

  // Group members by role for admin view
  const admins = visibleMembers.filter((m: any) => m.role === "ADMIN");
  const moderators = visibleMembers.filter((m: any) => m.role === "MODERATOR");
  const users = visibleMembers.filter((m: any) => m.role === "USER");

  // Get moderator list for admin's reassign feature
  const moderatorList = allMembers.filter((m: any) => m.role === "MODERATOR");

  // Available modules for moderator creating users (scoped to their own modules)
  const availableModules = isAdmin ? [...APP_MODULES] : APP_MODULES.filter((m) => currentModules.includes(m));

  // Determine available roles for create form
  const availableRoles = isAdmin
    ? (["ADMIN", "MODERATOR", "USER"] as const)
    : (["USER"] as const);

  function renderMember(m: any) {
    const userStatus = onlineMap.get(m.user.id);
    const isOnline = userStatus?.isOnline ?? false;
    const hasPin = userStatus?.hasPin ?? false;
    const memberManagerId = userStatus?.managerId;
    const memberCanManage = userStatus?.canManageUsers ?? false;
    const memberModules: string[] = userStatus?.allowedModules ?? m.allowedModules ?? [];
    const memberMaxDevices: number = userStatus?.maxAutotypeDevices ?? 2;
    const memberActiveDevices: number = userStatus?.autotypeActiveDevices ?? 0;
    const memberSessions: any[] = userStatus?.autotypeSessions ?? [];
    const hasAutotype = m.role === "ADMIN" || memberModules.includes("AUTOTYPE");

    // Can this caller edit this member?
    const canEditThis = isAdmin || (isModerator && canManageUsers && memberManagerId === currentMemberId);
    // Moderator can't edit themselves or other moderators/admins
    const isSelf = m.id === currentMemberId;

    // Find manager name
    const managerMember = memberManagerId ? allMembers.find((mm: any) => mm.id === memberManagerId) : null;

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
                  {isAdmin ? (
                    <>
                      <SelectItem value="ADMIN">ADMIN</SelectItem>
                      <SelectItem value="MODERATOR">MODERATOR</SelectItem>
                      <SelectItem value="USER">USER</SelectItem>
                    </>
                  ) : (
                    <SelectItem value="USER">USER</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            {(editRole === "USER" || editRole === "MODERATOR") && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {editRole === "MODERATOR" ? "Khu vực quản lý" : t("user_allowed_modules")}
                </label>
                <div className="flex flex-wrap gap-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-blue-700">
                    <input type="checkbox" checked={editModules.length === availableModules.length}
                      onChange={() => setEditModules(editModules.length === availableModules.length ? [] : [...availableModules])}
                      className="rounded border-blue-400" />
                    Chọn tất cả
                  </label>
                  <span className="text-gray-300">|</span>
                  {availableModules.map((mod) => (
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
                <span className={`inline-block w-2 h-2 rounded-full ${isOnline ? "bg-green-500" : "bg-gray-300"}`} />
                <p className="font-medium text-sm">{m.user.name || m.user.username || m.user.email}</p>
                {!hasPin && (
                  <Badge variant="outline" className="text-[10px] border-orange-300 text-orange-600">{t("user_no_pin")}</Badge>
                )}
                {/* Admin: show canManageUsers badge for moderators */}
                {isAdmin && m.role === "MODERATOR" && memberCanManage && (
                  <Badge className="text-[10px] bg-purple-100 text-purple-700">Quản lý user</Badge>
                )}
              </div>
              <p className="text-xs text-gray-500 ml-4">
                @{m.user.username || "—"}
                {m.user.memberships && m.user.memberships.length >= 1 && (
                  <span className="ml-2">
                    {m.user.memberships.map((ms: any) => (
                      <span key={ms.project.id} className={`inline-block text-[10px] px-1.5 py-0.5 rounded mr-1 ${
                        ms.project.id === projectId ? "bg-blue-100 text-blue-700 font-medium" : "bg-gray-100 text-gray-500"
                      }`}>
                        {ms.project.code}
                      </span>
                    ))}
                    {isAdmin && (
                      <button
                        onClick={() => setProjectDialog({
                          userId: m.user.id,
                          name: m.user.name || m.user.username || m.user.email,
                          memberships: m.user.memberships || [],
                        })}
                        className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-600 hover:bg-green-100 cursor-pointer ml-1"
                        title="Quản lý projects"
                      >
                        + Project
                      </button>
                    )}
                  </span>
                )}
              </p>
              {/* Show modules for USER and MODERATOR */}
              {(m.role === "USER" || m.role === "MODERATOR") && memberModules.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1 ml-4">
                  {memberModules.map((mod: string) => (
                    <Badge key={mod} variant="outline" className="text-xs">{mod}</Badge>
                  ))}
                </div>
              )}
              {m.role === "ADMIN" && <p className="text-xs text-gray-400 mt-1 ml-4">{t("user_all_modules")}</p>}
              {/* AutoType device info */}
              {hasAutotype && (
                <div className="flex items-center gap-2 mt-1 ml-4">
                  <button
                    onClick={() => setAutotypeDialog({
                      userId: m.user.id,
                      name: m.user.name || m.user.username || m.user.email,
                      sessions: memberSessions,
                    })}
                    className="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border hover:bg-gray-50 transition-colors"
                  >
                    <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <span className={memberActiveDevices > 0 ? "text-green-700 font-medium" : "text-gray-500"}>
                      {memberActiveDevices}/{memberMaxDevices}
                    </span>
                  </button>
                  {(canEditThis || isAdmin) && (
                    <Select
                      value={String(memberMaxDevices)}
                      onValueChange={(v) => {
                        updateMember.mutate({
                          projectId: projectId!,
                          memberId: m.id,
                          maxAutotypeDevices: parseInt(v),
                        });
                      }}
                    >
                      <SelectTrigger className="w-20 h-6 text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                          <SelectItem key={n} value={String(n)}>{n} TB</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
              {/* Show manager info */}
              {managerMember && (
                <p className="text-[10px] text-purple-500 ml-4 mt-0.5">
                  Nhóm: {managerMember.user.name || managerMember.user.username}
                </p>
              )}
              {userStatus?.lastActiveAt && (
                <p className="text-[10px] text-gray-400 ml-4">
                  {t("user_last_active")} {new Date(userStatus.lastActiveAt).toLocaleString("vi-VN")}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              <Badge className={`${roleColors[m.role] ?? ""} text-xs`}>{m.role}</Badge>
              {/* Admin: toggle canManageUsers for moderators */}
              {isAdmin && m.role === "MODERATOR" && (
                <Button size="sm" variant="outline"
                  className={memberCanManage ? "border-purple-400 text-purple-700 bg-purple-50" : ""}
                  onClick={() => {
                    updateMember.mutate({
                      projectId: projectId!,
                      memberId: m.id,
                      canManageUsers: !memberCanManage,
                    });
                  }}>
                  {memberCanManage ? "Tắt quản lý" : "Bật quản lý"}
                </Button>
              )}
              {/* Admin: reassign user to moderator */}
              {isAdmin && m.role === "USER" && moderatorList.length > 0 && (
                <Select
                  value={memberManagerId || "__none__"}
                  onValueChange={(v) => {
                    updateMember.mutate({
                      projectId: projectId!,
                      memberId: m.id,
                      managerId: v === "__none__" ? null : v,
                    });
                  }}
                >
                  <SelectTrigger className="w-28 h-7 text-xs">
                    <SelectValue placeholder="Nhóm..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Không nhóm</SelectItem>
                    {moderatorList.map((mod: any) => (
                      <SelectItem key={mod.id} value={mod.id}>
                        {mod.user.name || mod.user.username}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {(canEditThis || (isAdmin && !isSelf)) && (
                <>
                  <Button size="sm" variant="outline" onClick={() => startEdit(m)}>{t("edit")}</Button>
                  <Button size="sm" variant="outline" onClick={() => setResetPinDialog({ userId: m.user.id, name: m.user.name || m.user.username || m.user.email })}>
                    {t("user_reset_pin")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setResetPassDialog({ userId: m.user.id, name: m.user.name || m.user.username || m.user.email })}>
                    {t("user_reset_pass")}
                  </Button>
                  {m.role !== "ADMIN" && (
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
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("user_title")}</h1>
          <p className="text-gray-500">
            {isModerator ? "Quản lý nhóm của bạn" : t("user_subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white border rounded-lg px-3 py-1.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
            </span>
            <span className="text-sm font-medium text-gray-700">{onlineCount} {t("online")}</span>
          </div>
          {canManage && (
            <Button onClick={() => setShowForm(true)}>{t("user_create")}</Button>
          )}
        </div>
      </div>

      {/* Create User Form */}
      {showForm && canManage && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t("user_create_title")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Họ tên</label>
              <Input placeholder="Nguyễn Văn A" value={formName} onChange={(e) => setFormName(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tên đăng nhập</label>
              <Input placeholder="nguyenvana" value={formUsername}
                onChange={(e) => setFormUsername(e.target.value.replace(/[^a-zA-Z0-9._-]/g, "").toLowerCase())} />
              <p className="text-xs text-gray-400 mt-0.5">Chữ thường, số, dấu chấm, gạch ngang</p>
            </div>
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
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">PIN</label>
              <Input type="text" placeholder="Để trống → user tự set" value={formPin} onChange={(e) => setFormPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                maxLength={6} inputMode="numeric" />
              <p className="text-xs text-gray-400 mt-0.5">4-6 số. Để trống nếu muốn user tự đặt.</p>
            </div>
            {availableRoles.length > 1 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("role")}</label>
                <Select value={formRole} onValueChange={(v) => setFormRole(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {availableRoles.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {(formRole === "USER" || formRole === "MODERATOR") && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {formRole === "MODERATOR" ? "Khu vực quản lý" : t("user_allowed_modules")}
              </label>
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-2 text-sm font-medium text-blue-700">
                  <input type="checkbox" checked={formModules.length === availableModules.length}
                    onChange={() => setFormModules(formModules.length === availableModules.length ? [] : [...availableModules])}
                    className="rounded border-blue-400" />
                  Chọn tất cả
                </label>
                <span className="text-gray-300">|</span>
                {availableModules.map((mod) => (
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
              createUser.mutate({
                projectId: projectId!,
                username: formUsername,
                name: formName,
                password: formPassword,
                pin: formPin || undefined,
                role: formRole,
                allowedModules: formModules,
              });
            }} disabled={!formUsername || !formName || !formPassword || createUser.isLoading}>
              {createUser.isLoading ? t("creating") : t("user_create_user")}
            </Button>
            <Button variant="outline" onClick={resetForm}>{t("cancel")}</Button>
          </div>
          {createUser.error && <p className="text-sm text-red-600 mt-2">{createUser.error.message}</p>}
        </div>
      )}

      {/* Admin view: grouped by role */}
      {isAdmin && (
        <>
          {/* Admins */}
          {admins.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200">
              <div className="p-4 border-b border-gray-200 flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <h2 className="text-sm font-semibold text-gray-900">Admin ({admins.length})</h2>
              </div>
              <div className="divide-y divide-gray-100">
                {admins.map(renderMember)}
              </div>
            </div>
          )}

          {/* Moderators */}
          {moderators.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200">
              <div className="p-4 border-b border-gray-200 flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-blue-500" />
                <h2 className="text-sm font-semibold text-gray-900">Moderator ({moderators.length})</h2>
                <p className="text-xs text-gray-400 ml-2">Bật &ldquo;Quản lý user&rdquo; để moderator tạo &amp; quản lý nhóm</p>
              </div>
              <div className="divide-y divide-gray-100">
                {moderators.map(renderMember)}
              </div>
            </div>
          )}

          {/* Users - grouped by manager */}
          <div className="bg-white rounded-lg border border-gray-200">
            <div className="p-4 border-b border-gray-200 flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <h2 className="text-sm font-semibold text-gray-900">User ({users.length})</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {(() => {
                // Group users by manager
                const grouped: Record<string, any[]> = { __none__: [] };
                moderatorList.forEach((mod: any) => { grouped[mod.id] = []; });
                users.forEach((m: any) => {
                  const info = onlineMap.get(m.user.id);
                  const mgr = info?.managerId || "__none__";
                  if (!grouped[mgr]) grouped[mgr] = [];
                  grouped[mgr].push(m);
                });

                return (
                  <>
                    {moderatorList.map((mod: any) => {
                      const teamUsers = grouped[mod.id] || [];
                      if (teamUsers.length === 0) return null;
                      return (
                        <div key={mod.id}>
                          <div className="px-4 py-2 bg-purple-50 border-b border-purple-100">
                            <span className="text-xs font-bold text-purple-700">
                              Nhóm {mod.user.name || mod.user.username} ({teamUsers.length})
                            </span>
                          </div>
                          {teamUsers.map(renderMember)}
                        </div>
                      );
                    })}
                    {grouped.__none__.length > 0 && (
                      <div>
                        {moderatorList.length > 0 && (
                          <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                            <span className="text-xs font-bold text-gray-500">Chưa phân nhóm ({grouped.__none__.length})</span>
                          </div>
                        )}
                        {grouped.__none__.map(renderMember)}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </>
      )}

      {/* Moderator view: flat list of their team */}
      {isModerator && (
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">
              Nhóm của bạn ({visibleMembers.filter((m: any) => m.id !== currentMemberId).length})
            </h2>
          </div>
          <div className="divide-y divide-gray-100">
            {visibleMembers.filter((m: any) => m.id !== currentMemberId).map(renderMember)}
            {visibleMembers.filter((m: any) => m.id !== currentMemberId).length === 0 && (
              <div className="p-8 text-center text-gray-500">
                {canManageUsers ? "Chưa có thành viên. Tạo user mới để thêm vào nhóm." : "Bạn chưa được cấp quyền quản lý user."}
              </div>
            )}
          </div>
        </div>
      )}

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

      {/* AutoType Sessions Dialog */}
      <Dialog open={!!autotypeDialog} onOpenChange={(v) => { if (!v) setAutotypeDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>AutoType - {autotypeDialog?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            {autotypeDialog?.sessions && autotypeDialog.sessions.length > 0 ? (
              <>
                <p className="text-sm text-gray-500">
                  {autotypeDialog.sessions.length} thiết bị đang hoạt động
                </p>
                <div className="space-y-2">
                  {autotypeDialog.sessions.map((s: any) => (
                    <div key={s.deviceId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          <span className="text-sm font-medium">{s.deviceName || s.deviceId.slice(0, 16)}</span>
                        </div>
                        <p className="text-[11px] text-gray-400 ml-6">
                          Active: {new Date(s.lastActiveAt).toLocaleString("vi-VN")}
                        </p>
                      </div>
                      {(isAdmin || canManage) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600 hover:bg-red-50 text-xs h-7"
                          onClick={() => {
                            kickSession.mutate({
                              projectId: projectId!,
                              userId: autotypeDialog!.userId,
                              deviceId: s.deviceId,
                            });
                            setAutotypeDialog({
                              ...autotypeDialog!,
                              sessions: autotypeDialog!.sessions.filter((ss: any) => ss.deviceId !== s.deviceId),
                            });
                          }}
                          disabled={kickSession.isLoading}
                        >
                          Kick
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                {(isAdmin || canManage) && autotypeDialog.sessions.length > 1 && (
                  <Button
                    variant="outline"
                    className="w-full text-red-600 hover:bg-red-50"
                    onClick={() => {
                      kickAllSessions.mutate({
                        projectId: projectId!,
                        userId: autotypeDialog!.userId,
                      });
                      setAutotypeDialog({ ...autotypeDialog!, sessions: [] });
                    }}
                    disabled={kickAllSessions.isLoading}
                  >
                    Kick tất cả thiết bị
                  </Button>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-400 text-center py-4">Không có thiết bị nào đang hoạt động</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Project Assignment Dialog */}
      <Dialog open={!!projectDialog} onOpenChange={(v) => { if (!v) setProjectDialog(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Quản lý Projects — {projectDialog?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {/* Current projects */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Đang thuộc:</p>
              <div className="flex flex-wrap gap-2">
                {projectDialog?.memberships && projectDialog.memberships.length > 0 ? (
                  projectDialog.memberships.map((ms: any) => (
                    <div key={ms.project.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200">
                      <span className="text-sm font-medium text-blue-800">{ms.project.code || ms.project.name}</span>
                      <span className="text-[10px] text-blue-500">({ms.role})</span>
                      {ms.project.id !== projectId && (
                        <button
                          onClick={() => {
                            if (confirm(`Xóa ${projectDialog?.name} khỏi project ${ms.project.code}?`)) {
                              removeMember.mutate({
                                projectId: ms.project.id,
                                memberId: ms.id,
                              });
                              setProjectDialog({
                                ...projectDialog!,
                                memberships: projectDialog!.memberships.filter((m: any) => m.project.id !== ms.project.id),
                              });
                            }
                          }}
                          className="text-red-400 hover:text-red-600 ml-1"
                          title="Xóa khỏi project"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <span className="text-sm text-gray-400">Chưa thuộc project nào</span>
                )}
              </div>
            </div>

            {/* Add to project */}
            {allProjects && (() => {
              const currentProjectIds = (projectDialog?.memberships || []).map((m: any) => m.project.id);
              const available = allProjects.filter((p: any) => !currentProjectIds.includes(p.id));
              if (available.length === 0) return <p className="text-sm text-gray-400">Đã thuộc tất cả projects</p>;
              return (
                <div className="border-t pt-3">
                  <p className="text-sm font-medium text-gray-700 mb-2">Thêm vào project:</p>
                  <div className="space-y-2">
                    {available.map((p: any) => (
                      <div key={p.id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 border">
                        <span className="text-sm font-medium">{p.code || p.name}</span>
                        <div className="flex items-center gap-2">
                          <Select value={addProjectRole} onValueChange={(v) => setAddProjectRole(v as any)}>
                            <SelectTrigger className="w-28 h-7 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ADMIN">ADMIN</SelectItem>
                              <SelectItem value="MODERATOR">MODERATOR</SelectItem>
                              <SelectItem value="USER">USER</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => {
                              const user = allMembers.find((m: any) => m.user.id === projectDialog?.userId);
                              const email = user?.user?.email;
                              if (!email) { toast.error("User không có email"); return; }
                              addMember.mutate({
                                projectId: p.id,
                                email,
                                role: addProjectRole,
                                allowedModules: addProjectModules,
                              });
                              setProjectDialog({
                                ...projectDialog!,
                                memberships: [
                                  ...projectDialog!.memberships,
                                  { id: "new", project: p, role: addProjectRole },
                                ],
                              });
                            }}
                            disabled={addMember.isLoading}
                          >
                            Thêm
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2">
                    <p className="text-xs text-gray-500 mb-1">Modules mặc định:</p>
                    <div className="flex flex-wrap gap-2">
                      {APP_MODULES.map((mod) => (
                        <label key={mod} className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={addProjectModules.includes(mod)}
                            onChange={() => toggleModule(mod, addProjectModules, setAddProjectModules)}
                            className="rounded border-gray-300"
                          />
                          {mod}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
