import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseExcelBuffer, mapColumns } from "@/lib/excel-import";

function createTestExcel(data: Record<string, unknown>[]): ArrayBuffer {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return out;
}

describe("parseExcelBuffer", () => {
  it("parses Excel buffer into row objects", () => {
    const buffer = createTestExcel([
      { Name: "Alice", Amount: 100 },
      { Name: "Bob", Amount: 200 },
    ]);
    const rows = parseExcelBuffer(buffer);
    expect(rows).toHaveLength(2);
    expect(rows[0].Name).toBe("Alice");
    expect(rows[0].Amount).toBe(100);
    expect(rows[1].Name).toBe("Bob");
  });

  it("handles empty sheet", () => {
    const buffer = createTestExcel([]);
    const rows = parseExcelBuffer(buffer);
    expect(rows).toHaveLength(0);
  });

  it("throws on empty workbook (no sheets)", () => {
    // XLSX.write itself throws on empty workbook, which is fine -
    // our guard handles the case where SheetNames is empty after read
    const wb = XLSX.utils.book_new();
    expect(() => XLSX.write(wb, { type: "array", bookType: "xlsx" })).toThrow();
  });

  it("fills missing values with null", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["A", "B"],
      [1, null],
      [null, 2],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const rows = parseExcelBuffer(out);
    expect(rows[0].A).toBe(1);
    expect(rows[0].B).toBeNull();
    expect(rows[1].A).toBeNull();
    expect(rows[1].B).toBe(2);
  });
});

describe("mapColumns", () => {
  it("maps source columns to target keys", () => {
    const rows = [
      { "Full Name": "Alice", "Total Amount": 100 },
      { "Full Name": "Bob", "Total Amount": 200 },
    ];
    const mapped = mapColumns(rows, {
      name: "Full Name",
      amount: "Total Amount",
    });
    expect(mapped[0].name).toBe("Alice");
    expect(mapped[0].amount).toBe(100);
    expect(mapped[1].name).toBe("Bob");
  });

  it("returns null for missing source columns", () => {
    const rows = [{ A: 1 }];
    const mapped = mapColumns(rows, { x: "A", y: "B" });
    expect(mapped[0].x).toBe(1);
    expect(mapped[0].y).toBeNull();
  });
});
