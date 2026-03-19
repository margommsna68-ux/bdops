"use client";

import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";
import { useRouter } from "next/navigation";

const SEVERITY_STYLES = {
  error: "bg-red-50 border-red-200 text-red-800",
  warning: "bg-amber-50 border-amber-200 text-amber-800",
  info: "bg-blue-50 border-blue-200 text-blue-800",
};

const SEVERITY_ICON = {
  error: (
    <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
    </svg>
  ),
  warning: (
    <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  info: (
    <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const projectId = useProjectStore((s) => s.currentProjectId);

  const { data: alerts } = trpc.notification.alerts.useQuery(
    { projectId: projectId! },
    {
      enabled: !!projectId,
      refetchInterval: 30000, // refresh every 30s
    }
  );

  // Dismissed alerts stored in sessionStorage
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("bdops-dismissed-alerts");
      if (saved) setDismissed(new Set(JSON.parse(saved)));
    } catch { /* ignore */ }
  }, []);

  const dismiss = (id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      sessionStorage.setItem("bdops-dismissed-alerts", JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const visibleAlerts = (alerts ?? []).filter((a) => !dismissed.has(a.id));
  const errorCount = visibleAlerts.filter((a) => a.severity === "error").length;
  const totalCount = visibleAlerts.length;

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!projectId) return null;

  return (
    <div className="relative" ref={ref}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
        title="Thông báo"
      >
        <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {/* Badge */}
        {totalCount > 0 && (
          <span className={`absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white rounded-full px-1 ${
            errorCount > 0 ? "bg-red-500" : "bg-amber-500"
          }`}>
            {totalCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-xl border border-gray-200 z-50 max-h-[70vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-900">
              Thông báo
              {totalCount > 0 && (
                <span className="ml-2 text-xs font-normal text-gray-500">({totalCount})</span>
              )}
            </h3>
            {totalCount > 0 && (
              <button
                onClick={() => {
                  const allIds = visibleAlerts.map((a) => a.id);
                  setDismissed((prev) => {
                    const next = new Set(prev);
                    allIds.forEach((id) => next.add(id));
                    sessionStorage.setItem("bdops-dismissed-alerts", JSON.stringify(Array.from(next)));
                    return next;
                  });
                }}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Bỏ qua tất cả
              </button>
            )}
          </div>

          {/* Alert list */}
          <div className="overflow-y-auto flex-1">
            {visibleAlerts.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <svg className="w-10 h-10 text-gray-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-gray-400">Không có thông báo mới</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {visibleAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`px-4 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors cursor-pointer ${SEVERITY_STYLES[alert.severity]}`}
                    onClick={() => {
                      if (alert.link) {
                        router.push(alert.link);
                        setOpen(false);
                      }
                    }}
                  >
                    {SEVERITY_ICON[alert.severity]}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{alert.title}</p>
                      <p className="text-xs opacity-70 mt-0.5">{alert.message}</p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        dismiss(alert.id);
                      }}
                      className="text-gray-400 hover:text-gray-600 shrink-0 p-0.5"
                      title="Bỏ qua"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
