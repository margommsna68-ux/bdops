# Purchase quantity and bill — 25 October 2026

Owner request: unit price for each PP/account/proxy automatically fills purchased quantity from the input and calculates the bill. Owner explicitly chose proxy cost recording inside NEW proxy import.

## Behavior

- PayPal counts codes, never emails; Gmail/Apple ID counts distinct valid new login identities. Input quantities appear immediately and are reconciled against a matching money-free stock check. Existing stock and email additions do not inflate an automatic new-purchase bill.
- Manual actual quantity remains sticky through edits/restored drafts; reset resumes list counting. This supports paid 50 / received 48. Saved unpriced account batches suggest paid quantity when known, otherwise received account count. TOTAL remains the entered actual total.
- Priced AUTO account imports compare the READY identity set and current classification generation; failed refresh blocks AUTO save. The backend checks the AUTO unit quantity again against current classified count in preview and commit; stock races reject rather than silently reprice.
- NEW proxy import optionally records one IP_PROXY cost atomically with imported endpoints, using existing VND/USD PayPal/USDT normalization, quote expiry and financial period locks. Explicit actual quantity is preserved; omitted quantity uses accepted new endpoints. No new ledger or migration.
- Partial fixes (ERROR or PayPal ADD) stay in the recorded purchase; no second cost. Append ignores the original price/expired quote. Proxy retries keep original token/key after unknown replies, but a first definitive refusal permits fresh checking. Priced proxy imports are view-only in ordinary undo; costs are corrected through the existing finance workflow.
- Human permissions remain unchanged; proxy bill fields require writeCosts. Financial history has its own COSTS gate. Proxy package renewal dates are not advanced automatically.

## Verification

- `browser-results.json`: 15 real Chrome checks on the local production build, synthetic data only: PP codes vs multiple emails, manual override/reset/list updates, Apple ID, proxy bill, partial proxy import and cost-free completion.
- `database-results.json`: 7 read-back assertions. Exactly one PP cost 3.75 USDT, one login cost 1.26 USDT, one proxy cost 4.50 USDT, paid quantities 3/3, four proxy rows after completing the rejected line. No second proxy cost.
- `visual-results.json`: 4 themes selected through Settings, verified grid styles, plus 390px overflow check. Shared purchase fields now load styles on the proxy route itself.
- Independent reviews found and fixed AUTO stock-race/count mismatch, failed-refresh stale cache, expired quote blocking append, definite proxy refusal leaving the editor frozen, and ADD-only partial PP completion billing twice. Regression expectations preserved.
- Old `.runtime/review-stock-detail-state-20261020.test.tsx` mock gained only the new `cashAccess` dependency with writeCosts false; its assertions are unchanged.
- No production test imports, billing writes, grant/token edits, machine work or Sheet writes. No video. Secrets in examples/screenshots are synthetic.

## Existing PayPal receipt feature checked

The additional owner question is already implemented: Server/VM → TIỀN TRONG VM → Rút về PayPal → Ghi tiền về PP after a SENT request. The form identifies PP code and receiving email. `recordPayoutReceipt` writes the existing FundTransaction book with request/VM/cycle/account/email snapshots. Kho PayPal's expanded email list shows per-email received totals; parent PP totals use the same book. No duplicate receipt feature, synthetic payout on production, or separate ledger was added.

Final verification: 195 files / 1046 tests pass; typecheck and production build RL9foagOjyGj6QrFkgE16 pass; lint has no new warnings/errors. Local Chrome 15 functional + 5 theme/mobile checks, plus 7 DB assertions. Backup moneytohome-20261025-121116.dump; encrypted/decryption-verified moon-01 copy SHA-256 5a605c5f2c5764fda69880b2e4f2d0e2e68da26d217aeda3e6c955ef15a934c0. No migration.
