import * as XLSX from "xlsx";

export interface ParsedRow {
  [key: string]: string | number | null;
}

export function parseExcelBuffer(buffer: ArrayBuffer): ParsedRow[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  if (workbook.SheetNames.length === 0) throw new Error("Workbook has no sheets");
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<ParsedRow>(sheet, { defval: null });
}

export function parseExcelSheets(buffer: ArrayBuffer): Record<string, ParsedRow[]> {
  const workbook = XLSX.read(buffer, { type: "array" });
  const result: Record<string, ParsedRow[]> = {};
  for (const name of workbook.SheetNames) {
    result[name] = XLSX.utils.sheet_to_json<ParsedRow>(workbook.Sheets[name], { defval: null });
  }
  return result;
}

// Map column names to standardized keys
export function mapColumns<T extends Record<string, string>>(
  rows: ParsedRow[],
  mapping: T
): Array<Record<keyof T, string | number | null>> {
  return rows.map((row) => {
    const mapped: any = {};
    for (const [targetKey, sourceKey] of Object.entries(mapping)) {
      mapped[targetKey] = row[sourceKey] ?? null;
    }
    return mapped;
  });
}
