# M1 independent local Chrome UI sidecar — 26 October 2026

**Core dashboard checks passed; four-theme coverage is incomplete.** Real installed Chrome 155.0.8059.86 ran headless through the existing Playwright helper dependencies, against a real local Next server and actual authenticated tRPC overview API. No route mocks, video or product edits. Authoritative machine-readable browser version is in `results.json`.

## Confirmed

- Existing synthetic project from `.runtime/dashboard-ui-fixture.json`, eight VMs/two servers, guarded **127.0.0.1:55432/proxy_app_trial**. Shared `.env.test` DB and production DB were not used.
- Real overview source response saved in `source-api.json`: exactly one GOOD VM with fresh agent contact; fresh ABORTED prevents GOOD; fresh Central contact with missing AGENT remains Unknown; absent native evidence stays Unknown; unsupported policy stays Unsupported.
- Updated policy verified: fresh VM evidence under 120 seconds; a three-minute-old VM sample is STALE while a three-minute-old guest sample remains FRESH under its independent 1200-second limit.
- Actual coverage renders VM **5/8**, Guest **2/8**, Network **2/8**, Proxy **0/8**, App **3/8**. Running **2**, verified app connection **1**, unverified earning **7**. These are fixture observations, not real fleet measurements.
- Desktop **1280px** and phone **390px**: no page overflow; monitor panel stays within viewport; observed/received times distinguishable; fresh/stale/Unknown Central/agent labels separate; selected enrolled server without AGENT shows zero GOOD; Unknown drilldown shows its three exact VMs and no earning-success label.
- Final browser exercise recorded **120 passing API/layout/behavior assertions**, zero JavaScript page exceptions, zero browser console errors and zero failed browser requests. Repeated viewport checks were requested under four themes; they are **not** evidence of four distinct applied themes.
- Closeout readback confirmed VM identities, lifecycle/cycle/revision, SDK pointers and project VM/SDK/account/fund row counts unchanged. Only synthetic scan events/heartbeat snapshots were added/refreshed, plus normal local auth/session activity. No business accounts/secrets were created or printed.

## Theme limitation — stop condition respected

Dark and Bronze were actually displayed and captured. Light and Golden preferences did not change `<html data-theme>` from Dark in this isolated source-copy harness. Both normal Settings clicks and persisted-preference reloads showed this behavior. This is a harness/environment finding, not an independently diagnosed production defect.

The first aggregate palette assertion measured the monitor's unpainted/transparent surface and was unsuitable. One final bounded check measured the **painted `.bp-cards` background and shared `--ds-card` token**, while also checking actual `data-theme`. Requested Light still yielded actual Dark, `rgb(21, 29, 48)` / `#151d30`; four-theme verification therefore remains **incomplete**. No further retry or product fix was attempted. See `theme-assertion.json`.

Retained screenshots:

- [Dark desktop, 1280px](dark-1280.png)
- [Bronze phone, 390px](bronze-390.png)

The two captures taken under unsuccessful Light/Golden requests were moved to `.runtime/fleet-m1-ui-request-*-actually-dark.png` so the evidence folder does not mislabel them as verified themes.

## Execution limits and cleanup

Next was isolated under `.runtime/fleet-m1-ui-app` to keep generated files out of the product tree. A source junction initially returned route 404s, so it was replaced by a byte-identical snapshot (572 source files; hashes in `.runtime/fleet-m1-ui-source-manifest.json`). Native Node 24 TypeScript stripping conflicted with the existing Tailwind configuration; the sidecar used `--no-experimental-strip-types`. Two integrated policy/UI source files were synchronized into the **existing** snapshot after the inventory threshold update; no additional source tree was created.

The source-copy test files were discovered by an already-running shared Vitest run. The main task added an explicit exclusion. This sidecar did **not** run Vitest or touch that shared test DB. Future sidecars should use an already-excluded `.runtime/codex-release-*` folder as the owner directed.

The owned Next process on port 3010 was stopped after closeout. All sidecar code, logs, source snapshot, session and before/after fixture readbacks remain under `.runtime/fleet-m1-ui*`; secret-bearing session material is not copied into this evidence folder. Synthetic monitor observations remain only in the local UI fixture. No deployment, commit, production migration, financial action, AE action, bridge edit or integration edit was performed.
