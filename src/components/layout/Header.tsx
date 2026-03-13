"use client";

import { useProjectStore } from "@/lib/store";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { currentProjectCode, currentProjectName } = useProjectStore();

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 md:px-6 shrink-0">
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
          <div className="hidden sm:flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500">Project</span>
            <span className="text-sm font-semibold text-gray-900">
              {currentProjectCode}{currentProjectName ? ` — ${currentProjectName}` : ""}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-400 font-medium">
        BDOps v1.0
      </div>
    </header>
  );
}
