# Business dashboard implementation plan

> **For agentic workers:** execute with superpowers:executing-plans; a bounded GEN2 read-only sidecar and final independent review support this work.

**Goal:** Present real VM earning health, observed daily growth, $8/$10 thresholds and proxy action items simply.
**Architecture:** Read projection over authorized VM workspace, SDK observations and verified scan evidence; existing finance remains collapsed. Reuse current observation services for GEN2 data, no machine actions.
**Tech Stack:** Next.js / React / tRPC / Prisma / PostgreSQL; existing CSS tokens.
**Spec:** docs/superpowers/specs/2026-10-26-business-dashboard-design.md

## Global constraints
Existing GEN2 scans only. $8 soon/$10 enough. Paused/new separate. No automatic proxy/payment/withdrawal actions. No secrets in responses/logs. Existing project/server and money rights. At most two displayed decimals. Preserve old history and migrations. No video.

## Review focus
Unknown scans never healthy; lifecycle/cycle changes never inherit money; withdrawal reductions never stalled; no-money/server-limited users cannot infer restricted data; stale/error refresh cannot look newly checked.

### 1. Projection
- [ ] Add failing pure tests in src/__tests__/proxy-management/business-pulse.test.ts for health, daily amount coverage, declines, thresholds and lifecycle.
- [ ] Implement src/lib/business-pulse.ts shared DTO/classification and src/server/dashboard/pulse.ts authorized read projection. Add explicit VM/cycle binding to new SDK observation event details where needed, preserve existing behavior.
- [ ] Add DB integration tests for scoped readers, SDK changes, read timestamps and legacy uncertainty.

### 2. Dashboard
- [ ] Build src/components/dashboard/BusinessPulse.tsx and scoped CSS; integrate Overview operations with existing auxiliary sections collapsed.
- [ ] Add focused UI tests for drilldown/counts, empty/loading/error and no money. Preserve URL and table navigation.
- [ ] Real local Chrome 1280/390, four themes, shared reads and refresh; only synthetic writes.

### 3. GEN2 / notifications
- [ ] Verify existing GEN2 schema and source times; implement smallest safe read-only source adapter with normal API writes, durable idempotency and incident transition reporting. Reuse existing destination/config, never print secret. If evidence absent, surface explicit unknown; do not invent mappings.
- [ ] Test adapter with saved synthetic data, timeout/stale/duplicate/identity mismatch and incident/recovery transitions before activation.

### 4. Release
- [ ] Independent source review, resolve material findings, focused/full tests + typecheck/lint/build.
- [ ] Backup local+approved moon copy, stage precise source, deploy website and verify public/read data. Publish only proven sync behavior; record limits, update runbooks and parent AGENTS.
