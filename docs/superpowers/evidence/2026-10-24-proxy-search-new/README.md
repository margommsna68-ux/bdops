# Proxy search and NEW consistency — 24 October 2026

Owner reported that pasting a complete IP:port:user:pass found nothing and that NEW included moon05/VM_078 in use.

Findings: registry search compared raw text against IP/package/location strings, not IP+port. Registry state/filter/counts used stored inventoryState even when active allocation evidence contradicted NEW. Read-only live audit found 12 NEW endpoints, three with DESIRED holds on moon05/VM_078, VM_079 and VM_080. Existing allocation/copy pools already refuse held proxies; this was a stale classification and listing/counting defect.

Changes in b9773eb:
- Shared search normalization extracts IP:port from pasted endpoints. UI strips credentials before search state, URL or request; URL serialization/read and backend matching use the same rule. Full endpoint searches match exact IP and port, not credentials; ordinary IP/package/server/VM text search stays.
- Before counts/filter/sort/pagination/copy, stale NEW with an active or legacy VM position is represented as LIVE; NEW with UNCERTAIN holds only is represented as QUARANTINED. Explicit BLOCKED/historical states stay intact. Reads do not mutate data or claim real machine installation.
- Corrected the exact three live NEW labels through existing createProxyEditService syncStates, journal cmvltd7h2000ak1wiut17s5v9. Preview was restricted to the previously inspected three endpoint IDs. NEW -> LIVE only, no proxy/credential/location/configuration/status-on-VM edits. Readback: 9 NEW, zero with positions.

Verification: integration reproduction first failed expected search result 1 versus actual 0, then passed; tests cover exact port mismatch, assigned NEW, uncertain NEW, BLOCKED preserved and URL credential removal. Six related suites: 25/25. Types pass, lint no errors (existing RegistryTable hook warning). Local real Chrome checks full input, outgoing requests/URL without credentials, NEW without held rows, no JS errors. Initial browser attempts corrected a hydration timing assumption and a hardcoded test port; successful run reads actual fixture port. Synthetic credentials/screenshots only; no video. Production build passed.

Backup before repair/release: moneytohome-20261024-100217.dump, encrypted/decryption-verified on moon-01. No migration. Release verification recorded alongside this file.

Released 10:04:53 Bangkok, build V_e9ghSk_xrI2LJgIEsFG; public/localhost manifests 200. Read-only live query via checked queryRegistry: example endpoint matches1; NEW9, no held rows. Rollback app-before-proxy-search-20261024. Authenticated host browser was not separately used; real browser checks were local synthetic data. No credentials from the user's pasted example stored in evidence.
