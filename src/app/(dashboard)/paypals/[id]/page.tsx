"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/dashboard/StatCard";
import { trpc } from "@/lib/trpc";
import { trpcVanilla } from "@/lib/trpc-vanilla";
import { useProjectStore } from "@/lib/store";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PinVerifyDialog } from "@/components/PinVerify";
import toast from "react-hot-toast";

// ─── Copy Button ─────────
function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  if (!value || value === "—") return null;
  return (
    <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="shrink-0 text-gray-400 hover:text-gray-600" title="Copy">
      {copied ? (
        <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
      )}
    </button>
  );
}

// ─── Secret Field (reveal + copy) ─────────
function SecretField({ emailId, field, projectId, pinVerified, onNeedPin }: {
  emailId: string; field: "password" | "twoFa" | "hotmailToken"; projectId: string;
  pinVerified: boolean; onNeedPin: () => void;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState(false);

  const fetchCred = (): Promise<string> =>
    trpcVanilla.paypalEmail.getCredentials.query({ projectId, id: emailId })
      .then((c: any) => c?.[field] ?? "");

  const handleReveal = () => {
    if (!pinVerified) { onNeedPin(); return; }
    setLoading(true);
    fetchCred().then((v) => setRevealed(v || "—")).catch(() => toast.error("Failed")).finally(() => setLoading(false));
  };

  const handleCopy = () => {
    if (!pinVerified) { onNeedPin(); return; }
    setCopying(true);
    fetchCred().then((v) => {
      if (v) { navigator.clipboard.writeText(v); toast.success("Copied!"); }
      else toast.error("Empty");
    }).catch(() => toast.error("Failed")).finally(() => setCopying(false));
  };

  if (revealed !== null) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-xs truncate max-w-[180px]">{revealed}</span>
        <CopyBtn value={revealed === "—" ? "" : revealed} />
        <button onClick={() => setRevealed(null)} className="text-gray-400 hover:text-gray-600 shrink-0" title="Hide">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243" /></svg>
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button onClick={handleReveal} disabled={loading} className="text-gray-400 hover:text-blue-600 text-xs flex items-center gap-0.5">
        {loading ? (
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
        )}
        <span>••••</span>
      </button>
      <button onClick={handleCopy} disabled={copying} className="text-gray-400 hover:text-blue-600 shrink-0" title="Copy">
        {copying ? (
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
        )}
      </button>
    </div>
  );
}

