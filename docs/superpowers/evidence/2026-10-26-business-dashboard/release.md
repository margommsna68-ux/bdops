# Live release 26 October 2026

- Web code d57cde3, build VZOQP8B2AzzOLj-HR0SSP, deployed 08:37 Bangkok. Public exact-build manifest returns 200. No migration (41 applied, up to date).
- Backup 08:36: moneytohome-20261026-083644.dump, encrypted moon-01 copy verified including decryption. Rollback D:/MoneyToHome/app-before-business-dashboard-20261026. Only Web service swapped, Tunnel kept running.
- Read-only before/after snapshots match: 678 VM, 149 login accounts, 1,465 proxies, 4 purchase batches, 4 costs, 0 payout requests/fund entries; 634 SDK. Both business hashes unchanged before cache ingestion.
- Bridge 06808b4 installed on Central in shared MoneyToHome/Gen2Dashboard/releases/20261026-v1; all nine source/test files verified by SHA-256. Existing token/GEN2 configuration retained. Task MoneyToHome-GEN2-Dashboard runs with batch/password logon, Limited, no visible desktop.
- One real cached MOON-01/VM_001 scan accepted, exactly one event, no pending response. Read-back dashboard GOOD, time 25/10 23:00:06Z. Stored SDK money remained $19.17 with its original reading time; old cached $19.25 was NOT relabelled as a new current-round reading.
- Background task running, no error output; snapshot 08:45 showed 38 real GEN2 events. It is still completing the rate-limited first pass, not a claim that all VMs are synced. 486 web rows have explicit UUID; cached source matched 481, others remain unknown.
- Initial read-back: 678 total, 587 active denominator, 2 paused, 89 not installed; enough amount threshold 443 VMs, soon 40. These use existing fresh stored balances and are not withdrawal-readiness claims. Four recorded web issues remain visible. Today growth insufficient until two same-binding observations today.
- Live reminder hook authenticated/read current due list: zero due items, zero sends, zero unknown. Delivery itself was NOT exercised with a fake live notification. Existing GEN2 incident/recovery sender left unchanged.
- Bridge tests 54/54: crash replay, refused retry preserving uncertainty, exact source timestamps, current UUID/server matching, safe dead-PID lock recovery, scoped routes, secrets excluded, notifications deduped/unknown preserved. Independent review issues were fixed before install.

No VM power/scan/fix, proxy replacement, account assignment, payout, payment or Sheet write was performed. First capture intentionally waits for future GEN2 money observations; no old cache was imported as new money.
