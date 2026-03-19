"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PinGate } from "@/components/PinGate";
import { useHydration, useProjectStore } from "@/lib/store";
import { trpc } from "@/lib/trpc";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const hydrated = useHydration();

  // Auto-sync role + modules from DB on every page load
  const projectId = useProjectStore((s) => s.currentProjectId);
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject);
  const currentProjectCode = useProjectStore((s) => s.currentProjectCode);
  const currentProjectName = useProjectStore((s) => s.currentProjectName);
  const { data: membership } = trpc.project.myMembership.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId && hydrated, refetchOnWindowFocus: true, staleTime: 0, refetchOnMount: "always" }
  );

  // Update store when membership data arrives
  useEffect(() => {
    if (membership && projectId && currentProjectCode && currentProjectName) {
      setCurrentProject(projectId, currentProjectCode, currentProjectName, membership.role, membership.allowedModules, membership.canManageUsers, membership.id);
    }
  }, [membership, projectId, currentProjectCode, currentProjectName, setCurrentProject]);

  // Restore sidebar collapsed state from localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("sidebar-collapsed");
      if (saved === "true") setSidebarCollapsed(true);
    }
  }, []);

  const toggleCollapse = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  };

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <PinGate>
      <div className="flex min-h-screen bg-gray-50">
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar - hidden on mobile, collapsible on desktop */}
        <div
          className={`fixed inset-y-0 left-0 z-50 transform transition-all duration-200 lg:relative lg:translate-x-0 max-w-[85vw] ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <Sidebar
            onNavigate={() => setSidebarOpen(false)}
            collapsed={sidebarCollapsed}
            onToggleCollapse={toggleCollapse}
          />
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <Header onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
          <main className="flex-1 p-3 sm:p-4 md:p-6 overflow-auto">
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
        </div>
      </div>
    </PinGate>
  );
}
