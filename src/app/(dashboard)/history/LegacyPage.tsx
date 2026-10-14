"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/lib/i18n";
import toast from "react-hot-toast";

const ENTITY_LABELS: Record<string, string> = {
  PayPalAccount: "PayPal",
  PayPalEmail: "Email PP",
  FundTransaction: "Fund",
  Withdrawal: "Rút tiền",
  Server: "Server",
  VirtualMachine: "VM",
  GmailAccount: "Gmail",
  CostRecord: "Chi phí",
  Project: "Dự án",
};

const FIELD_LABEL_KEYS: Record<string, string> = {
  code: "history_field_pp_code",
  primaryEmail: "history_field_primary_email",
  holder: "history_field_holder",
  vmppCode: "history_field_vmpp_code",
  status: "pp_col_status",
  notes: "notes_label",
  limitNote: "history_field_limit_note",
  company: "history_field_company",
  name: "history_field_name",
  amount: "amount_label",
  confirmed: "history_field_confirmed",
  failed: "history_field_failed",
  transactionId: "history_field_transaction_id",
};

export default function HistoryPage() {
  const t = useT();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [entity, setEntity] = useState("");

  const { data: history, isLoading, refetch } = trpc.editHistory.list.useQuery(
    { projectId: projectId!, entity: entity || undefined, limit: 200 },
    { enabled: !!projectId }
  );

  const revert = trpc.editHistory.revert.useMutation({
    onSuccess: () => { refetch(); toast.success(t("history_reverted_success")); },
    onError: (e) => toast.error(e.message),
  });

  if (!projectId) return <p className="text-gray-500 p-8">{t("select_project_first")}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("edit_history_title")}</h1>
          <p className="text-sm text-gray-500">{t("edit_history_subtitle")}</p>
        </div>
        <select value={entity} onChange={(e) => setEntity(e.target.value)}
          className="px-3 py-1.5 border rounded text-sm">
          <option value="">{t("all")}</option>
          <option value="PayPalAccount">PayPal</option>
          <option value="FundTransaction">Fund</option>
          <option value="PayPalEmail">Email PP</option>
          <option value="Server">Server</option>
          <option value="Project">Dự án</option>
        </select>
      </div>

      {isLoading ? (
        <p className="text-gray-400 p-4">Đang tải...</p>
      ) : !history || history.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center text-gray-400">
          Chưa có thay đổi nào trong 30 ngày qua
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-2.5 text-left text-gray-500 text-xs">Thời gian</th>
                <th className="px-4 py-2.5 text-left text-gray-500 text-xs">Người sửa</th>
                <th className="px-4 py-2.5 text-left text-gray-500 text-xs">Đối tượng</th>
                <th className="px-4 py-2.5 text-left text-gray-500 text-xs">Trường</th>
                <th className="px-4 py-2.5 text-left text-gray-500 text-xs">Giá trị cũ</th>
                <th className="px-4 py-2.5 text-left text-gray-500 text-xs">Giá trị mới</th>
                <th className="px-4 py-2.5 text-center text-gray-500 text-xs w-24">Hoàn tác</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {history.map((h: any) => {
                const date = new Date(h.createdAt);
                return (
                  <tr key={h.id} className={`hover:bg-gray-50 ${h.reverted ? "opacity-50" : ""}`}>
                    <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">
                      <div>{date.toLocaleDateString("vi-VN")}</div>
                      <div className="text-gray-400">{date.toLocaleTimeString("vi-VN")}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs font-medium text-gray-700">{h.user?.name || h.user?.username || "?"}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="text-[10px]">{ENTITY_LABELS[h.entity] || h.entity}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs font-medium text-gray-700">
                      {t(FIELD_LABEL_KEYS[h.field] || h.field)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs font-mono bg-red-50 text-red-700 px-1.5 py-0.5 rounded break-all">
                        {h.oldValue || <span className="text-gray-300 italic">trống</span>}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs font-mono bg-green-50 text-green-700 px-1.5 py-0.5 rounded break-all">
                        {h.newValue || <span className="text-gray-300 italic">trống</span>}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {h.reverted ? (
                        <span className="text-[10px] text-gray-400">Đã hoàn tác</span>
                      ) : (
                        <button
                          onClick={() => {
                            if (confirm(`Hoàn tác: ${t(FIELD_LABEL_KEYS[h.field] || h.field)} → "${h.oldValue || "trống"}"?`))
                              revert.mutate({ projectId: projectId!, historyId: h.id });
                          }}
                          disabled={revert.isLoading}
                          className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-[10px] font-semibold hover:bg-blue-200 transition-colors disabled:opacity-50">
                          Hoàn tác
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
