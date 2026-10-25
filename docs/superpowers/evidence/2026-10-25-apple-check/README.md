# Check Apple ID — 25 October 2026

## Release and installation
- Code commit 34d2c8b; build `42CJbDKUCYoDy0oiaUMDT`; deployed SERVER-01 17:00:57 Bangkok to https://wow.lalamail.sbs. Two additive migrations: 20261025090000_apple_check and 20261025091000_apple_check_replay.
- Backup `moneytohome-20261025-165506.dump`, encrypted/decryption-verified copy on moon-01 SHA256 `faf02c728ed7fadde489a34b9af080cf6b5a4ed37d71a674ac9cd0e61f7b8d25`.
- Rollback folder `D:/MoneyToHome/app-before-apple-check-20261025`. Stop/clean worker before rolling back to code unaware of its proxy reservation.
- Worker 1.0.0 installed at `C:/Users/Administrator/Desktop/MoneyToHome/AppleCheckWorker` on pinned WIN-6CA4QAGDD2F. Actual Windows user meo3; Desktop location is resolved, not inferred. Eight runtime files match installed immutable manifest. Dedicated playwright-core 1.64.1; existing AVC Chromium 150 executable reused, shared runtime and profiles untouched.
- Scheduled task `MoneyToHome-AppleCheck-Worker`: meo3 Interactive/Limited, starts at logon, one instance, no automatic Windows login. Dedicated token stored only in private ACL-protected worker file; server retains its hash. Existing AI users/tokens/rights unchanged.

## Tests actually run
- Web: 203 files / 1,125 tests pass, typecheck/build pass, lint existing warnings only. Initial full run encountered six worker tests while their filenames were being changed from Vitest discovery to Node-only names; subsequent complete frozen run passes. No product expectations weakened.
- Worker: 51/51 Node tests pass; CLI syntax and native Windows desktop/ACL checks pass. Independent reviewers found and helped close redirect exfiltration, child ACL, lost claim, duplicate overlapping journals, revoked-token recovery and preflight challenge issues. Final source review: no remaining P1/P2 blockers.
- Local real Chrome: 12 checks plus four themes selected through Settings; 390px screenshot. Synthetic account/proxy only. UI creates a worker token, hides it, queues a single check, reflects fixture Locked, separates cleanup history, and denies common-stock controls/data to scoped moderator. Screenshots contain synthetic data and masked secrets; no video.
- Central native smoke: existing Chromium opens with an intentionally unreachable loopback proxy, refuses the route and closes/cleans its owned profile. First run returned generic SMOKE_FAILED without sufficient diagnostic, so its cause is not established; instrumented repeat passed without product changes. Do not describe the first failure as proven unrelated.

## Authorized real canary
Owner explicitly replied to select randomly from MoneyToHome. Selected exactly one ACTIVE Apple ID with no EarnApp or VM binding and an eligible NEW SELF/TUT proxy. No global stock group was created or proxy ownership changed.

One job ran through the live API/worker. Its account-secret endpoint was delivered once; final result **UNKNOWN**, cleanup **OK**, account remains ACTIVE/revision 0, zero VM links, proxy lease released. No automatic password retry, replacement account, OTP retrieval or further account check occurred. The result is deliberately **not** called login success, Locked or a completed real-branch acceptance test.

Worker is left online/IDLE. Readback: zero remaining profiles, pending reports, ambiguous claims or quarantines; zero owned Chromium processes after completion. Sample idle Node RSS 130.4 MiB and 0% of one core over a two-second sample. During the real job a sample counted seven owned Chromium processes, ~422 MiB combined. These are samples, not resource guarantees.

## Data integrity
Immediately before/after deployment, business counts and digest are identical: 678 VM /149 login /1465 proxy /4 batches /4 costs /0 payout requests /0 fund transactions; digest `6f2c51c6a6577499ee7f70240436283496dec407182d8c6e78a0691363e28eb1`.

The final digest differs while counts remain equal. Readback found a concurrent `VM_SDK_OBSERVE` by **codexcli** at 10:02:13Z updating VM_057, between deployment and canary completion. It is not legitimate to claim all final data stayed bit-identical. This feature's audit contains configuration/request/proxy read/login read/result only; it performs no VM, EarnApp link, money or SDK writes. The canary's proxy only acquires/releases its temporary check lease.

## Remaining limits
The one real Apple canary returned UNKNOWN. Actual Locked, authenticated success and OTP/CAPTCHA branches remain verified with fixtures/source-based guards, not observed on real accounts during this release. Apple markup can change; no retry/false classification is used to conceal uncertainty. No reboot/logoff rehearsal was performed; task registration and current interactive run verified. No Sheet, Railway, AE or GEN2 changes.
