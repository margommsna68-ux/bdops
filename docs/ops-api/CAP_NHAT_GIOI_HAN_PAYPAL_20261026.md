# PayPal: tối đa 2 email mỗi ngày — dành cho AI vận hành

Áp dụng trên MoneyToHome, dự án được cấp quyền, qua web và API dùng chung. Hợp đồng OpenAPI 1.5.1. Không cần thay token hoặc launcher vì cập nhật này.

- Một mã PayPal chỉ dùng tối đa **2 email nhận khác nhau trong một ngày**, tính 00:00–24:00 theo giờ Việt Nam, bằng giờ máy chủ. Đổi ngày trong nội dung lệnh không đổi hạn mức.
- Trước khi chọn email, đọc gợi ý PayPal hiện hành. `daily` cho biết `used`, `reserved`, `remaining`, `limit`, `date`, `timeZone`. Mỗi email có `dailyAllowed` (được chọn) và `dailyOccupied` (đã dùng/đang giữ suất); đã chiếm suất không đồng nghĩa được phép gửi, nhất là yêu cầu cũ vượt hạn mức.
- Chỉ chuẩn bị đã giữ suất để AI khác không lấy quá 2 email. Hủy yêu cầu chưa gửi trả suất. Đã gửi hoặc chưa xác định kết quả thì giữ dấu sử dụng trong ngày, kể cả sau đó thất bại, hủy hoặc hoàn tác. Email của yêu cầu đang chuẩn bị/chưa rõ kết quả tiếp tục được giữ qua ngày cho tới khi xử lý xong.
- Gửi lại cùng lệnh/key không thêm suất. Giữ nguyên quy tắc một yêu cầu rút cho mỗi EarnApp; không tạo yêu cầu mới để né giới hạn.
- API trả `409 PAYPAL_DAILY_LIMIT` khi hết suất. Với yêu cầu mới chưa gắn email, chọn PayPal khác còn suất. Nếu EarnApp đã gắn email, giữ nguyên liên kết, báo chờ; không tự đổi email hay tài khoản trên VM.
- Lệnh có kết quả chưa xác định phải được gửi lại bằng **đúng key và nội dung cũ**. Không đổi key chỉ vì bị giới hạn hay từ chối ở lần thử lại.
- Chỉ đánh dấu đã gửi sau khi có bằng chứng trên EarnApp. Tiền thực nhận vẫn ghi riêng sau khi xác minh PayPal đã nhận; hạn mức này không chặn việc đối chiếu tiền về.

Ví dụ: PP-TU32 có 5 email; hôm nay email 1 và 2 đã dùng/đang giữ thì email 3–5 chưa được dùng cho một lệnh rút mới trong ngày. Các email vẫn ở kho, không bị đánh dấu đã dùng chỉ vì hết hạn mức.
