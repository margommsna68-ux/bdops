"use client";

import { useState } from "react";
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

export default function AdminProjectsPage() {
  const { currentRole, setCurrentProject } = useProjectStore();
  const isAdmin = currentRole === "ADMIN";

  const [showCreate, setShowCreate] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; code: string; name: string } | null>(null);
  const [deleteInput, setDeleteInput] = useState("");
  const [wipeConfirm, setWipeConfirm] = useState<{ id: string; code: string; name: string } | null>(null);
  const [wipeInput, setWipeInput] = useState("");

  const { data: projects, isLoading, refetch } = trpc.project.listAll.useQuery();

  const createProject = trpc.project.create.useMutation({
    onSuccess: (p) => {
      refetch();
      setShowCreate(false);
      setNewCode("");
      setNewName("");
      setNewDesc("");
      toast.success(`Tạo dự án ${p.code} thành công`);
      setCurrentProject(p.id, p.code, p.name, "ADMIN", [], false);
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

  if (!isAdmin) return <p className="text-gray-500 p-8">Chỉ ADMIN mới truy cập được trang này.</p>;
  if (isLoading) return <p className="p-8">Loading...</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quản lý Dự Án</h1>
          <p className="text-gray-500 text-sm">Tạo, xem và xóa project. Xóa project sẽ xóa toàn bộ dữ liệu liên quan.</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>+ Tạo dự án mới</Button>
      </div>

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
                </div>
                {p.description && <p className="text-sm text-gray-500 mt-1">{p.description}</p>}
                <p className="text-[10px] text-gray-400 mt-1">
                  ID: {p.id} | Tạo: {new Date(p.createdAt).toLocaleDateString("vi-VN")}
                </p>
              </div>
              <div className="flex gap-2">
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

            {/* Stats */}
            <div className="flex flex-wrap gap-3 mt-4">
              {([
                ["Members", p._count.members, "bg-blue-50 text-blue-700"],
                ["Servers", p._count.servers, "bg-gray-50 text-gray-700"],
                ["PayPals", p._count.paypalAccounts, "bg-green-50 text-green-700"],
                ["Funds", p._count.fundTransactions, "bg-emerald-50 text-emerald-700"],
                ["Withdrawals", p._count.withdrawals, "bg-orange-50 text-orange-700"],
                ["Costs", p._count.costRecords, "bg-red-50 text-red-700"],
                ["Gmails", p._count.gmailAccounts, "bg-purple-50 text-purple-700"],
                ["Proxies", p._count.proxyIPs, "bg-indigo-50 text-indigo-700"],
              ] as [string, number, string][]).map(([label, count, cls]) => (
                <div key={label} className={`px-3 py-1.5 rounded-lg border ${cls}`}>
                  <span className="text-xs font-medium">{label}: </span>
                  <span className="text-sm font-bold">{count}</span>
                </div>
              ))}
            </div>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Mô tả (tùy chọn)</label>
              <Input placeholder="Mô tả ngắn về dự án" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Hủy</Button>
              <Button
                onClick={() => {
                  if (!newCode || !newName) return;
                  createProject.mutate({ name: newName, code: newCode, description: newDesc || undefined });
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
    </div>
  );
}
