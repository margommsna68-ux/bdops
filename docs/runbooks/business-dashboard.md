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

Bridge và vận hành Central: xem `gen2-dashboard.md`. Dùng kết quả GEN2 đã quét, không tạo lịch quét mới. Cảnh báo lỗi/phục hồi dùng hệ thống Telegram hiện có của GEN2; bridge chỉ thêm nhắc kỳ proxy với một key mỗi gói/ngày đến hạn. Không tự thay proxy/thanh toán/rút tiền. Tiền thực nhận PayPal hôm nay để giai đoạn sau.
