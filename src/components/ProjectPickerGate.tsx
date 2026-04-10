"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
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

  const router = useRouter();
  const pathname = usePathname();

  // Auto-select if only 1 project
  useEffect(() => {
    if (projects && projects.length === 1 && !currentProjectId) {
      selectProject(projects[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects?.length, currentProjectId]);

  // Agent-only user: if user only has AGENT_PP module → redirect to /agent-pp
  // (unless they're already under /agent-pp/* which includes sub-routes like /agent-pp/demo)
  useEffect(() => {
    if (!currentProjectId || !memberships.length) return;
    if (pathname?.startsWith("/agent-pp")) return; // already on an allowed sub-route
    const membership = memberships.find((m: any) => m.projectId === currentProjectId);
    if (!membership) return;
    const modules: string[] = membership.allowedModules || [];
    const role = membership.role;
    // Only redirect if: not ADMIN/MOD, and only has AGENT_PP module
    if (role !== "ADMIN" && role !== "MODERATOR" && modules.length > 0 && modules.every((m: string) => m === "AGENT_PP")) {
      router.replace("/agent-pp");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId, memberships.length, pathname]);

  // Already has a project selected → skip
  if (currentProjectId && dismissed) return <>{children}</>;
  if (currentProjectId) return <>{children}</>;

  // Loading
  if (isLoading) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-lg font-bold mx-auto mb-4 shadow-lg animate-pulse">B</div>
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
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-lg font-bold mx-auto mb-4 shadow-lg">B</div>
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
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-xl font-bold mx-auto mb-3 shadow-lg shadow-blue-500/30">B</div>
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
                      <span className="text-lg font-bold text-white">{p.code}</span>
                      {pType === "PAYPAL_ONLY" && (
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">PP Only</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-300 mt-0.5">{p.name}</p>
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
