"use client";

import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { links } from "@/lib/links";
import { useSession, signOut } from "next-auth/react";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { useProjectStore } from "@/lib/store";
import { useSettingsStore } from "@/lib/settings-store";
import { useT } from "@/lib/i18n";
import { isCollectorOnly } from "@/lib/collector-utils";
import type { AppModule } from "@/server/trpc";
import {trpc} from '@/lib/trpc';
import { BrandMark, BRAND_NAME, BRAND_SLOGAN } from "@/components/BrandMark";

// role: who the target page actually serves. ADMIN = admin only (projects, audit log); MOD = admin or moderator (staff page).
type NavItem =
  | { href: string; labelKey: string; label?: string; icon: string; module?: AppModule | null; role?: "ADMIN" | "MOD"; infraOnly?: boolean }
  | { type: "separator"; labelKey: string };

const navItems: NavItem[] = [
  // ─── Tổng Quan ───
  { href: "/dashboard", labelKey: "nav_dashboard", icon: "D", module: null },
  // ─── Vận Hành ───
  { type: "separator", labelKey: "nav_operations" },
  { href: "/infrastructure/vms", labelKey: "nav_vms", icon: "E", module: "INFRASTRUCTURE", infraOnly: true },
  { href: "/funds", labelKey: "nav_fund_tracking", icon: "$", module: "FUNDS" },
  { href: "/withdrawals", labelKey: "nav_withdrawals", icon: "W", module: "WITHDRAWALS" },
  // ─── Hạ Tầng ───
  { type: "separator", labelKey: "nav_infrastructure" },
  { href: "/infrastructure/servers", labelKey: "nav_servers", icon: "S", module: "INFRASTRUCTURE", infraOnly: true },
  { href: "/infrastructure/proxies", labelKey: "nav_proxies", icon: "I", module: "INFRASTRUCTURE", infraOnly: true },
  { href: "/paypals", labelKey: "nav_paypal_accounts", icon: "P", module: "PAYPALS" },
  { href: "/gmails", labelKey: "nav_gmails", icon: "G", module: "INFRASTRUCTURE", infraOnly: true },
  // ─── Tài Chính ───
  { type: "separator", labelKey: "nav_finance" },
  { href: "/agent-pp", labelKey: "nav_agent_pp", icon: "A", module: "AGENT_PP" },
  { href: "/costs", labelKey: "nav_costs", icon: "C", module: "COSTS" },
  { href: "/profit", labelKey: "nav_profit", icon: "%", module: "PROFIT" },
  // ─── Quản Trị ───
  { type: "separator", labelKey: "nav_admin" },
  { href: "/admin/projects", labelKey: "nav_projects", icon: "P", role: "ADMIN" },
  { href: "/admin/users", labelKey: "nav_users", icon: "U", role: "MOD" },
  { href: "/audit-log", labelKey: "nav_audit_log", icon: "A", role: "ADMIN" },
  { href: "/settings", labelKey: "nav_settings", icon: "*" },
];
// Money pages: /funds is money arriving in PayPal; /withdrawals is "Nhận USDT về team" when team cash is on (original withdrawals
// under ?view=original), otherwise the original withdrawals/transfers page.
const moneyItems=(cashMode:boolean):NavItem[]=>cashMode?[
  {href:links.teamReceipts(),labelKey:'Nhận USDT về team',label:'Nhận USDT về team',icon:'T',module:'WITHDRAWALS'},
  {href:links.paypalIn(),labelKey:'Tiền vào PayPal',label:'Tiền vào PayPal',icon:'$',module:'FUNDS'},
  {href:links.originalWithdrawals(true),labelKey:'Rút / chuyển gốc',label:'Rút / chuyển gốc',icon:'R',module:'WITHDRAWALS'},
]:[
  {href:links.paypalIn(),labelKey:'Tiền vào PayPal',label:'Tiền vào PayPal',icon:'$',module:'FUNDS'},
  {href:links.originalWithdrawals(false),labelKey:'Rút / chuyển gốc',label:'Rút / chuyển gốc',icon:'R',module:'WITHDRAWALS'},
];
const personalItems=(cashMode:boolean):NavItem[]=>[
  {href:'/dashboard',labelKey:'Tổng quan',icon:'D'},
  {href:'/infrastructure/proxies',labelKey:'Quản lý proxy',icon:'P',module:'INFRASTRUCTURE'},
  {href:'/infrastructure/servers',labelKey:'Server / VM',icon:'S',module:'INFRASTRUCTURE'},
  {href:'/vm-tasks',labelKey:'Việc cài proxy',icon:'V',module:'INFRASTRUCTURE'},
  {href:'/work',labelKey:'Giao việc',icon:'W',module:'INFRASTRUCTURE'},
  {href:'/gmails',labelKey:'Kho tài khoản',icon:'G',module:'INFRASTRUCTURE'},
  {href:'/paypals',labelKey:'PayPal',icon:'P',module:'PAYPALS'},
  {type:'separator',labelKey:'Tài chính'},
  ...moneyItems(cashMode),
  {href:'/costs',labelKey:'Chi phí',icon:'C',module:'COSTS'},
  {href:'/profit',labelKey:'Lợi nhuận',icon:'%',module:'PROFIT'},
  {href:'/history',labelKey:'Lịch sử thao tác',icon:'H'},
  {type:'separator',labelKey:'Quản trị'},
  {href:'/admin/users',labelKey:'Nhân viên',icon:'U',role:'MOD'},
  {href:'/admin/projects',labelKey:'Dự án',icon:'P',role:'ADMIN'},
  {href:'/settings',labelKey:'Thiết lập',icon:'*'},
];

