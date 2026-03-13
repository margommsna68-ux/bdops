"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface PickerItem {
  id: string;
  label: string;
  sub?: string;
  badge?: string;
  badgeColor?: string;
}

// ═══ Single-select mode ═══
interface SinglePickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  title: string;
  items: PickerItem[];
  columns?: number;
  selectedId?: string;
  allowClear?: boolean;
  multi?: false;
}

// ═══ Multi-select mode ═══
interface MultiPickerProps {
  open: boolean;
  onClose: () => void;
  onSelectMulti: (ids: string[]) => void;
  title: string;
  items: PickerItem[];
  columns?: number;
  maxSelect?: number;
  multi: true;
  selectedIds?: string[];
}

type PickerDialogProps = SinglePickerProps | MultiPickerProps;

export function PickerDialog(props: PickerDialogProps) {
  const { open, onClose, title, items, columns = 4 } = props;
  const [search, setSearch] = useState("");
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (i) => i.label.toLowerCase().includes(q) || i.sub?.toLowerCase().includes(q)
    );
  }, [items, search]);

  const reset = () => { setSearch(""); setMultiSelected(new Set()); };

  const handleClose = () => { reset(); onClose(); };

  // Single-select mode
  if (!props.multi) {
    const { onSelect, selectedId, allowClear } = props;
    const handleSelect = (id: string) => { onSelect(id); handleClose(); };

    return (
      <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
        <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>

          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9" autoFocus />
            </div>
            <span className="text-xs text-gray-400 whitespace-nowrap">{filtered.length} items</span>
          </div>

          <div className="flex-1 overflow-y-auto mt-2 -mx-1">
            {allowClear && (
              <button onClick={() => handleSelect("")}
                className="w-full text-left px-3 py-2 mb-1 rounded-md text-sm text-gray-500 hover:bg-gray-100 border border-dashed border-gray-200">
                — None / Clear —
              </button>
            )}
            <ItemGrid items={filtered} columns={columns} selectedIds={new Set(selectedId ? [selectedId] : [])}
              onClickItem={(id) => handleSelect(id)} />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Multi-select mode
  const { onSelectMulti, maxSelect } = props;

  const toggleItem = (id: string) => {
    setMultiSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (maxSelect && next.size >= maxSelect) return prev;
        next.add(id);
      }
      return next;
    });
  };

  const addItem = (id: string) => {
    setMultiSelected((prev) => {
      if (prev.has(id)) return prev;
      if (maxSelect && prev.size >= maxSelect) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const confirmMulti = () => {
    const ids = Array.from(multiSelected);
    onSelectMulti(ids);
    handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between pr-8">
            <span>{title}</span>
            <span className="text-sm font-normal text-gray-500">
              {multiSelected.size}{maxSelect ? ` / ${maxSelect}` : ""} selected
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9" autoFocus />
          </div>
          <span className="text-xs text-gray-400 whitespace-nowrap">{filtered.length} items</span>
        </div>

        {/* Lasso hint */}
        <div className="text-[11px] text-gray-400 -mt-1">
          Click to toggle / Drag to lasso-select multiple items
        </div>

        <div className="flex-1 overflow-y-auto mt-1 -mx-1">
          <LassoGrid
            items={filtered}
            columns={columns}
            selectedIds={multiSelected}
            onToggleItem={toggleItem}
            onAddItem={addItem}
            maxSelect={maxSelect}
          />
        </div>

        {/* Confirm bar */}
        <div className="flex items-center justify-between pt-2 border-t">
          <div className="flex gap-1 flex-wrap max-w-[70%]">
            {Array.from(multiSelected).map((id) => {
              const item = items.find((i) => i.id === id);
              return item ? (
                <span key={id} className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full">
                  {item.label}
                  <button onClick={() => toggleItem(id)} title="Deselect" className="ml-0.5 text-blue-400 hover:text-red-600 hover:bg-red-100 rounded-full w-4 h-4 flex items-center justify-center text-[11px] transition-colors">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </span>
              ) : null;
            })}
          </div>
          <div className="flex gap-2 shrink-0">
            {multiSelected.size > 0 && (
              <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 hover:bg-red-50 text-xs"
                onClick={() => setMultiSelected(new Set())}>
                Deselect all
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleClose}>Cancel</Button>
            <Button size="sm" onClick={confirmMulti} disabled={multiSelected.size === 0}>
              Confirm ({multiSelected.size})
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ═══ Shared item grid (single-select, no lasso) ═══
function ItemGrid({ items, columns, selectedIds, onClickItem }: {
  items: PickerItem[];
  columns: number;
  selectedIds: Set<string>;
  onClickItem: (id: string) => void;
}) {
  if (items.length === 0) {
    return <div className="text-center py-8 text-gray-400 text-sm">No items found</div>;
  }

  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {items.map((item) => {
        const isSelected = selectedIds.has(item.id);
        return (
          <button
            key={item.id}
            onClick={() => onClickItem(item.id)}
            className={`
              text-left rounded-xl border-2 px-3 py-3 transition-all text-sm relative
              hover:shadow-lg hover:border-blue-400 hover:bg-blue-50
              active:scale-[0.97]
              ${isSelected
                ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200 shadow-md"
                : "border-gray-200 bg-white hover:border-gray-300"
              }
            `}
          >
            {/* Label - large and prominent */}
            <div>
              <span className={`text-base font-bold tracking-wide ${isSelected ? "text-blue-700" : "text-gray-900"}`}>
                {item.label}
              </span>
            </div>

            {/* Sub + Badge row */}
            <div className="flex items-center gap-1.5 mt-1.5">
              {item.badge && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${item.badgeColor || "bg-gray-100 text-gray-600"}`}>
                  {item.badge}
                </span>
              )}
              {item.sub && (
                <span className="text-[11px] text-gray-400 truncate">{item.sub}</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ═══ Lasso-selectable grid (multi-select) ═══
function LassoGrid({ items, columns, selectedIds, onToggleItem, onAddItem, maxSelect: _maxSelect }: {
  items: PickerItem[];
  columns: number;
  selectedIds: Set<string>;
  onToggleItem: (id: string) => void;
  onAddItem: (id: string) => void;
  maxSelect?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [isDragging, setIsDragging] = useState(false);
  const [lassoRect, setLassoRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [lassoHovered, setLassoHovered] = useState<Set<string>>(new Set());
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const hasDraggedRef = useRef(false);

  const setItemRef = useCallback((id: string, el: HTMLButtonElement | null) => {
    if (el) itemRefs.current.set(id, el);
    else itemRefs.current.delete(id);
  }, []);

  const getItemsInRect = useCallback((rect: { x1: number; y1: number; x2: number; y2: number }) => {
    const container = containerRef.current;
    if (!container) return new Set<string>();

    const minX = Math.min(rect.x1, rect.x2);
    const maxX = Math.max(rect.x1, rect.x2);
    const minY = Math.min(rect.y1, rect.y2);
    const maxY = Math.max(rect.y1, rect.y2);

    const hit = new Set<string>();
    itemRefs.current.forEach((el, id) => {
      const r = el.getBoundingClientRect();
      const cr = container.getBoundingClientRect();
      const elX1 = r.left - cr.left + container.scrollLeft;
      const elY1 = r.top - cr.top + container.scrollTop;
      const elX2 = elX1 + r.width;
      const elY2 = elY1 + r.height;

      if (elX1 < maxX && elX2 > minX && elY1 < maxY && elY2 > minY) {
        hit.add(id);
      }
    });
    return hit;
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only start lasso on left mouse button, not on the buttons themselves
    if (e.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;

    const cr = container.getBoundingClientRect();
    const x = e.clientX - cr.left + container.scrollLeft;
    const y = e.clientY - cr.top + container.scrollTop;
    dragStartRef.current = { x, y };
    hasDraggedRef.current = false;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragStartRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    const cr = container.getBoundingClientRect();
    const x = e.clientX - cr.left + container.scrollLeft;
    const y = e.clientY - cr.top + container.scrollTop;

    const dx = Math.abs(x - dragStartRef.current.x);
    const dy = Math.abs(y - dragStartRef.current.y);

    // Only start lasso after 5px drag to avoid accidental lasso on click
    if (!isDragging && (dx > 5 || dy > 5)) {
      setIsDragging(true);
      hasDraggedRef.current = true;
    }

    if (isDragging || dx > 5 || dy > 5) {
      const rect = { x1: dragStartRef.current.x, y1: dragStartRef.current.y, x2: x, y2: y };
      setLassoRect(rect);
      setLassoHovered(getItemsInRect(rect));
    }
  };

  const handleMouseUp = () => {
    if (hasDraggedRef.current && lassoHovered.size > 0) {
      // Add all lasso-selected items
      lassoHovered.forEach((id) => {
        if (!selectedIds.has(id)) {
          onAddItem(id);
        }
      });
    }
    dragStartRef.current = null;
    setIsDragging(false);
    setLassoRect(null);
    setLassoHovered(new Set());
    hasDraggedRef.current = false;
  };

  if (items.length === 0) {
    return <div className="text-center py-8 text-gray-400 text-sm">No items found</div>;
  }

  return (
    <div
      ref={containerRef}
      className="relative select-none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Lasso rectangle overlay */}
      {lassoRect && isDragging && (
        <div
          className="absolute border-2 border-blue-400 bg-blue-100/30 rounded-sm pointer-events-none z-10"
          style={{
            left: Math.min(lassoRect.x1, lassoRect.x2),
            top: Math.min(lassoRect.y1, lassoRect.y2),
            width: Math.abs(lassoRect.x2 - lassoRect.x1),
            height: Math.abs(lassoRect.y2 - lassoRect.y1),
          }}
        />
      )}

      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const isSelected = selectedIds.has(item.id);
          const isLassoHover = lassoHovered.has(item.id) && !isSelected;
          return (
            <button
              key={item.id}
              ref={(el) => setItemRef(item.id, el)}
              onClick={(e) => {
                // Only toggle if not from a drag
                if (!hasDraggedRef.current) {
                  e.preventDefault();
                  onToggleItem(item.id);
                }
              }}
              className={`
                text-left rounded-xl border-2 px-3 py-3 transition-all text-sm relative
                hover:shadow-lg hover:border-blue-400 hover:bg-blue-50
                active:scale-[0.97]
                ${isSelected
                  ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200 shadow-md"
                  : isLassoHover
                    ? "border-blue-300 bg-blue-50/60 ring-1 ring-blue-200 shadow-sm"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }
              `}
            >
              {/* Checkbox */}
              <div className={`absolute top-2 right-2 w-5 h-5 rounded-md border-2 flex items-center justify-center text-xs font-bold transition-all ${
                isSelected ? "border-blue-500 bg-blue-500 text-white shadow-sm"
                : isLassoHover ? "border-blue-400 bg-blue-200 text-blue-600"
                : "border-gray-300 bg-gray-50"
              }`}>
                {isSelected && "✓"}
                {isLassoHover && !isSelected && "·"}
              </div>

              {/* VM name - large and prominent */}
              <div className="pr-7">
                <span className={`text-base font-bold tracking-wide ${
                  isSelected ? "text-blue-700" : "text-gray-900"
                }`}>
                  {item.label}
                </span>
              </div>

              {/* Sub + Badge row */}
              <div className="flex items-center gap-1.5 mt-1.5">
                {item.badge && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${item.badgeColor || "bg-gray-100 text-gray-600"}`}>
                    {item.badge}
                  </span>
                )}
                {item.sub && (
                  <span className="text-[11px] text-gray-400 truncate">{item.sub}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
