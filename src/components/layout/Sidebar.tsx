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
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({ onNavigate, collapsed, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const { currentRole, currentModules } = useProjectStore();

  const isAdmin = currentRole === "ADMIN";
  const isModerator = currentRole === "MODERATOR";
  const hasFullAccess = isAdmin || isModerator;

  const hasModuleAccess = (module: AppModule | null | undefined): boolean => {
    if (!module) return true;
    if (hasFullAccess) return true;
    if (!currentRole) return true;
    return currentModules.includes(module);
  };

  const filteredItems = navItems.filter((item) => {
    if ("type" in item) return true;
    if (item.adminOnly) return isAdmin || isModerator || !currentRole;
    return hasModuleAccess(item.module);
  });

  const visibleItems: NavItem[] = [];
  for (let i = 0; i < filteredItems.length; i++) {
    const item = filteredItems[i];
    if ("type" in item) {
      const nextItem = filteredItems[i + 1];
      if (nextItem && !("type" in nextItem)) {
        visibleItems.push(item);
      }
    } else {
      visibleItems.push(item);
    }
  }

  return (
    <aside className={`${collapsed ? "w-16" : "w-64"} bg-gray-900 text-white min-h-screen flex flex-col shrink-0 transition-all duration-200`}>
      <div className="p-4 border-b border-gray-700 flex items-center justify-between">
        {!collapsed && (
          <div>
            <h1 className="text-xl font-bold">BDOps</h1>
            <p className="text-xs text-gray-400 mt-1">Operations Management</p>
          </div>
        )}
        {collapsed && (
          <span className="text-lg font-bold mx-auto">B</span>
        )}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className={`text-gray-400 hover:text-white transition-colors ${collapsed ? "mx-auto mt-1" : ""}`}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {collapsed ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7M19 19l-7-7 7-7" />
              )}
            </svg>
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="p-3 border-b border-gray-700">
          <ProjectSwitcher />
        </div>
      )}

      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {visibleItems.map((item, i) => {
          if ("type" in item) {
            if (collapsed) return null;
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
              title={collapsed ? item.label : undefined}
              className={`flex items-center ${collapsed ? "justify-center" : "gap-3"} px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? "bg-blue-600 text-white font-medium"
                  : "text-gray-300 hover:bg-gray-800 hover:text-white"
              }`}
            >
              <span className="w-5 h-5 flex items-center justify-center text-xs font-mono bg-gray-700 rounded shrink-0">
                {item.icon}
              </span>
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {currentRole && !collapsed && (
        <div className="px-4 py-2 border-t border-gray-700">
          <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${
            isAdmin ? "bg-red-600" : isModerator ? "bg-yellow-600" : "bg-blue-600"
          }`}>
            {currentRole}
          </span>
        </div>
      )}

      {!collapsed && (
        <div className="p-4 border-t border-gray-700 text-xs text-gray-500">
          BDOps v1.0
        </div>
      )}
    </aside>
  );
}
