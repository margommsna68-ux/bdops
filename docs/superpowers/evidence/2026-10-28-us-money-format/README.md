# US number format for money â€” 28 October 2026

Owner decision (verbatim): "Ä‘á»•i toÃ n bá»™ dáº¥u , sang dáº¥u . trong sá»‘ tiá»n theo quy chuáº©n US vÃ­ dá»¥ $12.18 nháº­p liá»‡u cÅ©ng váº­y Ä‘Ãºng."
and "Táº¥t cáº£ theo US" for every currency incl. VND. This REPLACES the 19/10/2026 Vietnamese convention ("." thousands, "," decimals).

Branch `codex/payout-simple`, worktree `D:/MoneyToHome/dev-payout-simple-20261028`. Not deployed by this task.

## Rule now

- Display: `$12.18`, `$1,234.56`, `-$5.00`, `16.27 USDT`, `420,000 â‚«`, `$32.12 PayPal`, rates `1 USDT = 25,940 VND`,
  `24,000.5`. Decimal counts / rounding per place are unchanged (VND whole Ä‘á»“ng, USDT 2 dp unless exact, ledger â‰¥ 2 dp).
- Input (every money / price / rate / fee field and paste parser): "." = decimal point, "," = optional thousands separator.
  `"1,234.56"` = 1234.56, `"420,000"` = 420000. A decimal comma or a comma group that is not exactly 3 digits (`"12,18"`,
  `"1.234,56"`, `"0,424"`, `"12,1800"`) is refused with **"DÃ¹ng dáº¥u . cho pháº§n tháº­p phÃ¢n, vÃ­ dá»¥ 12.18; dáº¥u , chá»‰ Ä‘á»ƒ tÃ¡ch hÃ ng
  nghÃ¬n (1,234.56)"**. The old VND-only "English thousands comma" warning and its trailing-zero workaround (`"15,6250"`) are gone.
- Text the web writes back into an input (`moneyInput`) always parses back to the same value (tested round-trip).
- Stored data, DB schema, migrations and the ops API contract (canonical `"12.18"`) are unchanged. Server text written from now on
  uses US digits; history rows written before stay as written.

## What changed

Core (`src/lib/money-input.ts`): `parseViNumber` â†’ `parseMoneyNumber` (no `vnd` option), `viNumber` â†’ `moneyNumber`,
`viInput` â†’ `moneyInput`, new `parsePositiveAmount` (â‰¤ 2 dp payout / receipt fields) and `US_DECIMAL_HINT`; `formatUsd`,
`formatMoney`, `formatLedger`, `displayMoney` emit US digits.

Other parsers moved onto the shared rule:
- `src/lib/sdk-money.ts` (`parseSdkAmount`, `formatSdkAmount`, `amountInput` â†’ en-US) â€” SDK cell, Kho SDK, DÃ¡n báº£ng SDK, ops
  `sdk-observations` (canonical input unaffected; `"5,17"` now refused, matching the existing comment in sdk-observe.ts).
- `src/lib/paypal-transfer.ts` (`moneyCents`, rate; `viCents` â†’ `centsLabel` with US text) â€” PayPal transfer form + server check.
- `src/server/business-management/paypal-ledger.ts` `ledgerAmount` (payout amounts, receipts, receipt paste, opening balance,
  transfers) and transfer rate.
- `src/server/vm-ops/balance.ts` DÃ¡n báº£ng â†’ Sá»‘ dÆ° (error hint now "vÃ­ dá»¥ 10.50 hoáº·c 1,234.50").
- Payout UI: `payout-frame-model.ts` `receiptCheck` ("Sá»‘ tiá»n chÃ­nh xÃ¡c trong PayPal", also bulk receipt rows in
  PayoutStatusBulk), `PayoutFrame.tsx`, `PayoutBulkPanel.tsx`, `MergePayoutPanel.tsx` (were `replace(',','.')`).
- Purchase / cost forms: `purchase-money.ts`, `UsdtCostsWorkspace.tsx`, `MoneyParts.tsx` (balance cell), placeholders
  (`VÃ­ dá»¥ 70,000`, `24,000`, `25,820`, `420,000`, `vÃ­ dá»¥ 10.50`, paste samples `12.40` / `10.50`).

