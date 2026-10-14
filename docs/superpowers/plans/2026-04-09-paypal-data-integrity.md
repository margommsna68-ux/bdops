# PayPal Data Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix broken multi-email cells, add data-completeness warnings to PayPal list/detail pages, and make sheet import update existing credentials with a change report.

**Architecture:** Shared utility for email extraction and completeness checks. Backend enriches `paypal.list` with computed `missingFields`. Two new admin endpoints (`scanBrokenEmails`, `fixBrokenEmails`). `importFromSheet` refactored to upsert credentials and report changes. Frontend adds a `NoDataBadge` component, status-column warning, Fix Broken Emails dialog, and import change-report dialog.

**Tech Stack:** Next.js 14 (App Router), TypeScript strict, Prisma 5, tRPC, Zod, Tailwind, react-hot-toast. No automated test suite — each task uses manual verification steps.

**Spec:** `docs/superpowers/specs/2026-04-09-paypal-data-integrity-design.md`

**Repo context:** Work inside `bdops/` (git repo). Dev server runs via `npm run dev` at `http://localhost:3000`. Next.js HMR auto-reloads on file changes — do NOT restart the dev server. The parent `project web/` directory is not a git repo; all git commands must be run with `bdops` as the working directory.

---

## File map

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/pp-data-utils.ts` | **Create** | `extractEmails`, `isSingleValidEmail`, `getMissingFields` helpers |
| `src/components/NoDataBadge.tsx` | **Create** | Red `[NODATA]` / gray `N/A` badge |
| `src/lib/i18n.ts` | Modify | Add en/vi keys for new UI strings |
| `src/server/routers/paypal.ts` | Modify | Replace `isValidEmail`, enrich `list`, refactor `importFromSheet`, add `scanBrokenEmails` + `fixBrokenEmails` |
| `src/app/(dashboard)/paypals/page.tsx` | Modify | Status-column warning, Fix Broken Emails dialog, Quick Add parser fix, import result dialog |
| `src/app/(dashboard)/paypals/[id]/page.tsx` | Modify | `NoDataBadge` integration via extended `EditableField` |

---

## Task 1: Create `pp-data-utils.ts` helper module

**Files:**
- Create: `src/lib/pp-data-utils.ts`

- [ ] **Step 1: Create the helper file with all three functions**

Write this exact content to `src/lib/pp-data-utils.ts`:

```ts
// Shared helpers for PayPal data integrity checks.
// Used by both backend routers and frontend components.

export const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/**
 * Extract all emails from a string. Handles multi-email cells like
 * "oanh@gmail.com  max@hotmail.com" or "a@x.com,b@y.com".
 * Returns a deduped, lowercased list. Safe for null/undefined input.
 */
export function extractEmails(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = text.match(EMAIL_REGEX) ?? [];
  const cleaned = matches.map((e) => e.trim().toLowerCase()).filter(Boolean);
  return Array.from(new Set(cleaned));
}

/**
 * Strict check: returns true only if the input is exactly one valid email
 * with no extra characters or whitespace. Use this to validate stored data.
 */
export function isSingleValidEmail(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (/\s/.test(trimmed)) return false;
  const matches = trimmed.match(EMAIL_REGEX);
  return matches?.length === 1 && matches[0] === trimmed;
}

/**
 * Which "required" fields are missing on a PP record?
 * Required = PayPalAccount.password + PayPalAccount.twoFa + ≥1 PayPalEmail.
 */
export type MissingPPField = "password" | "twoFa" | "email";

export interface PPCompletenessInput {
  hasPassword?: boolean;
  hasTwoFa?: boolean;
  emailCount?: number;
}

export function getMissingFields(pp: PPCompletenessInput): MissingPPField[] {
  const missing: MissingPPField[] = [];
  if (!pp.hasPassword) missing.push("password");
  if (!pp.hasTwoFa) missing.push("twoFa");
  if (!pp.emailCount || pp.emailCount < 1) missing.push("email");
  return missing;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd bdops && npx tsc --noEmit 2>&1 | grep -E "pp-data-utils" || echo "OK — no errors in pp-data-utils"`
Expected: `OK — no errors in pp-data-utils`

- [ ] **Step 3: Manual smoke test via node REPL**

Run: `cd bdops && node -e "const {extractEmails,isSingleValidEmail,getMissingFields}=require('./src/lib/pp-data-utils.ts'); console.log(extractEmails('a@x.com b@y.com'));" 2>&1 || echo "skip - ts file"`

Since the file is TypeScript, the node direct-run will fail. Instead, add a temporary throwaway check using `tsx` or `ts-node` if available, OR skip this step and rely on the integration test in Task 4 that consumes this helper. Proceed to step 4.

- [ ] **Step 4: Commit**

```bash
cd bdops
git add src/lib/pp-data-utils.ts
git commit -m "feat(paypal): add email extraction and completeness helpers"
```

---

## Task 2: Create `NoDataBadge` component

**Files:**
- Create: `src/components/NoDataBadge.tsx`

- [ ] **Step 1: Write the component**

Write this exact content to `src/components/NoDataBadge.tsx`:

```tsx
// Badge shown when a PP field is missing data.
// variant="required" → red NODATA badge (field is required for completeness)
// variant="optional" → gray N/A text (field is optional, just not filled)

export function NoDataBadge({
  variant = "optional",
  label,
}: {
  variant?: "required" | "optional";
  label?: string;
}) {
  if (variant === "required") {
    return (
      <span
        className="inline-block px-1.5 py-0.5 text-[9px] font-bold bg-red-100 text-red-700 rounded border border-red-300 uppercase tracking-wide"
        title={label || "Field is required but missing"}
      >
        NODATA
      </span>
    );
  }
  return <span className="text-xs text-gray-400 italic">N/A</span>;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd bdops && npx tsc --noEmit 2>&1 | grep -E "NoDataBadge" || echo "OK"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd bdops
git add src/components/NoDataBadge.tsx
git commit -m "feat(paypal): add NoDataBadge component"
```

---

## Task 3: Add i18n keys

**Files:**
- Modify: `src/lib/i18n.ts` — add new keys before the closing `}` of the `translations` object

- [ ] **Step 1: Find the insertion point**

Run: `cd bdops && grep -n "// ─── PayPal\|paypal_status\|^};" src/lib/i18n.ts | tail -10`
Look for a PayPal section or the final `};` of the translations object. Insert the new keys either in the existing PayPal section or just before the closing `};`.

- [ ] **Step 2: Add these keys**

Insert the following inside the `translations` object (group them as a `// ─── PayPal Data Integrity ───` section if there isn't an existing PayPal section):

