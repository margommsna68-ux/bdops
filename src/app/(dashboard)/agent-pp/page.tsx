"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { usePinAction } from "@/components/PinVerify";
import toast from "react-hot-toast";

export default function AgentPPPage() {
  const t = useT();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const currentRole = useProjectStore((s) => s.currentRole);
  const isAdminOrMod = currentRole === "ADMIN" || currentRole === "MODERATOR";
  const isAdminOnly = currentRole === "ADMIN";

  const [page, setPage] = useState(1);
  const [salesPage, setSalesPage] = useState(1);
  const [newEmail, setNewEmail] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [disputeId, setDisputeId] = useState<string | null>(null);
  const [disputeNote, setDisputeNote] = useState("");
  const [activeTab, setActiveTab] = useState<"received" | "sold">("received");

  // Sell form state
  const [showSellForm, setShowSellForm] = useState(false);
  const [sellEmailId, setSellEmailId] = useState("");
  const [sellAmount, setSellAmount] = useState("");
  const [sellTxId, setSellTxId] = useState("");
  const [sellExchangeEmail, setSellExchangeEmail] = useState("");
  const [sellNotes, setSellNotes] = useState("");

  // Queries
  const { data: emails, refetch: refetchEmails } = trpc.agentPP.myEmails.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );
  const { data: balance, refetch: refetchBalance } = trpc.agentPP.myBalance.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );
  const { data: globalBalance } = trpc.agentPP.globalBalance.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId && isAdminOrMod }
  );
  const { data: txData, isLoading, refetch: refetchTx } = trpc.agentPP.myTransactions.useQuery(
    { projectId: projectId!, page },
    { enabled: !!projectId }
  );
  const { data: salesData, isLoading: salesLoading, refetch: refetchSales } = trpc.agentPP.mySales.useQuery(
    { projectId: projectId!, page: salesPage },
    { enabled: !!projectId }
  );
  const { data: allAgents } = trpc.agentPP.allAgents.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId && isAdminOrMod }
  );

  const isCollector = (emails ?? []).length > 0;
  // Admin sees global stats, collectors see their own
  const displayBalance = isAdminOrMod && !isCollector ? globalBalance : balance;

  const addEmail = trpc.agentPP.addEmail.useMutation({
    onSuccess: () => { refetchEmails(); refetchBalance(); setNewEmail(""); setNewLabel(""); setShowEmailForm(false); toast.success("Email added"); },
  });
  const removeEmail = trpc.agentPP.removeEmail.useMutation({
    onSuccess: () => { refetchEmails(); refetchBalance(); toast.success("Email removed"); },
  });
  const confirmReceived = trpc.agentPP.confirmReceived.useMutation({
    onSuccess: () => { refetchTx(); toast.success(t("agpp_confirmed")); },
  });
  const disputeTx = trpc.agentPP.disputeTransaction.useMutation({
    onSuccess: () => { refetchTx(); setDisputeId(null); setDisputeNote(""); toast.success(t("agpp_disputed")); },
  });
  const createSale = trpc.agentPP.createSale.useMutation({
    onSuccess: () => {
      refetchSales(); refetchBalance();
      setSellAmount(""); setSellTxId(""); setSellExchangeEmail(""); setSellNotes("");
      setShowSellForm(false);
      toast.success(t("agpp_sale_created"));
    },
  });
  const deleteSale = trpc.agentPP.deleteSale.useMutation({
    onSuccess: () => { refetchSales(); refetchBalance(); toast.success(t("agpp_sale_deleted")); },
  });
  const deleteWithdrawal = trpc.withdrawal.delete.useMutation({
    onSuccess: () => { refetchTx(); refetchBalance(); toast.success(t("deleted")); },
    onError: (err) => toast.error(err.message),
  });
  const { requirePin, PinDialog } = usePinAction();

  const items = txData?.items ?? [];
  const total = txData?.total ?? 0;
  const totalPages = Math.ceil(total / 50);
  const salesItems = salesData?.items ?? [];
  const salesTotal = salesData?.total ?? 0;
  const salesTotalPages = Math.ceil(salesTotal / 50);

  if (!projectId) return <p className="text-gray-500 p-8">{t("select_project")}</p>;

  const handleSellSubmit = () => {
    if (!sellEmailId || !sellAmount || !sellTxId) return;
    createSale.mutate({
      projectId: projectId!,
      agentEmailId: sellEmailId,
      amount: parseFloat(sellAmount),
      transactionId: sellTxId,
      exchangeEmail: sellExchangeEmail || undefined,
      notes: sellNotes || undefined,
    });
  };

  const bal = displayBalance?.balance ?? 0;

  return (
    <div className="space-y-4">
      {/* ══ Page Header ══ */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("agpp_title")}</h1>
          <p className="text-sm text-gray-500">{t("agpp_subtitle")}</p>
        </div>
        {isAdminOrMod && !isCollector && (
          <Badge className="bg-blue-100 text-blue-700 text-xs px-3 py-1">
            Admin View
          </Badge>
        )}
      </div>

      {/* ══ Hero Balance ══ */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="p-5">
          {/* Top row: 3 balance metrics */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            {/* Left: Tổng nhận */}
            <div className="text-center min-w-[120px]">
              <div className="text-xs font-semibold text-gray-400 uppercase mb-1">{t("agpp_total_received")}</div>
              <div className="text-xl font-bold text-green-600">{formatCurrency(displayBalance?.totalReceived ?? 0)}</div>
            </div>

            {/* Center: Số dư - HERO */}
            <div className="text-center flex-1">
              <div className="text-xs font-semibold text-gray-400 uppercase mb-1">{t("agpp_remaining")}</div>
              <div className={`text-4xl font-extrabold ${bal >= 0 ? "text-blue-600" : "text-red-600"}`}>
                {formatCurrency(bal)}
              </div>
              {isCollector && (
                <div className="mt-2">
                  <Button
                    size="sm"
                    className="bg-orange-600 hover:bg-orange-700 h-8 px-5 text-sm font-semibold"
                    onClick={() => { setShowSellForm(!showSellForm); if (!showSellForm) setActiveTab("sold"); }}
                  >
                    {showSellForm ? t("cancel") : t("agpp_sell_title")}
                  </Button>
                </div>
              )}
            </div>

            {/* Right: Đã bán */}
            <div className="text-center min-w-[120px]">
              <div className="text-xs font-semibold text-gray-400 uppercase mb-1">{t("agpp_total_sold")}</div>
              <div className="text-xl font-bold text-orange-600">{formatCurrency(displayBalance?.totalSold ?? 0)}</div>
            </div>
          </div>

          {/* Email tags row - chỉ hiện cho collector */}
          {isCollector && (
            <div className="mt-4 pt-3 border-t border-gray-100 flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-gray-500">PP Emails:</span>
              {(emails ?? []).map((em: any) => (
                <span key={em.id} className="inline-flex items-center gap-1 bg-gray-100 border rounded-full px-2.5 py-0.5 text-xs text-gray-700">
                  {em.email}
                  {em.label && <span className="text-gray-400">({em.label})</span>}
                  <button onClick={() => {
                    if (window.confirm(`Remove ${em.email}?`))
                      removeEmail.mutate({ projectId: projectId!, id: em.id });
                  }} className="text-red-400 hover:text-red-600 ml-0.5">&times;</button>
                </span>
              ))}
              {!showEmailForm ? (
                <button onClick={() => setShowEmailForm(true)}
                  className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-0.5 text-xs text-blue-600 hover:bg-blue-100">
                  + {t("agpp_add_email")}
                </button>
              ) : (
                <div className="flex items-center gap-1.5 ml-1">
                  <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="email@paypal.com" className="h-7 text-xs w-44"
                    onKeyDown={(e) => { if (e.key === "Enter" && newEmail) addEmail.mutate({ projectId: projectId!, email: newEmail, label: newLabel || undefined }); }} />
                  <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
                    placeholder={t("agpp_label_placeholder")} className="h-7 text-xs w-24" />
                  <Button size="sm" className="h-7 text-xs px-2" disabled={!newEmail || addEmail.isLoading}
                    onClick={() => addEmail.mutate({ projectId: projectId!, email: newEmail, label: newLabel || undefined })}>
                    {t("agpp_add_email")}
                  </Button>
                  <button onClick={() => { setShowEmailForm(false); setNewEmail(""); setNewLabel(""); }}
                    className="text-gray-400 hover:text-gray-600 text-xs">&times;</button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sell Form - slides in under hero (chỉ collector) */}
        {isCollector && showSellForm && (
          <div className="px-5 pb-5 pt-0">
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">
                    Email PP <span className="text-red-500">*</span>
                  </label>
                  <select value={sellEmailId} onChange={(e) => setSellEmailId(e.target.value)}
                    className="w-full h-9 text-sm border rounded-md px-2 bg-white">
                    <option value="">-- Chọn --</option>
                    {(emails ?? []).map((em: any) => (
                      <option key={em.id} value={em.id}>
                        {em.email}{em.label ? ` (${em.label})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">
                    Email Exchange
                  </label>
                  <Input value={sellExchangeEmail} onChange={(e) => setSellExchangeEmail(e.target.value)}
                    placeholder="exchange@email.com" className="h-9 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">
                    {t("agpp_sell_amount")} <span className="text-red-500">*</span>
                  </label>
                  <Input type="number" step="0.01" min="0" value={sellAmount}
                    onChange={(e) => setSellAmount(e.target.value)}
                    placeholder="0.00" className="h-9 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">
                    TX ID <span className="text-red-500">*</span>
                  </label>
                  <Input value={sellTxId} onChange={(e) => setSellTxId(e.target.value)}
                    placeholder="Transaction ID" className="h-9 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">
                    {t("agpp_sell_notes")}
                  </label>
                  <div className="flex gap-1.5">
                    <Input value={sellNotes} onChange={(e) => setSellNotes(e.target.value)}
                      placeholder={t("agpp_sell_notes")} className="h-9 text-sm flex-1" />
                    <Button size="sm" className="bg-orange-600 hover:bg-orange-700 h-9 px-4 whitespace-nowrap"
                      disabled={!sellEmailId || !sellAmount || !sellTxId || createSale.isLoading}
                      onClick={handleSellSubmit}>
                      {createSale.isLoading ? "..." : t("agpp_sell_submit")}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ══ Tabs: Giao dịch nhận | Lịch sử bán ══ */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Tab header */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab("received")}
            className={`flex-1 px-4 py-2.5 text-sm font-semibold transition-colors relative ${
              activeTab === "received"
                ? "text-green-700 bg-green-50/50"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            {t("agpp_transactions")}
            {total > 0 && <Badge className="ml-2 bg-green-100 text-green-700 text-[10px] px-1.5">{total}</Badge>}
            {activeTab === "received" && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-600" />}
          </button>
          <button
            onClick={() => setActiveTab("sold")}
            className={`flex-1 px-4 py-2.5 text-sm font-semibold transition-colors relative ${
              activeTab === "sold"
                ? "text-orange-700 bg-orange-50/50"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            {t("agpp_sales_history")}
            {salesTotal > 0 && <Badge className="ml-2 bg-orange-100 text-orange-700 text-[10px] px-1.5">{salesTotal}</Badge>}
            {activeTab === "sold" && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-600" />}
          </button>
        </div>

        {/* Tab: Giao dịch nhận */}
        {activeTab === "received" && (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t("col_date")}</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t("agpp_source_pp")}</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t("agpp_agent_email")}</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t("col_amount")}</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">TX ID</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t("col_status")}</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 w-32"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading ? (
                    <tr><td colSpan={7} className="text-center py-8 text-gray-400">{t("loading")}</td></tr>
                  ) : items.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-8 text-gray-400">{t("agpp_no_transactions")}</td></tr>
                  ) : (
                    items.map((w: any) => (
                      <tr key={w.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-600 text-xs whitespace-nowrap">{formatDate(w.date)}</td>
                        <td className="px-3 py-2 text-xs font-medium">{w.sourcePaypal?.code ?? "—"}</td>
                        <td className="px-3 py-2 text-xs">
                          {w.agentEmail?.email ?? "—"}
                          {w.agentEmail?.label && <span className="text-gray-400 ml-1">({w.agentEmail.label})</span>}
                        </td>
                        <td className="px-3 py-2 font-semibold text-green-700">{formatCurrency(w.amount)}</td>
                        <td className="px-3 py-2 text-xs font-mono text-gray-500">{w.transactionId || w.withdrawCode || "—"}</td>
                        <td className="px-3 py-2">
                          {w.disputeResolved && w.disputeAction === "OVERRIDE" ? (
                            <Badge className="bg-blue-100 text-blue-800 text-xs" title={w.adminResolveNote || ""}>Admin xác nhận</Badge>
                          ) : w.agentConfirmed ? (
                            <Badge className="bg-green-100 text-green-800 text-xs">{t("agpp_confirmed")}</Badge>
                          ) : w.agentDisputed ? (
                            <Badge className="bg-red-100 text-red-800 text-xs" title={w.disputeNote}>Đang khiếu nại</Badge>
                          ) : (
                            <Badge variant="outline" className="border-yellow-500 text-yellow-700 text-xs">{t("agpp_pending")}</Badge>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <div className="flex gap-1 justify-center items-center">
                            {!w.agentConfirmed && !w.agentDisputed && !w.disputeResolved && (
                              <>
                                <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 border-green-500 text-green-700"
                                  onClick={() => confirmReceived.mutate({ projectId: projectId!, id: w.id })}>
                                  {t("agpp_confirm_received")}
                                </Button>
                                <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 border-red-400 text-red-600"
                                  onClick={() => { setDisputeId(w.id); setDisputeNote(""); }}>
                                  {t("agpp_dispute")}
                                </Button>
                              </>
                            )}
                            {w.agentDisputed && !w.disputeResolved && (
                              <span className="text-[10px] text-red-500" title={w.disputeNote}>
                                {w.disputeNote?.slice(0, 30)}{(w.disputeNote?.length ?? 0) > 30 ? "..." : ""}
                              </span>
                            )}
                            {w.disputeResolved && (
                              <div className="text-[10px]">
                                {w.disputeAction === "OVERRIDE" ? (
                                  <span className="text-blue-600" title={w.adminResolveNote || ""}>
                                    {w.resolvedBy?.name || "Admin"}: Đã gửi đúng
                                  </span>
                                ) : (
                                  <span className="text-gray-500">Đã hủy bởi {w.resolvedBy?.name || "Admin"}</span>
                                )}
                              </div>
                            )}
                            {isAdminOnly && (
                              <button
                                onClick={() => requirePin(
                                  () => deleteWithdrawal.mutate({ projectId: projectId!, id: w.id }),
                                  "Xóa giao dịch",
                                  `Xóa ${formatCurrency(w.amount)} — ${w.sourcePaypal?.code ?? ""}?`
                                )}
                                className="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600 ml-1"
                                title={t("delete")}
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {total > 50 && (
              <div className="flex items-center justify-between px-4 py-2 border-t text-sm">
                <span className="text-gray-500">{(page - 1) * 50 + 1}-{Math.min(page * 50, total)} / {total}</span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-7 text-xs">{t("prev")}</Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="h-7 text-xs">{t("next")}</Button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Tab: Lịch sử bán */}
        {activeTab === "sold" && (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t("col_date")}</th>
                    {isAdminOrMod && <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Collector</th>}
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Email PP</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Email Exchange</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t("col_amount")}</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">TX ID</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t("agpp_sell_notes")}</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {salesLoading ? (
                    <tr><td colSpan={isAdminOrMod ? 8 : 7} className="text-center py-8 text-gray-400">{t("loading")}</td></tr>
                  ) : salesItems.length === 0 ? (
                    <tr><td colSpan={isAdminOrMod ? 8 : 7} className="text-center py-8 text-gray-400">{t("agpp_no_sales")}</td></tr>
                  ) : (
                    salesItems.map((s: any) => (
                      <tr key={s.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-600 text-xs whitespace-nowrap">{formatDate(s.date)}</td>
                        {isAdminOrMod && <td className="px-3 py-2 text-xs font-medium text-gray-800">{s.agentUser?.name || s.agentUser?.username || "—"}</td>}
                        <td className="px-3 py-2 text-xs">
                          {s.agentEmail?.email ?? "—"}
                          {s.agentEmail?.label && <span className="text-gray-400 ml-1">({s.agentEmail.label})</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600">{s.exchangeEmail || "—"}</td>
                        <td className="px-3 py-2 font-semibold text-orange-700">{formatCurrency(s.amount)}</td>
                        <td className="px-3 py-2 text-xs font-mono text-gray-500">{s.transactionId}</td>
                        <td className="px-3 py-2 text-xs text-gray-500 max-w-[200px] truncate" title={s.notes || ""}>{s.notes || "—"}</td>
                        <td className="px-3 py-2 text-center">
                          <button onClick={() => requirePin(
                            () => deleteSale.mutate({ projectId: projectId!, id: s.id }),
                            "Xóa lần bán",
                            `Xóa ${formatCurrency(s.amount)}?`
                          )} className="text-red-400 hover:text-red-600 text-xs">&times;</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {salesTotal > 50 && (
              <div className="flex items-center justify-between px-4 py-2 border-t text-sm">
                <span className="text-gray-500">{(salesPage - 1) * 50 + 1}-{Math.min(salesPage * 50, salesTotal)} / {salesTotal}</span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" disabled={salesPage <= 1} onClick={() => setSalesPage(salesPage - 1)} className="h-7 text-xs">{t("prev")}</Button>
                  <Button variant="outline" size="sm" disabled={salesPage >= salesTotalPages} onClick={() => setSalesPage(salesPage + 1)} className="h-7 text-xs">{t("next")}</Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ══ Admin: All Agents Overview ══ */}
      {isAdminOrMod && allAgents && allAgents.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">{t("agpp_all_agents")}</h3>
          </div>
          <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {allAgents.map((ag: any) => (
              <div key={ag.userId} className="border rounded-lg p-4 bg-gray-50">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-bold text-gray-800">{ag.userName}</span>
                  <span className="text-lg font-bold text-green-700">{formatCurrency(ag.totalReceived)}</span>
                </div>
                <div className="space-y-1">
                  {ag.emails.map((em: any) => (
                    <div key={em.id} className="flex items-center justify-between text-xs">
                      <span className="text-gray-600">{em.email}</span>
                      <span className="text-green-600 font-medium">{formatCurrency(em.totalReceived)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PIN Dialog */}
      {PinDialog}

      {/* ══ Dispute Dialog ══ */}
      {disputeId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDisputeId(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-3">{t("agpp_dispute")}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">{t("agpp_dispute_note")}</label>
                <textarea
                  autoFocus
                  value={disputeNote}
                  onChange={(e) => setDisputeNote(e.target.value)}
                  className="w-full border rounded-lg p-2 text-sm mt-1"
                  rows={3}
                  placeholder="Không thấy giao dịch này trong PayPal..."
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setDisputeId(null)}>{t("cancel")}</Button>
                <Button size="sm" disabled={!disputeNote.trim() || disputeTx.isLoading}
                  className="bg-red-600 hover:bg-red-700"
                  onClick={() => disputeTx.mutate({ projectId: projectId!, id: disputeId, note: disputeNote })}>
                  {t("agpp_dispute")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
