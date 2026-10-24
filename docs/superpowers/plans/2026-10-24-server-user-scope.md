# Server-limited User Access Implementation Plan

> **For agentic workers:** use subagent-driven-development or executing-plans, test each boundary before release.

**Goal:** ADMIN assigns a project's non-admin member to selected servers; that member sees and operates only those servers and their bound proxy/SDK data.

**Architecture:** Add ALL/SELECTED membership scope with a stable-ID allowlist. Existing roles, capabilities, token scopes, PIN/2FA, revisions and VM cycles remain intersections. Central scope helpers resolve resources from DB; per-request allowlisted surfaces fail closed for project-wide tools; write/replay checks reload and lock current membership within transactions. Filter before counts and paging.

**Tech stack:** existing Next/tRPC/Prisma/Postgres and React components; additive migration, no dependencies.

**User decisions:** only server-bound data; no unassigned common stock. Multiple selected servers supported. SELECTED with no server grants gives no data. Existing users default ALL; do not change any live user's grants automatically. ADMIN stays ALL and manages grants. Current proxy may be read for an allowed VM but other-server locations/history are hidden; shared-proxy mutation is denied if it would affect an unauthorized server.

## Tasks

- [x] Membership fields, grant service and UI in existing MemberRightsForm; admin/project/revision validation, transaction/audit.
- [x] Shared server-scope helpers and transaction membership lock; guarded resource sets (VM/server/SDK/proxy/job/account/request/configuration). New SDK attached to allowed VM is allowed; existing stock or another server's SDK is denied.
- [x] SDK/workspace/detail/history filtering, hidden-holder-safe errors, source+destination validation and replay checks.
- [x] Proxy inventory counts/search/copy filtered; shared-location redaction and affected-server validation; deny global stock administration for restricted users.
- [x] Central web/API fail-closed routing, VM/ops/account projections, token/job/replay enforcement. Deny project-wide money, global journals/import/undo and legacy side doors for server-limited users.
- [x] Integration tests using A/B/common-stock with direct IDs, mixed bulk, stale grants, replay, retained job, transfer and secrets; real local browser with admin + scoped user.
- [x] Review all changed boundaries; types/lint/build + related tests; backup, additive migration and production deployment; read-only host verification, docs and handoff.

## Review focus

- Scope revoked between preview and commit/replay or while job remains active.
- Shared endpoints, SDK money/history bindings and old snapshots leaking the other server.
- Hidden data influencing facets, totals, searches or errors.
- Alternate routes and approval/batch paths bypassing service guards.
- Empty selection and foreign-project grants must never mean unrestricted.
