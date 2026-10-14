# PayPal Data Integrity — Design Spec

**Date:** 2026-04-09
**Status:** Approved
**Area:** `src/app/(dashboard)/paypals/*`, `src/server/routers/paypal.ts`, `src/lib/*`

## Problem

1. **Email chèn trong 1 cell**: Khi chuẩn bị dữ liệu trên Google Sheet, một số cell email chứa nhiều email phân cách bằng space (ví dụ `"oanhoanh123cm@gmail.com maximuselwynjack1@hotmail.com"`). Hàm `isValidEmail()` ở `paypal.ts:13` quá permissive (`@` + `.` + `length > 5`) nên string 2 email được chấp nhận và lưu nguyên vào `PayPalEmail.email` → data hỏng.
2. **Không cảnh báo thiếu data**: List page và detail page không có indicator nào cho PP thiếu password/2FA/email.
3. **Import không update credentials cũ**: `importFromSheet` (paypal.ts:1047-1071) chỉ CREATE email row mới, bỏ qua khi email đã tồn tại → pass/2FA mới trong sheet không được sync vào DB.

## Requirements (đã chốt với user)

| # | Hạng mục | Quyết định |
|---|----------|------------|
| R1 | Định nghĩa "complete PP" | `PayPalAccount.password` + `PayPalAccount.twoFa` + ≥1 `PayPalEmail` record |
| R2 | Tách email | Regex `/[\w.+-]+@[\w-]+\.[\w.-]+/g` extract tất cả email trong string |
| R3 | Update từ sheet | Sheet = source of truth. Sheet có giá trị khác DB → overwrite. Sheet trống → giữ DB. Báo cáo thay đổi |
| R4 | Detail display | `[NODATA]` badge đỏ cho field required, `N/A` xám cho optional |
| R5 | List warning | Text đỏ "⚠ Bổ sung data" dưới badge status, click nhảy đến detail |
| R6 | Fix existing broken | Script 1 lần + UI preview + nút Fix All (admin) |

## Architecture

### New shared helper — `src/lib/pp-data-utils.ts`

```ts
export const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

// Extract all emails from a string (handles "a@x.com b@y.com" etc.)
export function extractEmails(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = text.match(EMAIL_REGEX) ?? [];
  // Dedupe + lowercase
  return Array.from(new Set(matches.map((e) => e.trim().toLowerCase())));
}

// Strict: string MUST be a single valid email, no whitespace, no extras
export function isSingleValidEmail(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (/\s/.test(trimmed)) return false; // any whitespace → invalid
  const matches = trimmed.match(EMAIL_REGEX);
  return matches?.length === 1 && matches[0] === trimmed;
}

// Check if PP record has all required data
export type MissingField = "password" | "twoFa" | "email";
export function getMissingFields(pp: {
  hasPassword?: boolean;
  hasTwoFa?: boolean;
  _count?: { emails: number };
  emails?: unknown[];
}): MissingField[] {
  const missing: MissingField[] = [];
  if (!pp.hasPassword) missing.push("password");
  if (!pp.hasTwoFa) missing.push("twoFa");
  const emailCount = pp._count?.emails ?? (Array.isArray(pp.emails) ? pp.emails.length : 0);
  if (emailCount === 0) missing.push("email");
  return missing;
}
```

### Backend changes — `src/server/routers/paypal.ts`

#### 1. Replace `isValidEmail()` helper
Use strict validation so `"a@x.com b@y.com"` no longer passes as a single valid email. When cell has multiple, use `extractEmails()` to split.

#### 2. Enrich `paypal.list` output
Add to each item in `enrichedItems` (around line 128):
```ts
const missingFields = getMissingFields({
  hasPassword: !!pp.password,
  hasTwoFa: !!pp.twoFa,
  _count: pp._count,
});
// ...
missingFields,
isComplete: missingFields.length === 0,
```

#### 3. Update `importFromSheet` (paypal.ts:968-1160)

**Email extraction**: Instead of processing `row.email1/2/3` as single emails, run `extractEmails(row.email1)` etc. and merge all into one deduped list. Each extracted email becomes its own `PayPalEmail` row, with credentials from its source column (email1 → passEmail1/tokenEmail1).

**Upsert logic for existing email rows**:
```ts
for (const entry of allExtractedEntries) {
  const existing = await ctx.prisma.payPalEmail.findFirst({
    where: { email: entry.email, projectId: input.projectId },
  });

  if (!existing) {
    // create new
    await ctx.prisma.payPalEmail.create({ data: { ...entry, paypalId, projectId } });
    results.emailsCreated++;
    continue;
  }

  // upsert: compare encrypted values by decrypting existing
  const currentPass = existing.password ? decrypt(existing.password) : null;
  const currentTwoFa = existing.twoFa ? decrypt(existing.twoFa) : null;
  const currentToken = existing.hotmailToken ? decrypt(existing.hotmailToken) : null;

  const updates: any = {};
  if (entry.pass && entry.pass !== currentPass) updates.password = encrypt(entry.pass);
  if (entry.twoFa && entry.twoFa !== currentTwoFa) updates.twoFa = encrypt(entry.twoFa);
  if (entry.token && entry.token !== currentToken) updates.hotmailToken = encrypt(entry.token);

  if (Object.keys(updates).length > 0) {
    await ctx.prisma.payPalEmail.update({ where: { id: existing.id }, data: updates });
    changes.push({
      ppCode, email: entry.email,
      fields: Object.keys(updates),
    });
  }
}
```

