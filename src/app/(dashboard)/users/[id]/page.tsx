"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
// import { trpcVanilla } from "@/lib/trpc-vanilla";
import { useProjectStore } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { formatCurrency } from "@/lib/utils";
import toast from "react-hot-toast";

const ROLE_COLORS: Record<string, string> = {
  ADMIN: "bg-red-100 text-red-800", MODERATOR: "bg-blue-100 text-blue-800", USER: "bg-green-100 text-green-800",
};
const APP_MODULES = ["FUNDS", "WITHDRAWALS", "PAYPALS", "INFRASTRUCTURE", "COSTS", "PROFIT", "AGENT_PP", "AUTOTYPE"] as const;
const MODULE_LABEL_KEYS: Record<string, string> = {
  FUNDS: "admin_module_funds",
  WITHDRAWALS: "admin_module_withdrawals",
  PAYPALS: "admin_module_paypals",
  INFRASTRUCTURE: "admin_module_infrastructure",
  COSTS: "admin_module_costs",
  PROFIT: "admin_module_profit",
  AGENT_PP: "admin_module_agent_pp",
  AUTOTYPE: "admin_module_autotype",
};

export default function UserDetailPage() {
  const params = useParams();
  const t = useT();
  const storeProjectId = useProjectStore((s) => s.currentProjectId);
  const currentRole = useProjectStore((s) => s.currentRole);
  const isAdmin = currentRole === "ADMIN";
  const userId = params.id as string;

  // Local project selection — admin can switch project to see user's data in different projects
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const projectId = selectedProjectId ?? storeProjectId;

  const { data, isLoading, refetch } = trpc.user.getDetail.useQuery(
    { projectId: projectId!, userId },
    { enabled: !!projectId && !!userId }
  );

  // Edit states
  const [editRole, setEditRole] = useState("");
  const [editModules, setEditModules] = useState<string[]>([]);
  const [editFee, setEditFee] = useState("");
  const [editDevices, setEditDevices] = useState("");
  const [newAgentEmail, setNewAgentEmail] = useState("");
  const [dirty, setDirty] = useState(false);

  // Sync from data
  useEffect(() => {
    if (data?.membership) {
      setEditRole(data.membership.role);
      setEditModules(data.membership.allowedModules ?? []);
      setEditFee(data.membership.agentFeePercent != null ? String(Number(data.membership.agentFeePercent)) : "3");
      setEditDevices(String(data.membership.maxAutotypeDevices ?? 2));
      setDirty(false);
    }
  }, [data?.membership]);

  const updateMember = trpc.project.updateMember.useMutation({
    onSuccess: () => { refetch(); setDirty(false); toast.success(t("toast_updated")); },
    onError: (e) => toast.error(e.message),
  });
  const resetPin = trpc.user.resetPin.useMutation({
    onSuccess: () => { refetch(); toast.success(t("admin_pin_reset")); },
    onError: (e) => toast.error(e.message),
  });
  const resetPassword = trpc.user.resetPassword.useMutation({
    onSuccess: (res: any) => { refetch(); toast.success(t("admin_password_reset", { pw: res.newPassword })); },
    onError: (e) => toast.error(e.message),
  });
  const addAgentEmail = trpc.agentPP.adminAddEmail.useMutation({
    onSuccess: () => { refetch(); setNewAgentEmail(""); toast.success(t("user_email_added")); },
    onError: (e) => toast.error(e.message),
  });
  const removeAgentEmail = trpc.agentPP.adminRemoveEmail.useMutation({
    onSuccess: () => { refetch(); toast.success(t("toast_deleted")); },
    onError: (e) => toast.error(e.message),
  });

  const saveConfig = () => {
    if (!data?.membership || !projectId) return;
    updateMember.mutate({
      projectId,
      memberId: data.membership.id,
      role: editRole as any,
      allowedModules: editModules as any,
      agentFeePercent: editFee !== "" ? parseFloat(editFee) : 3,
      maxAutotypeDevices: parseInt(editDevices) || 2,
    });
  };

  const toggleModule = (mod: string) => {
    setEditModules((prev) => prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod]);
    setDirty(true);
  };

  if (!projectId) return <p className="text-gray-500 p-8">{t("select_project_first")}</p>;
  if (isLoading) return <p className="p-8 text-gray-400">{t("loading_dots")}</p>;
  if (!data) return <p className="p-8">{t("user_not_found")}</p>;

  const { user, membership, agentEmails, agentSales, agentStats, sessions, editHistory } = data;
  const collectorExpenses = (data as any).collectorExpenses ?? [];
  const agentWithdrawals = (data as any).agentWithdrawals ?? [];
  const hasAgent = editRole === "ADMIN" || editModules.includes("AGENT_PP");
  const hasAutotype = editRole === "ADMIN" || editModules.includes("AUTOTYPE");

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-500">
        <Link href="/admin/users" className="hover:text-blue-600">{t("user_manage_users_link")}</Link>
        <span>/</span>
        <span className="font-medium text-gray-900">{user.name || user.username}</span>
      </nav>

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-xl font-bold">
          {(user.name || user.username || "?").charAt(0).toUpperCase()}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{user.name || user.username}</h1>
          <p className="text-sm text-gray-500">{user.email} • @{user.username}</p>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {/* Project selector — pill buttons, click to switch */}
          {user.memberships && user.memberships.length > 0 && (
            <div className="flex gap-1.5 items-center">
              {user.memberships.map((m: any) => {
                const active = projectId === m.projectId;
                return (
                  <button
                    key={m.projectId}
                    onClick={() => setSelectedProjectId(m.projectId)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      active
                        ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                        : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300"
                    }`}
                    title={m.project.name}
                  >
                    {m.project.code}
                  </button>
                );
              })}
            </div>
          )}
          {membership && <Badge className={ROLE_COLORS[membership.role]}>{membership.role}</Badge>}
          <Badge variant="outline">{user.hasPin ? "PIN ✓" : t("user_no_pin_badge")}</Badge>
        </div>
      </div>

      {/* ═══ Config Section ═══ */}
      <div className="bg-white rounded-lg border p-5 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800">{t("user_permission_config")}</h2>
          {dirty && (
            <Button size="sm" onClick={saveConfig} disabled={updateMember.isLoading}
              className="bg-green-600 hover:bg-green-700 h-7 px-4 text-xs">
              {updateMember.isLoading ? t("saving_dots") : t("user_save_changes")}
            </Button>
          )}
        </div>

        {/* Role */}
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1.5">Vai trò</label>
          <div className="flex gap-2">
            {(["ADMIN", "MODERATOR", "USER"] as const).map((r) => (
              <button key={r} onClick={() => { setEditRole(r); setDirty(true); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${editRole === r ? ROLE_COLORS[r] + " border-current" : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"}`}>
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Modules */}
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1.5">Modules</label>
          {editRole === "ADMIN" ? (
            <p className="text-xs text-gray-400">Admin có tất cả modules</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {APP_MODULES.map((mod) => (
                <button key={mod} onClick={() => toggleModule(mod)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${editModules.includes(mod) ? "bg-blue-100 text-blue-700 border-blue-300" : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"}`}>
                  {t(MODULE_LABEL_KEYS[mod] || mod)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        {isAdmin && (
          <div className="flex gap-2 pt-3 border-t">
            <Button variant="outline" size="sm" className="text-xs h-7 border-orange-300 text-orange-600 hover:bg-orange-50"
              onClick={() => { if (confirm("Reset PIN?")) resetPin.mutate({ projectId: projectId!, userId: user.id }); }}>
              Reset PIN
            </Button>
            <Button variant="outline" size="sm" className="text-xs h-7 border-red-300 text-red-600 hover:bg-red-50"
              onClick={() => { if (confirm("Reset mật khẩu? Mật khẩu mới sẽ được hiện lên.")) resetPassword.mutate({ projectId: projectId!, userId: user.id }); }}>
              Reset Password
            </Button>
          </div>
        )}
      </div>

      {/* ═══ Agent PP Section ═══ */}
      {hasAgent && (
        <div className="bg-white rounded-lg border p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">PayPal Gộp</h2>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-500">Agent Fee</label>
              <Input type="number" min="0" max="100" step="0.1" value={editFee}
                onChange={(e) => { setEditFee(e.target.value); setDirty(true); }}
                className="w-16 h-7 text-xs text-center" />
              <span className="text-xs text-gray-400">%</span>
            </div>
          </div>
          {/* Stats */}
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-purple-50 rounded-lg p-3 text-center">
              <div className="text-[10px] text-purple-600 uppercase">Tổng hoa hồng</div>
              <div className="text-lg font-bold text-purple-700">{formatCurrency(agentStats.totalEarning)}</div>
            </div>
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <div className="text-[10px] text-green-600 uppercase">Đã rút</div>
              <div className="text-lg font-bold text-green-700">{formatCurrency(agentStats.totalWithdrawn)}</div>
            </div>
            <div className="bg-amber-50 rounded-lg p-3 text-center">
              <div className="text-[10px] text-amber-600 uppercase">Chờ rút</div>
              <div className="text-lg font-bold text-amber-700">{formatCurrency(agentStats.pending)}</div>
            </div>
            <div className="bg-orange-50 rounded-lg p-3 text-center">
              <div className="text-[10px] text-orange-600 uppercase">Tổng bán</div>
              <div className="text-lg font-bold text-orange-700">{formatCurrency(agentStats.totalSold)}</div>
            </div>
          </div>

          {/* Emails & Links */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-500">Email & Link nhận tiền</span>
            </div>
            <div className="space-y-1">
              {agentEmails.map((ae: any) => {
                const isLink = ae.email.startsWith("http");
                return (
                  <div key={ae.id} className="flex items-center justify-between py-1 px-2 rounded hover:bg-gray-50 -mx-2 group">
                    <div className="flex items-center gap-2 text-xs min-w-0">
                      {isLink ? (
                        <><svg className="w-3 h-3 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                        <a href={ae.email} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate">{ae.email}</a></>
                      ) : (
                        <><svg className="w-3 h-3 text-orange-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                        <span className="font-mono text-gray-700 truncate">{ae.email}</span></>
                      )}
                    </div>
                    <button onClick={() => removeAgentEmail.mutate({ projectId: projectId!, id: ae.id })}
                      className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 shrink-0">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 mt-2">
              <Input value={newAgentEmail} onChange={(e) => setNewAgentEmail(e.target.value)}
                placeholder="email hoặc https://..." className="h-8 text-xs flex-1"
                onKeyDown={(e) => { if (e.key === "Enter" && newAgentEmail.trim()) addAgentEmail.mutate({ projectId: projectId!, userId, email: newAgentEmail.trim() }); }} />
              <Button size="sm" className="h-8 text-xs px-3" disabled={!newAgentEmail.trim()}
                onClick={() => addAgentEmail.mutate({ projectId: projectId!, userId, email: newAgentEmail.trim() })}>Thêm</Button>
            </div>
          </div>

          {/* Sales table */}
          {agentSales.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 border-b text-xs font-semibold text-gray-600">Giao dịch ({agentSales.length})</div>
              <div className="overflow-auto max-h-[250px]">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-1.5 text-left text-gray-500">Ngày</th>
                      <th className="px-3 py-1.5 text-right text-gray-500">Số tiền</th>
                      <th className="px-3 py-1.5 text-center text-gray-500">Fee%</th>
                      <th className="px-3 py-1.5 text-right text-gray-500">Hoa hồng</th>
                      <th className="px-3 py-1.5 text-left text-gray-500">Mã GD</th>
                      <th className="px-3 py-1.5 text-center text-gray-500">Rút</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {agentSales.map((s: any) => (
                      <tr key={s.id} className="hover:bg-gray-50">
                        <td className="px-3 py-1.5 text-gray-600">{new Date(s.date).toLocaleDateString("vi-VN")}</td>
                        <td className="px-3 py-1.5 text-right font-semibold text-orange-700">{formatCurrency(Number(s.amount))}</td>
                        <td className="px-3 py-1.5 text-center text-gray-500">{s.feePercent != null ? `${Number(s.feePercent)}%` : "—"}</td>
                        <td className="px-3 py-1.5 text-right font-semibold text-purple-700">{s.agentEarning ? formatCurrency(Number(s.agentEarning)) : "—"}</td>
                        <td className="px-3 py-1.5 font-mono text-gray-400">{s.transactionId}</td>
                        <td className="px-3 py-1.5 text-center">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${s.withdrawn ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                            {s.withdrawn ? "Đã rút" : "Chờ"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ Admin: Collector Withdrawals (PP Fee) ═══ */}
      {isAdmin && hasAgent && agentWithdrawals.length > 0 && (
        <AdminWithdrawalsSection
          projectId={projectId!}
          withdrawals={agentWithdrawals}
          onChange={refetch}
        />
      )}

      {/* ═══ Admin: Collector Expenses ═══ */}
      {isAdmin && hasAgent && collectorExpenses.length > 0 && (
        <AdminExpensesSection
          projectId={projectId!}
          expenses={collectorExpenses}
          onChange={refetch}
        />
      )}

      {/* ═══ AutoType Section ═══ */}
      {hasAutotype && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">AutoType{sessions.length > 0 ? ` — Sessions (${sessions.length})` : ""}</h2>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-500">Max devices</label>
              <Input type="number" min="0" max="999" value={editDevices}
                onChange={(e) => { setEditDevices(e.target.value); setDirty(true); }}
                className="w-16 h-7 text-xs text-center" />
              <span className="text-xs text-gray-400">(0 = ∞)</span>
            </div>
          </div>
          {sessions.length > 0 ? (
            <div className="overflow-auto max-h-[200px]">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-gray-500">Device</th>
                    <th className="px-3 py-2 text-left text-gray-500">IP</th>
                    <th className="px-3 py-2 text-left text-gray-500">Lần cuối</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sessions.map((s: any) => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-gray-700">{s.deviceId?.slice(0, 12) || "—"}</td>
                      <td className="px-3 py-2 text-gray-500">{s.ip || "—"}</td>
                      <td className="px-3 py-2 text-gray-500">{new Date(s.lastActiveAt).toLocaleString("vi-VN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-3 text-xs text-gray-400">Chưa có device nào đăng nhập.</p>
          )}
        </div>
      )}

      {/* ═══ Edit History ═══ */}
      {editHistory.length > 0 && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="px-4 py-3 border-b"><h2 className="text-sm font-semibold text-gray-800">Lịch sử thay đổi ({editHistory.length})</h2></div>
          <div className="overflow-auto max-h-[200px]">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-gray-500">Thời gian</th>
                  <th className="px-3 py-2 text-left text-gray-500">Đối tượng</th>
                  <th className="px-3 py-2 text-left text-gray-500">Trường</th>
                  <th className="px-3 py-2 text-left text-gray-500">Cũ</th>
                  <th className="px-3 py-2 text-left text-gray-500">Mới</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {editHistory.map((h: any) => (
                  <tr key={h.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{new Date(h.createdAt).toLocaleString("vi-VN")}</td>
                    <td className="px-3 py-2"><Badge variant="outline" className="text-[9px]">{h.entity}</Badge></td>
                    <td className="px-3 py-2 font-medium text-gray-700">{h.field}</td>
                    <td className="px-3 py-2"><span className="font-mono bg-red-50 text-red-600 px-1 py-0.5 rounded text-[10px]">{h.oldValue || "—"}</span></td>
                    <td className="px-3 py-2"><span className="font-mono bg-green-50 text-green-600 px-1 py-0.5 rounded text-[10px]">{h.newValue || "—"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ADMIN-ONLY: Collector Withdrawals Section — edit PP fee (bypasses 24h lock)
// ═══════════════════════════════════════════════════════════════════════
function AdminWithdrawalsSection({
  projectId, withdrawals, onChange,
}: {
  projectId: string;
  withdrawals: any[];
  onChange: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const updateFee = trpc.agentPP.updatePaypalFee.useMutation({
    onSuccess: () => { onChange(); toast.success("PP fee updated (admin override)"); setEditingId(null); },
    onError: (e) => toast.error(e.message),
  });
  const deleteW = trpc.withdrawal.delete.useMutation({
    onSuccess: () => { onChange(); toast.success("Withdrawal deleted"); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <div className="px-4 py-3 border-b bg-amber-50 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-amber-900">⚠ Admin — Agent Withdrawals ({withdrawals.length})</h2>
        <span className="text-[10px] text-amber-700">Bypass 24h lock</span>
      </div>
      <div className="overflow-auto max-h-[320px]">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="px-2 py-2 text-left text-gray-500">Date</th>
              <th className="px-2 py-2 text-left text-gray-500">Project</th>
              <th className="px-2 py-2 text-left text-gray-500">Source PP</th>
              <th className="px-2 py-2 text-left text-gray-500">TX ID</th>
              <th className="px-2 py-2 text-right text-gray-500">Amount</th>
              <th className="px-2 py-2 text-right text-gray-500">PP Fee</th>
              <th className="px-2 py-2 text-center text-gray-500">Locked?</th>
              <th className="px-2 py-2 text-center text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {withdrawals.map((w: any) => {
              const locked = w.paypalFeeSetAt && (Date.now() - new Date(w.paypalFeeSetAt).getTime() > 24 * 3600 * 1000);
              return (
                <tr key={w.id} className="hover:bg-gray-50">
                  <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{new Date(w.date).toLocaleDateString("en-US")}</td>
                  <td className="px-2 py-1.5"><Badge variant="outline" className="text-[9px]">{w.project?.code ?? "—"}</Badge></td>
                  <td className="px-2 py-1.5 font-medium">{w.sourcePaypal?.code ?? "—"}</td>
                  <td className="px-2 py-1.5 font-mono text-gray-500 truncate max-w-[120px]">{w.transactionId || "—"}</td>
                  <td className="px-2 py-1.5 text-right font-semibold text-green-700">{formatCurrency(Number(w.amount))}</td>
                  <td className="px-2 py-1.5 text-right">
                    {editingId === w.id ? (
                      <input
                        type="number" step="0.01" autoFocus
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        onBlur={() => {
                          const v = editingValue.trim() === "" ? null : parseFloat(editingValue);
                          updateFee.mutate({ projectId: w.projectId ?? projectId, id: w.id, paypalFee: v });
                        }}
                        className="w-20 h-6 text-xs px-1 border border-blue-400 rounded text-right font-mono"
                      />
                    ) : (
                      <button
                        onClick={() => { setEditingId(w.id); setEditingValue(w.paypalFee != null ? String(Number(w.paypalFee)) : ""); }}
                        className="text-red-600 hover:bg-blue-50 rounded px-1"
                      >
                        {w.paypalFee != null ? `-${formatCurrency(Number(w.paypalFee))}` : "+ set"}
                      </button>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {locked ? <span className="text-red-500 text-[10px]">🔒 locked</span> : <span className="text-green-500 text-[10px]">unlocked</span>}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <button
                      onClick={() => { if (confirm("Delete this withdrawal?")) deleteW.mutate({ projectId: w.projectId ?? projectId, id: w.id }); }}
                      className="text-red-400 hover:text-red-600 text-[10px]"
                    >Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ADMIN-ONLY: Collector Expenses Section — delete any (bypasses 24h lock)
// ═══════════════════════════════════════════════════════════════════════
function AdminExpensesSection({
  projectId, expenses, onChange,
}: {
  projectId: string;
  expenses: any[];
  onChange: () => void;
}) {
  const deleteExp = trpc.agentPP.deleteExpense.useMutation({
    onSuccess: () => { onChange(); toast.success("Expense deleted (admin override)"); },
    onError: (e) => toast.error(e.message),
  });
  const typeLabel: Record<string, string> = {
    TEAM_PAYMENT: "→ Team",
    BILL: "🧾 Bill",
    OTHER: "◇ Other",
  };
  const typeColor: Record<string, string> = {
    TEAM_PAYMENT: "bg-emerald-100 text-emerald-700",
    BILL: "bg-blue-100 text-blue-700",
    OTHER: "bg-gray-100 text-gray-700",
  };

  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <div className="px-4 py-3 border-b bg-amber-50 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-amber-900">⚠ Admin — Collector Expenses ({expenses.length})</h2>
        <span className="text-[10px] text-amber-700">Bypass 24h lock</span>
      </div>
      <div className="overflow-auto max-h-[320px]">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="px-2 py-2 text-left text-gray-500">Date</th>
              <th className="px-2 py-2 text-left text-gray-500">Project</th>
              <th className="px-2 py-2 text-left text-gray-500">Type</th>
              <th className="px-2 py-2 text-left text-gray-500">Reference</th>
              <th className="px-2 py-2 text-left text-gray-500">Note</th>
              <th className="px-2 py-2 text-center text-gray-500">Linked</th>
              <th className="px-2 py-2 text-right text-gray-500">Amount</th>
              <th className="px-2 py-2 text-center text-gray-500">Locked?</th>
              <th className="px-2 py-2 text-center text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {expenses.map((e: any) => {
              const locked = e.createdAt && (Date.now() - new Date(e.createdAt).getTime() > 24 * 3600 * 1000);
              return (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{new Date(e.date).toLocaleDateString("en-US")}</td>
                  <td className="px-2 py-1.5"><Badge variant="outline" className="text-[9px]">{e.project?.code ?? "—"}</Badge></td>
                  <td className="px-2 py-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${typeColor[e.type] || "bg-gray-100 text-gray-700"}`}>
                      {typeLabel[e.type] || e.type}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 font-mono text-blue-700 truncate max-w-[140px]">{e.referenceId}</td>
                  <td className="px-2 py-1.5 text-gray-500 italic truncate max-w-[150px]">{e.note || "—"}</td>
                  <td className="px-2 py-1.5 text-center text-gray-500">{e.withdrawals?.length ?? 0}</td>
                  <td className="px-2 py-1.5 text-right font-bold text-red-600">-{formatCurrency(Number(e.amount))}</td>
                  <td className="px-2 py-1.5 text-center">
                    {locked ? <span className="text-red-500 text-[10px]">🔒 locked</span> : <span className="text-green-500 text-[10px]">unlocked</span>}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <button
                      onClick={() => { if (confirm("Delete this expense? Linked transactions will return to pending.")) deleteExp.mutate({ projectId: e.projectId ?? projectId, id: e.id }); }}
                      className="text-red-400 hover:text-red-600 text-[10px]"
                    >Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