```ts
  // ─── PayPal Data Integrity ───
  "pp_missing_data": { en: "Add data", vi: "Bổ sung data" },
  "pp_missing_data_tooltip": { en: "Missing required fields", vi: "Thiếu dữ liệu bắt buộc" },
  "pp_missing_password": { en: "password", vi: "mật khẩu" },
  "pp_missing_twofa": { en: "2FA", vi: "2FA" },
  "pp_missing_email": { en: "email", vi: "email" },
  "pp_nodata_badge": { en: "NODATA", vi: "NODATA" },
  "pp_fix_broken_emails": { en: "Fix Broken Emails", vi: "Sửa email bị chèn" },
  "pp_scan_broken_emails": { en: "Scan for broken emails", vi: "Quét email bị chèn" },
  "pp_broken_emails_found": { en: "Broken emails found", vi: "Email bị chèn đã tìm thấy" },
  "pp_broken_emails_none": { en: "No broken emails found.", vi: "Không có email nào bị chèn." },
  "pp_fix_all": { en: "Fix All", vi: "Sửa tất cả" },
  "pp_original_email": { en: "Original", vi: "Email gốc" },
  "pp_split_into": { en: "Split into", vi: "Tách thành" },
  "pp_fix_success": { en: "Fixed {count} records, created {created} new emails", vi: "Đã sửa {count} bản ghi, tạo {created} email mới" },
  "pp_import_changes_title": { en: "Import changes detected", vi: "Phát hiện thay đổi từ import" },
  "pp_import_no_changes": { en: "No changes — all data already up to date.", vi: "Không có thay đổi — dữ liệu đã mới nhất." },
  "pp_import_changes_field": { en: "Field", vi: "Trường" },
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd bdops && npx tsc --noEmit 2>&1 | grep -E "i18n" || echo "OK"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
cd bdops
git add src/lib/i18n.ts
git commit -m "feat(paypal): add i18n keys for data integrity UI"
```

---

## Task 4: Backend — update `paypal.ts` helpers and `list` enrichment

**Files:**
- Modify: `src/server/routers/paypal.ts`

- [ ] **Step 1: Import new helpers**

Find the existing imports near the top of `src/server/routers/paypal.ts` (around line 1-15). After the existing `import { fetchSheetData, fetchSheetTabs } from "@/lib/sheet-import";` line (line 7), add:

```ts
import { extractEmails, isSingleValidEmail, getMissingFields } from "@/lib/pp-data-utils";
```

- [ ] **Step 2: Remove the old permissive `isValidEmail` helper**

Delete lines 13-15 of `src/server/routers/paypal.ts`:

```ts
function isValidEmail(v: string | null | undefined): boolean {
  return !!v && v.includes("@") && v.includes(".") && v.length > 5;
}
```

All existing usages in this file currently check "looks like an email" but should instead check "is this a single valid email". Replace call sites that use `isValidEmail(x)` to check "should we consider this cell as producing emails" with `extractEmails(x).length > 0`, and add a separate path when upstream code previously assumed the cell contained exactly one email.

- [ ] **Step 3: Update `importFromSheet` call sites that use `isValidEmail`**

Inside `importFromSheet` (around lines 1033-1102), find these call sites and update:

**At line ~1041** (existing-PP update path):
```ts
// OLD:
if (isValidEmail(row.email1)) updateData.primaryEmail = row.email1;
```
Replace with:
```ts
// NEW: only set primaryEmail if row.email1 is a single valid email.
// Multi-email handling happens later when iterating email entries.
const email1Extracted = extractEmails(row.email1);
if (email1Extracted.length > 0) updateData.primaryEmail = email1Extracted[0];
```

**At line ~1055** (existing-PP email loop):
```ts
// OLD:
for (const entry of emailEntries) {
  if (!isValidEmail(entry.email)) continue;
```

This entire loop is replaced in Task 5 with the upsert logic. For now leave the loop in place but swap `isValidEmail(entry.email)` → `extractEmails(entry.email).length > 0`. Task 5 will overhaul this block completely.

**At line ~1090** (new-PP allEmails):
```ts
// OLD:
const allEmails = [row.email1, row.email2, row.email3].filter(isValidEmail);
```
Replace with:
```ts
const allEmails = [row.email1, row.email2, row.email3].flatMap(extractEmails);
```

**At line ~1102** (new-PP primaryEmail):
```ts
// OLD:
const primaryEmail = (isValidEmail(row.email1) ? row.email1 : null) || (isValidEmail(row.email2) ? row.email2 : null) || (isValidEmail(row.email3) ? row.email3 : null) || `${ppCode}@unknown.com`;
```
Replace with:
```ts
const primaryEmail = allEmails[0] || `${ppCode}@unknown.com`;
```

**At line ~1128** (new-PP email loop):
```ts
// OLD:
for (const entry of emailEntries) {
  if (!isValidEmail(entry.email)) continue;
```

Keep this loop for now but swap `isValidEmail(entry.email)` → `extractEmails(entry.email).length > 0`. Task 5 will overhaul.

- [ ] **Step 4: Enrich `paypal.list` with `missingFields` + `isComplete`**

Find the `enrichedItems` assignment at `src/server/routers/paypal.ts:128-137`. Replace the block from `const enrichedItems = items.map((pp) => ({` to its closing `}));` with:

```ts
const enrichedItems = items.map((pp) => {
  const hasPassword = !!pp.password;
  const hasTwoFa = !!pp.twoFa;
  const emailCount = pp._count.emails;
  const missingFields = getMissingFields({ hasPassword, hasTwoFa, emailCount });
  return {
    ...pp,
    totalReceived: fundMap.get(pp.id) ?? 0,
    totalWithdrawn: withdrawMap.get(pp.id) ?? 0,
    balance: (fundMap.get(pp.id) ?? 0) - (withdrawMap.get(pp.id) ?? 0),
    lastFundDate: lastFundMap.get(pp.id) ?? null,
    hasPassword,
    hasTwoFa,
    hasToken: !!pp.hotmailToken,
    missingFields,
    isComplete: missingFields.length === 0,
  };
});
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd bdops && npx tsc --noEmit 2>&1 | grep -E "paypal\.ts" || echo "OK"`
Expected: `OK`

- [ ] **Step 6: Manual verify — list endpoint returns new fields**

Start dev server (if not running): `cd bdops && npm run dev` (background).
In a second terminal, curl an existing list call and grep for `missingFields`:
```bash
# Replace SESSION_COOKIE with a valid next-auth session cookie; alternatively open the paypals page in the browser with devtools Network tab and inspect the response of /api/trpc/paypal.list.
```
Easier: open `http://localhost:3000/paypals` in browser, open devtools → Network → find `paypal.list` request → inspect response → confirm each item has `missingFields: [...]` and `isComplete: boolean`. Take a screenshot for reference.

- [ ] **Step 7: Commit**