**Account-level credentials**: Same logic for `PayPalAccount.password` and `PayPalAccount.twoFa` from sheet's `passPaypal` + `twoFa` columns.

**Return shape**:
```ts
return {
  imported,       // new PPs created
  updated,        // existing PPs touched
  skipped,        // no changes needed
  emailsCreated,  // new PayPalEmail rows
  emailsUpdated,  // existing PayPalEmail rows updated
  errors: errors.slice(0, 10),
  changes,        // [{ppCode, email, fields[]}]
  results,        // per-row status (already exists)
};
```

#### 4. New endpoint `paypal.scanBrokenEmails` (admin-only query)

Scans for `PayPalEmail` records where the email string is not a single valid email (contains whitespace or extra characters). Server-side admin/moderator check required.

```ts
scanBrokenEmails: paypalsProcedure
  .input(z.object({ projectId: z.string() }))
  .query(async ({ ctx, input }) => {
    // Server-side role check: must be ADMIN or MODERATOR
    await requireAdminOrModerator(ctx, input.projectId);
    const all = await ctx.prisma.payPalEmail.findMany({
      where: { projectId: input.projectId },
      include: { paypal: { select: { id: true, code: true } } },
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

Also check `PayPalAccount.primaryEmail` for the same condition and surface it in the same list.

#### 5. New endpoint `paypal.fixBrokenEmails` (admin-only mutation)

```ts
fixBrokenEmails: paypalsProcedure
  .input(z.object({
    projectId: z.string(),
    items: z.array(z.object({
      emailId: z.string(),
      extractedEmails: z.array(z.string()),
    })),
  }))
  .mutation(async ({ ctx, input }) => {
    // Role check: must be ADMIN or MODERATOR
    // ... (follow existing admin-check pattern)

    let fixed = 0;
    let newEmails = 0;

    for (const item of input.items) {
      if (item.extractedEmails.length === 0) continue;

      const existing = await ctx.prisma.payPalEmail.findFirstOrThrow({
        where: { id: item.emailId, projectId: input.projectId },
      });

      // Update existing row with first extracted email (keep credentials)
      const [firstEmail, ...rest] = item.extractedEmails;
      await ctx.prisma.payPalEmail.update({
        where: { id: existing.id },
        data: { email: firstEmail },
      });

      // Create new rows for remaining emails (no credentials copied)
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
        } catch { /* skip duplicate */ }
      }

      // If this was primary, sync PayPalAccount.primaryEmail
      if (existing.isPrimary) {
        await ctx.prisma.payPalAccount.update({
          where: { id: existing.paypalId },
          data: { primaryEmail: firstEmail },
        });
      }

      fixed++;
    }

    await createAuditLog({
      action: "FIX_BROKEN_EMAILS",
      entity: "PayPalEmail",
      entityId: input.projectId,
      userId: (ctx.user as any).id,
      projectId: input.projectId,
      changes: { fixed, newEmails },
    });

    return { fixed, newEmails };
  }),
```

### Frontend changes

#### New component — `src/components/NoDataBadge.tsx`

```tsx
export function NoDataBadge({ variant = "optional" }: { variant?: "required" | "optional" }) {
  if (variant === "required") {
    return (
      <span className="inline-block px-1.5 py-0.5 text-[9px] font-bold bg-red-100 text-red-700 rounded border border-red-300 uppercase tracking-wide">
        NODATA
      </span>
    );
  }
  return <span className="text-xs text-gray-400 italic">N/A</span>;
}
```

#### `paypals/page.tsx` — list status column

Inside the `status` cell render (around line 1063), add warning text after existing LIMITED/SUSPENDED UI:

```tsx
{pp.missingFields?.length > 0 && (
  <button
    onClick={(e) => { e.stopPropagation(); router.push(`/paypals/${pp.id}`); }}
    className="text-[9px] text-red-600 font-semibold block hover:underline flex items-center gap-0.5 mt-0.5"
    title={`Thiếu: ${pp.missingFields.join(", ")}`}
  >
    <span>⚠</span>
    <span>Bổ sung data</span>
  </button>
)}
```

#### `paypals/page.tsx` — Admin "Fix Broken Emails" dialog

Add button in admin toolbar area that opens a dialog:
- On open: call `paypal.scanBrokenEmails` query
- Render table: PP Code | Email gốc | Tách thành
- Button "Fix All (N)" → call `paypal.fixBrokenEmails` mutation
- PIN-gated (use existing `requirePinOnce`)
- Show toast with result

#### `paypals/[id]/page.tsx` — detail page

Replace `—` display in key fields:
- **Required fields** (`primaryEmail`, account `password`, account `twoFa`): use `<NoDataBadge variant="required" />`
- **Optional fields** (`vmppCode`, `holder`, `bankCode`, `holderName`, `dateOfBirth`, `idNumber`, `address`, `phone`, `docsLink`, `notes`): use `<NoDataBadge variant="optional" />`

Update `EditableField` component (or create a wrapper) to render `NoDataBadge` instead of plain `—` when value is empty.

#### Import result dialog

After `importFromSheet` returns, if `changes.length > 0`, show a dialog listing all changes:

```
Đã cập nhật 5 PP từ sheet:
• PP-001 / a@x.com: password, twoFa
• PP-042 / b@y.com: token
• ...
```

## Data flow diagrams

### Fix broken emails

```
Admin → Click "Scan Broken Emails"
  ↓
