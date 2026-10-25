# Check Apple ID trên MoneyToHome

## Người dùng
Mở Kho tài khoản → Apple ID. Cột **Tình trạng acc** hiện kết quả kiểm tra và thời gian. Có thể bấm check từng dòng hoặc chọn tối đa **5 account** rồi bấm **Check Apple ID** ở thanh thao tác. Worker xử lý lần lượt, không mở 5 trình duyệt đồng thời. Chọn quá 5 phải giảm lựa chọn, không âm thầm bỏ bớt dòng. Đang chạy không tạo thêm lần đăng nhập. Worker ngoại tuyến hoặc thiếu desktop thì việc chờ trên web. Có thể mở lịch sử và huỷ việc.

- **Apple Locked:** web ngừng cấp mới tài khoản qua cả UI và AI. Tài khoản/EarnApp/VM đã liên kết giữ nguyên, không tự thay. Chủ xử lý đổi với nhà cung cấp hoặc xoá theo luồng kho.
- **Live · yêu cầu 2FA:** sau khi gửi mật khẩu, trang Apple hiện ô nhập mã xác thực. Theo quy ước của chủ, đây là Live; worker dừng tại đó, không lấy/nhập mã. Không đồng nghĩa hoàn tất đăng nhập hay dùng được EarnApp. Kết quả này không tự mở lại account Locked.
- **Cần xác minh:** CAPTCHA hoặc yêu cầu xác minh trước bước gửi mật khẩu. Không tính Live, không tự lấy mã từ các link SMS/2FA.
- **Đăng nhập Apple thành công:** chỉ khi worker xác nhận phiên Apple đúng email; không chứng minh dùng được trên EarnApp.
- **Sai mật khẩu:** Apple từ chối thông tin đăng nhập; kiểm lại email/mật khẩu trong kho, không thử liên tục.
- **Không kiểm tra được / Chưa rõ kết quả:** lỗi kỹ thuật không đổi tình trạng tài khoản thành Locked.
- **Cần kiểm tra lại:** tài khoản đã thay phiên bản; kết quả cũ chỉ là lịch sử. Sửa thông tin không tự mở lại tài khoản Locked.

Mỗi tài khoản đã bắt đầu đăng nhập phải nghỉ ít nhất 15 phút trước khi check lần nữa. Không có Check All. Không có thao tác VM hay rút tiền trong tính năng này.

## ADMIN
Trong Kho tài khoản mở **Cấu hình Check Apple ID**. Chọn tên worker và nhóm proxy cho phép kiểm tra. TUT chỉ dùng proxy SELF, NEW chưa gán, không có giữ chỗ/lịch sử xung đột; không dùng proxy đang trên VM, BLOCKED/đã replace hoặc của nhóm khác. Custom group phải chứa proxy SELF đủ điều kiện. Không có proxy thì việc giữ trong hàng chờ.

Lưu cấu hình phát token worker chỉ hiển thị một lần. Token này chỉ dùng các lệnh Check Apple ID, không phải token vận hành AI và không mở quyền ADMIN chung. Chuyển token vào file riêng của worker bằng kênh riêng; không gửi chat, không lưu vào bảng. Đổi token khi không còn phiên đang giữ tài nguyên. Tắt worker ngừng nhận việc/lấy bí mật, huỷ việc chưa nhận; việc đã chạy vẫn phải dọn phiên và báo kết quả.

Kết quả đăng nhập và dọn phiên là hai phần riêng. Dọn thất bại tạm ngừng worker; xem runbook worker để khôi phục đúng profile. Không tạo lần check mới để giải quyết việc chưa rõ kết quả.

## Kiến trúc / hợp đồng
- `src/server/apple-check/service.ts`: giao dịch quyền, hàng chờ, checkpoint, proxy lease, kết quả và audit.
- `appleCheck` tRPC: overview/configure/request/cancel/disable. Theo phiên PIN/2FA hiện hành và quyền dự án. ADMIN/MODERATOR không giới hạn server được yêu cầu check; người được giới hạn server chỉ đọc kết quả tài khoản thuộc server mình, không đọc kho chung.
- POST `/api/apple-check/v1/{heartbeat|claim|route|submit|heartbeat-job|result|cleanup-recovered}`: Bearer riêng, JSON `{ok,data,error}`, no-store, giới hạn tần suất/body. Chỉ lease hiện hành lấy được đúng tài khoản và proxy của việc.
- Worker/profile/khởi chạy/rollback: [apple-check-worker.md](apple-check-worker.md).
- Không lưu mật khẩu, link 2FA/SMS, proxy user/pass, cookie hay DOM vào job/nhật ký.

## Mất kết nối / khôi phục
Worker ghi claim key trước khi gửi, gửi lại cùng key trả cùng lease. Sau checkpoint SUBMITTING, không trả lại bí mật và không đăng nhập lần hai. Worker khởi động sau crash chỉ đối chiếu/dọn và báo UNKNOWN. Kết quả đang chờ gửi lại giữ nguyên payload/thời gian. Khoá yêu cầu người dùng được lưu cả khi gộp vào một việc đang chạy.

Khi rollback web: tắt nhận việc và dọn/reconcile phiên worker trước khi quay về bản cũ. Bản cũ không biết proxy lease của Check Apple ID. Hai migration chỉ thêm bảng/cột; không rollback bằng xoá bảng hay reset database.

## Giới hạn cần ghi đúng
Đăng nhập Apple có thể đòi xác minh. Worker không vượt hoặc hoàn tất OTP/CAPTCHA. DOM Apple có thể đổi; không nhận diện rõ thì UNKNOWN, tuyệt đối không tự nâng thành thành công hoặc Locked. Mỗi phiên chỉ gửi thông tin đăng nhập một lần. Chỉ mở rộng sau khi kiểm một tài khoản thật và đọc lại kết quả.