Display:
- `batch-format.ts`: `viAmount` â†’ `amountText`, `viMoney` â†’ `ledgerNumber` (US); callers AccountStore / PaypalStock.
- `PaypalStock.tsx` gather tooltips `$100.00`, transfer summary; `vm-ops.ts` gather labels `$100.00`; ServerWorkspace `$0.00`;
  BalancePaste preview uses `formatUsd`; AccountStore package price uses `moneyNumber`.
- `workflow.ts` `moneyDisplay`, `BusinessPulse.tsx`, `Overview.tsx`, `OverviewCharts.tsx`, `PayoutSummary.tsx`,
  `PurchaseMoneyFields.tsx`: numeric `toLocaleString('vi-VN')` â†’ `'en-US'`. These shared formatters also format plain counts
  (VM counts, quantities, the 99.9% ring) â€” switched to US too for consistency (e.g. `1,234 VM`).
- Server text: settle note `PhÃ­ / thiáº¿u 1.50 USD` (payout.ts), `EarnApp bá»‹ SUS: máº¥t 10.00 USD` (suspend.ts), transfer errors
  `BÃªn nháº­n pháº£i nháº­n 750,000.00 VND â€¦`, SDK change notes / journal (`formatSdkAmount`).
- `scripts/gen2-dashboard/reminders.mjs` (Telegram proxy-renewal reminder) â†’ `$12.35 PayPal`.

Docs: `src/lib/money-input.ts` header, comments in purchase/cost/inventory/sdk/vmManagement files, `docs/runbooks/account-store.md`
(money-input section rewritten), `BAT_DAU_O_DAY.md` (new note). `PROMPT_CLAUDE_VAN_HANH_WEB.md` does not describe the human number
format (API amounts were already canonical), so it is unchanged.

## Tests

- TDD: `money-input.test.ts` / `money-display.test.ts` / `batch-format.test.ts` rewritten first (RED: 16 failing), then
  implementation (GREEN). Parser cases: `12.18`, `1,234.56`, `420,000` (VND), `0.424`, `24,000.5` accepted; `12,18`, `1.234,56`,
  `0,424`, `12,1800`, `1,23.5`, `9,`, `12.` refused; formatter round-trip over 10 values.
- 24 existing test files asserted Vietnamese strings or typed Vietnamese input; updated to US (owner decision, not a weakening):
  business-pulse-ui, earn-money(-ui/.integration), money-column-ui, payout-* (daily, final-review, fix, frame, frame-model,
  selection, suspend), paypal-cost-controls/-purchase, paypal-email-ledger, paypal-transfer-rule, proxy-import-purchase-ui,
  purchase-autoquantity(-ui), sdk-list/-money/-stale/-store, vm-ops, sdk-money-rights. `sdk-money.test.ts` now also asserts
  `12,40` and `1.234,56` are refused. `scripts/gen2-dashboard/test/reminders.node.mjs` 21/21.
- Results: Full Vitest (PowerShell) 222 files / 1544 tests passed; reminders.node 21/21; tsc, eslint (changed files), bronze unchanged, next build OK.

## Left in Vietnamese / other format, and why

- Dates and times (`toLocaleString('vi-VN')` on Date, `dd/MM/yyyy`) â€” not money.
- `src/lib/paypal-payment-parser.ts` reads amounts from PayPal emails (external text; accepts both `3,684.94` and `3.684,94`) â€”
  not human input in the web, unchanged on purpose.
- Legacy pages (`*/LegacyPage.tsx`, agent-pp, forms/*) already used `en-US` / plain `toFixed`.
- Server history lines that already used `toFixed(2)` (e.g. `Tiá»n vá» PP 10.00 USD`) were US already; they get no thousands
  comma (unchanged).
- Rows written before 28/10/2026 (history, settle notes, SDK notes) keep the text they were written with.
- The Central worker `scripts/fleet-ops/daily-report.mjs` is not in this branch (it lives in the FleetOps release on Central);
  its money text should get the same change there. The root `AGENTS.md` (outside this worktree) still records the 19/10 rule and
  should be updated by the parent session.