```bash
cd bdops
git add src/server/routers/paypal.ts
git commit -m "feat(paypal): use strict email extraction and enrich list with missingFields"
```

---

## Task 5: Backend — refactor `importFromSheet` to upsert credentials with change report

**Files:**
- Modify: `src/server/routers/paypal.ts` — replace the body of `importFromSheet`

- [ ] **Step 1: Add `decrypt` import if missing**

Check that `decrypt` is imported from `@/lib/encryption`:
Run: `cd bdops && grep -n "from \"@/lib/encryption\"" src/server/routers/paypal.ts`
Expected: line with both `encrypt` and `decrypt` in the import.

If only `encrypt` is imported, change the import to include `decrypt`:
```ts
import { encrypt, decrypt } from "@/lib/encryption";
```

- [ ] **Step 2: Replace the email-creation loop inside `importFromSheet` (existing-PP branch)**

Find the block at `src/server/routers/paypal.ts:1047-1071` inside the `if (existing)` branch. It currently looks like:

```ts
// Add missing emails
const emailEntries = [
  { email: row.email1, pass: row.passEmail1, token: row.tokenEmail1 },
  { email: row.email2, pass: row.passEmail2, token: row.tokenEmail2 },
  { email: row.email3, pass: row.passEmail3, token: row.tokenEmail3 },
];
let emailsAdded = 0;
for (const entry of emailEntries) {
  if (extractEmails(entry.email).length === 0) continue;
  // Check email globally — not just within this PP
  const exists = await ctx.prisma.payPalEmail.findFirst({
    where: { email: entry.email },
  });
  if (!exists) {
    const emailData: any = {
      email: entry.email,
      isPrimary: false,
      paypalId: existing.id,
      projectId: input.projectId,
    };
    if (entry.pass) emailData.password = encrypt(entry.pass);
    if (entry.token) emailData.hotmailToken = encrypt(entry.token);
    try { await ctx.prisma.payPalEmail.create({ data: emailData }); emailsAdded++; } catch {}
  }
}
```

Replace with:

```ts
// Expand each email cell via extractEmails — handles multi-email cells.
// Each (email, pass, token) entry from the sheet is split into one (email, pass, token)
// per extracted email. If a cell has 2 emails, they both inherit the same pass/token.
const sheetEntries: Array<{ email: string; pass: string; token: string }> = [];
for (const src of [
  { email: row.email1, pass: row.passEmail1, token: row.tokenEmail1 },
  { email: row.email2, pass: row.passEmail2, token: row.tokenEmail2 },
  { email: row.email3, pass: row.passEmail3, token: row.tokenEmail3 },
]) {
  for (const e of extractEmails(src.email)) {
    sheetEntries.push({ email: e, pass: src.pass || "", token: src.token || "" });
  }
}

let emailsAdded = 0;
let emailsUpdated = 0;
const emailChanges: Array<{ email: string; fields: string[] }> = [];

for (const entry of sheetEntries) {
  // Email is unique per project, but we look up globally to avoid collisions
  const existingEmail = await ctx.prisma.payPalEmail.findFirst({
    where: { email: entry.email, projectId: input.projectId },
  });

  if (!existingEmail) {
    const emailData: any = {
      email: entry.email,
      isPrimary: false,
      paypalId: existing.id,
      projectId: input.projectId,
    };
    if (entry.pass) emailData.password = encrypt(entry.pass);
    if (entry.token) emailData.hotmailToken = encrypt(entry.token);
    try {
      await ctx.prisma.payPalEmail.create({ data: emailData });
      emailsAdded++;
    } catch { /* skip duplicate */ }
    continue;
  }

  // Email exists — compare + update changed credentials
  const currentPass = existingEmail.password ? decrypt(existingEmail.password) : null;
  const currentToken = existingEmail.hotmailToken ? decrypt(existingEmail.hotmailToken) : null;

  const updates: any = {};
  const changedFields: string[] = [];
  if (entry.pass && entry.pass !== currentPass) {
    updates.password = encrypt(entry.pass);
    changedFields.push("password");
  }
  if (entry.token && entry.token !== currentToken) {
    updates.hotmailToken = encrypt(entry.token);
    changedFields.push("token");
  }

  if (Object.keys(updates).length > 0) {
    await ctx.prisma.payPalEmail.update({
      where: { id: existingEmail.id },
      data: updates,
    });
    emailsUpdated++;
    emailChanges.push({ email: entry.email, fields: changedFields });
  }
}
```

- [ ] **Step 3: Also compare PP account-level password and 2FA**

Inside the same `if (existing)` branch, find the `updateData` object (around line 1036). Currently it unconditionally sets `password` + `twoFa` if the sheet has a value. Change that to compare-first. Replace:

```ts
if (row.passPaypal) updateData.password = encrypt(row.passPaypal);
if (row.twoFa) updateData.twoFa = encrypt(row.twoFa);
```

with:

```ts
const currentPPPass = existing.password ? decrypt(existing.password) : null;
const currentPPTwoFa = existing.twoFa ? decrypt(existing.twoFa) : null;
const accountChangedFields: string[] = [];
if (row.passPaypal && row.passPaypal !== currentPPPass) {
  updateData.password = encrypt(row.passPaypal);
  accountChangedFields.push("password");
}
if (row.twoFa && row.twoFa !== currentPPTwoFa) {
  updateData.twoFa = encrypt(row.twoFa);
  accountChangedFields.push("twoFa");
}
```

- [ ] **Step 4: Collect a top-level `changes` array and include it in the per-row result**

At the start of `importFromSheet`'s mutation body (right after `let imported = 0;`), add:

```ts
let updated = 0;
let emailsCreatedTotal = 0;
let emailsUpdatedTotal = 0;
const allChanges: Array<{ ppCode: string; email?: string; fields: string[] }> = [];
```

After the account-level `updateData` comparison (after Step 3), push account-level changes:

```ts
if (accountChangedFields.length > 0) {
  allChanges.push({ ppCode, fields: accountChangedFields });
}
```

After the per-email loop (after Step 2), push email-level changes and aggregate counters:

```ts
for (const c of emailChanges) {
  allChanges.push({ ppCode, email: c.email, fields: c.fields });
}
emailsCreatedTotal += emailsAdded;
emailsUpdatedTotal += emailsUpdated;
```

Also, change the existing branch's success classification. The current logic counts any change as `imported++`. Change it to increment `updated` instead:

```ts
// OLD:
const changes = Object.keys(updateData).length + emailsAdded;
if (changes > 0) {
  imported++;
  results.push({ ppcode: ppCode, status: "created", message: `Updated: ${Object.keys(updateData).join(",")}${emailsAdded > 0 ? ` +${emailsAdded} emails` : ""}` });
} else {
  skipped++;
  results.push({ ppcode: ppCode, status: "skipped", message: "Đã đầy đủ" });
}
```

