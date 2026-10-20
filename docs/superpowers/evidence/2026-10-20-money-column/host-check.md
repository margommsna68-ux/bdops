# Host — chỉ xem (20/10/2026, sau deploy 887756ba)

- Trước deploy: backup 7c13d9f7. Số liệu host trước / sau (`p20-host-before40` / `after40`, 16 mục): giống hệt.
- Trình duyệt mới (chưa có cấu hình cột lưu), 1274 px, sidebar mở 256 px, tất cả server: Server 329–425 | VM 425–543 | Tình trạng 543–667 | **Tiền / Rút 667–887** (trước sửa: 1473 px, ngoài màn hình).
- 1280 px, một server: VM 329–447 | Tình trạng 447–571 | **Tiền / Rút 571–791**.
- Dòng tổng hợp: "Chưa VM nào trong bộ lọc có tài khoản EarnApp (576 VM chưa gán tài khoản)." (trước: "Chưa có dữ liệu: 0 VM").
- Ô Tiền / Rút trang đầu: 100 × "Chưa gán tài khoản". Bấm một ô mở bộ chọn tài khoản của VM, đóng lại không lưu.
- Mép cột: lúc đầu không có đường mép trái; cuộn ngang / dọc giữ tiêu đề và cột cố định.
- tRPC POST: chỉ `user.verifyPin`, `user.heartbeat`. Không lỗi JS. Không gán tài khoản, không ghi tiền.
- Không kiểm: cấu hình cột đã lưu trong trình duyệt thật của chủ dự án (được chuyển một lần khi mở trang nếu còn đúng thứ tự mặc định cũ). Ảnh host không đưa vào repo (có IP proxy thật).
