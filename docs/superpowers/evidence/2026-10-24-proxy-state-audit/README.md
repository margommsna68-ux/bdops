# Proxy state audit and two-Sheet reconciliation — 24 October 2026

Owner requested LIVE/BLOCKED/replaced consistency across inventory and Server/VM, then both Sheets reconciled from the web. All work used code; no UI or video. No real VM configuration was changed.

## Web

- Audited 1,463 endpoints, 678 VMs and 101 replacement links. No replaced/retired endpoint was currently assigned; historical replacement links and active holds were consistent.
- Found vt-01/VM_033: its current proxy was BLOCKED but an operator had subsequently set the VM to Chưa nối. Corrected that one status through `setVmStatus` with cycle, revision, endpoint and journal checks.
- Code c9f4982 now rejects OK/Chưa nối/LINKED when the definite current proxy is BLOCKED. OFF, SUS and error statuses remain available. This does not assert real-machine health.
- Preserved An-01/VM_015 OFF despite its BLOCKED proxy. Preserved 641 LIVE endpoints without a recorded VM position: LIVE may be explicitly recorded for external/shared use and is not automatically free stock.
- Readback: LIVE 1,296; REPLACED 101; QUARANTINED 52; RETIRED 1; NEW 9; BLOCKED 4. No remaining definite state mismatch found by this audit.
- Related tests: 16/16 plus 26/26; new regression failed before the change. Typecheck, lint and production build passed. These are focused checks, not a new full-suite claim.
- Backup `moneytohome-20261024-102207.dump`, encrypted off-host copy verified on moon-01. Deployed 10:24 Bangkok, build `03uoOY6Ca5G7K9Vj3Yb9p`; no migration. Rollback `D:\MoneyToHome\app-before-proxy-audit-20261024`.

## Sheets

- Web is authoritative. Exact endpoint matching for Proxy Server; approved server aliases plus VM code, stable Sheet VM ID, cycle and revision for Server Total. Checked all live web revisions immediately before applying.
- Proxy inventory: reconciled 1,463 rows, including state, position and group. NEW count is 9, with no NEW row assigned to a VM.
- Server Total: matched 678 VMs; changed 3 operating statuses through the existing HMAC journal and renderer. Updated the replacement proxy for moon05/VM_088 in both files (2 cells). Did not directly overwrite status formulas.
- Preserved existing proxy cells for 20 REVIEW VMs and 1 VM with no definite web proxy. Did not infer missing assignments. No account, SDK, observed money or cost commands were issued.
- Backups before writes: proxy file `16CZwxKcHPCbaDXGM3m4QfS0Mt2HFVucSQi45BAhExVs`, Server Total `1B7U2DPVBsBs-Ph5Mz6xm-PGJXor2KvpVzJNa2PtENC8`, journal `1TCaO6V_DqQ2G2q8AYkF2Vi7we5S__yOGAZsWlwVJeEw`.
- Applied 10:37:39 Bangkok. Readback verified every planned master state/location/group, all 678 VM statuses/cycles and both changed proxy cells; journal sequence 926.
- Updated the proxy Sheet's existing refresh wrapper to overlay this dated web snapshot after its old calculation (which otherwise reclassified LUONG_NGOAI BLOCKED entries and old shared-group decisions). Metadata contains endpoint only, no proxy credentials. No trigger added. This is a dated one-time mirror, not continuous web synchronization; later web changes require another reconciliation.
- Executed the overlay: matched 1,463, NEW 9. No changes to user notes or proxy history columns.

## Google access cleanup

Used the already authorized private Apps Script project and a temporary capability-guarded deployment, fixed to the two owner-approved files and hashed write plan. Restored original project HEAD after deploying each temporary version. Deleted the temporary deployment after readback; confirmed it absent and original HEAD identical to the pre-task backup. Existing production deployments retained. No AI token, PIN, sharing policy or operations trigger changed.

Runtime and private artifacts are deliberately not committed: they contain full proxy values or connection material. Aggregate verification is retained alongside this report.
