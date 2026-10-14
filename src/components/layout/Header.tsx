"use client";

import Link from "next/link";
import { useProjectStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "./NotificationBell";
import { useT } from "@/lib/i18n";

interface HeaderProps {
  onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { currentProjectCode, currentProjectName } = useProjectStore();
  const t = useT();

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 md:px-6 shrink-0 sticky top-0 z-30 shadow-sm">
      <div className="flex items-center gap-3">
        {/* Mobile hamburger */}
        <Button
          variant="ghost"
          size="sm"
          className="lg:hidden p-1"
          onClick={onMenuClick}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </Button>

        {/* Current project */}
        {currentProjectCode && (
          <div className="hidden sm:flex items-center gap-2.5">
            <span className="text-sm font-bold text-gray-800 tracking-tight">
              {currentProjectName || currentProjectCode}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* History */}
        <Link href="/history" className="relative p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title={t("header_history_tooltip")}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </Link>
        {/* Notifications */}
        <NotificationBell />
        <span className="text-[10px] text-gray-400 font-semibold hidden sm:inline tracking-widest uppercase">v8.9</span>
      </div>
    </header>
  );
}
