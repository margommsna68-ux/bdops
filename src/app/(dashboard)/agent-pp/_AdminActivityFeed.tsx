"use client";

import { trpc } from "@/lib/trpc";
import { useT } from "@/lib/i18n";
import { formatCurrency, capitalName } from "@/lib/utils";

function fmtTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" });
}

type TimelineItem = { id: string; time: string; type: "received" | "sold"; desc: string; amount: number };

export function AdminActivityFeed({ projectId }: { projectId: string }) {
  const t = useT();
  const { data, isLoading } = trpc.agentPP.todayActivity.useQuery(
    { projectId },
    { refetchInterval: 30_000 },
  );

  const items: TimelineItem[] = [];
  if (data) {
    for (const w of data.todayWithdrawals) {
      const agent = capitalName(w.agentEmail?.user?.name || w.agentEmail?.user?.username);
      const pp = w.sourcePaypal?.code || "PP";
      items.push({ id: `w-${w.id}`, time: fmtTime(w.date), type: "received", desc: `${agent} ← ${pp}`, amount: Number(w.amount) });
    }
    for (const s of data.todaySales) {
      const agent = capitalName(s.agentUser?.name || s.agentUser?.username);
      items.push({ id: `s-${s.id}`, time: fmtTime(s.date), type: "sold", desc: `${agent} sold`, amount: Number(s.amount) });
    }
    items.sort((a, b) => (b.time > a.time ? 1 : -1));
  }
  const visible = items.slice(0, 15);
  const total = visible.length;

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 sticky top-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="animate-pulse h-8 bg-gray-100 rounded mb-2" />
        ))}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 sticky top-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
        </span>
        <span className="text-sm font-bold text-gray-800">{t("agpp_live_activity")}</span>
        {total > 0 && (
          <span className="ml-auto text-[10px] bg-gray-100 text-gray-600 rounded-full px-2 py-0.5 font-medium">{total}</span>
        )}
      </div>

      {/* Summary bar */}
      {data && (
        <div className="bg-gray-50 rounded-lg px-3 py-2 flex items-center gap-3 mb-3">
          <span className="text-[10px] uppercase text-gray-500 font-semibold">{t("agpp_received_label")}</span>
          <span className="text-xs font-mono font-semibold text-green-700">{formatCurrency(data.totalWithdrawals)}</span>
          <span className="text-gray-300">|</span>
          <span className="text-[10px] uppercase text-gray-500 font-semibold">{t("agpp_sold_label")}</span>
          <span className="text-xs font-mono font-semibold text-blue-700">{formatCurrency(data.totalSales)}</span>
        </div>
      )}

      {/* Timeline */}
      {total === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4">{t("agpp_no_activity")}</p>
      ) : (
        <div className="max-h-[480px] overflow-y-auto">
          {visible.map((item) => (
            <div key={item.id} className="py-2 flex items-center gap-2.5 text-xs border-b border-gray-100 last:border-0">
              <span className="text-[10px] text-gray-400 font-mono w-10 shrink-0">{item.time}</span>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${item.type === "received" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                {item.type === "received" ? "↓" : "↑"}
              </span>
              <span className="text-gray-700 truncate">{item.desc}</span>
              <span className="font-mono font-semibold text-gray-800 ml-auto shrink-0">{formatCurrency(item.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
