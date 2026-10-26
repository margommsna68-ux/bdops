# Fleet monitoring milestone 1 — 26 October 2026

Status: source implementation verified; web/Central deployment pending. Native GEN2 canary installation is BLOCKED; M1 is NOT accepted, M2/M3 must not start. This report does not claim resource measurements or live guest coverage.

## Reuse and scope

| Component | Existing part reused | Added | Proof |
| --- | --- | --- | --- |
| Agent/Central | Native EarnApp monitor, GenProbe core, authenticated heartbeat, registry, guard/hold | Opt-in 60s inventory and600s guest/proxy lanes; source-time snapshot | 39 package tests;15 legacy groups on original and patched source |
| Bridge | Current UUID/config/cycle capture and durable journal | Bounded generic batch transport and independent source heartbeats | 104 native Node tests; real web handler/testDB batch + lost ACK |
| Web | Existing scan service, scoped workspace, business dashboard | Versioned independent axes, bounded heartbeat table, source freshness and coverage | Targeted HTTP/integration/UI tests; local Chrome evidence in sibling folder |
| AE | Installed Moon05 fixed API | No control changes in this milestone | AE_READY, protocol2, actual39.3.2.0, financialEnabled:false; read-only vm-list91/91 |

## Review corrections

- Retry after another batch ACK now resolves the live queue object before persisting attempted=true. Four-state lost ACK/refused replay never invents a fresh key.
- Heartbeat UNKNOWN remains UNKNOWN in both aggregate status and per-source logs; authorization loss stops new work.
- CLI refuses a server filter outside monitor enrollment before taking any lock or starting a lane.
- Per-axis ACK clocks merge newest source times; inventory-only ACK never erases fresh guest proof.
- Agent contact is required for enrolled GOOD; non-running VM evidence contradicts positive earning; newer inventory cannot promote older cached earning proof.
- VM inventory expires after120seconds, separately from1200second guest/app evidence. Source clock never uses file mtime or HTTP receipt time.

## Tests and evidence

- `.runtime/fleet-m1-bridge-tests.log`:104/104 passed.
- `.runtime/fleet-m1-native-verify.log`:39/39 package tests,15 legacy regression groups on both base and patched source, syntax and hash checks.
- `.runtime/fleet-m1-final-focused.log`:56/56 passed after final inventory-freshness change.
- Final full web run:219files/1314tests passed. Full TypeScript and targeted ESLint:0errors. Final production build passed (existing hook warnings only). Production Prisma client had already been generated and validated before this build. Browser/deployment results are recorded below after completion.
- Initial broad Vitest discovery mistakenly imported the independent node:test source package as11 empty suites. It also exposed one pre-existing login-issue-read mock missing the two daily-email read delegates. The mock gained empty delegates; assertions/product behavior unchanged. Native tests now run only through their own explicit runner. Generated UI app copy is excluded like existing release copies. An intervening broad run was stopped after it discovered that duplicate UI source copy; no test expectation was weakened.

## Live rollout boundaries

No native source package has been installed. No production VM power, NAT, proxy, RAM, EarnApp/account or Auto-FIX/hold configuration action was issued. Apple worker unchanged. The website and Central bridge may be deployed independently; this does not prove native end-to-end coverage. Real CPU/RAM delta, probe p95/p99, guest child cleanup and actual600s coverage remain unmeasured.

Native installation blocker: `integrations/gen2-monitor-canary/DEPLOYMENT-BLOCKER.md`. Installed3.1.18 lacks a verified external ingress into the running process guarded updater, private immutable canary feed and successor environment gates. The separate headless updater can miss running jobs. No unsafe workaround, shared feed publication or false canary acceptance is authorized by this evidence.
