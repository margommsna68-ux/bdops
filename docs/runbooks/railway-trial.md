# Bản thử Railway — 15/10/2026

**Địa chỉ:** https://bdops-proxy-trial-proxy-trial-20261015.up.railway.app. Chỉ coi sẵn sàng khi phần kết quả cuối tài liệu ghi triển khai thành công.

## Tài khoản và dữ liệu

Tài khoản chủ: `tuntun`. Mật khẩu/PIN riêng tại `C:\Users\TUNTUN\Desktop\project web new\private-config\railway-trial-2026-10-15\owner-access.json`. Đổi mật khẩu/PIN trong Cài đặt trước khi giao nhân viên. Tạo tài khoản nhân viên riêng và cấp đúng dự án; không chia sẻ tài khoản chủ.

Chỉ **Proxy cá nhân — Sheet 15/10** được mở trên host. Login demo bị vô hiệu hóa; dữ liệu mẫu được giữ kín để bảo toàn lịch sử. Dữ liệu chính là snapshot 15/10; web chưa tự đọc các chỉnh sửa VM sau đó từ Sheet và không ghi ngược Sheet.

Genjy đọc **trực tiếp, chỉ đọc**, toàn bộ workbook Google `1_PQ7ZjCHl6wNzbRMdbFJsgF8hDjLRbMZPRyy3DyDve8`, gồm tab ẩn/notes/formulas. Bấm **Cập nhật** để quét. Genjy đã biết được giữ vĩnh viễn kể cả nguồn bỏ IP; lỗi nguồn chặn cấp proxy. Nếu tắt chia sẻ link, cần cấu hình Google chỉ đọc bằng tài khoản riêng.

## Anh test theo 5 việc

1. **Quản lý proxy**: tìm IP anh biết; xem gói, sở hữu, server/VM và lịch sử. Genjy/PC chung phải hiện riêng.
2. **Báo BLOCKED**: dán IP hoặc full proxy → xem trước → lưu. Copy danh sách gửi nhà cung cấp có gói, full proxy, BLOCKED.
3. **Nhận replace**: Removed ô trên, Added ô dưới, cùng thứ tự. IP viết tắt lấy port/user/pass từ IP cũ cùng cặp; full proxy giữ đầy đủ. Xem trước phát hiện hàng có trong kho/lịch sử/Genjy trước khi lưu.
4. **Server/VM**: giao NEW đủ điều kiện vào chỗ trống thật sự. Cài thật rồi mới xác nhận. Hiện snapshot không có ô trống/NEW đủ điều kiện; không lấy các dòng chưa rõ để lấp.
5. **Lịch sử**: xem và hoàn tác thao tác chưa có thay đổi phụ thuộc. **Sao lưu** tạo bản mã hóa toàn hệ thống, không phải nút ghi đè khôi phục.

Bản thử chứa dữ liệu thật: lưu làm thay đổi database thử, không tự đổi Sheet hoặc máy VM. Không dán các list ví dụ cũ vào dự án thật để thử.

## Định danh triển khai

| Thành phần | Giá trị |
|---|---|
| Project | ingenious-curiosity / `5b92b205-94ed-4407-9b2b-ef3b6575af54` |
| Environment riêng | proxy-trial-20261015 / `89cf3b0a-e19e-42c0-a789-cb884e3ee624` |
| Web mới | bdops-proxy-trial / `7de07016-cac4-4292-a5d0-5f2f3a2e919e` |
| Postgres mới | Postgres-FNbm / `eb39bf26-de22-4a86-bc0c-ad2d824a8b61` |
| Volume backup | `d1ec71d7-fce5-44f8-b7b0-707dca84466d`, mount `/data` |
| Bản cũ | production / bdops / Postgres gốc — giữ nguyên |

Dockerfile dùng Node 22 và PostgreSQL client. Pre-deploy `npx prisma migrate deploy`; start `npm start`, PORT 3000, healthcheck `/api/auth/providers`; region Singapore. Các setting đã đọc lại từ environment patch, không chỉ dựa vào TOML. Không chạy db push/reset/seed lên host. Gói upload chỉ chứa source đã commit; loại .env/.runtime/khóa/archive khỏi upload và image.

## Backup và khôi phục

Khóa ứng dụng và khóa backup riêng trong thư mục private-config nêu trên, ACL chỉ user Windows hiện tại. Không đổi/mất `ENCRYPTION_KEY` hoặc `BACKUP_ENCRYPTION_KEY`. Backup `/data/backups` sống qua lần deploy; bản tải mã hóa về máy là bản ngoài host. Lịch tự động/retention chưa bật, cần làm trước vận hành chính thức lâu dài.

Hoàn tác từng thao tác dùng **Lịch sử**. Khôi phục toàn bộ cần kỹ thuật xác minh checksum/GCM, restore vào database mới trống và so dữ liệu trước khi anh duyệt chuyển kết nối. Không restore đè database đang chạy. Rollback source cần kiểm tra tương thích schema và giữ khóa mã hóa.

Backup local trước lên host: `4c0614fc-7611-47e5-b68f-84a755b974c8`. Local và Railway production cũ được giữ.

## Kết quả kiểm chứng

Đang triển khai và kiểm chứng trên host. Sẽ ghi kết quả API/UI, deployment ID, backup/restore vào đây khi hoàn tất.
