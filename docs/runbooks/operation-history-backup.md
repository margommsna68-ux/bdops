# Lịch sử và sao lưu — bản local

Trong Proxy → Lịch sử: chọn thao tác, đọc Trước/Sau, ghi lý do rồi Xác nhận hoàn tác. Chỉ quản lý ADMIN của dự án được hoàn tác. Dữ liệu đã sửa tiếp/gán VM sẽ bị chặn; thao tác cũ trước khi có ảnh trước không thể hoàn tác. Đây là hoàn tác từng thao tác còn nguyên dữ liệu sau, không phải stack Ctrl+Z: hoàn tác thao tác sau vẫn tăng revision, không tự cho phép quay lại một thao tác trước đó.

Nhập mới/nhận replace nhầm được thu hồi khỏi kho hiện hành, không xoá dấu vết IP. Cạnh replace VOID và RECEIVED còn để bắt hàng cũ; sở hữu Genjy/PC chung không đổi. Undo BLOCKED vô hiệu hoá event blocked đó, khôi phục ngày/trạng thái trước; không xác minh mạng thực tế. Thao tác ghi trên web không tự cài lại cấu hình máy. Gói mới tạo được disable khi undo; nếu kho thay đổi sau khi sửa gói thì từ chối undo.

Proxy → Thiết lập → Bản sao dự phòng: chủ hệ thống tạo bản sao mã hoá của toàn database ứng dụng. SYSTEM_OWNER_USER_ID cấu hình trên server, độc lập ADMIN dự án; không có API download dump. BACKUP_DIRECTORY absolute, BACKUP_ENCRYPTION_KEY riêng 64 hex, PG_DUMP_PATH/PG_RESTORE_PATH là binary PostgreSQL tương thích server. Không ghi secrets trong git/chat. Dùng custom pg_dump, không --clean/--create và không dump plaintext xuống ổ.

Khôi phục thử: tạo database trống local tên proxy_restore_*, cấu hình RESTORE_DATABASE_URL và BACKUP_ID trong phiên shell riêng rồi chạy `npx tsx scripts/restore-backup-trial.ts`. Guard chặn database app/test/remote, checksum + GCM được xác minh trước, pg_restore --single-transaction --exit-on-error. Script không ghi đè DB đang chạy. Có script `check-backup-trial.ts` chỉ cho localhost:55432/proxy_app_trial để chứng minh vòng sao lưu/khôi phục và giải mã credentials mẫu.

Giữ riêng ENCRYPTION_KEY của ứng dụng và BACKUP_ENCRYPTION_KEY; mất một trong hai không thể dùng dữ liệu credentials đã sao lưu. Backup cùng ổ chỉ giúp lỗi dữ liệu, không bảo vệ mất máy/ổ. Trước dùng thật trên Railway phải có storage độc lập, retention/monitoring và vòng restore trên môi trường host. Lịch tự động chưa bật. Nếu worker bị tắt giữa chừng, kỹ thuật kiểm tra tiến trình trước khi giải phóng `.creating-backup`; không xoá lock khi một đợt vẫn đang chạy.

Không restore một bản cũ lên hệ thống thật chỉ để sửa một thao tác: việc đó có thể mất thay đổi sau của nhân viên và lịch sử Genjy/nhận IP mới. Khi khôi phục sự cố toàn hệ thống cần lưu snapshot hiện tại nếu còn đọc được, đối chiếu/ghép những bằng chứng ownership/received mới hơn backup trước cutover.

Kiểm chứng 14/10/2026: 118 tests qua, production build qua; vòng real pg_dump/pg_restore có 35 bảng, credential mẫu giải mã được, app DB không đổi. Backup thử `22f5a201-77a6-4fe8-b057-9466c6b69fc2`, checksum `6d8e4bc8a3aa57f007880b883c5b7b2f0851bc7982ed3173e760a23381ab818e`. Browser nhập/undo mẫu 192.0.2.151 và tạo backup từ web đã thành công. Không nhập proxy thật.

## VM schema roundtrip — 14/10/2026

Encrypted backup 6703fb3b-b716-4a53-9cd6-b788b52d3f74 (205480 bytes, SHA256 c3354021241261c964aed6c51b7a833ee4e617f4d325042d9c653fdf0227fd9d) restored to separate empty local proxy_restore_1791983833257. Verified 37 table counts (AuditLog growth excluded) and encrypted proxy credential decryption. Original proxy_app_trial unchanged. Includes new VMConfiguration/VMProxyAllocation, journal/config pointers and all synthetic UI allocation/install history. Keys remain private local config; this does not validate production disaster recovery.

## Business schema roundtrip — 14/10/2026

Encrypted backup3deacbf2-63d3-43f5-97b6-7a5e22eba51d (231021bytes, SHA2564c23c47496192723c55efc5094c6ddf5c0dd0d352db44866a066e1c9e38e3196) restored to separate empty proxy_restore_1791989620293. Verified38table counts, proxy credential cipher and business history v3 decryption; active application database unchanged. Whole canonical accounts/work/finance/profit are included. Later sample work undo and viewer role QA do not imply real business operations.

Final reviewed-source roundtrip:backup92fdf4d7-16dc-41c6-aacb-8e99149e3f53,237167bytes,SHA256565da21207625fdacd5ad0b232bd9637be93532077b445d9288d5d1ee8e84853 → isolatedproxy_restore_1791991278902.38tables and proxy/business history decryption verified; active DB unchanged. Includes final sample source facts, operator/viewer trial identities and work undo history.
