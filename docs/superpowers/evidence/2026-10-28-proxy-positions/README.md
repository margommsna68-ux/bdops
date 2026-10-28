# Lịch sử vị trí proxy (server / VM theo thời gian) từ Sheet — 28/10/2026

Owner: "bổ sung lại lịch sử trên sheet vào site, ví dụ proxy đó đã từng vào server nào; vào lịch sử trong quá khứ không track được".

## Source (same XLSX export as the morning task, sha256 9aa078b0…)
- Hidden tab `SYSTEM_SNAPSHOT_THU` = 189 JSON snapshots (29/09 06:24 → 22/10 14:01 UTC). The useful parts are in the last snapshot's
  `masterView`: `vmEvents` (66 observed VM-cell edits: key, old, new, at, source; 8 "VM key removed"), `fillAssignments` (108 VMs filled
  from stock with time), `lastVMs` (678 positions as read 22/10), plus two owner-approved anhlong assignments of 29/09 in `history`.
  The per-snapshot `map` is NOT updated over time (it is the 29/09 baseline), so it only gives the starting positions.
- Rebuilt per proxy the intervals (position, from, to): baseline 29/09 → apply events in time order → reconcile with `lastVMs`
  (25 positions had no event, e.g. moon05 VM_071–091 re-added after 04/10 and 2 anhlong VMs → interval with unknown start).
  11 fill records duplicated a vmEvent and were skipped; 0 "old ≠ tracked" contradictions. Remaining open-interval vs web-hold
  differences = 7, all web-era changes after 22/10 (23.142.16.73 ports on moon05, 178.94.227.166, 95.135.204.110) that already
  have their own web RELEASED events — consistent.

## Written (batch SHEET_POSITIONS, key SHEET-POSITIONS-c911cf15d96533ab9a9df060, backup moneytohome-20261028-141230 + moon-01 verified)
- 735 ASSIGNED + 58 RELEASED `ProxyStatusEvent` rows on 714 proxies, `occurredAt` = Sheet time (null for 25 unknown starts and the
  unknown-date releases), `reason` = "Dùng cho vt-01/VM_033 (theo Sheet proxy: vt-01!B33)" / "Rời moon05/VM_069 — thay bằng
  178.94.227.198:5432 (theo Sheet proxy: moon05!B69)", `sourceRef` = "Sheet proxy › <cell>". No endpoint state, hold, VM or
  replacement changed. Journal SHEET_POSITIONS_IMPORT (not reversible), audit row. Dry run (rolled back) first; re-run replays.
- Guard: refuses if any ASSIGNED/RELEASED event dated before 23/10/2026 already exists (none did) or an endpoint changed identity.

## Verification
- `getProxyTimeline` on the host: 95.135.204.110 now shows moon05/VM_069 29/09→02/10, vt-01/VM_033 from 03/10 (Sheet) and the web
  24/10 release; 178.94.227.175 shows moon05/VM_069 (02/10, same day replaced) then vt-04/VM_045. ASSIGNED 7→742, RELEASED 7→65.
- UI: the timeline previously printed only the event label (e.g. "Dùng cho VM") without the VM. Commit d78cb5a/02f2414 adds the
  event `reason` to the timeline API and panel (the existing "Vị trí đang ghi nhận" section stays). Typecheck/lint clean, history
  tests green, local Chrome check on the synthetic project (`ui-timeline.png`).

## Release (timeline reasons)
- Stage built from a copy of the live app (XgZG7S0KR9H2Ee-L97I4k, the fleet-ops release) + 3 files → BUILD_ID `sMeg0XBUQACAlFGkIiTGc`,
  deployed 28/10/2026 14:18 Bangkok by `tools\deploy-proxy-timeline.ps1` (no migration, 47 up to date); manifest + login 200;
  rollback `D:\MoneyToHome\app-before-proxy-timeline-20261028`. Proxy / replacement counts unchanged by the deploy (payout count moved
  16 → 19 from concurrent owner/operator activity, not this work).
