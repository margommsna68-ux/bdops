import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useState, useEffect } from "react";

interface ProjectState {
  currentProjectId: string | null;
  currentProjectCode: string | null;
  setCurrentProject: (id: string, code: string) => void;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      currentProjectId: null,
      currentProjectCode: null,
      setCurrentProject: (id, code) =>
        set({ currentProjectId: id, currentProjectCode: code }),
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