paypal.scanBrokenEmails query
  ↓ prisma.payPalEmail.findMany() + filter by !isSingleValidEmail()
  ↓
Dialog preview with N broken records
  ↓
Admin → Click "Fix All (N)"
  ↓
requirePinOnce() → paypal.fixBrokenEmails mutation
  ↓ For each:
  ↓   - Update existing row with first email (keep credentials)
  ↓   - Create new rows for remaining (no credentials)
  ↓   - Sync PayPalAccount.primaryEmail if was primary
  ↓
Toast "Đã fix N PP, tạo M emails mới"
```

### Import with update + report

```
importFromSheet processes sheet rows
  ↓
For each row, for each email column (email1/2/3):
  ↓ emails = extractEmails(cell) → ["a@x.com", "b@y.com"]
  ↓ For each extracted email:
  ↓   existing = find in PayPalEmail by (email, projectId)
  ↓   If not exists → create new row
  ↓   If exists → compare pass/2FA/token with sheet values
  ↓     If sheet different → update + push change to report
  ↓
Compare account-level passPaypal + twoFa
  ↓
Return { imported, updated, emailsCreated, emailsUpdated, changes[], ... }
  ↓
UI shows dialog with changes list
```

## Testing strategy

Key scenarios to verify manually:

1. **Broken email detection**: Insert a test PayPalEmail row with `email = "a@test.com b@test.com"` → scan endpoint finds it → fix creates 2 separate rows.
2. **Sheet import split**: Sheet cell contains `"a@x.com b@y.com"` → import creates 2 PayPalEmail rows (not 1 with joined).
3. **Sheet import update**: Existing email with `password = "old"`, sheet has `password = "new"` → DB updated + change logged in report.
4. **Sheet import no-op**: Sheet value identical to DB → no update + no change in report.
5. **Sheet import empty**: Sheet cell empty for existing email → DB unchanged.
6. **List page warning**: PP missing password → red "⚠ Bổ sung data" shown in status column.
7. **Detail page NoData**: PP missing password → red `[NODATA]` badge. Missing vmppCode → gray `N/A`.
8. **List warning click**: Click "Bổ sung data" → navigates to detail page.
9. **Edge: no extractable email**: Sheet cell = "not an email" → skipped, logged as error.
10. **Edge: duplicate extraction**: Sheet cell = "a@x.com a@x.com" → deduped to 1.

## Out of scope

- Validation of individual field formats (e.g., CCCD length, phone format) — only completeness check.
- Auto-fixing via lazy migration on detail page load — user chose explicit admin button.
- Adding new columns to DB (isComplete, missingFields) — all computed.
- Email token (`hotmailToken`) as a required field — user confirmed it's optional.

## Also included (IN scope)

- **Quick Add parser fix** (`src/app/(dashboard)/paypals/page.tsx:536-577`): Replace the permissive `isEmail()` inline helper with `extractEmails()`. If a pasted line contains multiple emails, each becomes a separate preview row. This ensures consistency with sheet import behavior.

## Files affected

| File | Change |
|------|--------|
| `src/lib/pp-data-utils.ts` | **NEW** — helper functions |
| `src/components/NoDataBadge.tsx` | **NEW** — badge component |
| `src/server/routers/paypal.ts` | Update `isValidEmail`, `importFromSheet`, `list`; add `scanBrokenEmails`, `fixBrokenEmails` |
| `src/app/(dashboard)/paypals/page.tsx` | Add warning in status column, add Fix Broken Emails dialog, import result dialog, use `extractEmails()` in Quick Add parser |
| `src/app/(dashboard)/paypals/[id]/page.tsx` | Replace `—` with `NoDataBadge` for required/optional fields |
| `src/lib/i18n.ts` | Add keys for new UI strings (en/vi) |

## Risks

- **Credential decryption overhead**: Upsert logic decrypts existing credentials for comparison. For large imports this could add latency. Mitigation: skip comparison if the encrypted blob is identical (cheap), only decrypt on mismatch.
- **Race on fix**: Fix endpoint creates rows while scan snapshot may be stale. Mitigation: re-check `isSingleValidEmail()` inside the fix transaction before splitting.
- **Primary email sync**: If broken email was the primary, after split the PayPalAccount.primaryEmail must be synced to the FIRST extracted email. Make sure this is done atomically.
- **PIN/role gating**: Fix endpoint is destructive → must require PIN + admin role (reuse existing patterns).