Replace with:

```ts
const changeCount = Object.keys(updateData).length + emailsAdded + emailsUpdated;
if (changeCount > 0) {
  updated++;
  const parts: string[] = [];
  if (accountChangedFields.length > 0) parts.push(accountChangedFields.join(","));
  if (emailsAdded > 0) parts.push(`+${emailsAdded} emails`);
  if (emailsUpdated > 0) parts.push(`~${emailsUpdated} emails`);
  results.push({ ppcode: ppCode, status: "updated", message: parts.join(" ") || "changed" });
} else {
  skipped++;
  results.push({ ppcode: ppCode, status: "skipped", message: "Đã đầy đủ" });
}
```

Note: the existing `results` type uses `"created" | "skipped" | "error"`. Extend it:

```ts
const results: Array<{ ppcode: string; status: "created" | "updated" | "skipped" | "error"; message?: string }> = [];
```

- [ ] **Step 5: Expand the new-PP branch to handle multi-email too**

Find the new-PP branch at `src/server/routers/paypal.ts:1088-1142`. The `allEmails` is already updated to use `extractEmails` in Task 4. Now also expand the per-email creation loop. Replace the block:

```ts
// Create emails (up to 3)
const emailEntries = [
  { email: row.email1, pass: row.passEmail1, token: row.tokenEmail1 },
  { email: row.email2, pass: row.passEmail2, token: row.tokenEmail2 },
  { email: row.email3, pass: row.passEmail3, token: row.tokenEmail3 },
];

let primarySet = false;
for (const entry of emailEntries) {
  if (extractEmails(entry.email).length === 0) continue;
  const emailData: any = {
    email: entry.email,
    isPrimary: !primarySet,
    paypalId: pp.id,
    projectId: input.projectId,
  };
  if (entry.pass) emailData.password = encrypt(entry.pass);
  if (entry.token) emailData.hotmailToken = encrypt(entry.token);
  try {
    await ctx.prisma.payPalEmail.create({ data: emailData });
    primarySet = true;
  } catch { /* skip duplicate email */ }
}
```

with:

```ts
const newSheetEntries: Array<{ email: string; pass: string; token: string }> = [];
for (const src of [
  { email: row.email1, pass: row.passEmail1, token: row.tokenEmail1 },
  { email: row.email2, pass: row.passEmail2, token: row.tokenEmail2 },
  { email: row.email3, pass: row.passEmail3, token: row.tokenEmail3 },
]) {
  for (const e of extractEmails(src.email)) {
    newSheetEntries.push({ email: e, pass: src.pass || "", token: src.token || "" });
  }
}

let primarySet = false;
for (const entry of newSheetEntries) {
  const emailData: any = {
    email: entry.email,
    isPrimary: !primarySet,
    paypalId: pp.id,
    projectId: input.projectId,
  };
  if (entry.pass) emailData.password = encrypt(entry.pass);
  if (entry.token) emailData.hotmailToken = encrypt(entry.token);
  try {
    await ctx.prisma.payPalEmail.create({ data: emailData });
    primarySet = true;
    emailsCreatedTotal++;
  } catch { /* skip duplicate */ }
}
```

- [ ] **Step 6: Update the final return statement of `importFromSheet`**

Find the return statement at the end of the mutation (around line 1160+, after the audit log call). Replace:

```ts
return { imported, skipped, errors: errors.slice(0, 10), results };
```

with:

```ts
return {
  imported,
  updated,
  skipped,
  emailsCreated: emailsCreatedTotal,
  emailsUpdated: emailsUpdatedTotal,
  changes: allChanges,
  errors: errors.slice(0, 10),
  results,
};
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `cd bdops && npx tsc --noEmit 2>&1 | head -50`
Expected: No errors in `paypal.ts`. If there are type errors, fix them inline. The extended `results` union type may cause callers to need updating — check with `grep -rn "paypal.importFromSheet" src/` and adjust client-side type expectations.

- [ ] **Step 8: Manual verify — re-run an existing sheet import in dev**

Open `http://localhost:3000/paypals`, click the Sheet Import button. Import a small test batch (e.g., 2 PP codes). Check the Network tab response for `paypal.importFromSheet` — confirm it has `changes: [...]`, `updated`, `emailsCreated`, `emailsUpdated`. If you re-run the same import, the `changes` array should be empty (no diff).

- [ ] **Step 9: Commit**

```bash
cd bdops
git add src/server/routers/paypal.ts
git commit -m "feat(paypal): upsert credentials from sheet import with change report"
```

---

## Task 6: Backend — add `scanBrokenEmails` + `fixBrokenEmails` endpoints

**Files:**
- Modify: `src/server/routers/paypal.ts` — add two new endpoints at the end of the router (before the closing `});`)

- [ ] **Step 1: Find the insertion point**

Run: `cd bdops && grep -n "^});$" src/server/routers/paypal.ts | tail -1`
Expected: A line number near the bottom — this is the router's closing brace. Insert the new endpoints just above it.

- [ ] **Step 2: Add `scanBrokenEmails` endpoint**

Before the final `});`, insert:

```ts
  // ─── Scan for broken PayPalEmail records (multi-email in one cell) ───
  scanBrokenEmails: paypalsProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      if (ctx.role !== "ADMIN" && ctx.role !== "MODERATOR") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Requires ADMIN or MODERATOR role" });
      }
      const all = await ctx.prisma.payPalEmail.findMany({
        where: { projectId: input.projectId },
        include: { paypal: { select: { id: true, code: true } } },
        orderBy: { createdAt: "asc" },
      });

      const broken = all
        .map((e) => ({
          id: e.id,
          ppId: e.paypal.id,
          ppCode: e.paypal.code,
          originalEmail: e.email,
          extractedEmails: extractEmails(e.email),
          isPrimary: e.isPrimary,
        }))
        .filter((e) => !isSingleValidEmail(e.originalEmail) && e.extractedEmails.length >= 1);

      return broken;
    }),
```

- [ ] **Step 3: Add `fixBrokenEmails` endpoint**

Immediately after `scanBrokenEmails`, add:

