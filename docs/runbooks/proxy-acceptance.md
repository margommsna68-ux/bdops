# Bản thử kho proxy — 14/10/2026

Địa chỉ local: http://localhost:3010/infrastructure/proxies. Dự án `PROXY_TRIAL` chỉ có dữ liệu mẫu thuộc dải IP dành cho tài liệu. Chưa nhập proxy thật, chưa triển khai Railway, chưa sửa Sheet hay cài cấu hình VM.

## Thao tác hằng ngày

1. **Nhập mới:** dán full proxy, chọn của anh hoặc genjy → Kiểm tra danh sách → Lưu những dòng hợp lệ. Dòng thiếu gói nằm Cần kiểm tra; khai báo đúng thông tin ở Gói proxy để nhận diện. Dữ liệu cũ chưa rõ nguồn không tự trở thành NEW.
2. **Báo BLOCKED:** dán IP hoặc full proxy → Kiểm tra → Lưu. Dòng đổi đỏ và ghi thời điểm. Báo lại cùng IP đã BLOCKED giữ ngày giờ cũ.
3. **Copy BLOCKED:** xem ba cột Gói / Full proxy / BLOCKED rồi bấm Copy danh sách. Nút cạnh từng dòng cho phép copy full proxy riêng. Cả hai thao tác đều kiểm tra quyền copy ở server và lưu nhật ký.
4. **Nhận replace:** dán danh sách cũ ở ô trên, danh sách mới ở ô dưới, dòng N ghép dòng N. IP mới viết tắt lấy port/user/pass của đúng cặp; full proxy giữ thông tin đã dán. Ngày nhận có thể để trống khi chưa rõ.
5. **Lịch sử:** bấm IP để thấy chuỗi IP cũ → mới, ngày nhận và ngày ghi. IP cũ vẫn trong lịch sử; IP mới của anh là NEW nếu đã đủ gói. Genjy/PC chung giữ nguyên sở hữu qua mọi trạng thái.

Các bộ lọc Đang quản lý / Đã replace / Toàn bộ IP phân biệt kho hiện tại và lịch sử. Gói liên tục trong bảng; gói chưa rõ nằm cuối. Màu tím nghĩa là chưa ghi nhận gán VM, không có nghĩa mọi dòng tím đều đủ điều kiện cấp.

Nếu báo dữ liệu đã đổi/hết hạn, bấm Kiểm tra danh sách lại trước khi lưu. Nếu mất kết nối lúc lưu, thử lại cùng đợt; backend giữ kết quả đã ghi và không tạo thêm receipt.

## Kết quả nghiệm thu

- PostgreSQL trial riêng, migrations chạy lại không thay đổi; database test riêng với guard so sánh đích.
- Kiểm tra parser bare/full, lịch sử/owner, Genjy ghi chú, replay, rollback, hai commit tranh cùng IP, quyền chỉ xem và IDs ngoài dự án.
- Browser local: nhập proxy mẫu, BLOCKED bằng bare IP, nhận replace và xem ngày nhận chưa rõ, copy ba cột, copy một full proxy. IP đang có dù đổi credentials và IP Genjy đều bị chặn khi nhập mới vào kho cá nhân.
- Hai tab thử cùng IP: tab thứ hai cập nhật trước; tab thứ nhất nhận STALE_PREVIEW và phải kiểm tra lại. Sửa input xoá preview cũ.
- UI Copy từng treo Đang lấy khi mutation chạy trong mount effect/StrictMode. Chuyển mutation sang sự kiện click ở parent, chỉ render kết quả trong dialog; nghiệm thu lại sau reload cho đầu ra đầy đủ.
- Trạng thái build/tests/lint cuối cùng ghi trong `proxy-verification.md` sau lượt rà độc lập.

## Phần tiếp theo

Nút Điền VM thiếu còn khoá trong mốc kho proxy. Subsystem tiếp theo bổ sung server/VM, reservation chống cấp trùng, chỉ dùng SELF NEW cho VM thực sự trống và việc cài với phiên bản mong muốn/xác nhận. Sheet import hiện có seam server lưu snapshot đã phân loại, mã hoá và đối chiếu; bộ mapping dữ liệu thật phải lấy từ Sheet mới khi thực hiện chuyển dữ liệu. Không dùng snapshot lịch sử thay cho lần đọc hiện hành.

Railway triển khai sau khi bản local ổn và biết đúng tài khoản/project/database đích. Chưa cần thanh toán để build local. Railway là nơi chạy web/database online; nhân viên dùng tài khoản web, không cần quyền Railway. Chi phí phải đối chiếu ở thời điểm lên host.

## Lưu ý cho người triển khai

Không dùng db push/reset lên database vận hành. Dùng migrate deploy, backup trước chuyển dữ liệu. Không nhập các ví dụ nhà cung cấp trong chat. Không xoá dự án Bright Data cũ hoặc ánh xạ sang VM cá nhân theo tên.

Trên Windows, dừng đúng server local trước prisma generate để tránh DLL bị khoá. Vì ổ C gần đầy, bản kiểm tra production dùng BDOPS_BUILD_DIRECTORY=.next-build (junction sang D:/CodexRuntime/bdops-proxy-trial/build). Railway không đặt biến này, dùng .next mặc định. Cấu hình Railway mới dùng service Settings/IaC; railway.toml chỉ giữ tương thích dịch vụ cũ.
