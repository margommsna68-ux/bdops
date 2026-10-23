# VM table: seven rows and explicit money heading

Owner request: expand the VM table from about five visible rows to seven; rename Tiền VM to TIỀN TRONG VM.

Code: 465256b. The viewport measures the first seven rendered rows plus header and scrollbar, retains available-height growth, and recalculates through ResizeObserver when content/layout changes. Small screens can scroll the page; text and row styling stay unchanged. Column key payout and saved layouts retained. No business logic/database changes.

Checks: tsc clean; lint on all three changed files clean; 21/21 related grid/filter/SDK UI tests pass. Local Chrome browser checks at 1280x800, 1280x720, 390x844: seven rows fit inside the table scroll area, heading matches, no page JS errors. Screenshot uses synthetic local data only. Production build passed with existing warnings in unrelated files.

Backup: moneytohome-20261023-231213.dump, encrypted offsite copy on moon-01 verified. Deployment result is recorded separately after Windows administrator confirmation.

Deploy succeeded 23:16:43 Bangkok, build PQRxLyWlfHd0ShwXbZIRt. Public and localhost build manifests both HTTP 200. Windows approval was reopened visibly after the first launch was cancelled. No host business data was written. Host UI not rechecked through an authenticated browser; local UI was measured as documented above.