```ts
  // ─── Fix broken PayPalEmail records by splitting into multiple rows ───
  fixBrokenEmails: paypalsProcedure
    .input(z.object({
      projectId: z.string(),
      items: z.array(z.object({
        emailId: z.string(),
        extractedEmails: z.array(z.string().min(1)),
      })).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.role !== "ADMIN" && ctx.role !== "MODERATOR") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Requires ADMIN or MODERATOR role" });
      }

      let fixed = 0;
      let newEmails = 0;
      const errors: string[] = [];

      for (const item of input.items) {
        if (item.extractedEmails.length === 0) continue;
        try {
          const existing = await ctx.prisma.payPalEmail.findFirst({
            where: { id: item.emailId, projectId: input.projectId },
          });
          if (!existing) {
            errors.push(`${item.emailId}: not found`);
            continue;
          }
          // Re-check against current state (avoid race with concurrent edits)
          if (isSingleValidEmail(existing.email)) {
            continue; // already fixed
          }

          const [firstEmail, ...rest] = item.extractedEmails;

          // Update the existing row to use the first extracted email (keeps credentials)
          await ctx.prisma.payPalEmail.update({
            where: { id: existing.id },
            data: { email: firstEmail },
          });

          // Create new rows for remaining emails (no credentials — must be filled manually)
          for (const email of rest) {
            try {
              await ctx.prisma.payPalEmail.create({
                data: {
                  email,
                  isPrimary: false,
                  paypalId: existing.paypalId,
                  projectId: input.projectId,
                },
              });
              newEmails++;
            } catch { /* duplicate email in same project — skip */ }
          }

          // Sync PayPalAccount.primaryEmail if this was the primary
          if (existing.isPrimary) {
            await ctx.prisma.payPalAccount.update({
              where: { id: existing.paypalId },
              data: { primaryEmail: firstEmail },
            });
          }

          fixed++;
        } catch (e: any) {
          errors.push(`${item.emailId}: ${e.message}`);
        }
      }

      await createAuditLog({
        action: "FIX_BROKEN_EMAILS",
        entity: "PayPalEmail",
        entityId: input.projectId,
        userId: (ctx.user as any).id,
        projectId: input.projectId,
        changes: { fixed, newEmails, errorCount: errors.length },
      });

      return { fixed, newEmails, errors: errors.slice(0, 10) };
    }),
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd bdops && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 5: Manual verify — scan endpoint returns an empty list if DB is clean**

Open browser devtools on `http://localhost:3000/paypals`, open the Console tab, and run:
```js
fetch('/api/trpc/paypal.scanBrokenEmails?batch=1&input=' + encodeURIComponent(JSON.stringify({"0":{"json":{"projectId":"<PROJECT_ID>"}}})), {credentials:'include'}).then(r=>r.json()).then(console.log)
```
Replace `<PROJECT_ID>` with the current project ID from `localStorage` or the URL. Expected: `{result: {data: {json: []}}}` if no broken data, or a list of broken records.

Optionally insert a test row via `psql` or Prisma Studio:
```sql
-- Create a broken row for testing (replace paypalId/projectId with real values)
INSERT INTO "PayPalEmail" (id, email, "paypalId", "projectId", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'test1@x.com test2@y.com', '<PP_ID>', '<PROJECT_ID>', NOW(), NOW());
```
Then re-run the scan. It should appear in the result.

- [ ] **Step 6: Commit**

```bash
cd bdops
git add src/server/routers/paypal.ts
git commit -m "feat(paypal): add scanBrokenEmails and fixBrokenEmails endpoints"
```

---

## Task 7: Frontend — list page status column warning

**Files:**
- Modify: `src/app/(dashboard)/paypals/page.tsx` — status cell render block

- [ ] **Step 1: Locate the status cell render**

Run: `cd bdops && grep -n "status: (" src/app/(dashboard)/paypals/page.tsx`
Expected: `1063:                  status: (`

- [ ] **Step 2: Insert the warning text block**

In `src/app/(dashboard)/paypals/page.tsx`, inside the `status: (...)` render (lines 1063-1122), find the closing `</div>` of the outer `<div>` wrapping the status content (around line 1121). Just before that closing `</div>`, insert:

```tsx
{pp.missingFields && pp.missingFields.length > 0 && (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); router.push(`/paypals/${pp.id}`); }}
    className="text-[9px] text-red-600 font-semibold block hover:underline mt-0.5 text-left"
    title={`${t("pp_missing_data_tooltip")}: ${pp.missingFields.map((f: string) => t(`pp_missing_${f.toLowerCase()}`)).join(", ")}`}
  >
    ⚠ {t("pp_missing_data")}
  </button>
)}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd bdops && npx tsc --noEmit 2>&1 | grep -E "paypals/page.tsx" || echo "OK"`
Expected: `OK`

- [ ] **Step 4: Manual verify**

With dev server running, open `http://localhost:3000/paypals`. Find a PP that has no password (create one if needed via Quick Add with just an email). The status column should show `[ACTIVE]` badge followed by red `⚠ Bổ sung data` text below. Hover to see tooltip listing missing fields. Click it → should navigate to the detail page.

- [ ] **Step 5: Commit**

```bash
cd bdops
git add "src/app/(dashboard)/paypals/page.tsx"
git commit -m "feat(paypal): show incomplete-data warning in list status column"
```

---

## Task 8: Frontend — Fix Broken Emails dialog

**Files:**
- Modify: `src/app/(dashboard)/paypals/page.tsx`

- [ ] **Step 1: Add state hooks near the other dialog state**

Find the `showQuickAdd` state declaration (around line 319). Below it (right after `const [savingQuick, setSavingQuick] = useState(false);`), add:

```tsx
// Fix Broken Emails dialog state
const [showFixBroken, setShowFixBroken] = useState(false);
const { data: brokenEmails, refetch: refetchBroken, isLoading: brokenLoading } = trpc.paypal.scanBrokenEmails.useQuery(
  { projectId: projectId! },
  { enabled: !!projectId && showFixBroken, staleTime: 0 }
);
const fixBrokenMutation = trpc.paypal.fixBrokenEmails.useMutation({
  onSuccess: (res) => {
    toast.success(t("pp_fix_success").replace("{count}", String(res.fixed)).replace("{created}", String(res.newEmails)));
    refetchBroken();
    utils.paypal.list.invalidate();
    setShowFixBroken(false);
  },
  onError: (e) => toast.error(e.message),
});
```

- [ ] **Step 2: Add the "Fix Broken Emails" button in the toolbar**

Find the toolbar area where the Sheet Import button lives. Run:
```bash
cd bdops && grep -n "showSheetImport" "src/app/(dashboard)/paypals/page.tsx" | head -5
```
Locate the button that toggles `showSheetImport` (there should be a `<button onClick={() => setShowSheetImport(true)}>` around the top toolbar). Add a new button next to it, visible only to admin/moderator:

```tsx
{(currentRole === "ADMIN" || currentRole === "MODERATOR") && (
  <button
    type="button"
    onClick={() => setShowFixBroken(true)}
    className="px-3 py-1.5 bg-red-50 border border-red-200 text-red-700 rounded text-xs font-medium hover:bg-red-100"
    title={t("pp_scan_broken_emails")}
  >
    {t("pp_fix_broken_emails")}
  </button>
)}
```