interface SidebarProps {
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({ onNavigate, collapsed, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { currentRole, currentModules, currentProjectCode, currentProjectType } = useProjectStore();
  const theme = useSettingsStore((s) => s.theme);
  const t = useT();
  const projectId=useProjectStore(s=>s.currentProjectId),fresh=trpc.project.myMembership.useQuery({projectId:projectId||''},{enabled:!!projectId});
  const cashMode=!!fresh.data?.teamCashEnabled;

  const isAdmin = currentRole === "ADMIN";
  const isModerator = currentRole === "MODERATOR";
  const isAdminOrMod = isAdmin || isModerator;
  const collectorOnly = isCollectorOnly(currentRole, currentModules);

  const isGolden = theme === "golden";
  const accentBg = isGolden ? "bg-amber-500" : "bg-[#2563eb]";

  const hasModuleAccess = (module: AppModule | null | undefined): boolean => {
    if (!module) return true;
    if (isAdmin) return true;
    if (!currentRole) return false;
    return currentModules.includes(module);
  };

  const isPaypalOnly = currentProjectType === "PAYPAL_ONLY";
  const proxyMode=useProjectStore(s=>s.currentBusinessMode)==='PROXY_VM';

  // When no project selected (all deleted), show dashboard + admin + settings
  const noProject = !currentRole;

  const cashItems:NavItem[]=navItems.filter(item=>'type' in item||!item.infraOnly).flatMap(item=>!('type' in item)&&item.href==='/funds'?[]:!('type' in item)&&item.href==='/withdrawals'?moneyItems(true):[item]).concat([{href:'/history',labelKey:'Lịch sử thao tác',label:'Lịch sử thao tác',icon:'H'}]);
  const filteredItems = (proxyMode?personalItems(cashMode):cashMode?cashItems:navItems).filter((item) => {
    if ("type" in item) return true;
    if (noProject) {
      // Only show dashboard, admin links, settings when no project
      return item.href === "/dashboard" || item.href === "/settings" || item.role === "ADMIN";
    }
    if (item.infraOnly && isPaypalOnly) return false;
    if (item.role === "ADMIN") return isAdmin;
    if (item.role === "MOD") return isAdminOrMod;
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

  const rawName = session?.user?.name || "User";
  const userName = rawName;
  const userInitial = userName.charAt(0);

  return (
    <aside className={`${collapsed ? "w-16" : "w-64"} bg-gray-900 text-white min-h-screen flex flex-col shrink-0 transition-all duration-300 border-r border-gray-800/40`}>
      {/* ─── Header ─── */}
      <div className="p-4 border-b border-gray-700/30 flex items-center justify-between">
        {!collapsed && (
          <div className="flex items-center gap-2.5 min-w-0">
            <BrandMark size={30} className="shrink-0" />
            <div className="min-w-0">
              <h1 className="text-base font-bold tracking-tight leading-tight text-white">{BRAND_NAME}</h1>
              <p className="text-[10px] text-gray-400/80 leading-none mt-0.5 tracking-wide">{BRAND_SLOGAN}</p>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="mx-auto flex items-center justify-center h-9" title={BRAND_NAME + " — " + BRAND_SLOGAN}>
            <BrandMark size={28} />
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

      {/* ─── Project Switcher (hidden for collector-only users) ─── */}
      {!collectorOnly && !collapsed && (
        <div className="p-3 border-b border-gray-700/50">
          <ProjectSwitcher />
        </div>
      )}
      {!collectorOnly && collapsed && currentProjectCode && (
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
                  {proxyMode?item.labelKey:t(item.labelKey)}
                </span>
              </div>
            );
          }
          const label=item.label||(proxyMode?item.labelKey:t(item.labelKey));
          return <Suspense key={item.href} fallback={<NavLink href={item.href} icon={item.icon} label={label} collapsed={!!collapsed} accentBg={accentBg} active={pathname===item.href.split('?')[0]&&!item.href.includes('?')} onNavigate={onNavigate}/>}>
            <ActiveNavLink href={item.href} icon={item.icon} label={label} collapsed={!!collapsed} accentBg={accentBg} siblings={visibleItems.filter((x):x is Extract<NavItem,{href:string}>=>!('type' in x)).map(x=>x.href)} onNavigate={onNavigate}/>
          </Suspense>;
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
              <span>{t("sign_out")}</span>
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
              title={t("sign_out")}
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
type NavLinkProps={href:string;icon:string;label:string;collapsed:boolean;accentBg:string;onNavigate?:()=>void};
// Active when the path matches; links that share a path (Nhận USDT về team / Rút / chuyển gốc) also compare their query.
function ActiveNavLink({siblings,...props}:NavLinkProps&{siblings:string[]}){
  const pathname=usePathname(),search=useSearchParams(),[path,query='']=props.href.split('?');
  const inSection=pathname===path||pathname.startsWith(path+'/');
  const own=new URLSearchParams(query),matchesQuery=Array.from(own.entries()).every(([k,v])=>search.get(k)===v);
  const moreSpecific=siblings.some(h=>h!==props.href&&h.startsWith(path+'?')&&Array.from(new URLSearchParams(h.split('?')[1]).entries()).every(([k,v])=>search.get(k)===v));
  return <NavLink {...props} active={inSection&&matchesQuery&&(query?true:!moreSpecific)}/>;
}
function NavLink({href,icon,label,collapsed,accentBg,active,onNavigate}:NavLinkProps&{active:boolean}){
  return <Link href={href} onClick={onNavigate} title={collapsed?label:undefined} aria-current={active?'page':undefined}
    className={`flex items-center ${collapsed?"justify-center":"gap-3"} px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ${active?`${accentBg} text-white font-medium shadow-md shadow-blue-500/20`:"text-gray-300 hover:bg-white/[0.06] hover:text-white"}`}>
    <span className={`w-7 h-7 flex items-center justify-center text-xs font-mono rounded-lg shrink-0 transition-colors ${active?"bg-white/25":"bg-white/[0.07]"}`}>{icon}</span>
    {!collapsed&&<span>{label}</span>}
  </Link>;
}
