"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { useProjectStore } from "@/lib/store";
import type { AppModule } from "@/server/trpc";

type NavItem =
  | { href: string; label: string; icon: string; module?: AppModule | null; adminOnly?: boolean }
  | { type: "separator"; label: string };

const navItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "D", module: null },
  { href: "/funds", label: "Fund Tracking", icon: "$", module: "FUNDS" },
  { href: "/withdrawals", label: "Withdrawals", icon: "W", module: "WITHDRAWALS" },
  { href: "/paypals", label: "PayPal Accounts", icon: "P", module: "PAYPALS" },
  { type: "separator", label: "Infrastructure" },
  { href: "/infrastructure/servers", label: "Servers", icon: "S", module: "INFRASTRUCTURE" },
  { href: "/infrastructure/vms", label: "Virtual Machines", icon: "V", module: "INFRASTRUCTURE" },
  { href: "/infrastructure/proxies", label: "Proxy IPs", icon: "I", module: "INFRASTRUCTURE" },
  { href: "/gmails", label: "Gmail Accounts", icon: "G", module: "INFRASTRUCTURE" },
  { href: "/vm-tasks", label: "VM Tasks", icon: "T", module: "INFRASTRUCTURE" },
  { type: "separator", label: "Finance" },
  { href: "/costs", label: "Costs", icon: "C", module: "COSTS" },
  { href: "/profit", label: "Profit Split", icon: "%", module: "PROFIT" },
  { type: "separator", label: "Admin" },
  { href: "/admin/users", label: "Users", icon: "U", adminOnly: true },
  { href: "/admin/delete-requests", label: "Delete Requests", icon: "X", adminOnly: true },
  { href: "/audit-log", label: "Audit Log", icon: "A", adminOnly: true },
  { href: "/settings", label: "Settings", icon: "*", adminOnly: true },
];

interface SidebarProps {
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const { currentRole, currentModules } = useProjectStore();

  const isAdmin = currentRole === "ADMIN";
  const isModerator = currentRole === "MODERATOR";
  const hasFullAccess = isAdmin || isModerator;

  const hasModuleAccess = (module: AppModule | null | undefined): boolean => {
    if (!module) return true; // Dashboard - always visible
    if (hasFullAccess) return true;
    // If no role set yet (loading), show all modules to avoid empty sidebar
    if (!currentRole) return true;
    return currentModules.includes(module);
  };

  const filteredItems = navItems.filter((item) => {
    if ("type" in item) {
      // Keep separators, we'll handle empty sections below
      return true;
    }
    if (item.adminOnly) {
      // Show admin items if admin/mod, or if role not loaded yet
      return isAdmin || isModerator || !currentRole;
    }
    return hasModuleAccess(item.module);
  });

  // Remove consecutive separators and trailing separators
  const visibleItems: NavItem[] = [];
  for (let i = 0; i < filteredItems.length; i++) {
    const item = filteredItems[i];
    if ("type" in item) {
      // Check if next item is also separator or end of list
      const nextItem = filteredItems[i + 1];
      if (nextItem && !("type" in nextItem)) {
        visibleItems.push(item);
      }
    } else {
      visibleItems.push(item);
    }
  }

  return (
    <aside className="w-64 bg-gray-900 text-white min-h-screen flex flex-col shrink-0">
      <div className="p-4 border-b border-gray-700">
        <h1 className="text-xl font-bold">BDOps</h1>
        <p className="text-xs text-gray-400 mt-1">Operations Management</p>
      </div>

      <div className="p-3 border-b border-gray-700">
        <ProjectSwitcher />
      </div>

      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {visibleItems.map((item, i) => {
          if ("type" in item) {
            return (
              <div key={i} className="pt-4 pb-1 px-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  {item.label}
                </span>
              </div>
            );
          }
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? "bg-blue-600 text-white font-medium"
                  : "text-gray-300 hover:bg-gray-800 hover:text-white"
              }`}
            >
              <span className="w-5 h-5 flex items-center justify-center text-xs font-mono bg-gray-700 rounded">
                {item.icon}
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {currentRole && (
        <div className="px-4 py-2 border-t border-gray-700">
          <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${
            isAdmin ? "bg-red-600" : isModerator ? "bg-yellow-600" : "bg-blue-600"
          }`}>
            {currentRole}
          </span>
        </div>
      )}

      <div className="p-4 border-t border-gray-700 text-xs text-gray-500">
        BDOps v1.0
      </div>
    </aside>
  );
}