export default function PayPalDetailPage() {
  const params = useParams();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const { currentRole } = useProjectStore();
  const utils = trpc.useUtils();

  // PIN
  const [pinVerified, setPinVerified] = useState(false);
  const [showPinDialog, setShowPinDialog] = useState(false);

  // Add email form
  const [showAddEmail, setShowAddEmail] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [savingEmails, setSavingEmails] = useState(false);

  // Edit email
  const [editingEmail, setEditingEmail] = useState<any>(null);

  // Edit account details (card 1)
  const [editingDetails, setEditingDetails] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState<any>({});
  // Edit owner info (card 2)
  const [editingOwner, setEditingOwner] = useState(false);
  const [ownerDraft, setOwnerDraft] = useState<any>({});
  const [quickFillText, setQuickFillText] = useState("");
  // Case history notes
  const [showAddNote, setShowAddNote] = useState(false);
  const [newNoteType, setNewNoteType] = useState("note");
  const [newNoteText, setNewNoteText] = useState("");
  const [newNoteDocsLink, setNewNoteDocsLink] = useState("");

  const { data: pp, isLoading } = trpc.paypal.getById.useQuery(
    { projectId: projectId!, id: params.id as string },
    { enabled: !!projectId && !!params.id }
  );

  const { data: emailsData, refetch: refetchEmails } = trpc.paypalEmail.list.useQuery(
    { projectId: projectId!, paypalId: params.id as string },
    { enabled: !!projectId && !!params.id }
  );

  const invalidate = () => { utils.paypal.getById.invalidate(); refetchEmails(); };

  const updatePaypal = trpc.paypal.update.useMutation({
    onSuccess: () => { invalidate(); setEditingDetails(false); setEditingOwner(false); toast.success("Đã cập nhật"); },
    onError: (e) => toast.error(e.message),
  });

  const addCaseNote = trpc.paypal.addCaseNote.useMutation({
    onSuccess: () => { invalidate(); setShowAddNote(false); setNewNoteText(""); setNewNoteDocsLink(""); setNewNoteType("note"); toast.success("Đã thêm ghi chú"); },
    onError: (e) => toast.error(e.message),
  });

  const deleteCaseNote = trpc.paypal.deleteCaseNote.useMutation({
    onSuccess: () => { invalidate(); toast.success("Đã xóa"); },
    onError: (e) => toast.error(e.message),
  });

  const deleteEmail = trpc.paypalEmail.delete.useMutation({
    onSuccess: () => { invalidate(); toast.success("Email đã xóa"); },
    onError: (e) => toast.error(e.message),
  });

  const updateEmail = trpc.paypalEmail.update.useMutation({
    onSuccess: () => { invalidate(); setEditingEmail(null); toast.success("Đã cập nhật"); },
    onError: (e) => toast.error(e.message),
  });

  const canEdit = currentRole === "ADMIN" || currentRole === "MODERATOR" || currentRole === "USER";

  const emails = emailsData ?? [];

  // Parse bulk text for adding emails
  const parsedBulk = useMemo(() => {
    return bulkText.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
      const sep = line.includes("\t") ? "\t" : line.includes("|") ? "|" : null;
      if (sep) {
        const parts = line.split(sep).map((p) => p.trim());
        return { email: parts[0] || "", password: parts[1] || "", twoFa: parts[2] || "", hotmailToken: parts[3] || "" };
      }
      return { email: line, password: "", twoFa: "", hotmailToken: "" };
    });
  }, [bulkText]);

  const validBulk = parsedBulk.filter((p) => p.email.includes("@"));

  const saveBulkEmails = async () => {
    if (!validBulk.length) return;
    setSavingEmails(true);
    try {
      const result = await trpcVanilla.paypalEmail.bulkCreate.mutate({
        projectId: projectId!,
        paypalId: params.id as string,
        items: validBulk.map((r, i) => ({
          email: r.email,
          password: r.password || undefined,
          twoFa: r.twoFa || undefined,
          hotmailToken: r.hotmailToken || undefined,
          isPrimary: emails.length === 0 && i === 0,
        })),
      });
      toast.success(`Đã thêm ${result.created} email`);
      setBulkText("");
      setShowAddEmail(false);
      invalidate();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingEmails(false);
    }
  };

  const caseHistory = useMemo(() => {
    return Array.isArray(pp?.caseHistory) ? (pp.caseHistory as any[]) : [];
  }, [pp?.caseHistory]);

  if (!projectId) return <p className="text-gray-500 p-8">Select a project.</p>;
  if (isLoading) return <p className="p-8">Loading...</p>;
  if (!pp) return <p className="p-8">PayPal account not found.</p>;

  return (
    <div className="space-y-6">
      <PinVerifyDialog open={showPinDialog} onClose={() => setShowPinDialog(false)}
        onVerified={() => { setPinVerified(true); setShowPinDialog(false); }}
        title="PIN Required" description="Nhập PIN để xem thông tin nhạy cảm" />

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-500">
        <Link href="/paypals" className="hover:text-blue-600 transition-colors">PayPal Accounts</Link>
        <span>/</span>
        <span className="font-medium text-gray-900">{pp.code}</span>
      </nav>

      <div className="flex items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{pp.code}</h1>
          <p className="text-gray-500">{pp.primaryEmail}</p>
        </div>
        <div className="flex gap-2">
          <Badge className="bg-green-100 text-green-800">{pp.status}</Badge>
          <Badge variant="outline">{pp.role}</Badge>
          <Badge variant="outline">{pp.company}</Badge>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="Total Received" value={formatCurrency(Number(pp.totalReceived))} />
        <StatCard title="Total Withdrawn" value={formatCurrency(Number(pp.totalWithdrawn))} />
        <StatCard title="Current Balance" value={formatCurrency(pp.currentBalance)} trend={pp.currentBalance > 0 ? "up" : "neutral"} />
      </div>

      {/* ═══════════════════════════════════════ */}
      {/* 180-DAY ALERT */}
      {/* ═══════════════════════════════════════ */}
      {(() => {
        const isSuspended = pp.status === "SUSPENDED";
        const isLimited = pp.status === "LIMITED";
        const dateStr = pp.suspendedAt || pp.limitedAt;
        if (!isSuspended && !isLimited) return null;

        const startDate = dateStr ? new Date(dateStr) : null;
        const deadline = startDate ? new Date(startDate.getTime() + 180 * 24 * 60 * 60 * 1000) : null;
        const now = new Date();
        const daysLeft = deadline ? Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
        const daysPassed = startDate ? Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) : null;

        const bgColor = isSuspended ? "bg-red-50 border-red-300" : "bg-amber-50 border-amber-300";
        const textColor = isSuspended ? "text-red-800" : "text-amber-800";
        const iconColor = isSuspended ? "text-red-500" : "text-amber-500";

        return (
          <div className={`rounded-lg border-2 p-4 ${bgColor}`}>
            <div className="flex items-start gap-3">
              <svg className={`w-6 h-6 shrink-0 mt-0.5 ${iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <div className="flex-1">
                <h3 className={`font-semibold ${textColor}`}>
                  {isSuspended ? "Tài khoản bị Suspend vĩnh viễn" : "Tài khoản bị Limited - Cần Updocs"}
                </h3>
                {startDate && (
                  <p className="text-sm mt-1">
                    <span className="text-gray-600">Ngày bắt đầu: </span>
                    <span className="font-medium">{formatDate(startDate)}</span>
                    <span className="text-gray-400 ml-2">({daysPassed} ngày trước)</span>
                  </p>
                )}
                {deadline && daysLeft !== null && (
                  <div className="mt-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">Deadline rút tiền (180 ngày):</span>
                      <span className={`font-bold text-sm ${daysLeft <= 0 ? "text-red-700" : daysLeft <= 14 ? "text-red-600" : daysLeft <= 30 ? "text-amber-600" : "text-green-700"}`}>
                        {daysLeft <= 0 ? "HẾT HẠN - RÚT TIỀN NGAY!" : `${daysLeft} ngày còn lại`}
                      </span>
                    </div>
                    <div className="mt-1.5 w-full bg-gray-200 rounded-full h-2.5">
                      <div className={`h-2.5 rounded-full ${daysLeft <= 0 ? "bg-red-600" : daysLeft <= 30 ? "bg-amber-500" : "bg-green-500"}`}
                        style={{ width: `${Math.min(100, Math.max(0, ((180 - (daysLeft > 0 ? daysLeft : 0)) / 180) * 100))}%` }} />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Deadline: {formatDate(deadline)}</p>
                  </div>
                )}
                {isLimited && !startDate && canEdit && (
                  <div className="mt-2">
                    <p className="text-sm text-amber-700 mb-1.5">Cần xử lý updocs. Nếu không xử lý được, đặt countdown 180 ngày:</p>
                    <button onClick={() => {
                      updatePaypal.mutate({ projectId: projectId!, id: pp.id, limitedAt: new Date().toISOString() });
                    }} className="px-3 py-1.5 bg-amber-600 text-white rounded text-xs font-medium hover:bg-amber-700">
                      Đặt 180 ngày rút tiền
                    </button>
                  </div>
                )}
                {isSuspended && !startDate && canEdit && (
                  <div className="mt-2">
                    <button onClick={() => {
                      updatePaypal.mutate({ projectId: projectId!, id: pp.id, suspendedAt: new Date().toISOString() });
                    }} className="px-3 py-1.5 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700">
                      Đặt ngày suspend (bắt đầu đếm 180 ngày)
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════════════════════════════════════ */}
      {/* EMAILS MANAGEMENT */}
      {/* ═══════════════════════════════════════ */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Emails ({emails.length})</h2>
          {canEdit && (
            <button onClick={() => setShowAddEmail(!showAddEmail)}
              className={`px-3 py-1.5 rounded text-xs font-medium ${showAddEmail ? "bg-gray-600 text-white" : "bg-blue-600 text-white hover:bg-blue-700"}`}>
              {showAddEmail ? "Đóng" : "+ Thêm Email"}
            </button>
          )}
        </div>

        {/* Add Email Panel */}
        {showAddEmail && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 space-y-3">
            <p className="text-xs text-gray-500">Paste dữ liệu email (mỗi dòng 1 email). Cột: Email | Password | 2FA | Token — hoặc chỉ email</p>
            <textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)}
              rows={4} autoComplete="off" data-lpignore="true" data-1p-ignore data-form-type="other"
              className="w-full px-3 py-2 border rounded text-xs font-mono focus:ring-1 focus:ring-blue-500 focus:outline-none bg-white resize-y"
              placeholder={"user1@hotmail.com|Mi#o*AKxoOzk7G|AZKU IYVS 3RYR 5VBR|token123\nuser2@outlook.com|password2\nuser3@gmail.com"} />
            {parsedBulk.length > 0 && (
              <div className="bg-white border rounded overflow-auto max-h-[160px]">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-100 sticky top-0"><tr>
                    <th className="px-2 py-1 text-left text-gray-500">#</th>
                    <th className="px-2 py-1 text-left text-gray-500">Email</th>
                    <th className="px-2 py-1 text-left text-gray-500">Pass</th>
                    <th className="px-2 py-1 text-left text-gray-500">2FA</th>
                    <th className="px-2 py-1 text-left text-gray-500">Token</th>
                  </tr></thead>
                  <tbody className="divide-y">
                    {parsedBulk.map((r, i) => (
                      <tr key={i} className={r.email.includes("@") ? "" : "bg-red-50"}>
                        <td className="px-2 py-0.5 text-gray-400">{i + 1}</td>
                        <td className="px-2 py-0.5 font-mono">{r.email}</td>
                        <td className="px-2 py-0.5">{r.password ? "••••" : "—"}</td>
                        <td className="px-2 py-0.5">{r.twoFa ? "••••" : "—"}</td>
                        <td className="px-2 py-0.5">{r.hotmailToken ? "••••" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center gap-2">
              <button onClick={saveBulkEmails} disabled={savingEmails || !validBulk.length}
                className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {savingEmails ? "Đang thêm..." : `Thêm ${validBulk.length} email`}
              </button>
              <button onClick={() => { setShowAddEmail(false); setBulkText(""); }}
                className="px-3 py-1.5 bg-gray-200 rounded text-sm hover:bg-gray-300">Hủy</button>
            </div>
          </div>
        )}

        {/* Emails Table */}
        {emails.length === 0 ? (
          <p className="text-sm text-gray-500">Chưa có email nào. Thêm email để quản lý credentials.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 text-xs">
                  <th className="pb-2 pr-2">#</th>
                  <th className="pb-2 pr-2">Email</th>
                  <th className="pb-2 pr-2">Primary</th>
                  <th className="pb-2 pr-2">Password</th>
                  <th className="pb-2 pr-2">2FA</th>
                  <th className="pb-2 pr-2">Token</th>
                  <th className="pb-2 pr-2 text-right">Tổng nhận</th>
                  <th className="pb-2 pr-2">Ghi chú</th>
                  {canEdit && <th className="pb-2"></th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {emails.map((email: any, idx: number) => (
                  <tr key={email.id} className="hover:bg-gray-50">
                    <td className="py-2 pr-2 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-1.5">
                        {editingEmail?.id === email.id ? (
                          <input value={editingEmail.email} onChange={(e) => setEditingEmail({ ...editingEmail, email: e.target.value })}
                            className="px-1.5 py-0.5 border rounded text-xs w-[200px]" />
                        ) : (
                          <span className="font-mono text-xs">{email.email}</span>
                        )}
                        <CopyBtn value={email.email} />
                      </div>
                    </td>
                    <td className="py-2 pr-2">
                      {email.isPrimary ? (
                        <Badge className="bg-blue-100 text-blue-800 text-[10px]">Primary</Badge>
                      ) : canEdit ? (
                        <button onClick={() => updateEmail.mutate({ projectId: projectId!, id: email.id, isPrimary: true })}
                          className="text-[10px] text-gray-400 hover:text-blue-600">Set primary</button>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2">
                      <SecretField emailId={email.id} field="password" projectId={projectId!}
                        pinVerified={pinVerified} onNeedPin={() => setShowPinDialog(true)} />
                    </td>
                    <td className="py-2 pr-2">
                      <SecretField emailId={email.id} field="twoFa" projectId={projectId!}
                        pinVerified={pinVerified} onNeedPin={() => setShowPinDialog(true)} />
                    </td>
                    <td className="py-2 pr-2">
                      <SecretField emailId={email.id} field="hotmailToken" projectId={projectId!}
                        pinVerified={pinVerified} onNeedPin={() => setShowPinDialog(true)} />
                    </td>
                    <td className="py-2 pr-2 text-right font-mono text-xs">
                      {email.totalReceived > 0 ? (
                        <span className="text-green-700">${Number(email.totalReceived).toFixed(2)}</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-xs text-gray-500 max-w-[120px]">
                      {editingEmail?.id === email.id ? (
                        <input value={editingEmail.notes ?? ""} onChange={(e) => setEditingEmail({ ...editingEmail, notes: e.target.value })}
                          className="px-1.5 py-0.5 border rounded text-xs w-full" placeholder="notes..." />
                      ) : (
                        <span className="truncate block">{email.notes || "—"}</span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="py-2 text-right">
                        <div className="flex items-center gap-1 justify-end">
                          {editingEmail?.id === email.id ? (
                            <>
                              <button onClick={() => {
                                updateEmail.mutate({
                                  projectId: projectId!, id: email.id,
                                  email: editingEmail.email !== email.email ? editingEmail.email : undefined,
                                  notes: editingEmail.notes !== email.notes ? editingEmail.notes : undefined,
                                });
                              }} className="text-green-600 hover:text-green-800" title="Save">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                              </button>
                              <button onClick={() => setEditingEmail(null)} className="text-gray-400 hover:text-gray-600" title="Cancel">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                              </button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => setEditingEmail({ id: email.id, email: email.email, notes: email.notes })}
                                className="text-gray-400 hover:text-blue-600" title="Edit">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                              </button>
                              <button onClick={() => {
                                if (!confirm(`Xóa email ${email.email}?`)) return;
                                deleteEmail.mutate({ projectId: projectId!, id: email.id });
                              }} className="text-gray-400 hover:text-red-600" title="Delete">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ═══ CARD 1: Thông tin tài khoản ═══ */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Thông tin tài khoản</h2>
          {canEdit && !editingDetails && (
            <button onClick={() => {
              setDetailsDraft({
                holder: pp.holder ?? "", vmppCode: pp.vmppCode ?? "", bankCode: pp.bankCode ?? "",
                limitNote: pp.limitNote ?? "", notes: pp.notes ?? "",
                status: pp.status,
              });
              setEditingDetails(true);
            }} className="text-gray-400 hover:text-blue-600" title="Edit">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
            </button>
          )}
        </div>
        {editingDetails ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Status</label>
                <select value={detailsDraft.status} onChange={(e) => setDetailsDraft((prev: any) => ({ ...prev, status: e.target.value }))}
                  className="w-full px-2 py-1.5 border rounded text-sm bg-white">
                  {["ACTIVE", "LIMITED", "SUSPENDED"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {([
                ["holder", "User Win"],
                ["vmppCode", "VMPP Code"],
                ["bankCode", "Bank Code"],
                ["limitNote", "Limit Note"],
              ] as [string, string][]).map(([key, label]) => (
                <div key={key}>
                  <label className="block text-xs text-gray-500 mb-0.5">{label}</label>
                  <input value={detailsDraft[key] ?? ""} onChange={(e) => setDetailsDraft((prev: any) => ({ ...prev, [key]: e.target.value }))}
                    className="w-full px-2 py-1.5 border rounded text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none" />
                </div>
              ))}
              <div className="col-span-2 md:col-span-3">
                <label className="block text-xs text-gray-500 mb-0.5">Notes</label>
                <textarea value={detailsDraft.notes ?? ""} onChange={(e) => setDetailsDraft((prev: any) => ({ ...prev, notes: e.target.value }))}
                  rows={2} className="w-full px-2 py-1.5 border rounded text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none resize-y" />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button onClick={() => {
                const payload: any = { projectId: projectId!, id: pp.id };
                ["holder", "vmppCode", "bankCode", "limitNote", "notes", "status"].forEach((f) => {
                  if (detailsDraft[f] !== (pp as any)[f]) payload[f] = detailsDraft[f] || null;
                });
                if (detailsDraft.status) payload.status = detailsDraft.status;
                updatePaypal.mutate(payload);
              }} disabled={updatePaypal.isPending}
                className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {updatePaypal.isPending ? "Đang lưu..." : "Lưu"}
              </button>
              <button onClick={() => setEditingDetails(false)}
                className="px-3 py-1.5 bg-gray-200 rounded text-sm hover:bg-gray-300">Hủy</button>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div><dt className="text-gray-500 text-xs">Status</dt><dd><Badge className={`text-[10px] ${pp.status === "ACTIVE" ? "bg-green-100 text-green-800" : pp.status === "LIMITED" ? "bg-yellow-100 text-yellow-800" : pp.status === "SUSPENDED" ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-800"}`}>{pp.status}</Badge></dd></div>
            <div><dt className="text-gray-500 text-xs">User Win</dt><dd>{pp.holder || "—"}</dd></div>
            <div><dt className="text-gray-500 text-xs">VMPP Code</dt><dd className="font-mono">{pp.vmppCode || "—"}</dd></div>
            <div><dt className="text-gray-500 text-xs">Bank Code</dt><dd>{pp.bankCode || "—"}</dd></div>
            {pp.limitNote && <div><dt className="text-gray-500 text-xs">Limit Note</dt><dd className="text-amber-700">{pp.limitNote}</dd></div>}
            <div className="col-span-2 md:col-span-3"><dt className="text-gray-500 text-xs">Notes</dt><dd>{pp.notes || "—"}</dd></div>
          </dl>
        )}
      </div>

      {/* ═══ CARD 2: Thông tin chủ tài khoản ═══ */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Thông tin chủ tài khoản</h2>
          {canEdit && !editingOwner && (
            <button onClick={() => {
              setOwnerDraft({
                holderName: pp.holderName ?? "", dateOfBirth: pp.dateOfBirth ?? "", idNumber: pp.idNumber ?? "",
                address: pp.address ?? "", phone: pp.phone ?? "", docsLink: pp.docsLink ?? "",
              });
              setEditingOwner(true);
            }} className="text-gray-400 hover:text-blue-600" title="Edit">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
            </button>
          )}
        </div>
        {editingOwner ? (
          <div className="space-y-3">
            {/* Quick Fill */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <label className="block text-xs font-medium text-amber-800 mb-1">Nhập nhanh (Tên | Ngày sinh | CCCD | Địa chỉ | SĐT | Docs Link)</label>
              <div className="flex gap-2">
                <input value={quickFillText} onChange={(e) => setQuickFillText(e.target.value)}
                  className="flex-1 px-2 py-1.5 border rounded text-xs font-mono focus:ring-1 focus:ring-amber-500 focus:outline-none"
                  placeholder="DO HUY HOANG    15/05/1984    82184013563    Ap Trung,Long Dinh...    815112306    https://drive.google.com/..." />
                <button onClick={() => {
                  const parts = quickFillText.includes("\t")
                    ? quickFillText.split("\t").map((p) => p.trim()).filter(Boolean)
                    : quickFillText.includes("|")
                    ? quickFillText.split("|").map((p) => p.trim()).filter(Boolean)
                    : quickFillText.split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
                  setOwnerDraft((prev: any) => ({
                    ...prev,
                    holderName: parts[0] || prev.holderName,
                    dateOfBirth: parts[1] || prev.dateOfBirth,
                    idNumber: parts[2] || prev.idNumber,
                    address: parts[3] || prev.address,
                    phone: parts[4] || prev.phone,
                    docsLink: parts[5] || prev.docsLink,
                  }));
                  setQuickFillText("");
                  toast.success("Đã điền!");
                }} disabled={!quickFillText.trim()}
                  className="px-3 py-1.5 bg-amber-600 text-white rounded text-xs font-medium hover:bg-amber-700 disabled:opacity-50 shrink-0">
                  Điền
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {([
                ["holderName", "Tên chủ TK"],
                ["dateOfBirth", "Ngày sinh"],
                ["idNumber", "Số CCCD"],
                ["phone", "SĐT"],
              ] as [string, string][]).map(([key, label]) => (
                <div key={key}>
                  <label className="block text-xs text-gray-500 mb-0.5">{label}</label>
                  <input value={ownerDraft[key] ?? ""} onChange={(e) => setOwnerDraft((prev: any) => ({ ...prev, [key]: e.target.value }))}
                    className="w-full px-2 py-1.5 border rounded text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none" />
                </div>
              ))}
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-0.5">Địa chỉ</label>
                <input value={ownerDraft.address ?? ""} onChange={(e) => setOwnerDraft((prev: any) => ({ ...prev, address: e.target.value }))}
                  className="w-full px-2 py-1.5 border rounded text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none" />
              </div>
              <div className="col-span-2 md:col-span-3">
                <label className="block text-xs text-gray-500 mb-0.5">Link Docs</label>
                <input value={ownerDraft.docsLink ?? ""} onChange={(e) => setOwnerDraft((prev: any) => ({ ...prev, docsLink: e.target.value }))}
                  className="w-full px-2 py-1.5 border rounded text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  placeholder="https://drive.google.com/..." />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button onClick={() => {
                const payload: any = { projectId: projectId!, id: pp.id };
                ["holderName", "dateOfBirth", "idNumber", "address", "phone", "docsLink"].forEach((f) => {
                  if (ownerDraft[f] !== (pp as any)[f]) payload[f] = ownerDraft[f] || null;
                });
                updatePaypal.mutate(payload);
              }} disabled={updatePaypal.isPending}
                className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {updatePaypal.isPending ? "Đang lưu..." : "Lưu"}
              </button>
              <button onClick={() => setEditingOwner(false)}
                className="px-3 py-1.5 bg-gray-200 rounded text-sm hover:bg-gray-300">Hủy</button>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div><dt className="text-gray-500 text-xs">Tên chủ TK</dt><dd className="font-medium">{pp.holderName || "—"}</dd></div>
            <div><dt className="text-gray-500 text-xs">Ngày sinh</dt><dd>{pp.dateOfBirth || "—"}</dd></div>
            <div><dt className="text-gray-500 text-xs">Số CCCD</dt><dd className="font-mono">{pp.idNumber || "—"}</dd></div>
            <div><dt className="text-gray-500 text-xs">SĐT</dt><dd>{pp.phone || "—"}</dd></div>
            <div className="col-span-2"><dt className="text-gray-500 text-xs">Địa chỉ</dt><dd>{pp.address || "—"}</dd></div>
            {pp.docsLink && (
              <div className="col-span-2 md:col-span-3"><dt className="text-gray-500 text-xs">Docs</dt><dd><a href={pp.docsLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs break-all">{pp.docsLink}</a></dd></div>
            )}
          </dl>
        )}
      </div>

      {/* ═══ CARD 3: Lịch sử xử lý ═══ */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Lịch sử xử lý</h2>
          {canEdit && (
            <button onClick={() => setShowAddNote(true)}
              className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700">
              + Thêm ghi chú
            </button>
          )}
        </div>
        {/* Add Note Form */}
        {showAddNote && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Loại</label>
                <select value={newNoteType} onChange={(e) => setNewNoteType(e.target.value)}
                  className="w-full px-2 py-1.5 border rounded text-sm bg-white">
                  <option value="note">Ghi chú chung</option>
                  <option value="limit">Bị Limit</option>
                  <option value="suspend">Bị Suspend</option>
                  <option value="updocs">Yêu cầu Updocs</option>
                  <option value="resolve">Đã gỡ / Giải quyết</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Link Docs (tùy chọn)</label>
                <input value={newNoteDocsLink} onChange={(e) => setNewNoteDocsLink(e.target.value)}
                  className="w-full px-2 py-1.5 border rounded text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  placeholder="https://drive.google.com/..." />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Nội dung</label>
              <textarea value={newNoteText} onChange={(e) => setNewNoteText(e.target.value)}
                rows={2} className="w-full px-2 py-1.5 border rounded text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none resize-y"
                placeholder="Mô tả chi tiết tình trạng, bước xử lý..." />
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => {
                if (!newNoteText.trim()) { toast.error("Nhập nội dung"); return; }
                addCaseNote.mutate({
                  projectId: projectId!, id: pp.id,
                  type: newNoteType as any,
                  note: newNoteText,
                  docsLink: newNoteDocsLink || undefined,
                });
              }} disabled={addCaseNote.isPending}
                className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {addCaseNote.isPending ? "Đang lưu..." : "Lưu ghi chú"}
              </button>
              <button onClick={() => { setShowAddNote(false); setNewNoteText(""); setNewNoteDocsLink(""); }}
                className="px-3 py-1.5 bg-gray-200 rounded text-sm hover:bg-gray-300">Hủy</button>
            </div>
          </div>
        )}
        {/* Timeline */}
        {caseHistory.length === 0 ? (
          <p className="text-sm text-gray-500">Chưa có lịch sử xử lý.</p>
        ) : (
          <div className="space-y-3">
            {caseHistory.map((entry: any, idx: number) => {
              const typeColors: Record<string, string> = {
                limit: "bg-yellow-100 text-yellow-800 border-yellow-300",
                suspend: "bg-red-100 text-red-800 border-red-300",
                updocs: "bg-orange-100 text-orange-800 border-orange-300",
                resolve: "bg-green-100 text-green-800 border-green-300",
                note: "bg-gray-100 text-gray-800 border-gray-300",
              };
              const typeLabels: Record<string, string> = {
                limit: "Bị Limit", suspend: "Bị Suspend", updocs: "Updocs", resolve: "Đã gỡ", note: "Ghi chú",
              };
              return (
                <div key={idx} className={`border-l-4 rounded-r-lg p-3 ${typeColors[entry.type] || typeColors.note}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Badge className={`text-[10px] ${typeColors[entry.type] || ""}`}>{typeLabels[entry.type] || entry.type}</Badge>
                      <span className="text-xs text-gray-500">{entry.date ? formatDate(new Date(entry.date)) : "—"}</span>
                    </div>
                    {canEdit && (
                      <button onClick={() => {
                        if (!confirm("Xóa ghi chú này?")) return;
                        deleteCaseNote.mutate({ projectId: projectId!, id: pp.id, noteIndex: idx });
                      }} className="text-gray-400 hover:text-red-500" title="Xóa">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>
                  <p className="text-sm">{entry.note}</p>
                  {entry.docsLink && (
                    <a href={entry.docsLink} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline mt-1 inline-block break-all">{entry.docsLink}</a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* EarnApp Usage */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-4">
          EarnApp Accounts
          {pp.earnAppUsage?.length > 0 && <span className="text-sm font-normal text-gray-500 ml-2">({pp.earnAppUsage.length} VMs)</span>}
        </h2>
        {pp.gmails.length > 0 && (
          <div className="mb-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Linked Gmail Accounts ({pp.gmails.length})</h3>
            <div className="flex flex-wrap gap-2">
              {pp.gmails.map((g: any) => (
                <div key={g.id} className="flex items-center gap-1.5 bg-gray-50 rounded px-2 py-1 text-xs">
                  <Badge variant="outline" className="text-[10px]">{g.status}</Badge>
                  <span>{g.email}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {pp.earnAppUsage?.length > 0 ? (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs">
                <th className="pb-2 pr-3">VM</th>
                <th className="pb-2 pr-3">Server</th>
                <th className="pb-2 pr-3">Gmail (EarnApp)</th>
                <th className="pb-2 pr-3 text-right">Số lần nhận</th>
                <th className="pb-2 text-right">Tổng tiền</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pp.earnAppUsage.map((u: any, i: number) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="py-2 pr-3 font-mono text-xs font-medium">{u.vmCode}</td>
                  <td className="py-2 pr-3 text-xs text-gray-600">{u.serverCode}</td>
                  <td className="py-2 pr-3 text-xs">{u.gmailEmail}</td>
                  <td className="py-2 pr-3 text-right text-xs">{u.txCount}</td>
                  <td className="py-2 text-right font-mono text-xs text-green-700">${u.totalAmount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-500">Chưa có dữ liệu EarnApp.</p>
        )}
      </div>

      {/* Recent Funds */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-4">Recent Fund Transactions</h2>
        {pp.fundsReceived.length === 0 ? (
          <p className="text-sm text-gray-500">No fund transactions.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="pb-2">Date</th>
                <th className="pb-2">Amount</th>
                <th className="pb-2">TX ID</th>
                <th className="pb-2">Email</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pp.fundsReceived.map((f: any) => (
                <tr key={f.id}>
                  <td className="py-2">{formatDate(f.date)}</td>
                  <td className="py-2 font-medium text-green-700">{formatCurrency(Number(f.amount))}</td>
                  <td className="py-2 text-gray-600">{f.transactionId}</td>
                  <td className="py-2 text-xs text-gray-500">{f.paypalEmailId ? emails.find((e: any) => e.id === f.paypalEmailId)?.email || "—" : "—"}</td>
                  <td className="py-2">
                    {f.confirmed ? (
                      <Badge className="bg-green-100 text-green-800 text-xs">Confirmed</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs border-yellow-500 text-yellow-700">Pending</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent Withdrawals */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-4">Recent Withdrawals (from this PP)</h2>
        {pp.withdrawalsFrom.length === 0 ? (
          <p className="text-sm text-gray-500">No withdrawals.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="pb-2">Date</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Amount</th>
                <th className="pb-2">Agent/Dest</th>
                <th className="pb-2">Code</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pp.withdrawalsFrom.map((w: any) => (
                <tr key={w.id}>
                  <td className="py-2">{formatDate(w.date)}</td>
                  <td className="py-2"><Badge variant="outline" className="text-xs">{w.type}</Badge></td>
                  <td className="py-2 font-medium">{formatCurrency(Number(w.amount))}</td>
                  <td className="py-2">{w.agent || w.destPaypal?.code || "—"}</td>
                  <td className="py-2 text-gray-600">{w.withdrawCode || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
