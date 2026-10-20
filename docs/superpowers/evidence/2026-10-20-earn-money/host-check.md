# Host check — 20/10/2026 (chỉ đọc)

- Backup trước: 5bcf8d20-b24f-419e-a411-ca6f249582da (41 092 870 byte).
- Deploy: 66f4c1ba-bd01-4a17-9b0e-09cbb270e8c0 SUCCESS (commit 563c642); migration 20261020200000_earn_balance_checks (chỉ thêm) chạy ở pre-deploy.
- Ảnh chụp chỉ đọc trước / sau (`p20-host-look`): giống hệt nhau. 10 server / 576 VM, 553 Có proxy + 23 Cần kiểm tra, 5 SDK, 3 lô nhập, 6 PP "Đang gom" $0,00.
- Xem trên trình duyệt (không bấm lưu): cột "Tiền / Rút" hiện; host chưa có tài khoản EarnApp nên mọi ô là "Chưa có EarnApp"; dải tóm tắt "— (0 VM)", "$0,00", "0 VM"; lọc / sắp giữ trong URL.
- Request ghi duy nhất trong lúc xem: user.verifyPin, user.heartbeat. Không ghi dữ liệu thử lên host.
