import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { useSettingsStore } from "./settings-store"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

function getTimezone(): string {
  return useSettingsStore.getState().timezone || "Asia/Ho_Chi_Minh";
}

function getLocale(): string {
  const lang = useSettingsStore.getState().language;
  return lang === "vi" ? "vi-VN" : "en-US";
}

export function formatCurrency(amount: number | string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(num);
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(getLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: getTimezone(),
  }).format(d);
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(getLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: getTimezone(),
  }).format(d);
}
