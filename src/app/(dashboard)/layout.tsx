"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PinGate } from "@/components/PinGate";
import { useHydration } from "@/lib/store";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const hydrated = useHydration();

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
          className={`fixed inset-y-0 left-0 z-50 transform transition-all duration-200 lg:relative lg:translate-x-0 ${
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
          <main className="flex-1 p-4 md:p-6 overflow-auto">
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
        </div>
      </div>
    </PinGate>
  );
}
