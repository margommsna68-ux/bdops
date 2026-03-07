"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ProjectSwitcher } from "./ProjectSwitcher";

const navItems = [
  { href: "/", label: "Dashboard", icon: "D" },
  { href: "/funds", label: "Fund Tracking", icon: "$" },
  { href: "/withdrawals", label: "Withdrawals", icon: "W" },
  { href: "/paypals", label: "PayPal Accounts", icon: "P" },
  { type: "separator" as const, label: "Infrastructure" },
  { href: "/infrastructure/servers", label: "Servers", icon: "S" },
  { href: "/infrastructure/vms", label: "Virtual Machines", icon: "V" },
  { href: "/infrastructure/proxies", label: "Proxy IPs", icon: "I" },
  { href: "/gmails", label: "Gmail Accounts", icon: "G" },
  { href: "/vm-tasks", label: "VM Tasks", icon: "T" },
  { type: "separator" as const, label: "Finance" },
  { href: "/costs", label: "Costs", icon: "C" },
  { href: "/profit", label: "Profit Split", icon: "%" },
  { type: "separator" as const, label: "Admin" },
  { href: "/audit-log", label: "Audit Log", icon: "A" },
  { href: "/settings", label: "Settings", icon: "*" },
];

interface SidebarProps {
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const pathname = usePathname();

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
        {navItems.map((item, i) => {
          if ("type" in item && item.type === "separator") {
            return (
              <div key={i} className="pt-4 pb-1 px-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  {item.label}
                </span>
              </div>
            );
          }
          const navItem = item as { href: string; label: string; icon: string };
          const isActive =
            pathname === navItem.href ||
            (navItem.href !== "/" && pathname.startsWith(navItem.href));
          return (
            <Link
              key={navItem.href}
              href={navItem.href}
              onClick={onNavigate}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? "bg-blue-600 text-white font-medium"
                  : "text-gray-300 hover:bg-gray-800 hover:text-white"
              }`}
            >
              <span className="w-5 h-5 flex items-center justify-center text-xs font-mono bg-gray-700 rounded">
                {navItem.icon}
              </span>
              <span>{navItem.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-gray-700 text-xs text-gray-500">
        BDOps v1.0
      </div>
    </aside>
  );
}
