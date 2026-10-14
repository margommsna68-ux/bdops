/**
 * Bright Data Withdrawal Sheet Parser
 * Parses the multi-server CSV layout: 13 servers side-by-side, 7 cols each
 * Columns per server: Paypal# | Paypal Account (email) | VM# | Date (dd/mm/yyyy) | Time | Status | Amount $
 */

export interface BDSheetRow {
  server: string;       // "SERVER 1", "SERVER 2", etc.
  ppCode: string;       // "AE-xxx"
  email: string;        // PayPal account email
  vm: string;           // "001-002", "003-004", etc.
  date: string;         // "dd/mm/yyyy"
  time: string;         // "HH:MM"
  status: string;       // "Withdrawal", "Paid", "Suspend"
  amount: number;       // dollar amount
}

// Parse CSV text (handles quoted fields)
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { result.push(current); current = ""; }
      else current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * Fetch and parse BD sheet. Returns all rows with data.
 */
export async function fetchBDSheet(sheetUrl: string): Promise<BDSheetRow[]> {
  // Extract sheet ID
  const match = sheetUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error("URL Google Sheet không hợp lệ");
  const sheetId = match[1];
  const gidMatch = sheetUrl.match(/gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : "0";

  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  const resp = await fetch(csvUrl, { redirect: "follow" });
  if (!resp.ok) throw new Error(`Không tải được sheet (${resp.status})`);
  const text = await resp.text();

  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  if (lines.length < 2) throw new Error("Sheet trống");

  // Parse header to find server blocks
  // Each server block = 7 data cols. Pattern: empty | Paypal# | Paypal Account | VM# | Date | Time | Status | Amount$
  // Servers are separated by 2-3 empty columns
  const header = parseCSVLine(lines[0]);

  // Find column indices where "Paypal #" appears → start of each server block
  const serverStarts: number[] = [];
  for (let i = 0; i < header.length; i++) {
    if (header[i].trim().toLowerCase().includes("paypal #")) {
      serverStarts.push(i);
    }
  }

  if (serverStarts.length === 0) throw new Error("Không tìm thấy cấu trúc server trong sheet");

  // Parse data rows
  const rows: BDSheetRow[] = [];
  const currentServers: string[] = new Array(serverStarts.length).fill("");

  for (let lineIdx = 1; lineIdx < lines.length; lineIdx++) {
    const cols = parseCSVLine(lines[lineIdx]);

    // For each server block
    for (let si = 0; si < serverStarts.length; si++) {
      const base = serverStarts[si];
      // The SERVER label is 1 col BEFORE Paypal# (or same col in some layouts)
      // Check if this row has a SERVER label
      const labelCol = base - 1;
      if (labelCol >= 0 && cols[labelCol]?.trim().startsWith("SERVER")) {
        currentServers[si] = cols[labelCol].trim();
      }

      const ppCode = (cols[base] ?? "").trim();
      const email = (cols[base + 1] ?? "").trim();
      const vm = (cols[base + 2] ?? "").trim();
      const dateStr = (cols[base + 3] ?? "").trim();
      const timeStr = (cols[base + 4] ?? "").trim();
      const status = (cols[base + 5] ?? "").trim();
      const amountStr = (cols[base + 6] ?? "").trim();

      // Skip empty rows (no date or no status)
      if (!dateStr || !status) continue;

      // Parse amount: "$24.05" → 24.05
      const amount = parseFloat(amountStr.replace(/[$,]/g, "")) || 0;

      rows.push({
        server: currentServers[si] || `SERVER ${si + 1}`,
        ppCode,
        email,
        vm,
        date: dateStr,
        time: timeStr,
        status,
        amount,
      });
    }
  }

  return rows;
}

/**
 * Filter rows by date (dd/mm/yyyy format) and status
 */
export function filterByDateAndStatus(
  rows: BDSheetRow[],
  targetDate: string, // "dd/mm/yyyy"
  status: string = "Withdrawal"
): BDSheetRow[] {
  return rows.filter((r) =>
    r.date === targetDate &&
    r.status.toLowerCase() === status.toLowerCase() &&
    r.ppCode && r.email && r.amount > 0
  );
}

/**
 * Get today's date in dd/mm/yyyy format
 */
export function getTodayDDMMYYYY(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
