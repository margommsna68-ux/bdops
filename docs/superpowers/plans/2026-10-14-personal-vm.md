# Personal VM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Preserve approved sequential inline execution; helpers read-only.

**Goal:** Allocate unused SELF NEW proxies safely, preserve actual installed occupancy until exact human confirmation, unify personal UI.

**Architecture:** Additive managed VM/configuration/occupancy schema and vmManagement domain/router. Encrypted immutable configs and OperationJournal reuse existing scope/source/Serializable checks. Legacy routes/components remain isolated.

**Tech Stack:** Existing Next14, tRPC10, Prisma5/PostgreSQL17, React.

**Spec:** `../specs/2026-10-14-personal-vm-design.md`

## Global Constraints

- Operators all VMs in their granted project; fresh capability checks and no cross-project IDs.
- Genjy permanent; only unused SELF NEW auto fill classified BLANK; legacy UNRESOLVED never auto fill.
- Desired != installed; old physical holds persist until human confirmation, failure retains uncertain holds.
- Revision/sequence monotonic; encrypted snapshots; no public deploy/real data/example import.
- New router and managed child wrappers, preserve baseline finance/EarnApp.

## Review Focus

1. Pending reservation must invalidate stock undo even before proxyId moves.
2. One VM switching A→B holds both until confirmed; two operators cannot take B simultaneously.
3. Copy/start/fail means physical state uncertain: ordinary undo cannot release those proxies.
4. Legacy VMTask/delete/editHistory routes cannot bypass version or occupancy checks.
5. Later Genjy ownership/source failure blocks allocation, retains holds and exposes conflict clearly.

### Task 1: Managed models and allocation domain

Files: schema/migration; `src/server/vm-management/{types,repository,allocation}.ts`; inventory repository; integration fixture/tests.

Interfaces: `createVMService(db,deps).preview(scope,{mode:'AUTO'|'MANUAL',serverId?,vmIds?,endpointId?,idempotencyKey})` returns actor-bound token/rows; `.commit(scope,token,key)` returns same replayable batch results. `getEligibleInventory` excludes active holds. ProxyBatch kind VM_ALLOCATION uses separate service and is rejected by proxy batch commit.

- [x] RED integration: BLANK only, source error/Genjy owner denial, global competing occupancy, A retained while B desired, payload/token/expiry/revision/replay, fault atomicity.
- [x] Add managed fields/configs/allocations/tasks with Restrict FKs/global partial unique keys/pointer project validation. Migrate isolated trial/test only.
- [x] Implement server/VM DTO/create and preview/replan commit, encrypted exact configuration, holds/tasks, endpoint/VM revision bumps and before/after journal.
- [x] GREEN target tests and inventory suite; commit functioning domain.

### Task 2: Install lifecycle and safe undo

Files: `installation.ts`, operation snapshot/journal/undo; permissions and legacy vmTask/delete/editHistory; lifecycle integration tests.

Interfaces: `startInstall(scope,id)`, `copyConfiguration(scope,id)`, `reportInstallFailure(scope,id,note)`, `confirmInstalled(scope,{configurationId,configurationHash,expectedVmRevision})`; fresh source before confirm; results masked except explicit authorized copy. VM_PLAN inverse releases only untouched pending hold, preserves installed.

- [x] RED tests: hash/old version/foreign/member/viewer denial, copy cap, full-project operator, failure holds, confirm release A and never recycles as NEW, undo before/after start, reservation blocks NEW stock undo and direct legacy bypasses.
- [x] Implement lifecycle, current desired guard, config-linked task protection, reversible flag/journal v2 and monotonic compensation. GCM snapshots never in DTO.
- [x] GREEN lifecycle/concurrency/rollback, commit.

### Task 3: Personal UI and site consolidation

Files: vmManagement router/root; `src/components/vm-management/{ServerWorkspace,InstallWorkspace,ProxyDashboard}.tsx`; managed wrappers for servers/[id]/dashboard/vm-tasks/EarnApp vms; Sidebar/header/history; registry/timeline allocation locations.

- [x] Server create code + explicit VM codes, add VM, row change proxy/autofill preview and explicit partial save when shortage. Only one primary action for clean allocation. Blue pending marker, neutral normal states.
- [x] Install list shows desired vs installed, Copy để cài/start/confirm/failure; disabled/denied actions show reason. Header/nav/dashboard link correct personal flows; generic history embedded shares OperationJournal.
- [x] Seed only synthetic sample managed server with blank/placeholder/formula/unresolved examples on guarded trial database. Browser create/autofill/start/confirm/history/refreshed locations across pages.
- [x] Full suite/types/lint/build, one independent review, one fix pass RED→GREEN; refresh own loopback preview and update runbook/master progress. Real source migration and Railway are separate gated milestones.
