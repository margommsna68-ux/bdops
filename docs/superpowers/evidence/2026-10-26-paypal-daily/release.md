# Phát hành 26/10/2026, 10:49:58 Bangkok

- Code: `2000511`; build `U25qgGa1rUXbla_FYjQtz`, https://wow.lalamail.sbs.
- Backup trước deploy: `moneytohome-20261026-104732.dump`, bản mã hóa moon-01 `moneytohome-20261026-104732.mthbk` đã kiểm hash và giải mã.
- Hai migration `20261026110000_paypal_daily_emails` / `20261026110100_paypal_daily_retry_evidence` chạy thành công. Host đủ 43 migration, up to date.
- Triển khai bằng `D:/MoneyToHome/tools/deploy-paypal-daily.ps1`, không yêu cầu UAC mới. Bản quay lại: `D:/MoneyToHome/app-before-paypal-daily-20261026`.
- Public manifest đúng build trả 200; Web, Postgres, Tunnel đều Running. Mã quota trên host khớp source sau chuẩn hóa CRLF/LF (Git archive dùng LF, working tree Windows dùng CRLF); không khẳng định hash byte của hai file khác line ending bằng nhau.
- Snapshot chỉ đọc trước/sau giống hệt: 678 VM, 149 tài khoản, 1.465 proxy, 4 lô, 4 khoản chi, 0 yêu cầu rút, 0 giao dịch PP. Hash `509b63d811b87135555dca5e684d631ebab99caffb7b6ac686b6342ee282039b`.
- Host chưa có yêu cầu rút thật nên không thử ghi để lấp dữ liệu. Nghiệm thu nghiệp vụ trên DB thử và Chrome local như README; không tuyên bố đã kiểm thao tác rút thật hoặc phiên đăng nhập host.
- Central moon-01, hostname kiểm `WIN-6CA4QAGDD2F`: đã đặt `CAP_NHAT_GIOI_HAN_PAYPAL_20261026.md` và `openapi-paypal-1.5.1.json` trong `C:/Users/Administrator/Desktop/MoneyToHome`, đọc lại SHA-256 khớp. Không thay token, launcher, cấu hình hoặc lệnh chạy của AI.

Quay lại ứng dụng nếu cần: dừng riêng MoneyToHome-Web, giữ Tunnel/Postgres, đổi hai thư mục release theo runbook rồi khởi động Web. Hai migration thêm bảng/backfill có thể giữ; không xóa bảng quota hoặc khôi phục database chỉ để quay lại giao diện. Bản cũ không thực thi giới hạn mới nên chỉ rollback khi cần xử lý sự cố.