- [ ] **Step 3: Add the dialog markup**

Near the bottom of the page JSX (before the final closing fragment/tag), add:

```tsx
{/* Fix Broken Emails Dialog */}
{showFixBroken && (
  <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
       onClick={() => setShowFixBroken(false)}>
    <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-lg font-semibold">{t("pp_fix_broken_emails")}</h2>
        <button onClick={() => setShowFixBroken(false)} className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {brokenLoading ? (
          <p className="text-sm text-gray-500">{t("loading")}</p>
        ) : !brokenEmails || brokenEmails.length === 0 ? (
          <p className="text-sm text-gray-500">{t("pp_broken_emails_none")}</p>
        ) : (
          <div>
            <p className="text-sm font-medium mb-2">{t("pp_broken_emails_found")}: {brokenEmails.length}</p>
            <table className="min-w-full text-xs border">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-1 text-left">PP</th>
                  <th className="px-2 py-1 text-left">{t("pp_original_email")}</th>
                  <th className="px-2 py-1 text-left">{t("pp_split_into")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {brokenEmails.map((b: any) => (
                  <tr key={b.id}>
                    <td className="px-2 py-1 font-mono font-medium text-blue-700">{b.ppCode}</td>
                    <td className="px-2 py-1 font-mono text-red-600 break-all">{b.originalEmail}</td>
                    <td className="px-2 py-1 font-mono text-green-700">
                      {b.extractedEmails.map((e: string) => <div key={e}>{e}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="p-4 border-t flex items-center gap-2 justify-end">
        <button onClick={() => setShowFixBroken(false)} className="px-3 py-1.5 bg-gray-200 rounded text-sm hover:bg-gray-300">
          {t("cancel")}
        </button>
        {brokenEmails && brokenEmails.length > 0 && (
          <button
            onClick={() => {
              requirePinOnce(() => {
                fixBrokenMutation.mutate({
                  projectId: projectId!,
                  items: brokenEmails.map((b: any) => ({ emailId: b.id, extractedEmails: b.extractedEmails })),
                });
              });
            }}
            disabled={fixBrokenMutation.isLoading}
            className="px-4 py-1.5 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {fixBrokenMutation.isLoading ? t("loading") : `${t("pp_fix_all")} (${brokenEmails.length})`}
          </button>
        )}
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd bdops && npx tsc --noEmit 2>&1 | grep -E "paypals/page.tsx" || echo "OK"`
Expected: `OK`. If `currentRole` is not in scope, check its import or replace with the existing role check variable used elsewhere in the file (run `grep -n "currentRole\|ctx.role" src/app/(dashboard)/paypals/page.tsx`).

- [ ] **Step 5: Manual verify**

1. Insert a test broken email row via Prisma Studio or SQL (see Task 6 Step 5).
2. Open `http://localhost:3000/paypals`, click the new "Fix Broken Emails" button.
3. Dialog should open, list the broken row, show "Fix All (1)" button.
4. Click "Fix All (1)" → PIN prompt → enter PIN → mutation runs.
5. Toast shows success. Dialog closes. Re-scan → empty list.
6. Verify in DB: the broken row's email is now the first extracted email; a new row exists for the second extracted email.

- [ ] **Step 6: Commit**

```bash
cd bdops
git add "src/app/(dashboard)/paypals/page.tsx"
git commit -m "feat(paypal): add Fix Broken Emails dialog for admin/moderator"
```

---

## Task 9: Frontend — Quick Add parser uses `extractEmails`

**Files:**
- Modify: `src/app/(dashboard)/paypals/page.tsx` — `parsedLines` memo

- [ ] **Step 1: Import `extractEmails`**

Near the top of the file where other lib imports live, add:

```tsx
import { extractEmails } from "@/lib/pp-data-utils";
```

- [ ] **Step 2: Update `parsedLines` to expand multi-email lines**

Find the `parsedLines` memo (around line 536-577). Currently, each line produces exactly one parsed row. Change it so that if a line has multiple emails, each email produces its own row (all other fields are copied).

Replace the return statement inside `useMemo` with:

```tsx
return quickEmails.split("\n").map((line) => line.trim()).filter(Boolean).flatMap((line) => {
  const sep = line.includes("\t") ? "\t" : line.includes("|") ? "|" : null;
  const parts = sep ? line.split(sep).map((p) => p.trim()) : [line];

  // Parse once per line (holder, vmppCode, password, twoFa all shared)
  const base: { ppCode: string; holder: string; vmppCode: string; email: string; password: string; twoFa: string; warnings: string[] } = {
    ppCode: "", holder: "", vmppCode: "", email: "", password: "", twoFa: "", warnings: [],
  };
  const unmatched: string[] = [];
  let allEmails: string[] = [];

  for (const p of parts) {
    if (!p) continue;
    const extracted = extractEmails(p);
    if (extracted.length > 0) {
      allEmails = allEmails.concat(extracted);
      continue;
    }
    if (isPPCode(p) && !base.ppCode) base.ppCode = p;
    else if (isHolder(p) && !base.holder) base.holder = p.toUpperCase();
    else if (is2FA(p) && !base.twoFa) base.twoFa = p;
    else if (isVMPP(p) && !base.vmppCode) base.vmppCode = p;
    else unmatched.push(p);
  }

  if (unmatched.length > 0 && !base.password) {
    base.password = unmatched.sort((a, b) => b.length - a.length)[0];
    unmatched.splice(unmatched.indexOf(base.password), 1);
  }
  if (unmatched.length > 0 && !base.vmppCode) base.vmppCode = unmatched[0];

  if (base.ppCode && ppPrefix && !base.ppCode.toUpperCase().startsWith(ppPrefix.toUpperCase())) {
    base.warnings.push(`Mã PP "${base.ppCode}" không đúng prefix "${ppPrefix}"`);
  }

  // If no emails extracted, return one row with empty email (preserves existing error UX).
  if (allEmails.length === 0) return [{ ...base, email: "" }];

  // One row per extracted email. First row gets the ppCode; subsequent rows are auto-code.
  return allEmails.map((email, idx) => ({
    ...base,
    ppCode: idx === 0 ? base.ppCode : "",
    email,
    // Only the first row keeps password/twoFa (to avoid sharing across distinct PPs).
    password: idx === 0 ? base.password : "",
    twoFa: idx === 0 ? base.twoFa : "",
    warnings: idx === 0 ? base.warnings : [],
  }));
});
```

The `isEmail` inline helper (line 537) is no longer needed — the function body can remove it OR leave it; `extractEmails` replaces it.

- [ ] **Step 3: Remove the now-unused `isEmail` helper**

