"use client";

import { useState, useRef, useCallback } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";

export interface Column<T> {
  key: string;
  header: string;
  render?: (item: T) => React.ReactNode;
  className?: string;
  minWidth?: number;
  defaultWidth?: number;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  total?: number;
  page?: number;
  limit?: number;
  onPageChange?: (page: number) => void;
  emptyMessage?: string;
  isLoading?: boolean;
  onRowClick?: (item: T) => void;
  tableId?: string; // for persisting column widths
}

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  total = 0,
  page = 1,
  limit = 50,
  onPageChange,
  emptyMessage = "No data found.",
  isLoading,
  onRowClick,
  tableId,
}: DataTableProps<T>) {
  const totalPages = Math.ceil(total / limit);

  // Column resize state
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    // Restore from localStorage if tableId provided
    if (tableId && typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(`dt-widths-${tableId}`);
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    // Use default widths
    const defaults: Record<string, number> = {};
    columns.forEach((col) => {
      if (col.defaultWidth) defaults[col.key] = col.defaultWidth;
    });
    return defaults;
  });

  const resizingCol = useRef<string | null>(null);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, colKey: string) => {
      e.preventDefault();
      e.stopPropagation();
      resizingCol.current = colKey;
      startX.current = e.clientX;
      const th = (e.target as HTMLElement).closest("th");
      startWidth.current = th?.offsetWidth ?? 120;

      const handleMouseMove = (ev: MouseEvent) => {
        if (!resizingCol.current) return;
        const diff = ev.clientX - startX.current;
        const col = columns.find((c) => c.key === resizingCol.current);
        const minW = col?.minWidth ?? 50;
        const newWidth = Math.max(minW, startWidth.current + diff);
        setColumnWidths((prev) => {
          const next = { ...prev, [resizingCol.current!]: newWidth };
          // Persist
          if (tableId) {
            try { localStorage.setItem(`dt-widths-${tableId}`, JSON.stringify(next)); } catch {}
          }
          return next;
        });
      };

      const handleMouseUp = () => {
        resizingCol.current = null;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [columns, tableId]
  );

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  className={`relative group select-none ${col.className ?? ""}`}
                  style={columnWidths[col.key] ? { width: columnWidths[col.key], minWidth: columnWidths[col.key] } : undefined}
                >
                  {col.header}
                  {/* Resize handle */}
                  <div
                    className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400 group-hover:bg-blue-200 transition-colors"
                    onMouseDown={(e) => handleMouseDown(e, col.key)}
                  />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center py-8 text-gray-500">
                  Loading...
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center py-8 text-gray-500">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              data.map((item, idx) => (
                <TableRow
                  key={(item as any).id ?? idx}
                  className={onRowClick ? "cursor-pointer hover:bg-gray-50" : ""}
                  onClick={() => onRowClick?.(item)}
                >
                  {columns.map((col) => (
                    <TableCell
                      key={col.key}
                      className={col.className}
                      style={columnWidths[col.key] ? { width: columnWidths[col.key], minWidth: columnWidths[col.key] } : undefined}
                    >
                      {col.render ? col.render(item) : String(item[col.key] ?? "")}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {total > limit && onPageChange && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
          <span className="text-sm text-gray-500">
            Showing {(page - 1) * limit + 1}-{Math.min(page * limit, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
