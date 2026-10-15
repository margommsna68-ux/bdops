# Bản thử Railway — 15/10/2026

**Đã chạy thành công:** https://bdops-proxy-trial-proxy-trial-20261015.up.railway.app. Anh có thể đăng nhập và test thực tế.

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

Deployment **`adbcc72e-53c3-473f-9587-ff30c5f2aa76`**, trạng thái **SUCCESS**, source chức năng commit **`4fb3764`**. Kiểm tra ngày 15/10/2026:

- 217 tests / 58 files, TypeScript và production build qua; runtime dependency audit 0 cảnh báo. Build còn 4 cảnh báo hook cũ ở agent-pp.
- 11 nhóm kiểm tra API trên host qua: chặn chưa đăng nhập/seed, đăng nhập chủ và giới hạn dự án, đủ 10 server/574 VM, Genjy trực tiếp, quyền viewer/operator, NEW→BLOCKED→replace viết tắt/kế thừa credentials/chặn trùng/chống bấm lặp, autofill chỉ tạo cấu hình chờ cài, hoàn tác và tạo backup.
- Genjy trực tiếp mất khoảng **4,1 giây** ở lượt đo, 721 IP trong nguồn hiện hành khớp snapshot gốc; 724 danh tính Genjy có bằng chứng lịch sử vẫn được giữ.
- QA dùng dự án/IP mẫu riêng, sau đó đóng login/membership QA. Chỉ một tài khoản đăng nhập và một membership thật còn hoạt động. Hash proxy/VM/phân bổ/replace thật không đổi trong QA.
- Đã mở trang `/dashboard` trên trình duyệt và thấy chuyển đúng sang màn đăng nhập HTTPS; phiên chủ đã được kiểm tra bằng API. Không tự giả nhận đã kiểm tra từng màn bằng trình duyệt.
- Backup **`93fa4645-3ed0-4c94-bd07-7a490077a86a`**, **35.130.091 bytes**, SHA-256 `f866ef4ac976768c9483351369264c281ff32034993eb4cdf3dfad1488f48c29`. Đã tải bản mã hóa ra máy và xác minh GCM/checksum. File nằm trong private-config cùng manifest, khóa lưu riêng trong cấu hình.
- Đã restore trên host vào database mới **`proxy_restore_host_1792044921142`**: đủ **39 bảng / 13.916 dòng** (gồm dữ liệu QA kín), mọi giá trị/quan hệ gốc khớp; giải mã được đủ **1.362 cặp credentials** của dự án thật. Database app đang chạy không bị ghi đè.
- Railway cũ được đối chiếu lại: **26 bảng / 1.120 dòng, 0 bảng thay đổi**. Sheet gốc không bị sửa. Cổng TCP tạm phục vụ import/đối chiếu đã đóng; app dùng mạng riêng Railway.

Bằng chứng chi tiết: [release Railway](../superpowers/evidence/2026-10-15-railway-trial.md).
