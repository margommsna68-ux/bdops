"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface ComboboxOption {
  value: string;
  label: string;
  sub?: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  minDropdownWidth?: number;
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Search...",
  disabled,
  className,
  minDropdownWidth = 260,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const selected = options.find((o) => o.value === value);

  const filtered = search
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(search.toLowerCase()) ||
          (o.sub && o.sub.toLowerCase().includes(search.toLowerCase()))
      )
    : options;

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const dropW = Math.max(rect.width, minDropdownWidth);
    // Don't overflow right edge
    const maxLeft = window.innerWidth - dropW - 8;
    setPos({
      top: rect.bottom + 2,
      left: Math.min(rect.left, maxLeft),
      width: dropW,
    });
  }, [minDropdownWidth]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        btnRef.current && !btnRef.current.contains(target) &&
        dropRef.current && !dropRef.current.contains(target)
      ) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    updatePos();
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open, updatePos]);

  const handleOpen = () => {
    if (disabled) return;
    if (!open) {
      updatePos();
      setOpen(true);
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setOpen(false);
      setSearch("");
    }
  };

  return (
    <div className={cn("relative", className)}>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors",
          "focus:outline-none focus:ring-1 focus:ring-ring",
          disabled && "opacity-50 cursor-not-allowed",
          !selected && "text-muted-foreground"
        )}
        onClick={handleOpen}
      >
        <span className="truncate text-left">
          {selected ? (
            <>
              {selected.label}
              {selected.sub && <span className="text-gray-400 ml-1 text-xs">({selected.sub})</span>}
            </>
          ) : placeholder}
        </span>
        <svg className="h-4 w-4 opacity-50 shrink-0 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={dropRef}
          className="fixed z-[9999] rounded-md border bg-white shadow-xl"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          <div className="p-1.5">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Type to search..."
              className="w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
              onKeyDown={(e) => {
                if (e.key === "Escape") { setOpen(false); setSearch(""); }
                if (e.key === "Enter" && filtered.length === 1) {
                  onChange(filtered[0].value);
                  setOpen(false);
                  setSearch("");
                }
              }}
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-gray-400">No results</div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={cn(
                    "flex w-full items-center rounded px-2 py-1.5 text-sm hover:bg-gray-100 text-left",
                    o.value === value && "bg-blue-50 text-blue-700 font-medium"
                  )}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  {o.value === value && (
                    <svg className="h-3.5 w-3.5 shrink-0 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  <span className="font-medium shrink-0">{o.label}</span>
                  {o.sub && <span className="text-xs text-gray-400 ml-2 truncate">{o.sub}</span>}
                </button>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
