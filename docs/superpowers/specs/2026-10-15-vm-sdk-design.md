# Ghi SDK EarnApp theo Server → VM — thiết kế mốc 1

Ngày 15/10/2026. Nguồn yêu cầu: brief tiếp quản của anh và ghi nhận khảo sát `../discovery/2026-10-15-business-sheet-bulk-review.md`. Mốc này chỉ làm **cập nhật SDK** (một dòng và dán hàng loạt) ngay trong bảng Server/VM; tài khoản EarnApp (Gmail/Apple ID) và dán hàng loạt Gmail/PayPal là mốc kế tiếp, dùng lại cùng mẫu "Dán bảng".

## Hiện trạng đã xác minh

- `VirtualMachine.sdkId` có trong schema legacy nhưng managed API/UI không đọc/ghi. 583 VM managed trên local, 0 VM có SDK, không có SDK trùng.
- Managed VM ghi/hoàn tác qua `runBusinessCommand` (commandKey chống bấm lặp, journal mã hóa trước/sau, undo có kiểm tra revision). Trigger DB tự tăng `revision` mỗi lần UPDATE VM.
- Nhân viên USER có module INFRASTRUCTURE được ghi trên toàn bộ VM của dự án (`assertInfrastructureAction('ASSIGN')`); VIEWER bị chặn ở backend.
- SDK trong Sheet vận hành: 225 mã khác nhau, cùng độ dài 40 ký tự, chữ/số/gạch nối.

## Luồng thao tác

1. **Một VM tại dòng:** bấm bút chì ở ô SDK → nhập/dán mã → Enter. Web hiện SDK hiện tại và mã mới; lưu một lần, hiện lỗi tại chỗ nếu mã đang thuộc VM khác. Xóa SDK là nút riêng có xác nhận; ô trống không phải xóa.
2. **Nhiều VM:** nút **Dán SDK** trên trang Server/VM. Đã chọn server thì dán `VM<tab>SDK`; nhiều server thì dán `Server<tab>VM<tab>SDK` (chấp nhận tab, `|`, `,`, `;`). Dòng tiêu đề bị bỏ qua. Web ghép theo **danh tính server + mã VM**, không theo thứ tự dòng, không tạo VM mới.
3. **Xem trước** từng dòng: Server/VM tìm được, SDK hiện tại, SDK mới và kết quả: `Đổi` / `Giữ nguyên` (cùng mã hoặc ô trống) / `Không tìm thấy VM` / `SDK đang thuộc VM khác` / `Trùng trong danh sách` / `Mã không hợp lệ`. Bấm **Lưu N thay đổi** chỉ ghi các dòng hợp lệ; dòng lỗi vẫn hiện để sửa.
4. **Lưu một đợt:** một thao tác trong Lịch sử, có người/thời gian, hoàn tác được khi VM chưa bị sửa tiếp. Dán lại cùng dữ liệu → mọi dòng `Giữ nguyên`, không tạo lịch sử. Bấm lại cùng yêu cầu → replay, không ghi hai lần.
5. **Nhìn nhanh:** cột SDK hiện mã, ngày giờ và người ghi; bộ lọc **Chưa có SDK**; thẻ đếm trên trang Server/VM và mục "VM chưa có SDK" ở Tổng quan. Lịch sử SDK từng VM (mã cũ → mã mới, ai, khi nào) mở tại dòng.

## Quy tắc

- Mỗi VM một SDK hiện hành; một SDK chỉ thuộc một VM managed đang hoạt động (unique partial index + kiểm tra ứng dụng). Không tự dời SDK giữa máy: muốn chuyển phải xóa ở máy cũ trước, có lịch sử.
- Lưu SDK không cần tài khoản EarnApp. Ghi SDK không chứng minh app chạy/có tiền; xác nhận cài proxy là sự kiện độc lập, đổi proxy không ép tạo SDK mới.
- Mã hợp lệ: 8–128 ký tự `A-Za-z0-9 . _ : -`, cắt khoảng trắng; không suy mã từ nội dung khác.
- Quyền: cùng `INFRASTRUCTURE`/ASSIGN như giao proxy; AI hay nhân viên đều qua cùng endpoint tRPC và cùng kiểm tra; không mở endpoint legacy.
- Dữ liệu: thêm `sdkRecordedAt`, `sdkRecordedById` trên VM và bảng `VMSdkHistory` (mã cũ, mã mới, người, thời gian, ghi chú). Migration chỉ thêm, không đổi dữ liệu cũ.

## Ngoài phạm vi mốc này

Tài khoản EarnApp riêng (Gmail/Apple ID, nhiều SDK một tài khoản), dán hàng loạt Gmail/PayPal, token API cho AI, quan sát OK/OFF/No internet/No money theo ngày, nhập lịch sử SDK từ Sheet. Mẫu "Dán bảng → xem trước → lưu một đợt" của mốc này được viết để dùng lại cho các mốc đó.
