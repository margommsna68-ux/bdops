# SDK money binding — second independent review of 12ba8af (22/10/2026)

Reviewer's suite `.runtime/review-sdk-binding-12ba8af.test.ts`: 3/3 red before (migration bound a round-1 figure + failure to round 2
from the placement alone; money entered with a move stayed bound to the source holder; the bulk SDK endpoint wrote `amountCycle = 1`
on a round-2 VM), 3/3 green after with the same expectations; the two earlier suites still 3/3 and 4/4
(`review-suites-after-fix.txt`). Synthetic data only; no host write, no real VM, no Sheet, no video.

## Fixes
1. **Backfill only with evidence.** `20261022230000_sdk_money_binding` now binds an existing figure to the code's current VM + round only
   when it was written (`amountAt`) after that VM's last closed round (`VmCycle.closedAt`) and the code has not moved / been held /
   placed / removed / recreated since (`SdkEvent`); the same for the failed reading (`amountFailedAt`). Otherwise the figure and its
   history stay on the code, the link stays empty, the row reads "Chưa kiểm tra". No observation time is taken from a write time.
   Databases that had already run the placement-based backfill (local test / trial) are corrected by the new
   `20261023000000_sdk_money_binding_evidence` (touches only rows bound to the current VM + current round without evidence); a database
   that runs the corrected 20261022230000 first (the host) finds nothing to undo. `prisma migrate deploy` applied it on both local
   databases without a reset (`migrate status`: up to date).
2. **Move + new money binds to the destination.** `applyPlacement` passes the record with its NEW position (vmId + holderVmId) to
   `applyInfo`, so `moneyBinding` sees the destination VM and its round in the same transaction; a plain move keeps the source reading
   as history. Revision, rights, idempotency and undo unchanged. (`addVmSdk` / the SDK frame already re-read the record after the move.)
3. **Dán bảng kind SDK (`bulkPreview` / `bulkApply`)** — still provided by the router, no UI uses it (the UI's Dán bảng → SDK is
   `sdkPaste*`): the VM now travels with its `operation` (real round, never `operation:null` → 1), the preview carries `expectedCycle`,
   apply refuses a line whose round moved ("VM đã được tạo lại, kiểm tra lại dòng này") and binds money to the real round. A caller that
   sends no round gets the real round (the reviewer's case); the official UI sends it. Proxy / note branches untouched.

## Third review (`.runtime/review-sdk-evidence-abf6c12.test.ts`, 2/2 red → 2/2 green)
The evidence rule mistook two command-written bindings for guesses: (1) a reading with the SAME figure after a recreation moves only
`amountObservedAt` (never `amountAt`), so "written after the last closed round" judged by `amountAt` failed; (2) a new code recorded with
an unreadable money in one command has HOLD / PLACE events after the observation moment, read as "moved after the check". Now the
write moment of a figure is the command that recorded it — the AMOUNT / OBSERVE event whose `observedAt` equals `amountObservedAt`
(a web edit: `amountAt`) — and a failed reading is bound only through its own OBSERVE `readable:false` event; move / hold / place /
remove / recreate events count only when strictly AFTER that moment (the same command shares the timestamp). Applied to the first-time
backfill (corrected `20261022230000`), the correction of databases that ran the placement backfill (`20261023000000`, now keeps
command-written bindings) and a rebind for databases that ran the first version of that correction (`20261023010000`, gives back
what it had removed; nothing to do on the host). Applied locally with `migrate deploy`, no reset. Official cases in
`sdk-money-rights.integration.test.ts` (same-figure re-check after recreation stays OK through all three migrations; a failed reading
on a new code stays FAILED; both re-bound after being cleared).

## Checks
| Check | Result |
|---|---|
| Reviewer suites | evidence 2/2, binding 3/3, vm-money 3/3, sdk-survey 4/4 (`review-suites-after-fix.txt`) |
| Official tests added (`sdk-money-rights.integration.test.ts`) | move + money binds to the destination; bulk SDK binds the real round and refuses a stale paste; the backfill binds a proven row and leaves a round-1 figure + failure unbound after a recreation (web state UNCHECKED, `stored` history) |
| Full suite / lint / tsc / build | 150 files / 744 tests, lint 0, tsc clean, build OK |
| Data on the local trial (`.runtime/p45-local-binding.ts`) | `local-http-ops-client.txt` 4/4: recreated VM in round 2; code with $10 on S1; legacy-shaped row ($7 + failed reading in round 1, recreated, chosen again) stays unbound after the corrected backfill statements; a proven row is bound to its VM + round |
| Browser (`p45-ui.js`, admin) | `local-browser.txt` 8/8: R1 / L1 "Chưa kiểm tra"; Dán bảng → SDK (UI path) on the recreated VM: "Áp dụng 1 SDK", the code joins the list with $4,56 bound to R1 · round 2 (API `stored.cycle = 2`; not current, so the row stays "Chưa kiểm tra" by the 20/10 rule); SDK frame "Chọn SDK đã lưu" → "Dùng cho VM này" with $20: the code joins T1's list with $20 bound to T1 (API), S1 reads "Chưa kiểm tra"; L1 frame names "$7,00 … giữ làm lịch sử" without a round, API `moneyState UNCHECKED`, `stored.cycle null` |
| Screenshots | `shots/bulk-paste-round2.png`, `shots/move-with-money.png` |
