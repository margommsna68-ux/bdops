"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { useSettingsStore } from "@/lib/settings-store";
import { isCollectorOnly } from "@/lib/collector-utils";
import { usePinAction } from "@/components/PinVerify";
import toast from "react-hot-toast";

export default function AgentPPPage() {
  const t = useT();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const currentRole = useProjectStore((s) => s.currentRole);
  const currentModules = useProjectStore((s) => s.currentModules);
  const language = useSettingsStore((s) => s.language);
  const isAdminOrMod = currentRole === "ADMIN" || currentRole === "MODERATOR";
  const isAdminOnly = currentRole === "ADMIN";
  const collectorOnly = isCollectorOnly(currentRole, currentModules);

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
  const [sellFeePercent, setSellFeePercent] = useState("3");
  const [sellPaypalFee, setSellPaypalFee] = useState("0");
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
  const { data: todayActivity } = trpc.agentPP.todayActivity.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId && isAdminOrMod }
  );

  const { data: myEarnings } = trpc.agentPP.myEarnings.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );
  const markWithdrawn = trpc.agentPP.markWithdrawn.useMutation({
    onSuccess: () => { refetchSales(); refetchBalance(); toast.success(t("collector_updated")); },
    onError: (e) => toast.error(e.message),
  });

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
      setSellAmount(""); setSellFeePercent("3"); setSellPaypalFee("0"); setSellTxId(""); setSellExchangeEmail(""); setSellNotes("");
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
      feePercent: parseFloat(sellFeePercent) || 3,
      paypalFee: parseFloat(sellPaypalFee) || 0,
      transactionId: sellTxId,
      exchangeEmail: sellExchangeEmail || undefined,
      notes: sellNotes || undefined,
    });
  };

  // Calculate net preview
  const grossAmt = parseFloat(sellAmount) || 0;
  const feePct = parseFloat(sellFeePercent) || 3;
  const ppFee = parseFloat(sellPaypalFee) || 0;
  const netPreview = grossAmt - ppFee - (grossAmt * feePct / 100);

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
            {t("collector_admin_view")}
          </Badge>
        )}
      </div>

      {/* ══ Hero Balance ══ */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="p-5">
          {collectorOnly ? (
            /* Collector-only: 5 metric cards */
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="text-center py-3 bg-green-50 rounded-lg">
                <div className="text-[10px] font-semibold text-green-600 uppercase mb-1">{t("collector_total_received")}</div>
                <div className="text-xl font-bold text-green-700">{formatCurrency(displayBalance?.totalReceived ?? 0)}</div>
              </div>
              <div className="text-center py-3 bg-purple-50 rounded-lg">
                <div className="text-[10px] font-semibold text-purple-600 uppercase mb-1">{t("collector_commission")}</div>
                <div className="text-xl font-bold text-purple-700">{formatCurrency((displayBalance as any)?.totalCommission ?? 0)}</div>
              </div>
              <div className="text-center py-3 bg-emerald-50 rounded-lg">
                <div className="text-[10px] font-semibold text-emerald-600 uppercase mb-1">{t("collector_paid_team")}</div>
                <div className="text-xl font-bold text-emerald-700">{formatCurrency((displayBalance as any)?.paidToTeam ?? 0)}</div>
              </div>
              <div className="text-center py-3 bg-amber-50 rounded-lg">
                <div className="text-[10px] font-semibold text-amber-600 uppercase mb-1">{t("collector_owed_team")}</div>
                <div className="text-xl font-bold text-amber-700">{formatCurrency((displayBalance as any)?.owedToTeam ?? 0)}</div>
              </div>
              <div className="text-center py-3 bg-blue-50 rounded-lg relative">
                <div className="text-[10px] font-semibold text-blue-600 uppercase mb-1">{t("collector_fund_remaining")}</div>
                <div className={`text-xl font-bold ${bal >= 0 ? "text-blue-700" : "text-red-600"}`}>{formatCurrency(bal)}</div>
                {isCollector && (
                  <button onClick={() => { setShowSellForm(!showSellForm); if (!showSellForm) setActiveTab("sold"); }}
                    className={`mt-2 px-3 py-1 rounded text-[10px] font-semibold transition-colors ${showSellForm ? "bg-gray-200 text-gray-600" : "bg-orange-600 text-white hover:bg-orange-700"}`}>
                    {showSellForm ? t("collector_close") : t("collector_sell_fund")}
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* Admin/Moderator/Multi-module user: legacy 3-col layout */
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center py-3 bg-green-50 rounded-lg">
                <div className="text-[10px] font-semibold text-green-600 uppercase mb-1">{t("collector_total_received")}</div>
                <div className="text-xl font-bold text-green-700">{formatCurrency(displayBalance?.totalReceived ?? 0)}</div>
              </div>
              <div className="text-center py-3 bg-orange-50 rounded-lg">
                <div className="text-[10px] font-semibold text-orange-600 uppercase mb-1">{t("collector_total_sold")}</div>
                <div className="text-xl font-bold text-orange-700">{formatCurrency(displayBalance?.totalSold ?? 0)}</div>
              </div>
              <div className="text-center py-3 bg-blue-50 rounded-lg relative">
                <div className="text-[10px] font-semibold text-blue-600 uppercase mb-1">{t("collector_balance_remaining")}</div>
                <div className={`text-2xl font-extrabold ${bal >= 0 ? "text-blue-700" : "text-red-600"}`}>{formatCurrency(bal)}</div>
                {isCollector && (
                  <button onClick={() => { setShowSellForm(!showSellForm); if (!showSellForm) setActiveTab("sold"); }}
                    className={`mt-2 px-4 py-1 rounded text-xs font-semibold transition-colors ${showSellForm ? "bg-gray-200 text-gray-600" : "bg-orange-600 text-white hover:bg-orange-700"}`}>
                    {showSellForm ? t("collector_close") : t("collector_sell_fund")}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Email & Link section */}
          {isCollector && (
            <div className="mt-4 pt-3 border-t border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-500">{t("collector_emails_and_links")}</span>
                {!showEmailForm && (
                  <button onClick={() => setShowEmailForm(true)} className="text-[10px] text-blue-600 hover:text-blue-800 font-semibold">{t("collector_add")}</button>
                )}
              </div>
              {/* List */}
              <div className="space-y-1.5">
                {(emails ?? []).map((em: any) => {
                  const isL = em.email.startsWith("http://") || em.email.startsWith("https://");
                  return (
                    <div key={em.id} className="flex items-center justify-between group py-1 px-2 rounded hover:bg-gray-50 -mx-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {isL ? (
                          <svg className="w-3.5 h-3.5 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                        ) : (
                          <svg className="w-3.5 h-3.5 text-orange-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                        )}
                        {isL ? (
                          <a href={em.email} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline truncate">{em.email}</a>
                        ) : (
                          <span className="text-xs font-mono text-gray-700 truncate">{em.email}</span>
                        )}
                        {em.label && <span className="text-[10px] text-gray-400">({em.label})</span>}
                      </div>
                      <button onClick={() => { if (window.confirm(t("collector_delete_email_confirm").replace("{email}", em.email))) removeEmail.mutate({ projectId: projectId!, id: em.id }); }}
                        className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  );
                })}
              </div>
              {/* Add form */}
              {showEmailForm && (
                <div className="flex items-center gap-1.5 mt-2">
                  <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                    placeholder={t("collector_email_placeholder")} className="h-7 text-xs flex-1"
                    onKeyDown={(e) => { if (e.key === "Enter" && newEmail) addEmail.mutate({ projectId: projectId!, email: newEmail, label: newLabel || undefined }); }} />
                  <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
                    placeholder={t("collector_note_placeholder")} className="h-7 text-xs w-20" />
                  <Button size="sm" className="h-7 text-xs px-3" disabled={!newEmail || addEmail.isLoading}
                    onClick={() => addEmail.mutate({ projectId: projectId!, email: newEmail, label: newLabel || undefined })}>
                    {t("collector_add_btn")}
                  </Button>
                  <button onClick={() => { setShowEmailForm(false); setNewEmail(""); setNewLabel(""); }} className="text-gray-400 hover:text-gray-600">&times;</button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Agent Earnings Summary (only for admin/multi-module users — collector-only already sees this in Hero) */}
        {isCollector && myEarnings && !collectorOnly && (
          <div className="mt-4 pt-3 border-t border-gray-100">
            <div className="text-xs font-semibold text-gray-500 mb-2">{t("collector_my_commission")}</div>
            <div className="grid grid-cols-4 gap-2">
              <div className="text-center py-2 bg-purple-50 rounded">
                <div className="text-[10px] text-purple-600 uppercase">{t("collector_this_month")}</div>
                <div className="text-sm font-bold text-purple-700">{formatCurrency(myEarnings.monthEarning)}</div>
              </div>
              <div className="text-center py-2 bg-green-50 rounded">
                <div className="text-[10px] text-green-600 uppercase">{t("collector_total")}</div>
                <div className="text-sm font-bold text-green-700">{formatCurrency(myEarnings.totalEarning)}</div>
              </div>
              <div className="text-center py-2 bg-gray-50 rounded">
                <div className="text-[10px] text-gray-500 uppercase">{t("collector_withdrawn")}</div>
                <div className="text-sm font-bold text-gray-600">{formatCurrency(myEarnings.totalWithdrawn)}</div>
              </div>
              <div className="text-center py-2 bg-amber-50 rounded">
                <div className="text-[10px] text-amber-600 uppercase">{t("collector_pending_withdraw")}</div>
                <div className="text-sm font-bold text-amber-700">{formatCurrency(myEarnings.pending)}</div>
              </div>
            </div>
          </div>
        )}

        {/* Sell Form - slides in under hero (chỉ collector) */}
        {isCollector && showSellForm && (
          <div className="px-5 pb-5 pt-0">
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">
                    {t("collector_email_pp")} <span className="text-red-500">*</span>
                  </label>
                  <select value={sellEmailId} onChange={(e) => setSellEmailId(e.target.value)}
                    className="w-full h-9 text-sm border rounded-md px-2 bg-white">
                    <option value="">{t("collector_select")}</option>
                    {(emails ?? []).map((em: any) => (
                      <option key={em.id} value={em.id}>
                        {em.email}{em.label ? ` (${em.label})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">
                    {t("collector_email_exchange")}
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
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{t("collector_fee_agent")}</label>
                    <Input type="number" step="0.1" min="0" max="100" value={sellFeePercent}
                      onChange={(e) => setSellFeePercent(e.target.value)}
                      placeholder="3" className="h-9 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">{t("collector_paypal_fee")}</label>
                    <Input type="number" step="0.01" min="0" value={sellPaypalFee}
                      onChange={(e) => setSellPaypalFee(e.target.value)}
                      placeholder="0.00" className="h-9 text-sm" />
                  </div>
                </div>
                {grossAmt > 0 && (
                  <div className="bg-gray-50 border rounded px-3 py-2 text-xs">
                    <div className="flex justify-between"><span className="text-gray-500">{t("collector_gross")}</span><span className="font-mono">${grossAmt.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">- PP Fee</span><span className="font-mono text-red-600">-${ppFee.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">- Agent {feePct}%</span><span className="font-mono text-red-600">-${(grossAmt * feePct / 100).toFixed(2)}</span></div>
                    <div className="flex justify-between border-t mt-1 pt-1 font-semibold"><span>{t("collector_net")}</span><span className={`font-mono ${netPreview >= 0 ? "text-green-700" : "text-red-700"}`}>${netPreview.toFixed(2)}</span></div>
                  </div>
                )}
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
                          {(() => {
                            const val = w.agentEmail?.email ?? "—";
                            const isL = val.startsWith("http://") || val.startsWith("https://");
                            return isL ? <a href={val} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{val}</a> : <span>{val}</span>;
                          })()}
                        </td>
                        <td className="px-3 py-2 font-semibold text-green-700">{formatCurrency(w.amount)}</td>
                        <td className="px-3 py-2 text-xs font-mono text-gray-500">{w.transactionId || w.withdrawCode || "—"}</td>
                        <td className="px-3 py-2">
                          {w.disputeResolved && w.disputeAction === "OVERRIDE" ? (
                            <Badge className="bg-blue-100 text-blue-800 text-xs" title={w.adminResolveNote || ""}>{t("collector_admin_confirmed")}</Badge>
                          ) : w.agentConfirmed ? (
                            <Badge className="bg-green-100 text-green-800 text-xs">{t("agpp_confirmed")}</Badge>
                          ) : w.agentDisputed ? (
                            <Badge className="bg-red-100 text-red-800 text-xs" title={w.disputeNote}>{t("collector_disputing")}</Badge>
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
                                    {w.resolvedBy?.name || "Admin"}: {t("collector_sent_correctly")}
                                  </span>
                                ) : (
                                  <span className="text-gray-500">{t("collector_cancelled_by")} {w.resolvedBy?.name || "Admin"}</span>
                                )}
                              </div>
                            )}
                            {isAdminOnly && (
                              <button
                                onClick={() => requirePin(
                                  () => deleteWithdrawal.mutate({ projectId: projectId!, id: w.id }),
                                  t("collector_delete_tx"),
                                  t("collector_delete_tx_confirm").replace("{amount}", formatCurrency(w.amount)).replace("{code}", w.sourcePaypal?.code ?? "")
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
                    {isAdminOrMod && <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t("collector_role_label")}</th>}
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t("collector_email_pp")}</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">{t("collector_email_exchange")}</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">{t("col_amount")}</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Fee%</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">{t("collector_col_commission")}</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">TX ID</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">{t("collector_paid_team")}</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {salesLoading ? (
                    <tr><td colSpan={isAdminOrMod ? 11 : 10} className="text-center py-8 text-gray-400">{t("loading")}</td></tr>
                  ) : salesItems.length === 0 ? (
                    <tr><td colSpan={isAdminOrMod ? 11 : 10} className="text-center py-8 text-gray-400">{t("agpp_no_sales")}</td></tr>
                  ) : (
                    salesItems.map((s: any) => (
                      <tr key={s.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-600 text-xs whitespace-nowrap">{formatDate(s.date)}</td>
                        {isAdminOrMod && <td className="px-3 py-2 text-xs font-medium text-gray-800">{s.agentUser?.name || s.agentUser?.username || "—"}</td>}
                        <td className="px-3 py-2 text-xs">
                          {(() => {
                            const val = s.agentEmail?.email ?? "—";
                            const isL = val.startsWith("http://") || val.startsWith("https://");
                            return isL ? <a href={val} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{val}</a> : <span>{val}</span>;
                          })()}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600">{s.exchangeEmail || "—"}</td>
                        <td className="px-3 py-2 text-right font-semibold text-orange-700">{formatCurrency(s.amount)}</td>
                        <td className="px-3 py-2 text-center text-xs text-gray-500">{s.feePercent ? `${Number(s.feePercent)}%` : "—"}</td>
                        <td className="px-3 py-2 text-right text-xs font-semibold text-purple-700">{s.agentEarning ? formatCurrency(Number(s.agentEarning)) : "—"}</td>
                        <td className="px-3 py-2 text-xs font-mono text-gray-500">{s.transactionId}</td>
                        <td className="px-3 py-2 text-center">
                          <button onClick={() => markWithdrawn.mutate({ projectId: projectId!, id: s.id, withdrawn: !s.withdrawn })}
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded cursor-pointer ${s.withdrawn ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500 hover:bg-amber-100 hover:text-amber-700"}`}>
                            {s.withdrawn ? t("collector_mark_paid") : t("collector_mark_pending")}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button onClick={() => requirePin(
                            () => deleteSale.mutate({ projectId: projectId!, id: s.id }),
                            t("collector_delete_sale"),
                            t("collector_delete_sale_confirm").replace("{amount}", formatCurrency(s.amount))
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
                  {ag.emails.map((em: any) => {
                    const isLink = em.email.startsWith("http://") || em.email.startsWith("https://");
                    return (
                      <div key={em.id} className="flex items-center justify-between text-xs gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {isLink ? (
                            <svg className="w-3 h-3 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                          ) : (
                            <svg className="w-3 h-3 text-orange-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                          )}
                          {isLink ? (
                            <a href={em.email} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate">{em.email}</a>
                          ) : (
                            <span className="text-gray-600 truncate">{em.email}</span>
                          )}
                        </div>
                        <span className="text-green-600 font-medium shrink-0">{formatCurrency(em.totalReceived)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ Admin: Today Activity ══ */}
      {isAdminOrMod && todayActivity && (todayActivity.countWithdrawals > 0 || todayActivity.countSales > 0) && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">{t("collector_today_activity")}</h3>
            <div className="flex gap-3 text-xs">
              <span className="text-green-700 font-semibold">{todayActivity.countWithdrawals} {t("collector_received_count")} • {formatCurrency(todayActivity.totalWithdrawals)}</span>
              <span className="text-orange-700 font-semibold">{todayActivity.countSales} {t("collector_sold_count")} • {formatCurrency(todayActivity.totalSales)}</span>
            </div>
          </div>
          <div className="overflow-auto max-h-[300px]">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-gray-500">{t("collector_time")}</th>
                  <th className="px-3 py-2 text-left text-gray-500">{t("collector_type")}</th>
                  <th className="px-3 py-2 text-left text-gray-500">{t("collector_agent")}</th>
                  <th className="px-3 py-2 text-left text-gray-500">{t("collector_email_or_link")}</th>
                  <th className="px-3 py-2 text-right text-gray-500">{t("collector_amount")}</th>
                  <th className="px-3 py-2 text-left text-gray-500">{t("collector_tx_code")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {todayActivity.todayWithdrawals.map((w: any) => (
                  <tr key={`w-${w.id}`} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{new Date(w.date).toLocaleTimeString(language === "vi" ? "vi-VN" : "en-US", { hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-3 py-2"><span className="bg-green-100 text-green-700 text-[10px] font-semibold px-1.5 py-0.5 rounded">{t("collector_type_received")}</span></td>
                    <td className="px-3 py-2 font-medium text-gray-800">{w.agentEmail?.user?.name || w.agentEmail?.user?.username || "—"}</td>
                    <td className="px-3 py-2 text-gray-600">{w.agentEmail?.email || "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold text-green-700">{formatCurrency(w.amount)}</td>
                    <td className="px-3 py-2 font-mono text-gray-400">{w.transactionId || w.withdrawCode || "—"}</td>
                  </tr>
                ))}
                {todayActivity.todaySales.map((s: any) => (
                  <tr key={`s-${s.id}`} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{new Date(s.date).toLocaleTimeString(language === "vi" ? "vi-VN" : "en-US", { hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-3 py-2"><span className="bg-orange-100 text-orange-700 text-[10px] font-semibold px-1.5 py-0.5 rounded">{t("collector_type_sold")}</span></td>
                    <td className="px-3 py-2 font-medium text-gray-800">{s.agentUser?.name || s.agentUser?.username || "—"}</td>
                    <td className="px-3 py-2 text-gray-600">{s.agentEmail?.email || "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold text-orange-700">{formatCurrency(s.amount)}</td>
                    <td className="px-3 py-2 font-mono text-gray-400">{s.transactionId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                  placeholder={t("collector_dispute_placeholder")}
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
