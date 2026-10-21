# Independent review of the AI SDK survey (e60df42) — four fixes (22/10/2026)

The reviewer's suite `.runtime/review-sdk-survey-20261021.test.ts` reproduced four defects on the test database. Run unchanged before
the fixes: 4/4 red (`STALE_SURVEY_RESULT http 200 in cycle 2`, `PLAIN_SDK_WRITE denied:false amount 999.75`, undo kept the web time and
source, the later reading came back OLDER). After the fixes: 4/4 green with the same expectations (`review-suite-after-fix.txt`).
Synthetic data only: test database and the local trial (`proxy_app_trial`). No host write, no real VM, no Sheet, no video.

## 1. An old survey is never rebound to the VM as it is now (ops-client)
- `sdk-prepare <projectId> <vmId|server/vm>... [--code C] [--out F]` captures the web identity BEFORE the machine is read: `capturedAt`,
  `expectedCycle`, `expectedVmRevision`, `knownSdks {code: revision}` (the VM's codes, plus `--code` extras from `GET sdks`).
- The survey fills `observedAt` / `source` / `evidence` / `sdks` into that entry. `surveyBody` is pure: no read at send time; each code's
  `expectedSdkRevision` comes from `knownSdks` (null = the web had no such code at capture).
- `sdk-check` / `sdk-observe` / `sdk-survey` refuse an entry without its capture, or read before it ("đối chiếu / khảo sát lại"), and never
  send it. A round / revision that moved after the capture is refused by the web (`CYCLE_CHANGED` / `REVISION_CONFLICT`); the line says to
  capture again and read the machine again. `--redo` resends the same captured entry (new key); retry keeps key + body.

## 2. SDK money read right on every path (`src/server/vm-management/sdk-money-rights.ts`)
- One rule = the EarnApp balance rule (`balanceRights`): read with the money rights or the balance write right; write with EARN_BALANCE /
  ADMIN / MODERATOR. Applied in `readSdkStore`, `readSdkDetail` (event details: amount / from / to / source / evidence masked),
  `vmSdkLists` → `readVMWorkspace` (`sdkMoney`, `moneyHidden`), `inspectOperation` (SDK images described without money), the ops API
  (`GET sdks`, `GET vms/{id}`, the observation ack) and the UI ("Ẩn", no money input). No digit-stripping of notes.

## 3. SDK money write right on every web command
- `assertSdkMoneyWrite` inside the transaction of `updateSdkInfo`, `applySdkStore`, `saveVmSdk`, `addVmSdk`, `applySdkPaste`,
  `applyVmBulk` (SDK) and `observeVmSdks`; previews (`previewSdkStore`, `previewSdkPaste`, `previewVmBulk`) refuse lines that carry money
  with the same message. A command with money and no right is refused whole; codes / notes still go through. Token scope `BALANCE_WRITE`
  unchanged.

## 4. Undo restores the observation time and source with the amount
- SDK images now carry `amountObservedAt` and `amountSource`; `restoreSdkImage` puts them back with `amount` / `amountAt` / `amountById`;
  an image written before these fields restores the time as unknown (null), never invented. LINKED stays final.

## Checks
| Check | Result |
|---|---|
| Reviewer's suite before / after | 4/4 red → 4/4 green (`review-suite-after-fix.txt`) |
| New official tests | `src/__tests__/vm-management/sdk-money-rights.integration.test.ts` (4), `src/__tests__/ops-api/ops-client-sdk.test.ts` (6), `src/__tests__/ops-api/ops-client-survey.test.ts` (2) |
| Existing SDK / client tests | pass; five SDK tests whose "other operator" records money now give that operator EARN_BALANCE (the shared fixture is unchanged: finance tests need a plain worker) |
| Full suite / lint / tsc / build | see the commit message |
| Local HTTP through ops-client (`.runtime/p42-local-survey.ts`) | `local-http-ops-client.txt` 20/20: capture → survey → stale file refused, read-before-capture refused, OCR "5_17" refused twice, VM changed after capture refused (REVISION_CONFLICT) and not rebound even with `--redo`, new capture + new read succeeds, DUPLICATE / SDK_CONFLICT / OLDER / SAME, no finance rows |
| Browser (`p43-ui.js`, a local USER without EARN_BALANCE and the admin) | `local-browser.txt` 11/11: cell "Tích luỹ: ẩn", frame "Ẩn" without a money input, Kho SDK "Ẩn", page HTML carries no amount; admin edits 0,21 → 0,5, Nhật ký → Hoàn tác → 0,21 with the OLD check time, a later machine reading is SAVED (0,33) |
| Screenshots | `shots/sdk-cell-no-money-right.png`, `shots/sdk-cell-after-undo-observe.png` |
