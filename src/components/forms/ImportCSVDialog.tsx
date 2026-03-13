"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parseCSV } from "@/lib/excel-export";

interface ImportCSVDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (data: Record<string, string>[]) => void;
  title: string;
  description?: string;
  templateColumns?: string[];
}

export function ImportCSVDialog({
  open,
  onClose,
  onImport,
  title,
  description,
  templateColumns,
}: ImportCSVDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [allRows, setAllRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);

  const reset = () => {
    setPreview([]);
    setAllRows([]);
    setFileName("");
    setError("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError("");

    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length === 0) {
        setError("File is empty or has no valid rows.");
        return;
      }
      setAllRows(rows);
      setPreview(rows.slice(0, 5));
    } catch {
      setError("Failed to parse CSV file.");
    }
  };

  const handleImport = async () => {
    if (allRows.length === 0 || importing) return;
    setImporting(true);
    try {
      onImport(allRows);
      onClose();
      reset();
    } catch {
      setError("Import failed.");
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    if (!templateColumns || templateColumns.length === 0) return;
    const csv = templateColumns.join(",") + "\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); reset(); } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {description && <p className="text-sm text-gray-500">{description}</p>}

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <Label>Select CSV File (.csv)</Label>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                onChange={handleFile}
                className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
            </div>
            {templateColumns && templateColumns.length > 0 && (
              <Button type="button" variant="outline" size="sm" className="mt-5 shrink-0 text-xs" onClick={downloadTemplate}>
                Download Template
              </Button>
            )}
          </div>

          {fileName && (
            <p className="text-sm text-gray-600">
              File: {fileName} ({allRows.length} rows)
            </p>
          )}

          {preview.length > 0 && (
            <div>
              <Label>Preview (first 5 rows)</Label>
              <div className="mt-1 overflow-x-auto border rounded-md max-h-48">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      {Object.keys(preview[0]).map((key) => (
                        <th key={key} className="px-2 py-1 text-left font-medium text-gray-500 whitespace-nowrap">
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {preview.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).map((val, j) => (
                          <td key={j} className="px-2 py-1 text-gray-700 whitespace-nowrap">
                            {String(val ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { onClose(); reset(); }}>Cancel</Button>
            <Button onClick={handleImport} disabled={allRows.length === 0 || importing}>
              {importing ? "Importing..." : `Import ${allRows.length} Rows`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
