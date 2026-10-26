# Dashboard kinh doanh — 26/10/2026

Trang Tổng quan có ba số chính. Bấm một số để xem đúng danh sách VM; chọn server để thu hẹp cả số và danh sách. Mỗi dòng mở đúng Server/VM. Kho và tài chính tháng nằm trong phần thu gọn bên dưới.

Giao diện “Điều hành gọn”: ba số chính nằm trong một khung, cảnh báo gọn bên dưới. Vòng tròn là tỷ lệ VM kiếm tiền trong số đang hoạt động (màu tốt / lỗi / chưa xác minh theo theme). Không có VM hoạt động thì hiện dấu gạch, không phải 0%; chỉ đủ toàn bộ mới hiện 100%. Thanh tiền hôm nay biểu diễn số VM tăng / chưa thấy tăng / giảm / thiếu dữ liệu, không phải đồ thị theo giờ. Thanh mức tiền biểu diễn số VM từ $10 / từ $8 đến dưới $10 / dưới $8 / chưa rõ, cùng mẫu số VM hoạt động. Tiền cũ/lỗi/chưa kiểm tra thuộc Chưa rõ. Bấm nhãn hoặc số để xem nhóm tương ứng. Giải thích chi tiết nằm trong “Cách tính”.

“Tình hình từng server” ưu tiên server có nhiều VM cần xem (lỗi, chưa xác minh hoặc đã báo/chờ xử lý; mỗi VM đếm một lần), mặc định hiện 5 server, bấm “Xem cả N server” để mở hết. Tăng hôm nay và số VM từ $10 có số cụ thể; bấm số để mở đúng danh sách. Không dùng thanh tương đối theo server kiếm nhiều nhất. Khi tự tải lại vẫn giữ server, nhóm VM đang xem và lựa chọn mở rộng.

Màu nền, chữ và đường viền lấy từ theme đang chọn; biểu đồ/trạng thái có bảng màu riêng cho Sáng, Tối, Vàng kim và Đồng ấm. Trên điện thoại các khối xếp dọc, bảng server thành từng mục; bộ lọc, danh sách VM và thông tin hạn proxy không cần kéo ngang. Nút lọc trên thiết bị cảm ứng có vùng chạm tối thiểu 40px, bộ chọn server 44px.

- VM hoạt động: EarnApp có bằng chứng chạy và kiếm tiền từ kết quả GEN2 trong 24 giờ. Tình trạng OK ghi tay không đủ. Tạm dừng/Chưa cài tách riêng. Lỗi đã ghi trên web vẫn ở nhóm Đã báo/chờ xử lý, không bị kết quả tốt cũ che đi.
- Tăng ghi nhận hôm nay: chênh lệch giữa các quan sát hợp lệ cùng VM/lượt/SDK trong ngày Việt Nam. Hiện số VM có đủ dữ liệu. Một lần đọc không đủ; không giả số dư đầu ngày. Có giảm tiền thì tách đối chiếu, không cộng thành thu nhập. Tiền vẫn giữ độ chính xác gốc, chỉ hiển thị tối đa hai số lẻ.
- Sắp đủ: $8 đến dưới $10; Đủ tiền: từ $10. Đây là mức tiền quan sát, không phải lệnh rút hay bằng chứng EarnApp cho rút. Trong chi tiết thấy thiếu tài khoản/email PP hoặc yêu cầu đã có.
- Gói proxy: hạn trả, ngày còn lại, giá và đồng tiền (chỉ theo quyền xem chi phí); click mở gói. Lỗi kết nối/xác thực/hết hạn khác với EarnApp chặn proxy.

Dữ liệu làm mới trên trang mỗi 30 giây. Giờ làm mới trang và giờ kiểm tra từng máy là hai mốc riêng. Thiếu dữ liệu hoặc thiếu quyền hiện rõ, không biến thành $0. User chỉ được giao server nào chỉ có số liệu server đó.

Web nhận kết quả qua API ops thông thường: GET `gen2-targets`, POST `vms/{id}/scan-observations`, GET `gen2-reminders`. OpenAPI 1.5.0. Ghi scan cần VM_OPS; kèm tiền cần BALANCE_WRITE và EARN_BALANCE. Các lệnh giữ kiểm tra token/user/phạm vi/revision/lượt/idempotency. Chỉ ghi quan sát, không đổi proxy/status/account hay chạy việc trong VM. SDK tiền dùng chung dịch vụ có sẵn; lịch sử mới ghi kèm VM/lượt để tính tăng.

Bridge và vận hành Central: xem `gen2-dashboard.md`. Dùng kết quả GEN2 đã quét, không tạo lịch quét mới. Cảnh báo lỗi/phục hồi dùng hệ thống Telegram hiện có của GEN2; bridge chỉ thêm nhắc kỳ proxy với một key mỗi gói/ngày đến hạn. Không tự thay proxy/thanh toán/rút tiền.

## EarnApp → PayPal

Khung ngay dưới ba số vận hành, theo server đang chọn:

- **Đã gửi hôm nay**: số VM và tiền của các yêu cầu thực sự gửi trong ngày Việt Nam (`submittedAt`), kể cả yêu cầu tạo từ hôm trước. Đã gửi vẫn là sự kiện đã xảy ra dù sau đó thất bại/huỷ.
- **Đang chờ về**: số còn chờ của yêu cầu đã gửi, gồm mọi ngày; đã nhận từng phần chỉ còn phần thiếu. Đang chuẩn bị/chưa rõ kết quả không tự tính là đã gửi.
- **PayPal nhận hôm nay**: khoản nhận xác nhận, không lỗi/không thu hồi, theo ngày thực nhận trong sổ. Không lấy ngày tạo yêu cầu, không coi EarnApp báo Paid là đã về. Các đồng tiền hiện riêng, không quy đổi.
- **Cần xử lý**: số yêu cầu thất bại, chưa rõ kết quả hoặc cần đối chiếu; gồm mọi ngày. Một VM có nhiều lượt cũ thì số VM và số yêu cầu có thể khác nhau.

Bấm từng ô mở `/earnapp-withdrawals?view=...` giữ server. Hai ô trong ngày mang `day=YYYY-MM-DD`, nên qua nửa đêm báo cáo vẫn mở đúng ngày vừa thấy. Báo cáo nhận trong ngày chỉ cộng ngày đang chọn, cả tổng và từng dòng; mở khung chi tiết vẫn có toàn bộ lịch sử của yêu cầu. Bấm × để bỏ nhóm và giữ các bộ lọc server/PayPal/tìm kiếm. Không trộn bộ lọc ngày yêu cầu với bộ lọc sự kiện từ dashboard.

Cùng quyền `requestMoney` như báo cáo rút; người thiếu quyền không có khung tiền, user bị giới hạn server vẫn theo quy tắc quyền tài chính hiện có. Lỗi tải ẩn số đã cache và có Thử lại. Tự cập nhật 30 giây và theo nút Tải lại; không mất server đang chọn. Trên điện thoại khung có hai cột. Các số này là EarnApp về PayPal, độc lập với USDT thực nhận về team và lợi nhuận.
