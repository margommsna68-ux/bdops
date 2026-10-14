# Quyết định khi triển khai kho proxy — 14/10/2026

Danh sách đầy đủ các Ruling trong ledger, theo thứ tự phát sinh. Chi phí nếu quyết định sai được ghi ở từng dòng. Phạm vi: kho local; VM, dữ liệu thật và public deploy tiếp theo.

## Rulings I made

- Ruling: use manual Git worktree here — the app-native worktree API targets the calling non-repository proxy-manager chat and has no repository argument; this implementation is a different repository. Cost if wrong: worktree is managed by Git instead of app attachment.
- Task 1: Ruling: baseline date tests expected English while copied settings default to Vietnamese — update expectations to the existing intended Vietnamese output; no app behavior changed. Cost if wrong: tests should explicitly set locale when English becomes the desired default.
- Task 3: Ruling: add partial unique active inventoryKey in addition to canonical IP identity — a durable lock protects concurrent writers and later port-stream allocation policies. Cost if wrong: approved port streams need separately evidenced keys, never a blanket duplicate allowance.
- Task 3: Ruling: quarantine all unmapped legacy rows until current source confirms owner/package — BDOps legacy data is not the user's personal Sheet infrastructure. Cost if wrong: records require reconciliation before becoming eligible; prevents accidental allocation.
- Task 4: Ruling: Railway official docs now deprecate Config as Code (new services cannot opt in; legacy deadline 2026-12-01) — configure new preview service pre-deploy in Settings/IaC; retain TOML for legacy compatibility only. Cost if wrong: deployment settings must be checked at actual service creation instead of assuming TOML is honored.
- Task 6: Ruling: user asked when UI would start — begin UI immediately using completed backend interfaces before closing Task 5. Cost if wrong: keep incomplete import/VM operations disabled and don't call the full plan complete yet.
- Task 5: Ruling: Sheet import tracks current inventory separately from provider NEW receipt; matching Genjy source identities are allowed for tracking but remain reserved. Cost if wrong: real import mapping must be reviewed before turning a frozen source row into stock. Live Google personal source mapping remains part of the separate real-data migration.
- Task 5: Ruling: package registration only restores rows quarantined explicitly for UNKNOWN_PACKAGE; unmapped legacy rows remain quarantined. Cost if wrong: manual legacy reconciliation remains necessary instead of silently releasing ambiguous data.
- Task 5: Ruling: unrelated integration fixture files share one database and caused bounded Serializable retries to exhaust; run fixture files sequentially, retain explicit Promise.allSettled race tests and runtime 3-attempt bound. Cost if wrong: suite runs approximately 5 seconds longer; no production retry weakening.
- Task 6: Ruling: local preview fulfills the preview deployment for now following user's local-first hosting question; Railway credentials/target remain unavailable. Cost if wrong: shared online access is deferred, nothing publishes to an unverified old project.
- Task 6: Ruling: move production build output through a task-owned .next-build junction to D because C has <1GB free; provide optional BDOPS_BUILD_DIRECTORY while default remains .next. Cost if wrong: local build needs the task-specific junction/ancestor dependency link; ordinary Railway builds remain unchanged.
- Final: Ruling: VIEWER promise includes keeping server credentials hidden, even through old server.getCredentials. Elevated reviewer-declined case to Important; deny VIEWER and require managed copy capability, real caller RED->GREEN. Cost if wrong: staff need an explicit copy grant to retrieve secrets.
- Final: Ruling: Railway/public deployment remains deferred in favor of local-first work and an identified cloud target. Cost if wrong: colleagues cannot yet use an online address.
- Final: Ruling: live personal Sheet mapping/account migration/real import is the next data migration milestone. Cost if wrong: current app remains a synthetic trial; live Sheet must be read and classified before real use.
- Final: Ruling: VM allocation/reservation/install confirmation and business integration remain the sequential next milestones; inventory allocation button stays disabled. Cost if wrong: this inventory release cannot yet fill/install VM configs.
- Final: Ruling: getEligibleInventory is an internal inventory reader, with no current allocation caller. Require fresh successful Genjy source gate in upcoming allocation service before enabling it. Cost if wrong: a future caller could allocate during a source outage unless it meets that contract.
- Final: Ruling: no full port-stream approval UI in this inventory milestone; default canonical IP lock remains conservative. Cost if wrong: approved streams need the later documented exception flow before use.
- Final: Ruling: dependency advisories are a public-release gate, not hidden by a green local build. Keep trial loopback/synthetic, upgrade and verify runtime before real/public deployment. Cost if wrong: published baseline could remain exposed to known advisories.
- Final: Ruling: no performance claim for large real workbooks without a representative dataset. Benchmark at live migration before claiming a faster update. Cost if wrong: larger inventory may require indexing/paging/source-scan optimization.
- Final: Ruling: reviewer inspected supplied browser/build evidence without running writes; root verified actual browser flows and production build. Cost if wrong: environment-specific browser issues need reproduction on the deployment target.

## Deferred minors

Reviewer không đưa Minor. Lint còn 4 cảnh báo hook có sẵn ở agent-pp; không sửa phần không liên quan trong mốc proxy. Dependency advisory là release gate quan trọng, không xem là Minor.

## Kiểm tra và phần tiếp theo

Lượt rà độc lập 3 Critical + 3 Important đã sửa bằng test RED→GREEN; bộ cuối 103/103, TypeScript/build qua. Không có dữ liệu thật hoặc deploy. Branch giữ để nối VM/reservation/install và business theo từng mốc.
