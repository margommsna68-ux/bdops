# PayPal — hai email nhận mỗi ngày (26/10/2026)

## Quy tắc

Chủ yêu cầu mỗi mã PP chỉ được dùng tối đa hai email khác nhau một ngày để rút EarnApp. Ngày Việt Nam, giờ máy chủ. Chuẩn bị giữ suất; hủy chuẩn bị chưa gửi trả suất. SENT/UNKNOWN lưu dấu theo ngày, không mất dấu do hủy/thất bại/hoàn tác; cùng key/email không chiếm thêm. Yêu cầu chuẩn bị/chưa rõ đang mở giữ chỗ qua ngày. Email cố định của EarnApp không tự thay. Tiền thực nhận vẫn đối chiếu riêng.

Backend chung kiểm trong giao dịch có khóa dự án cho web, hàng loạt và API. API bổ sung `PAYPAL_DAILY_LIMIT`/409, `daily`, `dailyAllowed`, `dailyOccupied`; OpenAPI 1.5.1. Bảng mới PayPalPayoutDayEmail; hai migration thêm dữ liệu lịch sử, không sửa sổ tiền.

## Kiểm chứng

- Bảy ca lõi đỏ trước sửa, xanh sau: email thứ ba; tranh suất cuối; hủy chuẩn bị và giữ suất đã gửi/chưa rõ; qua ngày và giả ngày; giữ chỗ qua đêm; email đã gắn hết suất; gửi lại hôm sau.
- 33 ca backend liên quan đạt, gồm HTTP API thật, đối chiếu schema, hoàn tác, dữ liệu lịch sử và ba giữ chỗ cũ. Hai test cũ được đổi thời điểm sang ngày tiếp theo vì kịch bản cũ dùng ba email cùng ngày; giữ nguyên khẳng định sổ tiền và tranh chấp.
- Toàn bộ 212 file / 1.274 test đạt trước chỉnh cuối giao diện. Sau đó thêm bảy ca nháp cũ; nhóm UI cuối 41/41 đạt. Typecheck, lint các file đổi và production build đạt; build có cảnh báo cũ ở agent-pp, RegistryTable, TotpSetup.
- Người kiểm độc lập phát hiện và đã xác nhận sửa: hoàn tác hủy chuẩn bị mở lại suất thứ ba; lịch sử UNKNOWN retry bị bỏ sót; nháp chưa gửi nhưng VM đổi phiên bản vẫn chiếm suất cục bộ. Không còn phát hiện bắt buộc sửa trong lượt cuối (review source, không phải lần chạy test riêng).
- Chrome thật, bản production local, dữ liệu giả: 12/12 phép kiểm. Ba VM chọn cùng PP: email thứ ba bị vô hiệu hóa, chỉ hai yêu cầu được chuẩn bị, số tiền nháp thứ ba còn nguyên. Mở lại nhận hạn mức 2/2 từ server và khóa Lưu. Màn 390px không tràn, không lỗi JavaScript. Đọc DB: hai yêu cầu PREPARING, hai email giữ, không có dấu gửi và không giao dịch tài chính.
- Lần trình duyệt đầu mở sai dự án mặc định nên không tìm thấy dòng thử; đã đặt đúng dự án thử rồi chạy sạch. Không sửa sản phẩm theo lỗi kịch bản này.

## Phạm vi và giới hạn

Chỉ dữ liệu giả được tạo yêu cầu trong quá trình kiểm. Không rút tiền thật, không ghi khoản nhận thật, không thao tác VM/GEN2/Sheet. Kiểm nhiều người đồng thời và qua nửa đêm bằng test tích hợp, không đợi nửa đêm trên trình duyệt. Không chụp lại cả bốn theme; thành phần dùng màu/nguyên tắc theme hiện có. Phát hành và kiểm host ghi riêng trong release.md khi hoàn tất.
