# EarnApp → PayPal trên dashboard

Chủ đã duyệt bốn số ngay dưới tổng quan Điều hành gọn: Đã gửi hôm nay, Đang chờ về, PayPal nhận hôm nay, Cần xử lý. Bấm mở đúng báo cáo rút, giữ server đang xem. Đây là phần đọc; không tạo/chuyển trạng thái yêu cầu hoặc ghi tiền thật.

- Dùng chung projection của báo cáo rút. Đã gửi theo submittedAt, thực nhận theo ngày khoản thu đã xác nhận; ngày Việt Nam. Khoản chờ và cần xử lý gồm mọi ngày. Không cộng USD và USDT hay lấy yêu cầu thay thực nhận.
- Dashboard và báo cáo dùng cùng bộ chọn và tổng. Liên kết ngày có dạng YYYY-MM-DD cố định lúc đọc. Báo cáo nhận trong ngày có tổng và từng dòng chỉ tính ngày đó; chi tiết vẫn giữ cả lịch sử.
- Giữ quyền requestMoney, project/server scope; thiếu quyền không truy vấn dữ liệu tiền, lỗi không hiện số cache.
- Một khung bốn cột trên máy tính, hai cột trên điện thoại. Dùng font, nền, viền và màu ngữ nghĩa của bốn theme hiện tại; nhấn màu ở thực nhận và cần xử lý, không thêm bảng màu riêng.
- Kiểm backend ngày biên/nhận từng phần/nhiều đồng tiền/khác lượt/phân trang/quyền. Kiểm UI liên kết, error/loading, chọn server, theme thật và điện thoại. Backup sát lúc deploy, triển khai từ worktree riêng, đọc lại host; không đưa thay đổi fleet đang dở vào bản này.
