"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { useProjectStore } from "@/lib/store";
import { useSettingsStore } from "@/lib/settings-store";
import { useT } from "@/lib/i18n";
import type { AppModule } from "@/server/trpc";

type NavItem =
  | { href: string; labelKey: string; icon: string; module?: AppModule | null; adminOnly?: boolean }
  | { type: "separator"; labelKey: string };

const navItems: NavItem[] = [
  // ─── Tổng Quan ───
  { href: "/dashboard", labelKey: "nav_dashboard", icon: "D", module: null },
  // ─── Vận Hành ───
  { type: "separator", labelKey: "nav_operations" },
  { href: "/infrastructure/vms", labelKey: "nav_vms", icon: "E", module: "INFRASTRUCTURE" },
  { href: "/funds", labelKey: "nav_fund_tracking", icon: "$", module: "FUNDS" },
  { href: "/withdrawals", labelKey: "nav_withdrawals", icon: "W", module: "WITHDRAWALS" },
  // ─── Hạ Tầng ───
  { type: "separator", labelKey: "nav_infrastructure" },
  { href: "/infrastructure/servers", labelKey: "nav_servers", icon: "S", module: "INFRASTRUCTURE" },
  { href: "/infrastructure/proxies", labelKey: "nav_proxies", icon: "I", module: "INFRASTRUCTURE" },
  { href: "/paypals", labelKey: "nav_paypal_accounts", icon: "P", module: "PAYPALS" },
  { href: "/gmails", labelKey: "nav_gmails", icon: "G", module: "INFRASTRUCTURE" },
  // ─── Tài Chính ───
  { type: "separator", labelKey: "nav_finance" },
  { href: "/agent-pp", labelKey: "nav_agent_pp", icon: "A", module: "AGENT_PP" },
  { href: "/costs", labelKey: "nav_costs", icon: "C", module: "COSTS" },
  { href: "/profit", labelKey: "nav_profit", icon: "%", module: "PROFIT" },
  // ─── Quản Trị ───
  { type: "separator", labelKey: "nav_admin" },
  { href: "/admin/projects", labelKey: "nav_projects", icon: "P", adminOnly: true },
  { href: "/admin/users", labelKey: "nav_users", icon: "U", adminOnly: true },
  { href: "/audit-log", labelKey: "nav_audit_log", icon: "A", adminOnly: true },
  { href: "/settings", labelKey: "nav_settings", icon: "*" },
];

