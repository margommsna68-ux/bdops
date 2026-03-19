"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { useProjectStore } from "@/lib/store";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard", keywords: "home overview" },
  { label: "Fund Tracking", href: "/funds", keywords: "funds money payment bright data" },
  { label: "Withdrawals", href: "/withdrawals", keywords: "withdraw mixing exchange" },
  { label: "PayPal Accounts", href: "/paypals", keywords: "paypal pp account" },
  { label: "Servers", href: "/infrastructure/servers", keywords: "server machine hardware" },
  { label: "Virtual Machines", href: "/infrastructure/vms", keywords: "vm virtual machine sdk" },
  { label: "Proxy IPs", href: "/infrastructure/proxies", keywords: "proxy ip address subnet" },
  { label: "Gmail Accounts", href: "/gmails", keywords: "gmail email google" },
  { label: "VM Tasks", href: "/vm-tasks", keywords: "task schedule job" },
  { label: "Costs", href: "/costs", keywords: "cost expense server ip" },
  { label: "Profit Split", href: "/profit", keywords: "profit split partner revenue" },
  { label: "Users", href: "/admin/users", keywords: "user admin member role" },
  { label: "Audit Log", href: "/audit-log", keywords: "audit log history" },
  { label: "Settings", href: "/settings", keywords: "settings config" },
  { label: "Agent PayPal", href: "/agent-pp", keywords: "agent paypal dai ly đại lý" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const projectId = useProjectStore((s) => s.currentProjectId);

  // Search data
  const { data: ppData } = trpc.paypal.list.useQuery(
    { projectId: projectId!, page: 1, search: query || undefined },
    { enabled: !!projectId && open && query.length >= 2 }
  );

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const q = query.toLowerCase().trim();

  // Build results
  const results: { type: string; label: string; sub?: string; href: string }[] = [];

  // Nav pages
  const navMatches = q
    ? NAV_ITEMS.filter(
        (n) =>
          n.label.toLowerCase().includes(q) ||
          n.keywords.includes(q)
      )
    : NAV_ITEMS.slice(0, 6);
  navMatches.forEach((n) =>
    results.push({ type: "Page", label: n.label, href: n.href })
  );

  // PayPal results
  if (ppData?.items && query.length >= 2) {
    ppData.items.slice(0, 5).forEach((pp: any) => {
      results.push({
        type: "PayPal",
        label: pp.code,
        sub: pp.primaryEmail,
        href: `/paypals/${pp.id}`,
      });
    });
  }

  const navigate = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    }
    if (e.key === "Enter" && results[selectedIdx]) {
      navigate(results[selectedIdx].href);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Dialog */}
      <div className="relative mx-auto mt-[15vh] w-full max-w-lg">
        <div className="bg-white rounded-xl shadow-2xl border overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b">
            <svg className="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0); }}
              onKeyDown={handleKeyDown}
              className="flex-1 text-sm outline-none placeholder:text-gray-400"
              placeholder="Search pages, PayPal accounts..."
            />
            <kbd className="hidden sm:inline-flex px-1.5 py-0.5 text-[10px] font-mono bg-gray-100 rounded border text-gray-400">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div className="max-h-[50vh] overflow-y-auto py-2">
            {results.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No results found.</p>
            ) : (
              results.map((r, i) => (
                <button
                  key={`${r.type}-${r.href}`}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                    i === selectedIdx ? "bg-blue-50 text-blue-700" : "hover:bg-gray-50"
                  }`}
                  onClick={() => navigate(r.href)}
                  onMouseEnter={() => setSelectedIdx(i)}
                >
                  <span className={`shrink-0 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                    r.type === "Page" ? "bg-gray-100 text-gray-500" : "bg-blue-100 text-blue-600"
                  }`}>
                    {r.type}
                  </span>
                  <span className="font-medium">{r.label}</span>
                  {r.sub && <span className="text-gray-400 text-xs truncate">{r.sub}</span>}
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t bg-gray-50 flex items-center gap-4 text-[10px] text-gray-400">
            <span><kbd className="px-1 py-0.5 bg-white rounded border">↑↓</kbd> Navigate</span>
            <span><kbd className="px-1 py-0.5 bg-white rounded border">↵</kbd> Open</span>
            <span><kbd className="px-1 py-0.5 bg-white rounded border">Esc</kbd> Close</span>
          </div>
        </div>
      </div>
    </div>
  );
}
