import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AppLanguage = "en" | "vi";
export type AppTimezone = string; // IANA timezone
export type AppTheme = "light" | "dark" | "golden";

interface SettingsState {
  language: AppLanguage;
  timezone: AppTimezone;
  theme: AppTheme;
  setLanguage: (lang: AppLanguage) => void;
  setTimezone: (tz: AppTimezone) => void;
  setTheme: (theme: AppTheme) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      language: "vi",
      timezone: "Asia/Ho_Chi_Minh",
      theme: "dark",
      setLanguage: (language) => set({ language }),
      setTimezone: (timezone) => set({ timezone }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: "bdops-settings",
      skipHydration: true,
    }
  )
);

// Common timezone options
export const TIMEZONE_OPTIONS = [
  { value: "Asia/Ho_Chi_Minh", label: "Vietnam (UTC+7)" },
  { value: "Asia/Bangkok", label: "Thailand (UTC+7)" },
  { value: "Asia/Singapore", label: "Singapore (UTC+8)" },
  { value: "Asia/Tokyo", label: "Japan (UTC+9)" },
  { value: "America/New_York", label: "US Eastern (UTC-5)" },
  { value: "America/Los_Angeles", label: "US Pacific (UTC-8)" },
  { value: "Europe/London", label: "London (UTC+0)" },
  { value: "UTC", label: "UTC" },
];
