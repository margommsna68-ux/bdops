# Check Apple ID Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development or superpowers:executing-plans. Owner already requested immediate execution of approved brief.

**Goal:** One-click Apple stock check with a dedicated Central worker, no VM account changes.
**Architecture:** Durable Prisma jobs and fenced worker lease; protected tRPC UI; outbound dedicated worker HTTP protocol.
**Tech Stack:** Next.js, Prisma/Postgres, React/tRPC, Node worker and existing CloakBrowser runtime.
**Spec:** docs/superpowers/specs/2026-10-25-apple-check-design.md

## Global Constraints
No real-account canary until owner selects one; no video; no VM/EarnApp operations; locked blocks allocation; OTP stops; secrets never in logs/frontend/job DTOs. Existing isolated worktree feat/proxy-inventory is reused.

## Review Focus
Crash after submit; stale account revision; same proxy selected concurrently by VM and check; token revoke during secret delivery; cleanup failure independent of successful auth.

## Tasks
- [ ] Backend: failing integration tests, additive worker/job models, transaction services, shared allocation guards, narrow HTTP route and protected router. Run focused tests against isolated test DB.
- [ ] Worker: independent Node package with durable minimal journal, strict API client, isolated browser/proxy adapter, resource/desktop gating, checkpoint before single submission and guaranteed ownership cleanup. Fake tests first; inspect actual Central runtime before installation.
- [ ] UI: Check button/results per Apple stock row and ADMIN dedicated proxy-group/worker configuration, cancellation/history; component tests first. Reuse current theme/classes and secret-entry protections.
- [ ] Integrate: full test/type/lint/build, independent spec/security review, synthetic HTTP/browser tests, fix findings.
- [ ] Delivery: runbook, manifest/install/rollback; backup then live additive migration/deploy and read-only verification; install worker safely if existing access/runtime supports it, leave no account checks running. Explicitly report deferred real canary.
