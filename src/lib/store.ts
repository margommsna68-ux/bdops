import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useState, useEffect } from "react";

interface ProjectState {
  currentProjectId: string | null;
  currentProjectCode: string | null;
  currentProjectName: string | null;
  currentRole: string | null;
  currentModules: string[];
  setCurrentProject: (id: string, code: string, name: string, role: string, modules: string[]) => void;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      currentProjectId: null,
      currentProjectCode: null,
      currentProjectName: null,
      currentRole: null,
      currentModules: [],
      setCurrentProject: (id, code, name, role, modules) =>
        set({ currentProjectId: id, currentProjectCode: code, currentProjectName: name, currentRole: role, currentModules: modules }),
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
