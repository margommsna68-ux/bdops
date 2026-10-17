# Kho tài khoản: evidence (17/10/2026)

Brief: account inventory and the EarnApp account per VM (see `docs/runbooks/account-store.md`). No video was recorded, per the
owner's decision; screenshots only.

## Local (PROXY_TRIAL)

The run used a new test server and synthetic `@example.invalid` accounts.

- Script `scratchpad/pw/accounts-accept.js`: 14/14 pass. Result in `2026-10-17-account-store/local-result.txt`.
- **Import:**
  - Gmail list of 6 lines: 3 valid, 3 errors (a bad email and a repeated account reported on both lines). Total paid
    125000 VND at 25000 VND/USDT recorded once (5 USDT).
  - The box keeps only the error lines. A fix in the same batch adds no cost; re-importing the list gives 0 valid, 4 existing,
    and the cost count is unchanged.
  - Apple ID batch without price shows *Chưa ghi chi phí*. PayPal list `Mã PP | Email` of 7 lines: 5 valid, 2 errors (a repeated
    code).
- **Assign:**
  - Cell popover saves login + PayPal together; *Lưu* is disabled when nothing changed. The same link through the API returns
    "Không thay đổi" and adds no history.
  - Selected 3 VMs → *Gán tài khoản* (Apple ID + PayPal) assigns the oldest NEW accounts first.
  - Dán bảng → *Tài khoản + PP*: a repeated VM is an error on both lines and an unknown VM is reported; the valid line is saved,
    and the account from a refused line stays NEW.
- **Conflicts:**
  - A login or PayPal held on another VM is refused with "đang giữ cho ac-xxxx / VM_001" / "đang nhận cho … (ac-xxxx / VM_001)".
  - Two parallel saves on one VM: 1 APPLIED, 1 "VM vừa được người khác thay đổi".
- **Stock and costs:**
  - The stock shows Đã gán with a link that opens the VM's account tab.
  - Unassigning moves the login and PayPal to *Đã dùng · chưa gán*, never NEW.
  - The cost count is unchanged by assignment and unassignment.
  - Filters persist in the URL after reload.
- **Work page:** purpose is stated, Sheet rows are separated, and no task was created by importing or assigning.
- **Bugs found and fixed in this check:**
  - The account popover re-rendered endlessly (React error #185).
  - With a server chosen, a pasted list that included the Server column had the server added twice.
- **Automated tests:**
  - 333 tests in 80 files. The known flaky `registry-copy` test failed once in the full run and passed 3/3 alone.
  - New suites: `account-store.integration.test.ts` (6) and `account-parse.test.ts` (3).
  - Types, lint (0 errors, 4 old warnings) and build pass.

## Host (moneytohome.up.railway.app, mooon)

- Commit `57f4bae`, backup `5034ed1d-5f99-4132-91ab-1fa0466d6fb1` taken before, deploy `f2298e2c-46b7-417b-96eb-f3fb383f3966`
  SUCCESS. The pre-deploy step applied migration `20261017120000_account_inventory`.
- Verify: 10 servers / 576 VMs.
- The account stock is empty: 0 Gmail / Apple ID, 0 PayPal, 0 batches, 0 review rows. No old link conflicts the new rules.
- Work items: 24 rows, all moved to *Đối chiếu Sheet cũ*; status and notes unchanged.
- Previews only (nothing written):
  - The owner's format example `tut-09 | pp09@example.invalid` repeated twice is reported as a repeat on both lines.
  - A paste line for moon05/VM_001 with an unknown account answers "chưa có trong Kho tài khoản".
  - The stock is unchanged afterwards.
- Browser (read-only): the Kho page, the moon05/VM_001 account popover (Escape, no save) and Giao việc. POST requests were only
  PIN unlock and heartbeat. Screenshots `host-h1-kho.png`, `host-h2-cell.png`, `host-h3-work.png`.
