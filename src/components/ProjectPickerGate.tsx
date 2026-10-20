"use client";

import { useEffect, useState } from "react";
import {BrandMark} from '@/components/BrandMark';
import { useSession } from "next-auth/react";
import { useProjectStore } from "@/lib/store";
import { trpc } from "@/lib/trpc";

export function ProjectPickerGate({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const { data: projects, isLoading } = trpc.project.list.useQuery();
  const { currentProjectId, setCurrentProject } = useProjectStore();
  const [dismissed, setDismissed] = useState(false);

  const memberships = (session?.user as any)?.memberships || [];

  const selectProject = (projectId: string) => {
    const project = projects?.find((p) => p.id === projectId);
    const membership = memberships.find((m: any) => m.projectId === projectId);
    if (project) {
      setCurrentProject(
        project.id,
        project.code,
        project.name,
        (project as any).type || "FULL",
        membership?.role || "USER",
        membership?.allowedModules || [],
        membership?.canManageUsers || false,
        membership?.id
      );
      setDismissed(true);
    }
  };

  // Detect collector-only user (only has AGENT_PP module)
  const isCollectorOnlyUser = (() => {
    if (!memberships.length) return false;
    // If ALL memberships are collector-only (role=USER + AGENT_PP only) → treat as collector
    return memberships.every((m: any) => {
      if (m.role === "ADMIN" || m.role === "MODERATOR") return false;
      const mods: string[] = m.allowedModules || [];
      return mods.length === 1 && mods[0] === "AGENT_PP";
    });
  })();

  // Auto-select first project for:
  // - Users with only 1 project
  // - Collector-only users (skip project picker entirely — go directly to dashboard)
  useEffect(() => {
    if (!projects || projects.length === 0 || currentProjectId) return;
    if (projects.length === 1 || isCollectorOnlyUser) {
      selectProject(projects[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects?.length, currentProjectId, isCollectorOnlyUser]);

  // NOTE: No auto-redirect to /agent-pp. Collector users land on /dashboard by default
  // and can navigate to /agent-pp / /settings via sidebar.

  // Already has a project selected → skip
  if (currentProjectId && dismissed) return <>{children}</>;
  if (currentProjectId) return <>{children}</>;

  // Loading
  if (isLoading) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <div className="flex justify-center mb-4 animate-pulse"><BrandMark size={44}/></div>
          <p className="text-gray-400 text-sm">Đang tải...</p>
        </div>
      </div>
    );
  }

  // No projects at all → let through (admin can create)
  if (!projects || projects.length === 0) return <>{children}</>;

  // 1 project → auto selected above, show loading briefly
  if (projects.length === 1) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <div className="flex justify-center mb-3"><BrandMark size={52}/></div>
          <p className="text-white text-sm font-medium">{projects[0].code} — {projects[0].name}</p>
          <p className="text-gray-400 text-xs mt-1">Đang vào...</p>
        </div>
      </div>
    );
  }

  // Multiple projects → show picker
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900">
      <div className="w-full max-w-sm mx-4">
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3"><BrandMark size={52}/></div>
          <h1 className="text-xl font-bold text-white tracking-tight">Chọn dự án</h1>
          <p className="text-sm text-gray-400 mt-1">Chọn project để bắt đầu làm việc</p>
        </div>

        {/* Project cards */}
        <div className="space-y-2">
          {projects.map((p) => {
            const membership = memberships.find((m: any) => m.projectId === p.id);
            const role = membership?.role || "USER";
            const pType = (p as any).type;
            return (
              <button
                key={p.id}
                onClick={() => selectProject(p.id)}
                className="w-full bg-white/10 hover:bg-white/20 border border-white/10 hover:border-white/20 rounded-xl px-5 py-4 text-left transition-all group"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-white">{p.name || p.code}</span>
                      {pType === "PAYPAL_ONLY" && (
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">PP Only</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${role === "ADMIN" ? "bg-red-500/20 text-red-300" : role === "MODERATOR" ? "bg-blue-500/20 text-blue-300" : "bg-gray-500/20 text-gray-300"}`}>
                      {role}
                    </span>
                    <svg className="w-5 h-5 text-gray-500 group-hover:text-white group-hover:translate-x-0.5 transition-all mt-2 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
