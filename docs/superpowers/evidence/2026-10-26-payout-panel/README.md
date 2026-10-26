# Rút EarnAp: một khung thao tác — 26/10/2026

Chủ yêu cầu sửa thiết kế rườm rà khi bấm Chi tiết/Thu gọn. Bỏ các hàng bung và hai lớp toggle; bấm dòng hoặc mã VM mở khung bên phải, điện thoại toàn màn hình. Số tiền/PP/email/status/receipt cùng một nơi. Trạng thái editor hiện trực tiếp; khoản nhận dùng luồng VM hiện có. Bảng giữ vị trí; Esc/X/Đóng trả focus; nếu dòng rời bộ lọc, trả focus về tiêu đề. URL/bộ lọc, quyền, 30s refresh và journal retry cũ giữ nguyên. Các màu lấy token bốn theme. Không migration/backend nghiệp vụ mới.

Code worktree 1f59d78; tích hợp source chính 547d3db. Build xqD9Fd3nBP_rKzZQ6bLtP, deploy 20:17:20 Bangkok 26/10. Sao lưu moneytohome-20261026-201638.dump; bản mã hoá ở moon-01 kiểm giải mã thành công, SHA256 23a6496b8eea8ea2660f8d41dabe5d20be2eec307ff9c2429fae28c2c9134a70. Rollback D:/MoneyToHome/app-before-payout-panel-20261026. Script D:/MoneyToHome/tools/deploy-payout-panel.ps1. Chỉ restart Web.

## Kiểm
- 24 focused tests (report service10, UI8, status action6), typecheck/lint/production build đạt. Ba kỳ vọng UI mới đỏ trên bản cũ, xanh sau sửa. Không chạy lại full suite.
- 44 assertions trên Chrome local, dữ liệu giả riêng: panel không thêm hàng; keyboard trap/Esc/focus; bốn theme thật qua Settings; desktop1280/phone390; ghi SENT trên đúng một request giả, tải lại vẫn đúng; không tạo request mới; lý do thất bại bắt buộc; 30s refresh giữ nháp và panel; receipt transaction hiện; không JS errors.
- Review độc lập phát hiện opener bị tháo khỏi DOM khi dòng rời filter; đã sửa và thêm test. Không còn finding sau review.
- Lượt kiểm đầu phát hiện CSS dialog chung giới hạn chiều rộng/margin điện thoại; override chỉ trên panel này. Kịch bản trước đó đo trước khi animation/focus trả về hoàn tất; bỏ animation và đợi focus thực tế, không coi lượt thất bại là pass.
- Script đọc DB sau browser đọc dữ liệu nhưng lỗi khi ghi file evidence vào thư mục chưa tạo; không dùng lượt này làm bằng chứng DB readback. Xác nhận lưu bằng browser reload và test tích hợp; fixture riêng đã dọn. Local server3037 đã dừng.
- Host chỉ đọc: public manifest chính xác200, localhealth200, ba dịch vụ Running, ba file source live khớp. Before/after hash bằng nhau b9b540d6c7c91fa8a56f4065dbea8a12a1499a1f721e48c339123a1864950576:4requests/678VM/149logins/1465proxy/4batches/4costs/0funds. Không claim kiểm UI đăng nhập trên host.
- Không sửa dữ liệu tài chính/VM/GEN2/Apple/Sheets/token. Các file fleet đang làm dở được giữ nguyên; build tách từ e5d7542, không mang migration fleet chưa xong.
