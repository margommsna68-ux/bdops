import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useState, useEffect } from "react";

interface ProjectState {
  currentProjectId: string | null;
  currentProjectCode: string | null;
  currentRole: string | null;
  currentModules: string[];
  setCurrentProject: (id: string, code: string, role: string, modules: string[]) => void;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      currentProjectId: null,
      currentProjectCode: null,
      currentRole: null,
      currentModules: [],
      setCurrentProject: (id, code, role, modules) =>
        set({ currentProjectId: id, currentProjectCode: code, currentRole: role, currentModules: modules }),
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
    setHydrated(true);
  }, []);

  return hydrated;
}
