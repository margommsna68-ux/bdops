# Host — chỉ đọc (20/10/2026)

- Commit 5f61827; backup trước deploy 29096b34 (41 MB); deploy f3819255 SUCCESS; không có migration.
- Ảnh chụp số liệu trước / sau deploy (`p20-host-look`, qua API chủ dự án, chỉ đọc): giống hệt (16 nhóm số: 10 server, 576 VM, 553 có proxy / 23 cần kiểm tra, 506 Chưa ghi / 70 Chưa nối, kho proxy 1261, ba lô nhập, nhãn gom PP, kho SDK 5).
- Xem bằng trình duyệt: cột "Tiền / Rút" hiện; host chưa có tài khoản EarnApp nào (576 VM "Chưa tài khoản"), nên mọi ô ghi "Chưa có EarnApp" và không có khung nào để mở. Lệnh POST duy nhất: user.verifyPin, user.heartbeat. Không lỗi trang.
- Không ghi dữ liệu thử trên host; các luồng đã sửa chưa có dữ liệu thật để chạy trên host.
