"use client";

import { useEffect, useState } from "react";
import { useSettingsStore } from "@/lib/settings-store";

// The theme stored in the browser (bdops-settings) is applied as data-theme on <html> once the settings are read (the dashboard
// layout reads them); light has no attribute. Before that, the inline script in app/layout.tsx keeps the old default (dark, also on
// the login page) and only applies a saved "Đồng ấm" early, so login and PIN open in it while Sáng / Tối / Vàng kim look exactly as
// before. Changing the theme only changes this attribute: nothing remounts, so drafts, filters, selections and table state stay.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSettingsStore((s) => s.theme);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const done = useSettingsStore.persist.onFinishHydration(() => setReady(true));
    if (useSettingsStore.persist.hasHydrated()) setReady(true);
    return done;
  }, []);

  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    // Remove old theme
    root.removeAttribute("data-theme");
    // Apply new theme (light has no attribute = default)
    if (theme && theme !== "light") {
      root.setAttribute("data-theme", theme);
    }
  }, [theme, ready]);

  return <>{children}</>;
}