interface SidebarProps {
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({ onNavigate, collapsed, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { currentRole, currentModules, currentProjectCode } = useProjectStore();
  const theme = useSettingsStore((s) => s.theme);
  const t = useT();

  const isAdmin = currentRole === "ADMIN";
  const isModerator = currentRole === "MODERATOR";
  const isAdminOrMod = isAdmin || isModerator;

  const isGolden = theme === "golden";
  const accentBg = isGolden ? "bg-amber-500" : "bg-[#2563eb]";

  const hasModuleAccess = (module: AppModule | null | undefined): boolean => {
    if (!module) return true;
    if (isAdmin) return true;
    if (!currentRole) return false;
    return currentModules.includes(module);
  };

  const filteredItems = navItems.filter((item) => {
    if ("type" in item) return true;
    if (item.adminOnly) return isAdminOrMod;
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

  const userName = session?.user?.name || "User";
  const userInitial = userName.charAt(0).toUpperCase();

  return (
    <aside className={`${collapsed ? "w-16" : "w-64"} bg-gray-900 text-white min-h-screen flex flex-col shrink-0 transition-all duration-200`}>
      {/* ─── Header ─── */}
      <div className="p-4 border-b border-gray-700/50 flex items-center justify-between">
        {!collapsed && (
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-lg ${isGolden ? "bg-amber-500" : "bg-blue-600"} flex items-center justify-center text-sm font-bold`}>
              B
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight">BDOps</h1>
              <p className="text-[10px] text-gray-400 leading-none">Operations Management</p>
            </div>
          </div>
        )}
        {collapsed && (
          <div className={`w-8 h-8 rounded-lg ${isGolden ? "bg-amber-500" : "bg-blue-600"} flex items-center justify-center text-sm font-bold mx-auto`}>
            B
          </div>
        )}
        {onToggleCollapse && !collapsed && (
          <button
            onClick={onToggleCollapse}
            className="text-gray-400 hover:text-white transition-colors"
            title="Collapse sidebar"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7M19 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        {onToggleCollapse && collapsed && (
          <button
            onClick={onToggleCollapse}
            className="text-gray-400 hover:text-white transition-colors mx-auto mt-1"
            title="Expand sidebar"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      {/* ─── Project Switcher ─── */}
      {!collapsed && (
        <div className="p-3 border-b border-gray-700/50">
          <ProjectSwitcher />
        </div>
      )}
      {collapsed && currentProjectCode && (
        <div className="p-2 border-b border-gray-700/50 flex justify-center">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isGolden ? "bg-amber-500/20 text-amber-300" : "bg-blue-600/20 text-blue-400"}`}>
            {currentProjectCode}
          </span>
        </div>
      )}

      {/* ─── Navigation ─── */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {visibleItems.map((item, i) => {
          if ("type" in item) {
            if (collapsed) return null;
            return (
              <div key={i} className="pt-4 pb-1 px-3">
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${isGolden ? "text-amber-400/70" : "text-gray-400"}`}>
                  {t(item.labelKey)}
                </span>
              </div>
            );
          }
          const isActive =
            pathname === item.href ||
            pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              title={collapsed ? t(item.labelKey) : undefined}
              className={`flex items-center ${collapsed ? "justify-center" : "gap-3"} px-3 py-2.5 rounded-lg text-sm transition-all duration-150 ${
                isActive
                  ? `${accentBg} text-white font-medium shadow-sm`
                  : "text-gray-300 hover:bg-[#1e293b] hover:text-white"
              }`}
            >
              <span className={`w-6 h-6 flex items-center justify-center text-xs font-mono rounded-md shrink-0 ${
                isActive
                  ? "bg-white/20"
                  : "bg-white/5"
              }`}>
                {item.icon}
              </span>
              {!collapsed && <span>{t(item.labelKey)}</span>}
            </Link>
          );
        })}
      </nav>

      {/* ─── Bottom Control Panel ─── */}
      <div className="border-t border-gray-700/50">
        {!collapsed ? (
          <div className="p-3 space-y-2">
            {/* User info */}
            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                isGolden ? "bg-amber-500/20 text-amber-300" : "bg-blue-600/20 text-blue-400"
              }`}>
                {userInitial}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-200 truncate">{userName}</p>
                <div className="flex items-center gap-1.5">
                  {currentRole && (
                    <span className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                      isAdmin ? "bg-red-500/20 text-red-400" : isModerator ? "bg-yellow-500/20 text-yellow-400" : "bg-blue-500/20 text-blue-400"
                    }`}>
                      {currentRole}
                    </span>
                  )}
                  {currentProjectCode && (
                    <span className="text-[9px] text-gray-400">{currentProjectCode}</span>
                  )}
                </div>
              </div>
            </div>
            {/* Logout */}
            <button
              onClick={() => {
                sessionStorage.removeItem("bdops-pin-ok");
                localStorage.removeItem("bdops-project");
                signOut({ callbackUrl: "/login" });
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-gray-300 hover:text-white ${
                isGolden ? "hover:bg-amber-500/10" : "hover:bg-gray-800"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span>Đăng xuất</span>
            </button>
          </div>
        ) : (
          <div className="p-2 flex flex-col items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
              isGolden ? "bg-amber-500/20 text-amber-300" : "bg-blue-600/20 text-blue-400"
            }`}>
              {userInitial}
            </div>
            <button
              onClick={() => {
                sessionStorage.removeItem("bdops-pin-ok");
                localStorage.removeItem("bdops-project");
                signOut({ callbackUrl: "/login" });
              }}
              className="text-gray-400 hover:text-white transition-colors p-1"
              title="Đăng xuất"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
