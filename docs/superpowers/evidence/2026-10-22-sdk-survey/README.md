# AI SDK survey, second brief (22/10/2026)

What was changed on top of commit 5c28444 (never deployed), and how it was checked. Synthetic data only: the test database and the local
trial database (`proxy_app_trial` on 127.0.0.1:55432). No host write, no real VM, no Sheet, no video.

## Changes
- Money in an SDK observation needs `BALANCE_WRITE` on the token and the EarnApp balance write right on the user (`EARN_BALANCE`, or
  ADMIN / MODERATOR), checked before and again inside the write transaction. The separate scope `SDK_AMOUNT` of 5c28444 is removed
  (it was never on the host). Reading SDK money needs the balance read right.
- Every code carries `expectedSdkRevision` (null only when the code is not stored); `GET sdks?projectId&code=` gives id / revision /
  state / where a code is.
- `current:true` on a VM whose current code is another one → `409 SDK_CONFLICT` (`CURRENT_DIFFERS`, with the current code / id / revision);
  same `observedAt` with another figure → `409 SDK_CONFLICT` (`SAME_TIME_OTHER_AMOUNT`). Both refuse the whole command.
- `evidence` note stored with the observation events and returned in `recorded`.
- Old money without an observation time reads as unknown (`observedAt: null`, "chưa rõ giờ"); `recordedAt` is the write time.
- UI: SDK cell "Tích luỹ 0,21 USD · 18:13" for the current code ("chưa kiểm tra" without a figure); SDK frame column
  "Tiền tích luỹ SDK (USD)"; Kho SDK column "Tiền tích luỹ SDK" with date + time of the check.
- ops-client `sdk-survey`: whole survey VM by VM with a run file (key + body frozen before sending), one result per line, rerun skips
  DONE, retries UNKNOWN with the same key and body, keeps refused lines until `--redo <vmId>`.

## Checks
| Check | Result |
|---|---|
| Full suite (`npx vitest run`) | 144 files / 713 tests passed (run twice, last after the Kho SDK time fix) |
| `tsc --noEmit`, `npm run lint`, `npm run build` | OK (lint: warnings only) |
| Integration `src/__tests__/ops-api/ops-sdk-observe.integration.test.ts` | 9 tests: $0.21 on a VM without EarnApp, two files = one SDK, Chưa xác nhận, used stays used, other VM / different current code refused, wrong round / VM / SDK revision, two writers at once, late older result, same time other amount, newer same figure, $0, OCR "5_17" refused, lost answer + replay with `recorded` unchanged, revoked token, disabled user, missing BALANCE_WRITE / EARN_BALANCE (also inside the transaction), no finance / account / status rows |
| ops-client `src/__tests__/ops-api/ops-client-survey.test.ts` | survey stop on problems; per-line results; frozen revisions; rerun / retry / --redo |
| Real HTTP through ops-client on the local server | `local-http-ops-client.txt` 15/15 |
| Browser (local, after the API writes) | `local-browser.txt` 6/6; `shots/sdk-cell.png`, `shots/sdk-store-row.png` |
