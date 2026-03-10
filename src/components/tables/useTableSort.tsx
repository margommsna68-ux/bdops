import { useState, useMemo } from "react";

export type SortDir = "asc" | "desc";

export function useTableSort<T extends Record<string, any>>(
  data: T[],
  defaultKey?: string
) {
  const [sortKey, setSortKey] = useState<string | null>(defaultKey ?? null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const aVal = getNestedValue(a, sortKey);
      const bVal = getNestedValue(b, sortKey);
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      const aNum = Number(aVal);
      const bNum = Number(bVal);
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return sortDir === "asc" ? aNum - bNum : bNum - aNum;
      }

      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      const cmp = aStr.localeCompare(bStr);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, handleSort };
}

function getNestedValue(obj: any, path: string): any {
  return path.split(".").reduce((v, k) => v?.[k], obj);
}

export function SortIcon({ active, direction }: { active: boolean; direction: SortDir }) {
  return (
    <span className="inline-flex ml-1 text-gray-400 text-[10px]">
      {active ? (direction === "asc" ? "▲" : "▼") : "⇅"}
    </span>
  );
}