Inside the `useMemo` body, find and delete:
```tsx
const isEmail = (s: string) => s.includes("@") && s.includes(".");
```
(If TypeScript complains it's unused, delete it.)

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd bdops && npx tsc --noEmit 2>&1 | grep -E "paypals/page.tsx" || echo "OK"`
Expected: `OK`

- [ ] **Step 5: Manual verify**

1. Open `http://localhost:3000/paypals`, click "+ Quick Add".
2. Paste:
```
oanhoanh123cm@gmail.com maximuselwynjack1@hotmail.com
user3@outlook.com
```
3. Preview should show **3 rows**: one per email (2 from line 1, 1 from line 2). Each row has its own email in the Email column.
4. Click "Tạo 3 PayPal" → 3 separate PayPal accounts should be created.

- [ ] **Step 6: Commit**

```bash
cd bdops
git add "src/app/(dashboard)/paypals/page.tsx"
git commit -m "feat(paypal): split multi-email quick-add lines into separate rows"
```

---

## Task 10: Frontend — import result dialog

**Files:**
- Modify: `src/app/(dashboard)/paypals/page.tsx`

- [ ] **Step 1: Add state hook for the result dialog**

Near the other dialog state hooks, add:

```tsx
// Sheet import result dialog state
const [importResult, setImportResult] = useState<null | {
  imported: number;
  updated: number;
  skipped: number;
  emailsCreated: number;
  emailsUpdated: number;
  changes: Array<{ ppCode: string; email?: string; fields: string[] }>;
  errors: string[];
}>(null);
```

- [ ] **Step 2: Wire the mutation success handler**

Find the existing `importFromSheet` mutation call (or the `setSheetResult` handler — search for `importFromSheet`). Run:
```bash
cd bdops && grep -n "importFromSheet" "src/app/(dashboard)/paypals/page.tsx"
```

Inside the `onSuccess` handler (or the `.then()` that captures the result), add:
```tsx
setImportResult(res as any);
```
(where `res` is the mutation response variable — adapt to local naming).

- [ ] **Step 3: Add the result dialog markup**

Near the bottom of the page JSX, add:

```tsx
{/* Import Result Dialog */}
{importResult && (
  <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
       onClick={() => setImportResult(null)}>
    <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-lg font-semibold">{t("pp_import_changes_title")}</h2>
        <button onClick={() => setImportResult(null)} className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-3">
        <div className="grid grid-cols-5 gap-2 text-center">
          <div className="bg-green-50 rounded p-2">
            <div className="text-xl font-bold text-green-700">{importResult.imported}</div>
            <div className="text-[10px] text-gray-500">New</div>
          </div>
          <div className="bg-blue-50 rounded p-2">
            <div className="text-xl font-bold text-blue-700">{importResult.updated}</div>
            <div className="text-[10px] text-gray-500">Updated</div>
          </div>
          <div className="bg-gray-50 rounded p-2">
            <div className="text-xl font-bold text-gray-700">{importResult.skipped}</div>
            <div className="text-[10px] text-gray-500">Skipped</div>
          </div>
          <div className="bg-emerald-50 rounded p-2">
            <div className="text-xl font-bold text-emerald-700">+{importResult.emailsCreated}</div>
            <div className="text-[10px] text-gray-500">New emails</div>
          </div>
          <div className="bg-amber-50 rounded p-2">
            <div className="text-xl font-bold text-amber-700">~{importResult.emailsUpdated}</div>
            <div className="text-[10px] text-gray-500">Updated emails</div>
          </div>
        </div>

        {importResult.changes.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">{t("pp_import_no_changes")}</p>
        ) : (
          <table className="min-w-full text-xs border">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1 text-left">PP</th>
                <th className="px-2 py-1 text-left">Email</th>
                <th className="px-2 py-1 text-left">{t("pp_import_changes_field")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {importResult.changes.map((c, i) => (
                <tr key={i}>
                  <td className="px-2 py-1 font-mono font-medium text-blue-700">{c.ppCode}</td>
                  <td className="px-2 py-1 font-mono text-gray-600">{c.email || "—"}</td>
                  <td className="px-2 py-1 text-orange-700">{c.fields.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {importResult.errors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded p-2">
            <p className="text-xs font-medium text-red-700 mb-1">Errors:</p>
            {importResult.errors.map((e, i) => (
              <p key={i} className="text-[10px] text-red-600 font-mono">{e}</p>
            ))}
          </div>
        )}
      </div>
      <div className="p-4 border-t flex justify-end">
        <button onClick={() => setImportResult(null)} className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">
          OK
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd bdops && npx tsc --noEmit 2>&1 | grep -E "paypals/page.tsx" || echo "OK"`
Expected: `OK`

- [ ] **Step 5: Manual verify**

1. Open `http://localhost:3000/paypals`, run a sheet import for PPs that already exist in DB.
2. After mutation completes, the Import Changes dialog should open.
3. Should show counter boxes (New / Updated / Skipped / New emails / Updated emails).
4. If any fields changed, they appear in the table below.
5. Re-run the same import → dialog should say "No changes — all data already up to date."

- [ ] **Step 6: Commit**

```bash
cd bdops
git add "src/app/(dashboard)/paypals/page.tsx"
git commit -m "feat(paypal): show sheet import change report dialog"
```

---

## Task 11: Frontend — detail page NoDataBadge integration

**Files:**
- Modify: `src/app/(dashboard)/paypals/[id]/page.tsx`

- [ ] **Step 1: Import NoDataBadge**

Near the top of `src/app/(dashboard)/paypals/[id]/page.tsx`, add:

```tsx
import { NoDataBadge } from "@/components/NoDataBadge";
```

- [ ] **Step 2: Extend `EditableField` to support a `required` flag**

Find the `EditableField` component at line 32 of `src/app/(dashboard)/paypals/[id]/page.tsx`. Replace its full body with:

```tsx
function EditableField({ value, onSave, canEdit, mono, textClass, required }: { value: string; onSave: (v: string) => void; canEdit?: boolean; mono?: boolean; textClass?: string; required?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const save = () => { setEditing(false); if (draft !== value) onSave(draft); };
  if (editing && canEdit) {
    return (
      <div className="flex items-center gap-1">
        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
          onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
          className={`flex-1 px-2 py-1 border border-blue-400 rounded bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none ${textClass || "text-sm"} ${mono ? "font-mono" : ""}`} />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 group">
      {value ? (
        <span className={`break-all ${textClass || "text-sm"} ${mono ? "font-mono" : ""}`}>{value}</span>
      ) : (
        <NoDataBadge variant={required ? "required" : "optional"} />
      )}
      {value && <CopyBtn value={value} />}
      {canEdit && (
        <button onClick={() => { setDraft(value); setEditing(true); }} className="text-gray-300 hover:text-blue-600 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" title="Edit">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Mark required field usages**

Find the Primary Email usage (line 653):
```tsx
<EditableField value={pp.primaryEmail} canEdit={canEdit} onSave={...} mono />
```
Change to:
```tsx
<EditableField value={pp.primaryEmail} canEdit={canEdit} onSave={...} mono required />
```

- [ ] **Step 4: Add NoData rendering to PPAccountSecret for password + 2FA**

Find `PPAccountSecret` component (around line 59). It currently reveals `"—"` when the value is empty. For the Password PayPal and 2FA fields on the detail page, after fetching credentials, if the decrypted value is empty AND it's `field === "password"` or `field === "twoFa"`, show `<NoDataBadge variant="required" />` in place of the reveal state.

The simplest way: find the placeholder rendering at around line 136 (where `revealed === "—"` or similar) and change it. Run:
```bash
cd bdops && grep -n "'—'\|\"—\"" src/app/(dashboard)/paypals/[id]/page.tsx | head -20
```

For each occurrence inside `PPAccountSecret` or the initial (unrevealed) state block, check if the component receives a `required` prop or can infer it from the `field` prop. Add a `required` prop:

```tsx
function PPAccountSecret({ ppId, field, projectId, pinVerified, onNeedPin, canEdit, onSaved, required }: {
  ppId: string; field: "password" | "twoFa" | "hotmailToken"; projectId: string;
  pinVerified: boolean; onNeedPin: () => void; canEdit?: boolean; onSaved?: () => void; required?: boolean;
}) {
```

Then at the call site (lines 660, 664), pass `required` when the field is `password` or `twoFa`:
```tsx
<PPAccountSecret ppId={pp.id} field="password" projectId={projectId!} pinVerified={pinVerified} onNeedPin={() => setShowPinDialog(true)} canEdit={canEdit} onSaved={() => invalidate()} required />
<PPAccountSecret ppId={pp.id} field="twoFa" projectId={projectId!} pinVerified={pinVerified} onNeedPin={() => setShowPinDialog(true)} canEdit={canEdit} onSaved={() => invalidate()} required />
```

For rendering: currently the unrevealed state shows a reveal button with "••••" dots. We need to know whether the field has data WITHOUT decrypting. The list endpoint already exposes `hasPassword`/`hasTwoFa`. But on the detail page, we need the same flag from `paypal.getById`. Check:

```bash
cd bdops && grep -n "hasPassword\|hasTwoFa" src/server/routers/paypal.ts | head -10
```

If `getById` does not return these flags, add them. Find the `getById` procedure (around line 179-200) and after the `include` block, return an enriched object:

```ts
return {
  ...pp,
  hasPassword: !!pp.password,
  hasTwoFa: !!pp.twoFa,
  hasToken: !!pp.hotmailToken,
};
```

On the frontend, in `PPAccountSecret`'s initial (non-revealed) state, branch on a new `hasData` prop passed from the parent:

```tsx
function PPAccountSecret({ ppId, field, projectId, pinVerified, onNeedPin, canEdit, onSaved, required, hasData }: {
  ppId: string; field: "password" | "twoFa" | "hotmailToken"; projectId: string;
  pinVerified: boolean; onNeedPin: () => void; canEdit?: boolean; onSaved?: () => void; required?: boolean; hasData?: boolean;
}) {
  // ...existing state & handlers unchanged...

  // In the default render branch (the un-revealed state), at the top:
  if (!hasData && required) {
    return (
      <div className="flex items-center gap-1.5">
        <NoDataBadge variant="required" />
        {canEdit && (
          <button onClick={handleEdit} className="text-xs text-blue-600 hover:underline" title="Add">
            + add
          </button>
        )}
      </div>
    );
  }
  if (!hasData && !required) {
    return <NoDataBadge variant="optional" />;
  }
  // ...rest of existing render (reveal button etc)...
}
```

And update the call sites to pass `hasData`:
```tsx
<PPAccountSecret ppId={pp.id} field="password" ... required hasData={pp.hasPassword} />
<PPAccountSecret ppId={pp.id} field="twoFa" ... required hasData={pp.hasTwoFa} />
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd bdops && npx tsc --noEmit 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 6: Manual verify**

1. Open `http://localhost:3000/paypals/<id>` for a PP that has no password and no 2FA.
2. The "Password PayPal" and "2FA" fields should show red `[NODATA]` badges.
3. For a PP with password/2FA set, those fields should show the masked `••••` reveal UI as before.
4. For optional fields like `holder`, `vmppCode`, `bankCode` — if empty they should show gray `N/A`.
5. Click the pencil icon to edit a field → still works (no regression).

- [ ] **Step 7: Commit**

```bash
cd bdops
git add "src/app/(dashboard)/paypals/[id]/page.tsx" "src/server/routers/paypal.ts"
git commit -m "feat(paypal): show NoDataBadge for missing required fields on detail page"
```

---

## Task 12: Deploy and smoke test on Railway

**Files:** none (deploy only)

- [ ] **Step 1: Run full TypeScript check**

Run: `cd bdops && npx tsc --noEmit 2>&1 | tail -20`
Expected: No errors.

- [ ] **Step 2: Run a production build locally**

Run: `cd bdops && npm run build 2>&1 | tail -40`
Expected: "Compiled successfully" without type errors. If build fails, fix the issues before deploying.

- [ ] **Step 3: Deploy to Railway**

Run:
```bash
npx @railway/cli up "C:/Users/TUNTUN/Desktop/project web/bdops" --path-as-root -d
```
Expected: Deploy completes successfully. Wait for Railway to finish building (check `https://railway.app` dashboard or CLI output).

- [ ] **Step 4: Smoke test on production**

Open `https://bdops-production.up.railway.app/paypals` and verify:

1. List loads without errors.
2. PPs with missing data show red `⚠ Bổ sung data` warning in status column.
3. Click warning → navigates to detail page.
4. Detail page shows `[NODATA]` badges for required missing fields.
5. "Fix Broken Emails" button is visible for admin/moderator.
6. Click it → dialog opens → shows broken records (from the user's original data) → "Fix All" works.
7. Sheet import runs and shows the new result dialog with change report.
8. Quick Add with a multi-email line creates multiple PPs.

- [ ] **Step 5: Notify the user with a status summary**

Post a message summarizing:
- What was deployed
- URL to verify: `https://bdops-production.up.railway.app/paypals`
- Broken-email count found on production (from the first scan)
- Any issues encountered during smoke test

## Rollback plan

If production smoke test reveals critical issues:

1. Revert the last git commits: `cd bdops && git log --oneline | head -12` to find the range, then `git revert <hash>..<hash>`
2. Redeploy: `npx @railway/cli up ...`
3. Report the issue to the user with logs.

Alternatively, each task commits independently, so a single bad task can be reverted without undoing earlier ones.
