# Release — Điều hành gọn

- Code commit: 968bca5; build: sIh5o4tnIFMi_ZgJgXxru.
- Deployed to https://wow.lalamail.sbs at 10:18:41 Bangkok, 26 October 2026.
- Existing scoped service permissions used; no elevation popup or security setting changed.
- Fresh local backup: moneytohome-20261026-101808.dump. Encrypted moon-01 copy verified, including decryption, at 03:18:25 UTC.
- No migration. The existing 41 migrations were up to date before swapping the app directories.
- MoneyToHome-Web and MoneyToHome-Tunnel running. Public exact-build manifest returns 200. Deployed component/CSS source matches the tested release after normalizing line endings.
- Read-only before/after business snapshots match: 678 VMs, 149 login accounts, 1,465 proxies, 4 purchase batches, 4 costs, no payout requests or fund transactions. No production business writes performed by this task.
- UI checks were performed against the local production build with synthetic data (40 assertions), not by logging into the owner's production account. Four themes and mobile/touch screenshots are in shots/.
- Rollback application retained at D:/MoneyToHome/app-before-dashboard-compact-20261026. Deployment script: D:/MoneyToHome/tools/deploy-dashboard-compact.ps1.

No changes to the GEN2 bridge, scheduled tasks, VM machines, token permissions, Sheets or financial records.
