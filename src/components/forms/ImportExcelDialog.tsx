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
import { parseExcelBuffer, type ParsedRow } from "@/lib/excel-import";

interface ImportExcelDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (data: ParsedRow[]) => void;
  title: string;
  description?: string;
}

export function ImportExcelDialog({
  open,
  onClose,
  onImport,
  title,
  description,
}: ImportExcelDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError("");

    try {
      const buffer = await file.arrayBuffer();
      const rows = parseExcelBuffer(buffer);
      setPreview(rows.slice(0, 5)); // Preview first 5 rows
    } catch {
      setError("Failed to parse file. Please use .xlsx or .csv format.");
    }
  };

  const handleImport = async () => {
    if (!fileRef.current?.files?.[0] || importing) return;
    setImporting(true);
    try {
      const buffer = await fileRef.current.files[0].arrayBuffer();
      const rows = parseExcelBuffer(buffer);
      onImport(rows);
      onClose();
      setPreview([]);
      setFileName("");
    } catch {
      setError("Import failed.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setPreview([]); setFileName(""); } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {description && <p className="text-sm text-gray-500">{description}</p>}

        <div className="space-y-4">
          <div>
            <Label>Select Excel File (.xlsx)</Label>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFile}
              className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
          </div>

          {fileName && (
            <p className="text-sm text-gray-600">
              File: {fileName}
            </p>
          )}

          {/* Preview */}
          {preview.length > 0 && (
            <div>
              <Label>Preview (first 5 rows)</Label>
              <div className="mt-1 overflow-x-auto border rounded-md">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      {Object.keys(preview[0]).map((key) => (
                        <th key={key} className="px-2 py-1 text-left font-medium text-gray-500">
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {preview.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).map((val, j) => (
                          <td key={j} className="px-2 py-1 text-gray-700">
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
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleImport} disabled={preview.length === 0 || importing}>
              {importing ? "Importing..." : "Import All Rows"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
