# Proxy toolbar cleanup — 23 October 2026

Owner reported the standalone “Chỉ BLOCKED” button and scattered controls were visually clumsy. Code 9ff2bf0, UI only.

- One action row: Nhập mới, Báo BLOCKED, Nhận replace, and one Copy dropdown. Copy entries clearly distinguish all filtered pages from BLOCKED in the selection / filtered result. Existing copy services and permissions unchanged.
- BLOCKED is a compact toggle beside search, with count, pressed state and soft red styling. It changes only the status filter and preserves the selected sort.
- One labelled grid for package, server, group, status and sort. Removed duplicated group chips; their counts are now in the group selector. Search no longer shrinks below usability. Bỏ lọc clears filter conditions while retaining view and sort.
- Desktop five-column filters; narrower layouts use three or two columns. Scoped styles preserve other inventory and VM toolbars, existing themes and bulk selection bar.

Verification:
- 31/31 related tests across six registry/package/URL/copy/UI files; typecheck passed; lint has no errors and the existing reset dependency warning.
- Local Chrome, synthetic existing test data: 17 checks covering BLOCKED sorting/filter, package counts, reload/Back, preserving sort, Copy scope with and without selection, desktop control bounds, four themes actually selected in Settings, 390px controls/menu bounds, no JavaScript errors. Browser script and result included; no video.
- First extended run stopped at an incorrect test click on the offscreen mobile sidebar. Removed that click; reran successfully. Menu screenshots wait for the opening transition. No production data used in screenshots.
- Production build passed. Backup moneytohome-20261023-233817.dump (39,357,916 bytes), encrypted moon-01 copy and decryption verified.
- Deployed at 23:39:27 Bangkok without UAC using scoped service control; build ZgPtObsovZuEKsN0Fy8BY. Public and localhost build manifests return 200. No migration or business-data writes. Rollback app-before-proxy-toolbar-20261023 retained.
- Authenticated host UI was not separately exercised; interaction and appearance checks used local data, public release was verified by build manifest.
