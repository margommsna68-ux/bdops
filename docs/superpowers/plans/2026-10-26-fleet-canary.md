# Fleet monitoring and control canary implementation plan

> For agentic workers: use superpowers:subagent-driven-development with disjoint bridge and web tasks; review after each task and whole milestone.

Goal: satisfy the owner brief through three gated milestones, no fleet rollout or production VM power actions.
Architecture: existing GEN2 native collector/guard -> existing Central -> existing cache bridge -> shared web telemetry. Reuse generic POST batch (already100items/10batches per minute and per-item service keys) before introducing another transport. Separate VM power commands later, gated allowlist at web and AE.
Tech stack: existing Node/Electron GEN2, Node bridge, Next/tRPC/Prisma/Postgres web, AE named-pipe API.
Spec: docs/superpowers/specs/2026-10-26-fleet-canary-owner-brief.md

## Constraints
- User authorization covers backup/test/deploy of this feature and canary on Central+onehost only. Production VM observations read-only; financialOFF; Apple worker untouched.
- Existing worktree feat/proxy-inventory retained; unrelated untracked assets preserved.
- No script/GUI substitute for AE actions. No concurrent collectors120s+600s. VM actions wait until M1 accepted.

## Discovery verified
- Central WIN-6CA4QAGDD2F, GEN2 actual package3.1.18/current junction versions3.1.18. Existing bridge task running. Selected source copied read-only .runtime/fleet-m1-source.
- Monitor currently120sec, one native probe, onlyRunning inventory in round. Slow probes add50%rest; rechecks precede unvisitedVMs.
- Web scan event only earning/problem, stale uses money24h threshold; no independent agent/central heartbeat.
- Generic POSTbatch already supportsGEN2_SCAN and100items with per-itemservice replay;10batches/minute bucket counts requests, notitems. Existing bridge does not use it. Do not increasefinancialquota.

## M1 tasks
- [x] Bridge: bounded per-item durable telemetry batch transport, exact same event keys/body; restart/partial/malformedACK/unknown isolated recovery. Preserve legacy pending command and capture-before-money identity rules. Add tests before implementation; no credentials/config changes.
- [x] Web: shared versioned monitor policy; optional backward-compatible independent VM/guest/network/app observations; fresh health distinct from earning evidence. Heartbeat/current coverage persisted separately with server scope, source vs received times and stale display. Tests authority/ordering/replay/scope; OpenAPI docs.
- [ ] GEN2: locate actual source worktree/build instructions; implement and test one600s native collector and60s inventory lane, independent proxy2slot transport, bounded child cleanup and no fixes. Canary only after source/build/test and existingengine baseline. Preserveproduction120s until newcollectorcanarypasses.
- [ ] Integrate/configcanary,backupweb+Central release,install Central+onehost,one full~100VMread-onlycycle. MeasureprocessCPU/RAM/coverage/p95/99/probe/socketcounts and end-to-end delay. Fixtures fornetwork/auth/stale/errors; do notinjectproductionfaults. Compareenginesbeforeafter.

## M2 gated
- [ ] AE capability/doctor/installedDLL actualverification, isolatedcanaryUUIDselection.
- [ ] Durable sharedWeb command service, operationID/lease fencing/TTL/revocation andcanaryallowlist. AE request/replay/resultjournal; no newproductionactions.
- [ ] End-to-endSTART/SHUTDOWN/POWER_OFF/CHECK_HEALTH and cancel/unknown proof oncanaryonly; nofakecompletion.

## M3 gated
- [ ] Telegram authenticateduser/project/server invokes samecommandservice; verifyappropriateACK independentlyfromweboutbox.
- [ ] Boundedbackground24–48h observation with timestampedtelemetry and resumeablehandoff; noClaudeactivepolling. No fleetrelease withoutownerdecision.

Current gate: GEN2 source patch verified, but initial native deployment blocked by installed3.1.18 update ingress. See integrations/gen2-monitor-canary/DEPLOYMENT-BLOCKER.md. Web/Central transport installation is independent; it cannot accept M1. No M2/M3 actions authorized until M1 passes.
