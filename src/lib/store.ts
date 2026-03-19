import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useState, useEffect } from "react";

interface ProjectState {
  currentProjectId: string | null;
  currentProjectCode: string | null;
  currentProjectName: string | null;
  currentRole: string | null;
  currentModules: string[];
  canManageUsers: boolean;
  currentMemberId: string | null;
  setCurrentProject: (id: string, code: string, name: string, role: string, modules: string[], canManageUsers?: boolean, memberId?: string) => void;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      currentProjectId: null,
      currentProjectCode: null,
      currentProjectName: null,
      currentRole: null,
      currentModules: [],
      canManageUsers: false,
      currentMemberId: null,
      setCurrentProject: (id, code, name, role, modules, canManageUsers = false, memberId = undefined) =>
        set({ currentProjectId: id, currentProjectCode: code, currentProjectName: name, currentRole: role, currentModules: modules, canManageUsers, currentMemberId: memberId ?? null }),
    }),
    {
      name: "bdops-project",
      skipHydration: true,
    }
  )
);

// Hook to handle SSR hydration safely
export function useHydration() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    useProjectStore.persist.rehydrate();
    // Also rehydrate settings store
    import("./settings-store").then(({ useSettingsStore }) => {
      useSettingsStore.persist.rehydrate();
    });
    setHydrated(true);
  }, []);

  return hydrated;
}
