# Lịch sử và sao lưu — bản local

Trong Proxy → Lịch sử: chọn thao tác, đọc Trước/Sau, ghi lý do rồi Xác nhận hoàn tác. Chỉ quản lý ADMIN của dự án được hoàn tác. Dữ liệu đã sửa tiếp/gán VM sẽ bị chặn; thao tác cũ trước khi có ảnh trước không thể hoàn tác. Đây là hoàn tác từng thao tác còn nguyên dữ liệu sau, không phải stack Ctrl+Z: hoàn tác thao tác sau vẫn tăng revision, không tự cho phép quay lại một thao tác trước đó.

Nhập mới/nhận replace nhầm được thu hồi khỏi kho hiện hành, không xoá dấu vết IP. Cạnh replace VOID và RECEIVED còn để bắt hàng cũ; sở hữu Genjy/PC chung không đổi. Undo BLOCKED vô hiệu hoá event blocked đó, khôi phục ngày/trạng thái trước; không xác minh mạng thực tế. Thao tác ghi trên web không tự cài lại cấu hình máy. Gói mới tạo được disable khi undo; nếu kho thay đổi sau khi sửa gói thì từ chối undo.

Proxy → Thiết lập → Bản sao dự phòng: chủ hệ thống tạo bản sao mã hoá của toàn database ứng dụng. SYSTEM_OWNER_USER_ID cấu hình trên server, độc lập ADMIN dự án; không có API download dump. BACKUP_DIRECTORY absolute, BACKUP_ENCRYPTION_KEY riêng 64 hex, PG_DUMP_PATH/PG_RESTORE_PATH là binary PostgreSQL tương thích server. Không ghi secrets trong git/chat. Dùng custom pg_dump, không --clean/--create và không dump plaintext xuống ổ.

Khôi phục thử: tạo database trống local tên proxy_restore_*, cấu hình RESTORE_DATABASE_URL và BACKUP_ID trong phiên shell riêng rồi chạy `npx tsx scripts/restore-backup-trial.ts`. Guard chặn database app/test/remote, checksum + GCM được xác minh trước, pg_restore --single-transaction --exit-on-error. Script không ghi đè DB đang chạy. Có script `check-backup-trial.ts` chỉ cho localhost:55432/proxy_app_trial để chứng minh vòng sao lưu/khôi phục và giải mã credentials mẫu.

Giữ riêng ENCRYPTION_KEY của ứng dụng và BACKUP_ENCRYPTION_KEY; mất một trong hai không thể dùng dữ liệu credentials đã sao lưu. Backup cùng ổ chỉ giúp lỗi dữ liệu, không bảo vệ mất máy/ổ. Trước dùng thật trên Railway phải có storage độc lập, retention/monitoring và vòng restore trên môi trường host. Lịch tự động chưa bật. Nếu worker bị tắt giữa chừng, kỹ thuật kiểm tra tiến trình trước khi giải phóng `.creating-backup`; không xoá lock khi một đợt vẫn đang chạy.

Không restore một bản cũ lên hệ thống thật chỉ để sửa một thao tác: việc đó có thể mất thay đổi sau của nhân viên và lịch sử Genjy/nhận IP mới. Khi khôi phục sự cố toàn hệ thống cần lưu snapshot hiện tại nếu còn đọc được, đối chiếu/ghép những bằng chứng ownership/received mới hơn backup trước cutover.

Kiểm chứng 14/10/2026: 117 tests qua, production build qua; vòng real pg_dump/pg_restore có 35 bảng, credential mẫu giải mã được, app DB không đổi. Backup thử `22f5a201-77a6-4fe8-b057-9466c6b69fc2`, checksum `6d8e4bc8a3aa57f007880b883c5b7b2f0851bc7982ed3173e760a23381ab818e`. Browser nhập/undo mẫu 192.0.2.151 và tạo backup từ web đã thành công. Không nhập proxy thật.
