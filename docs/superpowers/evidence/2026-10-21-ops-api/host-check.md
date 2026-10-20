# Host (Railway trial) — 21/10/2026

- Backup trước deploy: 5bddfbcd-7f9d-4645-842f-76f796a39792 (41 096 766 byte). Ảnh chụp số liệu trước: `.runtime/p20-host-before43.json` (local, không đưa lên).
- Deploy commit 1cca9fc: **chưa chạy được** — `railway up` hai lần đều trả "Deploys have been paused temporarily" (Railway tạm dừng deploy);
  không có deployment mới, host vẫn chạy 28b250e7, migration 20261021090000_ops_api chưa áp dụng, `/api/ops/v1/health` = 404 trên host.
- Chỉ xem: tài khoản "AI vận hành" (@ai-ops) = USER, có "Được truy cập Proxy / Server / VM", **không** có "Ghi kiểm tra tiền EarnApp"; hai quyền mới
  chưa tồn tại trên host. Mở hộp Quyền nhân viên rồi đóng, không lưu (chỉ `user.verifyPin`, `user.heartbeat`).
- Chưa tạo token, chưa cấp quyền, chưa ghi tiền / giữ email trên host.

Còn phải làm khi Railway mở lại: deploy, đợi SUCCESS (migration chạy ở pre-deploy), so số liệu trước / sau, `GET /health` gửi kèm
X-Forwarded-For giả để xác nhận verifiedIp là IP thật (OPS_TRUSTED_PROXY_HOPS=1), xem mục Token API vận hành trong Thiết lập (không tạo token).
