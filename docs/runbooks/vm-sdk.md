# Ghi SDK EarnApp theo Server → VM

Mốc 1 của hướng "bảng vận hành Server/VM", triển khai 15/10/2026. Thiết kế: `../superpowers/specs/2026-10-15-vm-sdk-design.md`. Bằng chứng: `../superpowers/evidence/2026-10-15-vm-sdk.md`.

## Thao tác

Mở **Server / VM**. Cột **SDK EarnApp** hiện mã hiện hành, ngày giờ và người ghi; VM chưa có mã hiện **Chưa có SDK** (màu cam). Thẻ **Chưa có SDK** ở đầu trang và mục **VM chưa có SDK** ở Tổng quan đếm số máy còn thiếu; bộ lọc **Chưa có SDK** liệt kê đúng các máy đó.

1. **Một VM:** bấm bút chì ở ô SDK → dán mã → Enter (Esc để hủy). Lỗi hiện ngay tại ô, ví dụ mã đang thuộc VM khác. Muốn xóa mã, bấm **Xóa SDK** trong lúc sửa và xác nhận; ô trống không phải lệnh xóa.
2. **Nhiều VM:** bấm **Dán SDK**. Chọn server rồi dán `VM<tab>SDK`, hoặc để "Nhiều server" và dán `Server<tab>VM<tab>SDK` (chấp nhận tab, `|`, `;`, `,`; dòng tiêu đề được bỏ qua). Bấm **Kiểm tra** để xem từng dòng: Server/VM tìm được, SDK hiện tại, SDK mới và kết quả. Bấm **Lưu N thay đổi** để ghi các dòng hợp lệ; dòng lỗi vẫn hiện để sửa và dán lại.
3. **Lịch sử:** biểu tượng đồng hồ ở ô SDK mở lịch sử mã cũ → mã mới, người và thời gian của VM đó. Trang **Lịch sử thao tác** có mục **Ghi SDK EarnApp** cho cả đợt; quản trị có thể hoàn tác khi VM chưa bị sửa tiếp.

Kết quả xem trước:

| Kết quả | Nghĩa |
|---|---|
| Ghi SDK mới / Đổi SDK | Dòng hợp lệ, sẽ ghi khi lưu |
| Giữ nguyên | Cùng mã hiện tại hoặc ô SDK trống; không tạo lịch sử |
| Không tìm thấy server / VM | Ghép theo tên server và mã VM, không tạo máy mới |
| SDK đang thuộc … | Mã đang ở VM khác; xóa ở máy cũ trước, không tự dời |
| Trùng trong danh sách dán | Cùng mã xuất hiện ở nhiều dòng trong lần dán |
| Mã SDK không hợp lệ | Ngoài 8–128 ký tự chữ/số/`.`/`_`/`:`/`-` |

Dán lại cùng dữ liệu không tạo thay đổi hay lịch sử. Bấm lưu hai lần cùng một đợt chỉ ghi một lần. Ghi SDK không xác nhận proxy đã cài, không chứng minh app chạy hay có tiền; đổi proxy không ép tạo SDK mới.

## Quyền và kiểm soát

Cùng quyền với giao proxy: ADMIN/MODERATOR và nhân viên USER có module INFRASTRUCTURE ghi được trên toàn bộ VM của dự án; VIEWER chỉ xem. Backend kiểm tra VM thuộc dự án, revision, mã hợp lệ và trùng mã (ứng dụng + unique index trên DB cho VM managed đang hoạt động). AI hay nhân viên đều đi qua `vmManagement.sdkPreview` / `sdkApply` / `sdkHistory`; không có đường ghi legacy.

## Dữ liệu

Migration `20261015120000_vm_sdk_record`: thêm `sdkRecordedAt`, `sdkRecordedById` vào VirtualMachine, bảng `VMSdkHistory`, unique partial index `VirtualMachine_managed_sdk_key`. Chỉ thêm, không đổi giá trị cũ. Lịch sử thao tác dùng resource `VM_SDK` (sdkId, thời gian, người ghi, revision); hoàn tác khôi phục mã trước và ghi thêm một dòng lịch sử "Hoàn tác".

## Chưa làm trong mốc này

Tài khoản EarnApp (Gmail/Apple ID, nhiều SDK một tài khoản), dán hàng loạt Gmail/PayPal, token API riêng cho AI, trạng thái OK/OFF/No internet/No money theo ngày, nhập lịch sử SDK từ Sheet vận hành.
