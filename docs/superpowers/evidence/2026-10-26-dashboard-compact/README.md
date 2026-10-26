# Điều hành gọn — 26/10/2026

Owner approved the compact demo and explicitly requested phone operation. Implementation changes only BusinessPulse and scoped CSS, retaining existing data, money calculations, rights, drilldowns, updates and operational rules. No migration or new VM/GEN2/financial actions.

## Changes

- One connected summary surface, compact attention buttons, quieter chart colors matching all four existing themes.
- Server table prioritizes unique VMs needing attention, initially five rows with an explicit expand/collapse button. Existing filters and exact VM drilldowns retained; server totals remain over the complete allowed dataset.
- Mobile stacks summaries and turns server rows into readable cards; touch hit areas and no horizontal page overflow.
- Off/uncalled setup VMs remain separate; missing/stale data and insufficient rights remain explicit. $8/$10 thresholds unchanged.

## Verification

- 33 focused tests pass (26 UI, 7 projection). New priority/collapse/refresh test failed before implementation and passes afterward. Existing coverage checks permissions, no invented money, exact filtered lists and refresh behavior.
- Typecheck, targeted lint and production build pass. On Node 24.12 the production build uses `--no-experimental-strip-types --no-experimental-require-module`; Vitest uses normal Node defaults. A test launch with the build-only flags failed during configuration loading, then passed with the correct runtime flags. No test expectation changed to hide that startup problem.
- Headless Chrome against the local production build: 40 assertions pass, using synthetic accounts and data on the guarded test database. Tests cover all four themes selected through Settings, 1280px desktop, 390px phone, a 360px touch context, filtered VM lists, exact VM links, server selection, refresh persistence and a user without money rights. Zero page script errors. No video.
- Independent read-only source review found no must-fix issue. Screenshots visually inspected for desktop Dark/Bronze and 360px touch layout; screenshots for the other themes are included.
- Early development-server checks hit a local JavaScript/chunk startup error; those runs are not counted as passed. The final checks ran against the successful production build.

`shots/` and `browser-results.json` contain synthetic data only. Public deployment and backup details will be recorded in release.md after verification.
