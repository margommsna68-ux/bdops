# VM proxy actions and package context — 24 October 2026

Owner requested reporting BLOCKED from a VM, package information inside Proxy, and BLOCKED copy beside Copy danh sách VM. Implemented by code; no desktop interaction or video.

## Changes

- Proxy shows IP:port with independent copy, then a smaller package line (ellipsis and full-name tooltip). Existing warning lines retained.
- Click Proxy → Báo proxy BLOCKED calls the existing setVmStatus command. Updates inventory and VM together, preserving OFF/SUS/errors under existing rules. No extra confirmation.
- Reporting captures endpoint, cycle and operating revision when the frame opens. Background changes disable the action. tRPC now forwards the service's existing optional endpoint/revision checks; server rechecks on save.
- Existing canBlock/canReplace access is passed to the grid; no new role or approval bypass.
- BLOCKED copy moved from chips to the action group beside Copy danh sách VM. Selection/all-filtered-pages semantics retained; responsive wrapping.

## Checks

- Initial new component checks: 3 failed before implementation; permission guard already passed. Final 6/6 also covers server refusal and an empty proxy.
- Focused regression: 5 files / 53 tests passed. Typecheck and build passed. Changed-file lint: no errors or warnings; full build retains existing warnings elsewhere.
- Headless Chrome with local test data: 18/18. Real click reports BLOCKED, refreshes cell, then offers replacement. Package and copy placement checked; four themes selected in Settings, mobile 390px, no JS errors. Local DB readback confirms proxy BLOCKED and VM PROXY_BLOCKED.
- Early browser attempts failed in the harness (pre-hydration click; parser mistook board.vms for workspace.vms). Corrected harness, then completed a clean run. Bronze screenshot visually inspected; screenshots contain synthetic data only.

## Release

- Code 82ebc7d; backup moneytohome-20261024-105724.dump, encrypted moon-01 copy/decryption verified.
- LIVE 10:58 Bangkok, build y6Cf7LpYu8Cw-V-OEij_B; no migration. Rollback D:\MoneyToHome\app-before-vm-proxy-ui-20261024.
- Public build manifest 200. Code-only host readback: 678 VMs; packages agree for 677 configuration-bearing VM rows. Selected business IDs/revisions/status/config-link hash identical before/after (678 VM, 511 operating rows, 1463 proxies, 570 SDK).
- No test BLOCKED command on the real host, real VM changes or Sheet writes. Host authenticated browser flow not repeated; browser end-to-end action tested locally only.
