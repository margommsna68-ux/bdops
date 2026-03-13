"use client";

import { useEffect } from "react";
import { useSettingsStore } from "@/lib/settings-store";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    // Remove old theme
    root.removeAttribute("data-theme");
    // Apply new theme (light has no attribute = default)
    if (theme && theme !== "light") {
      root.setAttribute("data-theme", theme);
    }
  }, [theme]);

  return <>{children}</>;
}
