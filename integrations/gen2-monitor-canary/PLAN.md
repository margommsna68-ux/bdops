# GEN2 native monitor package plan

Scope: new files here only; no install, settings/token changes, VM action, commit, or remote command. Source: GEN2 3.1.18 downloaded staging. Owner brief is ../../docs/superpowers/specs/2026-10-26-fleet-canary-owner-brief.md.

1. Pin base source hashes; retain exact source fixtures and legacy tests. Write failing deterministic tests for opt-in scheduling, concurrent inventory, evidence, proxy lanes and cancellation.
2. Extend existing monitor behind canary policy v1: due per VM, first pass before one bounded recheck, deadline retains slot; independently refresh whole inventory. Reuse incidents, guard and native core.
3. Add fixed native inventory/applied-config readers and bounded proxy transport lane; secret-free immutable health snapshots. No guessed guest network or earnings.
4. Add SHA-gated pure main source transform: one collector, opt-in environment flag, existing readCore/guard/incidents retained. No deployment command in package.
5. Run package and downloaded legacy tests, syntax-check transformed main, re-read shared policy, document gaps and handoff.
