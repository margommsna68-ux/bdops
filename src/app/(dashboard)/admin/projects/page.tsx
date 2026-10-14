"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import toast from "react-hot-toast";
import { useT } from "@/lib/i18n";

export default function AdminProjectsPage() {
  const t = useT();
  const router = useRouter();
  const { currentRole, currentProjectId, setCurrentProject } = useProjectStore();
  const noProject = !currentProjectId;
  const isAdmin = currentRole === "ADMIN" || noProject; // allow when no projects exist

  const [showCreate, setShowCreate] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newType, setNewType] = useState<"FULL" | "PAYPAL_ONLY">("FULL");

  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; code: string; name: string } | null>(null);
  const [deleteInput, setDeleteInput] = useState("");
  const [wipeConfirm, setWipeConfirm] = useState<{ id: string; code: string; name: string } | null>(null);
  const [wipeInput, setWipeInput] = useState("");

  const [addMemberFor, setAddMemberFor] = useState<{ id: string; code: string } | null>(null);
  const [addRole, setAddRole] = useState<"ADMIN" | "MODERATOR" | "USER">("USER");

  // Edit project
  const [editProject, setEditProject] = useState<any>(null);
  const [editPName, setEditPName] = useState("");
  const [editPDesc, setEditPDesc] = useState("");
  const [editPType, setEditPType] = useState<"FULL" | "PAYPAL_ONLY">("FULL");
  const [editPPrefix, setEditPPrefix] = useState("");
  const [editUserWins, setEditUserWins] = useState<string[]>([]);

  const updateProject = trpc.project.update.useMutation({
    onSuccess: () => { refetch(); setEditProject(null); toast.success(t("admin_project_updated")); },
    onError: (e) => toast.error(e.message),
  });

  const { data: projects, isLoading, refetch } = trpc.project.listAll.useQuery();
  const { data: allUsers } = trpc.project.allSystemUsers.useQuery(undefined, { enabled: isAdmin });

  const addMember = trpc.project.addMember.useMutation({
    onSuccess: () => { refetch(); toast.success(t("admin_member_added")); },
    onError: (e) => toast.error(e.message),
  });

  const createProject = trpc.project.create.useMutation({
    onSuccess: (p) => {
      refetch();
      setShowCreate(false);
      setNewCode("");
      setNewName("");
      setNewDesc("");
      toast.success(`Tạo dự án ${p.code} thành công`);
      setCurrentProject(p.id, p.code, p.name, p.type || "FULL", "ADMIN", [], false);
    },
    onError: (e) => toast.error(e.message),
  });

  const wipeProject = trpc.project.wipeProjectData.useMutation({
    onSuccess: (res: any) => {
      refetch();
      setWipeConfirm(null);
      setWipeInput("");
      toast.success(`Đã xóa toàn bộ dữ liệu của ${res.code}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteProject = trpc.project.deleteProject.useMutation({
    onSuccess: (res) => {
      refetch();
      setDeleteConfirm(null);
      setDeleteInput("");
      toast.success(`Đã xóa dự án ${res.code} và toàn bộ dữ liệu`);
    },
    onError: (e) => toast.error(e.message),
  });

  // User Win management (shared across all projects)
  const [showUserWin, setShowUserWin] = useState(false);
  const [userWinList, setUserWinList] = useState<string[]>([]);
  const [newUW, setNewUW] = useState("");
  const [uwLoaded, setUwLoaded] = useState(false);

  const DEFAULTS_UW = [...Array.from({ length: 19 }, (_, i) => `PP${String(i + 1).padStart(2, "0")}`), "UNDETECTABLE", "MULTILOGIN"];

  // Load from first project's settings — if empty, use defaults
  useEffect(() => {
    if (projects && projects.length > 0 && !uwLoaded) {
      const settings = (projects[0] as any).settings;
      const saved = settings?.userWinList;
      setUserWinList(saved && saved.length > 0 ? saved : DEFAULTS_UW);
      setUwLoaded(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, uwLoaded]);

  const saveUserWinList = async (list: string[]) => {
    setUserWinList(list);
    // Save to ALL projects
    if (!projects) return;
    for (const p of projects) {
      const settings = { ...((p as any).settings || {}), userWinList: list };
      try { await updateProject.mutateAsync({ projectId: p.id, settings }); } catch {}
    }
    toast.success(t("admin_userwin_saved"));
  };

  if (!isAdmin) return <p className="text-gray-500 p-8">Chỉ ADMIN mới truy cập được trang này.</p>;
  if (isLoading) return <p className="p-8">Loading...</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quản lý Dự Án</h1>
          <p className="text-gray-500 text-sm">Tạo, xem và xóa project. Xóa project sẽ xóa toàn bộ dữ liệu liên quan.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowUserWin(!showUserWin)}
            className={showUserWin ? "bg-gray-900 text-white border-gray-900" : ""}>
            User Win
          </Button>
          <Button onClick={() => setShowCreate(true)}>+ Tạo dự án mới</Button>
        </div>
      </div>

      {/* User Win Management */}
      {showUserWin && (
        <div className="bg-white rounded-lg border p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">Quản lý User Win</h2>
              <p className="text-xs text-gray-400">Click ✕ để xóa, click tên để đổi tên. Áp dụng cho tất cả project.</p>
            </div>
            <button onClick={() => {
              const defaults = [...Array.from({ length: 19 }, (_, i) => `PP${String(i + 1).padStart(2, "0")}`), "UNDETECTABLE", "MULTILOGIN"];
              saveUserWinList(defaults);
            }} className="text-[10px] text-blue-600 hover:underline">Reset mặc định</button>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {userWinList.length === 0 ? (
              <p className="text-xs text-gray-400">Chưa có User Win nào</p>
            ) : userWinList.map((uw, i) => (
              <span key={i} className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 text-xs font-semibold px-2.5 py-1 rounded-full group">
                <span className="cursor-pointer hover:underline" onClick={() => {
                  const newName = prompt(`Đổi tên "${uw}" thành:`, uw);
                  if (newName && newName.trim() && newName.trim() !== uw) {
                    saveUserWinList(userWinList.map((v, j) => j === i ? newName.trim().toUpperCase() : v));
                  }
                }}>{uw}</span>
                <button onClick={() => saveUserWinList(userWinList.filter((_, j) => j !== i))} className="text-blue-400 hover:text-red-500 ml-0.5">&times;</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input value={newUW} onChange={(e) => setNewUW(e.target.value.toUpperCase())}
              placeholder="Tên mới, VD: ADSPOWER, GOLOGIN..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && newUW.trim() && !userWinList.includes(newUW.trim())) {
                  saveUserWinList([...userWinList, newUW.trim()]);
                  setNewUW("");
                }
              }}
              className="h-9 flex-1" />
            <Button disabled={!newUW.trim() || userWinList.includes(newUW.trim())}
              onClick={() => { saveUserWinList([...userWinList, newUW.trim()]); setNewUW(""); }}>
              Thêm
            </Button>
          </div>
        </div>
      )}

      {/* Projects List */}
      <div className="grid gap-4">
        {projects?.map((p: any) => (
          <div key={p.id} className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-bold text-gray-900">{p.code}</h2>
                  <span className="text-gray-500">—</span>
                  <span className="text-gray-700">{p.name}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${(p as any).type === "PAYPAL_ONLY" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                    {(p as any).type === "PAYPAL_ONLY" ? "PayPal Only" : "Full"}
                  </span>
                </div>
                {p.description && <p className="text-sm text-gray-500 mt-1">{p.description}</p>}
                <p className="text-[10px] text-gray-400 mt-1">
                  ID: {p.id} | Tạo: {new Date(p.createdAt).toLocaleDateString("vi-VN")}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="text-blue-600 hover:bg-blue-50 border-blue-200"
                  onClick={() => {
                    setEditProject(p);
                    setEditPName(p.name);
                    setEditPDesc(p.description || "");
                    setEditPType((p as any).type || "FULL");
                    setEditPPrefix(((p as any).settings as any)?.ppPrefix || p.code);
                    setEditUserWins(((p as any).settings as any)?.userWinList ?? []);
                  }}>
                  Sửa
                </Button>
                <Button
                  variant="outline"
                  className="text-orange-600 hover:bg-orange-50 border-orange-200"
                  onClick={() => setWipeConfirm({ id: p.id, code: p.code, name: p.name })}
                >
                  Xóa dữ liệu
                </Button>
                <Button
                  variant="outline"
                  className="text-red-600 hover:bg-red-50 border-red-200"
                  onClick={() => setDeleteConfirm({ id: p.id, code: p.code, name: p.name })}
                >
                  Xóa dự án
                </Button>
              </div>
            </div>

            {/* Quick Nav Stats — click to navigate */}
            <div className="flex flex-wrap gap-2 mt-4">
              {([
                ["Members", p._count.members, "bg-blue-50 text-blue-700 hover:bg-blue-100", "/admin/users"],
                ["PayPals", p._count.paypalAccounts, "bg-green-50 text-green-700 hover:bg-green-100", "/paypals"],
                ["Funds", p._count.fundTransactions, "bg-emerald-50 text-emerald-700 hover:bg-emerald-100", "/funds"],
                ["Withdrawals", p._count.withdrawals, "bg-orange-50 text-orange-700 hover:bg-orange-100", "/withdrawals"],
                ["Servers", p._count.servers, "bg-gray-100 text-gray-700 hover:bg-gray-200", "/infrastructure/servers"],
                ["Costs", p._count.costRecords, "bg-red-50 text-red-700 hover:bg-red-100", "/costs"],
                ["Gmails", p._count.gmailAccounts, "bg-purple-50 text-purple-700 hover:bg-purple-100", "/gmails"],
                ["Proxies", p._count.proxyIPs, "bg-indigo-50 text-indigo-700 hover:bg-indigo-100", "/infrastructure/proxies"],
              ] as [string, number, string, string][]).map(([label, count, cls, href]) => (
                <button key={label} onClick={() => {
                  // Switch to this project then navigate
                  const membership = (p as any).members?.[0];
                  setCurrentProject(p.id, p.code, p.name, (p as any).type || "FULL", membership?.role || "ADMIN", membership?.allowedModules || [], membership?.canManageUsers || false, membership?.id);
                  router.push(href);
                }} className={`px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${cls}`}>
                  <span className="text-xs font-medium">{label} </span>
                  <span className="text-sm font-bold">{count}</span>
                </button>
              ))}
            </div>

            {/* Members */}
            {(p as any).members && (p as any).members.length > 0 && (
              <div className="mt-4 pt-3 border-t">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Thành viên ({(p as any).members.length})</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setAddMemberFor({ id: p.id, code: p.code })}
                      className="text-[10px] text-green-600 hover:text-green-800 font-semibold">+ Thêm nhanh</button>
                    <button onClick={() => {
                      const membership = (p as any).members?.[0];
                      setCurrentProject(p.id, p.code, p.name, (p as any).type || "FULL", membership?.role || "ADMIN", membership?.allowedModules || [], false, membership?.id);
                      router.push("/admin/users");
                    }} className="text-[10px] text-blue-600 hover:text-blue-800 font-medium">Quản lý →</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(p as any).members.map((m: any) => (
                    <div key={m.id} className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 border rounded-lg">
                      <div className={`w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-bold ${
                        m.role === "ADMIN" ? "bg-red-100 text-red-700" : m.role === "MODERATOR" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
                      }`}>{m.user?.name?.charAt(0) || m.user?.username?.charAt(0) || "?"}</div>
                      <span className="text-xs font-medium text-gray-700">{m.user?.name || m.user?.username}</span>
                      <span className={`text-[8px] font-bold px-1 py-0.5 rounded ${
                        m.role === "ADMIN" ? "bg-red-100 text-red-600" : m.role === "MODERATOR" ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-500"
                      }`}>{m.role}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}

        {(!projects || projects.length === 0) && (
          <div className="text-center py-12 text-gray-400">
            Chưa có dự án nào. Tạo dự án mới để bắt đầu.
          </div>
        )}
      </div>

      {/* Create Project Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tạo dự án mới</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mã dự án</label>
              <Input
                placeholder="VD: AE, DN, BD..."
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))}
                maxLength={10}
              />
              <p className="text-xs text-gray-400 mt-0.5">Tối đa 10 ký tự, viết hoa</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tên dự án</label>
              <Input placeholder="VD: Bright Data AE" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Loại dự án</label>
              <select value={newType} onChange={(e) => setNewType(e.target.value as any)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="FULL">Full (VMs + PayPal + Infrastructure)</option>
                <option value="PAYPAL_ONLY">PayPal Only (chỉ quản lý PayPal)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mô tả (tùy chọn)</label>
              <Input placeholder="Mô tả ngắn về dự án" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Hủy</Button>
              <Button
                onClick={() => {
                  if (!newCode || !newName) return;
                  createProject.mutate({ name: newName, code: newCode, type: newType, description: newDesc || undefined });
                }}
                disabled={!newCode || !newName || createProject.isLoading}
              >
                {createProject.isLoading ? "Đang tạo..." : "Tạo dự án"}
              </Button>
            </div>
            {createProject.error && <p className="text-sm text-red-600">{createProject.error.message}</p>}
          </div>
        </DialogContent>
      </Dialog>

      {/* Wipe Data Dialog */}
      <Dialog open={!!wipeConfirm} onOpenChange={(v) => { if (!v) { setWipeConfirm(null); setWipeInput(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-orange-600">Xóa dữ liệu {wipeConfirm?.code}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <p className="text-sm text-orange-800 font-medium">Xóa toàn bộ dữ liệu nhưng GIỮ LẠI project + members:</p>
              <ul className="text-sm text-orange-700 mt-2 space-y-1 list-disc pl-5">
                <li>PayPal accounts + emails</li>
                <li>Fund transactions + Withdrawals</li>
                <li>Servers, VMs, Proxies, Gmails</li>
                <li>Costs, Profit, Partners</li>
                <li>Audit logs, Delete requests</li>
              </ul>
              <p className="text-sm text-orange-900 font-bold mt-3">Project và thành viên được giữ lại.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Gõ <span className="font-mono font-bold text-orange-600">{wipeConfirm?.code}</span> để xác nhận
              </label>
              <Input value={wipeInput} onChange={(e) => setWipeInput(e.target.value)} placeholder={wipeConfirm?.code} className="font-mono" autoFocus />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setWipeConfirm(null); setWipeInput(""); }}>Hủy</Button>
              <Button
                className="bg-orange-600 hover:bg-orange-700 text-white"
                disabled={wipeInput !== wipeConfirm?.code || wipeProject.isLoading}
                onClick={() => { if (wipeConfirm && wipeInput === wipeConfirm.code) wipeProject.mutate({ projectId: wipeConfirm.id }); }}
              >
                {wipeProject.isLoading ? "Đang xóa..." : "Xóa dữ liệu"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={(v) => { if (!v) { setDeleteConfirm(null); setDeleteInput(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-600">Xóa dự án {deleteConfirm?.code}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-800 font-medium">Hành động này sẽ xóa VĨNH VIỄN:</p>
              <ul className="text-sm text-red-700 mt-2 space-y-1 list-disc pl-5">
                <li>Toàn bộ PayPal accounts + emails</li>
                <li>Toàn bộ Fund transactions + Withdrawals</li>
                <li>Toàn bộ Servers, VMs, Proxies, Gmails</li>
                <li>Toàn bộ Costs, Profit, Partners</li>
                <li>Toàn bộ Members, Audit logs</li>
                <li>Project và tất cả cấu hình</li>
              </ul>
              <p className="text-sm text-red-900 font-bold mt-3">KHÔNG THỂ hoàn tác!</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Gõ <span className="font-mono font-bold text-red-600">{deleteConfirm?.code}</span> để xác nhận xóa
              </label>
              <Input
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder={deleteConfirm?.code}
                className="font-mono"
                autoFocus
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setDeleteConfirm(null); setDeleteInput(""); }}>Hủy</Button>
              <Button
                variant="destructive"
                disabled={deleteInput !== deleteConfirm?.code || deleteProject.isLoading}
                onClick={() => {
                  if (deleteConfirm && deleteInput === deleteConfirm.code) {
                    deleteProject.mutate({ projectId: deleteConfirm.id });
                  }
                }}
              >
                {deleteProject.isLoading ? "Đang xóa..." : "Xóa vĩnh viễn"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Project Dialog */}
      <Dialog open={!!editProject} onOpenChange={(v) => { if (!v) setEditProject(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sửa dự án {editProject?.code}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tên dự án</label>
              <Input value={editPName} onChange={(e) => setEditPName(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Loại dự án</label>
              <select value={editPType} onChange={(e) => setEditPType(e.target.value as any)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="FULL">Full (VMs + PayPal + Infrastructure)</option>
                <option value="PAYPAL_ONLY">PayPal Only</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">PP Code Prefix</label>
              <Input value={editPPrefix} onChange={(e) => setEditPPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
                placeholder="VD: AE, PP, DN..." />
              <p className="text-xs text-gray-400 mt-0.5">Mã PP tự sinh sẽ theo prefix này: {editPPrefix}-001, {editPPrefix}-002...</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mô tả</label>
              <Input value={editPDesc} onChange={(e) => setEditPDesc(e.target.value)} placeholder="Mô tả project" />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setEditProject(null)}>Hủy</Button>
              <Button onClick={() => {
                if (!editProject) return;
                const settings = { ...((editProject as any).settings || {}), ppPrefix: editPPrefix || editProject.code, userWinList: editUserWins };
                updateProject.mutate({
                  projectId: editProject.id,
                  name: editPName,
                  type: editPType,
                  description: editPDesc || undefined,
                  settings,
                });
              }} disabled={updateProject.isLoading}>
                {updateProject.isLoading ? "Đang lưu..." : "Lưu"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Quick Add Member Dialog */}
      {addMemberFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setAddMemberFor(null)}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-900">Thêm thành viên vào {addMemberFor.code}</h3>
                <p className="text-[10px] text-gray-400">Chọn user có sẵn trong hệ thống</p>
              </div>
              <div className="flex items-center gap-2">
                <select value={addRole} onChange={(e) => setAddRole(e.target.value as any)}
                  className="text-xs border rounded px-2 py-1">
                  <option value="ADMIN">ADMIN</option>
                  <option value="MODERATOR">MODERATOR</option>
                  <option value="USER">USER</option>
                </select>
                <button onClick={() => setAddMemberFor(null)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            <div className="overflow-y-auto max-h-[60vh] divide-y">
              {(() => {
                // Get current project members IDs
                const currentProject = projects?.find((pr: any) => pr.id === addMemberFor.id);
                const existingIds = new Set(((currentProject as any)?.members || []).map((m: any) => m.user?.id));
                const availableUsers = (allUsers || []).filter((u: any) => !existingIds.has(u.id));

                if (availableUsers.length === 0) {
                  return <p className="px-4 py-8 text-center text-sm text-gray-400">Tất cả user đã thuộc project này</p>;
                }

                return availableUsers.map((u: any) => {
                  // Show which projects this user belongs to
                  const otherProjects = (u.memberships || [])
                    .filter((m: any) => m.projectId !== addMemberFor.id)
                    .map((m: any) => {
                      const proj = projects?.find((pr: any) => pr.id === m.projectId);
                      return proj ? `${(proj as any).code} (${m.role})` : m.role;
                    });

                  return (
                    <div key={u.id} className="px-4 py-3 flex items-center justify-between hover:bg-gray-50">
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">
                            {(u.name || u.username || "?").charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-gray-800">{u.name || u.username}</p>
                            <p className="text-[10px] text-gray-400">{u.email}</p>
                          </div>
                        </div>
                        {otherProjects.length > 0 && (
                          <div className="flex gap-1 mt-1 ml-9">
                            {otherProjects.map((op: string, i: number) => (
                              <span key={i} className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{op}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => addMember.mutate({ projectId: addMemberFor.id, email: u.email, role: addRole, allowedModules: [] })}
                        disabled={addMember.isLoading}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50 shrink-0">
                        + Thêm
                      </button>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
