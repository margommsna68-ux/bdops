/**
 * Google Sheet PP Import
 * Fetches CSV from public Google Sheet, parses PP data by code
 *
 * Sheet columns (A-N):
 * ma paypal | userwin | ppcode | passs payal | 2fa pp | email 1 | pass email 1 | token email 1 | email 2 | pass email 2 | token2 | email 3 | pass email 3 | token3
 */

export interface SheetPPRow {
  maPaypal: string;   // col A - key dùng để import
  userwin: string;    // col B
  ppcode: string;     // col C
  passPaypal: string; // col D
  twoFa: string;      // col E
  email1: string;     // col F
  passEmail1: string; // col G
  tokenEmail1: string;// col H
  email2: string;     // col I
  passEmail2: string; // col J
  tokenEmail2: string;// col K
  email3: string;     // col L
  passEmail3: string; // col M
  tokenEmail3: string;// col N
}

export interface SheetTab {
  name: string;
  gid: string;
}

function extractSheetId(url: string): string | null {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function extractGid(url: string): string {
  const match = url.match(/gid=(\d+)/);
  return match ? match[1] : "0";
}

/**
 * Fetch list of sheet tabs from a Google Spreadsheet
 */
export async function fetchSheetTabs(sheetUrl: string): Promise<SheetTab[]> {
  const sheetId = extractSheetId(sheetUrl);
  if (!sheetId) throw new Error("URL Google Sheet không hợp lệ");

  const htmlUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`;
  const resp = await fetch(htmlUrl, { redirect: "follow" });
  if (!resp.ok) throw new Error(`Không tải được sheet (${resp.status})`);

  const html = await resp.text();

  // Parse: items.push({name: "PP AE", ..., gid: "1086067347", ...});
  const tabs: SheetTab[] = [];
  const regex = /items\.push\(\{name:\s*"([^"]*)".*?gid:\s*"(\d+)"/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    tabs.push({ name: match[1], gid: match[2] });
  }

  return tabs;
}

export async function fetchSheetData(sheetUrl: string): Promise<SheetPPRow[]> {
  const sheetId = extractSheetId(sheetUrl);
  if (!sheetId) throw new Error("URL Google Sheet không hợp lệ");

  const gid = extractGid(sheetUrl);
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

  const resp = await fetch(csvUrl, { redirect: "follow" });
  if (!resp.ok) throw new Error(`Không tải được sheet (${resp.status}). Kiểm tra sheet đã public chưa.`);

  const text = await resp.text();
  const lines = parseCSV(text);
  if (lines.length < 2) throw new Error("Sheet trống hoặc không có dữ liệu");

  // Skip header row
  const rows: SheetPPRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i];
    // Skip empty rows (no ma paypal AND no ppcode)
    if (!cols[0]?.trim() && !cols[2]?.trim()) continue;

    rows.push({
      maPaypal: cols[0]?.trim() || "",
      userwin: cols[1]?.trim() || "",
      ppcode: cols[2]?.trim() || "",
      passPaypal: cols[3]?.trim() || "",
      twoFa: cols[4]?.trim() || "",
      email1: cols[5]?.trim() || "",
      passEmail1: cols[6]?.trim() || "",
      tokenEmail1: cols[7]?.trim() || "",
      email2: cols[8]?.trim() || "",
      passEmail2: cols[9]?.trim() || "",
      tokenEmail2: cols[10]?.trim() || "",
      email3: cols[11]?.trim() || "",
      passEmail3: cols[12]?.trim() || "",
      tokenEmail3: cols[13]?.trim() || "",
    });
  }

  return rows;
}

// Simple CSV parser that handles quoted fields with commas
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
        if (ch === "\r") i++;
      } else {
        field += ch;
      }
    }
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
