"use client";

import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import toast from "react-hot-toast";
import { useT } from "@/lib/i18n";
import { useSettingsStore } from "@/lib/settings-store";

const ENTITY_LABEL_KEYS: Record<string, string> = {
  PayPalAccount: "audit_entity_paypal",
  PayPalEmail: "audit_entity_paypal_email",
  FundTransaction: "audit_entity_fund",
  Withdrawal: "audit_entity_withdrawal",
  Server: "audit_entity_server",
  VirtualMachine: "audit_entity_vm",
  GmailAccount: "audit_entity_gmail",
  CostRecord: "audit_entity_cost",
  Project: "paypal_detail_project",
};
const FIELD_LABEL_KEYS: Record<string, string> = {
  code: "history_field_pp_code",
  primaryEmail: "history_field_primary_email",
  holder: "history_field_holder",
  vmppCode: "history_field_vmpp_code",
  status: "status_label",
  notes: "notes_label",
  limitNote: "history_field_limit_note",
  company: "history_field_company",
  name: "history_field_name",
  amount: "amount_label",
  confirmed: "history_field_confirmed",
  failed: "history_field_failed",
  transactionId: "history_field_transaction_id",
};

interface Props {
  entity?: string;
  show: boolean;
}

export function PageHistory({ entity, show }: Props) {
  const t = useT();
  const language = useSettingsStore((s) => s.language);
  const dateLocale = language === "vi" ? "vi-VN" : "en-US";
  const projectId = useProjectStore((s) => s.currentProjectId);

  const { data: history, refetch } = trpc.editHistory.list.useQuery(
    { projectId: projectId!, entity: entity || undefined, limit: 50 },
    { enabled: !!projectId && show }
  );

  const revert = trpc.editHistory.revert.useMutation({
    onSuccess: () => { refetch(); toast.success(t("toast_reverted")); },
    onError: (e) => toast.error(e.message),
  });

  if (!projectId || !show) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden animate-slide-up">
      <div className="px-4 py-2 bg-gray-50 border-b flex items-center gap-2">
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-xs font-semibold text-gray-600">{t("edit_history_title")}</span>
        {history && <span className="text-[10px] text-gray-400 ml-auto">{t("page_history_count", { n: history.length })}</span>}
      </div>
      <div className="max-h-[300px] overflow-y-auto">
        {!history || history.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-gray-400">{t("page_history_empty")}</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left text-gray-400">{t("page_history_col_time")}</th>
                <th className="px-3 py-2 text-left text-gray-400">{t("page_history_col_user")}</th>
                <th className="px-3 py-2 text-left text-gray-400">{t("page_history_col_entity")}</th>
                <th className="px-3 py-2 text-left text-gray-400">{t("page_history_col_field")}</th>
                <th className="px-3 py-2 text-left text-gray-400">{t("page_history_col_old")}</th>
                <th className="px-3 py-2 text-left text-gray-400">{t("page_history_col_new")}</th>
                <th className="px-3 py-2 text-center text-gray-400 w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {history.map((h: any) => {
                const d = new Date(h.createdAt);
                return (
                  <tr key={h.id} className={`hover:bg-gray-50 ${h.reverted ? "opacity-40" : ""}`}>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500">
                      {d.toLocaleDateString(dateLocale)} {d.toLocaleTimeString(dateLocale, { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-3 py-2 text-gray-700 font-medium">{h.user?.name || h.user?.username || "?"}</td>
                    <td className="px-3 py-2"><Badge variant="outline" className="text-[9px]">{t(ENTITY_LABEL_KEYS[h.entity] || h.entity)}</Badge></td>
                    <td className="px-3 py-2 font-medium text-gray-700">{t(FIELD_LABEL_KEYS[h.field] || h.field)}</td>
                    <td className="px-3 py-2">
                      <span className="font-mono bg-red-50 text-red-600 px-1 py-0.5 rounded text-[10px] break-all">
                        {h.oldValue || <span className="italic text-gray-300">{t("page_history_empty_value")}</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-mono bg-green-50 text-green-600 px-1 py-0.5 rounded text-[10px] break-all">
                        {h.newValue || <span className="italic text-gray-300">{t("page_history_empty_value")}</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {h.reverted ? (
                        <span className="text-[9px] text-gray-400">{t("page_history_already_reverted")}</span>
                      ) : (
                        <button onClick={() => revert.mutate({ projectId: projectId!, historyId: h.id })}
                          disabled={revert.isLoading}
                          className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-semibold hover:bg-blue-200 disabled:opacity-50">
                          {t("page_history_revert")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
