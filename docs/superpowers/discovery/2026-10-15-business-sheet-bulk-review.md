# Rà Sheet vận hành và thao tác hàng loạt — 15/10/2026

Đây là **ghi nhận khảo sát và câu hỏi đang chờ trả lời**, không phải thiết kế/plan đã duyệt. User yêu cầu đọc Sheet, so sánh web và trao đổi trước vì các thao tác hàng loạt còn khó. Không sửa Sheet, code, database hoặc triển khai trong lượt khảo sát này.

## Nguồn và cách đối chiếu

Workbook `19lRVAvOVAgyVPHFidYX_aMVAkoiHKcaUVIDy3QVcodo`, đọc trực tiếp 15/10/2026 lúc 16:42 Bangkok. 14 tab, trong đó 2 tab ẩn. Bản tải chỉ đọc 511770 bytes, SHA-256 `543b0f66e086af3bb6e400d27267dfa7815be4cfb929e0dde9a27e6055dee3fd`. Raw credentials/SDK/source cells giữ trong `.runtime/business-sheet-review-20261015`, không đưa vào Git/báo cáo.

So với **snapshot dùng nhập dự án PERSONAL_SHEET ngày 15/10**, không tự gọi là kiểm chứng mọi thay đổi người dùng vừa làm trên host. 250 vị trí có proxy chính thức ở AN-01 (70) và VT-01…04 (45 mỗi server) khớp IP snapshot đã nhập. 251 nhãn VM ghép được, trong đó một dòng không có proxy chính thức. Các nhãn VM trống trong mẫu 100 dòng/server không tự được coi là máy đang hoạt động.

## Sheet thể hiện quy trình gì

- AN-01 và các VT có proxy chính thức, proxy thay theo ngày, account, SDK, tên VM, tình trạng hiện tại và cột kiểm tra theo từng ngày.
- `SDK table` có 226 dòng VM, 225 SDK khác nhau, một dòng Off không có SDK. Ghép theo server/IP + mã VM; không thể dùng VM_001 đơn lẻ cho mọi server. Ngày xuất gồm nhiều đợt, không phải một snapshot toàn bộ cùng ngày.
- Có OK, OFF VM, No internet, No Money, Blocked, awaiting, Đã thay proxy và ghi chú Earn app is turned on. Những nhãn này nói về các loại sự kiện khác nhau, chưa được user định nghĩa chính xác.
- Cột account của 5 server được đối chiếu đang trống; không suy ra đó là Gmail, tài khoản app hay nhóm. Cần hỏi user.
- Các ngày vừa có serial date, vừa có chuỗi dễ lẫn tháng/ngày. Ví dụ 46279 = 14/09/2026; chuỗi 09/11/2026 cần quy ước trước khi nhập lịch sử, không tự đoán.
- Workbook có thêm các server Vultr và hai tab ẩn. Chưa xác nhận máy nào còn hoạt động; không tự nhập/gộp vào các máy cá nhân hoặc dự án Bright Data cũ.

## Khác biệt với web hiện tại

| Việc | Đã có | Khoảng trống |
|---|---|---|
| Kho proxy | NEW/BLOCKED/REPLACE nhiều dòng, preview, chống trùng/lưu lặp, lịch sử | Registry chưa có chọn dòng/sửa chung các metadata tùy ý |
| VM | Tạo nhiều mã VM, AUTO fill NEW của anh, giữ cấu hình giao/cài riêng | Gán proxy cụ thể mỗi VM, liên kết Gmail và thao tác cài vẫn nhiều dialog; chưa dán bảng VM→proxy/SDK/account |
| SDK/app | Schema legacy còn sdkId/earnTotal/earn24h/uptime | Managed API/UI không trả/sửa các trường này; chưa có SDK-status hoặc tài khoản earning-app riêng |
| Kiểm tra vận hành | Có công việc với notes và trạng thái hoàn thành | Chưa có quan sát theo ngày về VM/network/app/earnings. Trạng thái giao/cài không chứng minh máy bật, có internet hoặc có tiền tăng |
| Account/công việc/thu chi | Form lẻ và lịch sử/hoàn tác có kiểm tra | Chưa có managed multirow import/update, chọn nhiều dòng đổi chung, hoặc tạo/giao việc cho cả danh sách |

Nút Cập nhật ở nhiều trang chỉ tải lại dữ liệu; tại Proxy còn quét Genjy. Nó không phải nhập thay đổi từ Sheet hoặc sửa hàng loạt. Legacy có một số bulk tools nhưng managed routing chặn endpoint cũ để không bỏ qua quyền/lịch sử/tiền tệ mới; không mở lại nguyên các endpoint cũ như lối tắt.

Code căn cứ: `src/server/vm-management/repository.ts:13`, `state.ts:1–11`, `src/server/routers/vmManagement.ts:25–34`, `src/components/vm-management/ServerWorkspace.tsx:28–42`, `AllocationDialog.tsx:14–25`, `src/components/business-management/AccountsWorkspace.tsx:11–38`, `WorkWorkspace.tsx:12–21`, `src/server/trpc.ts:93–117`. Đã có một lượt rà source độc lập, chỉ đọc.

## Hướng trao đổi, chưa duyệt triển khai

Ưu tiên một bảng vận hành theo server+VM, hiển thị SDK/account/proxy và lần kiểm tra gần nhất. Hai thao tác chính: **Dán bảng** (mỗi dòng một bộ giá trị) và **Chọn nhiều dòng → áp cùng thay đổi**. Preview chỉ rõ dòng tìm được, trước/sau, trùng/không rõ; mỗi lần lưu là một đợt có lịch sử/hoàn tác và kiểm tra revision/quyền. Cần chốt ô trống nghĩa giữ nguyên hay xóa, cách sửa nhầm ngày, và phản hồi khi một vài dòng lỗi.

Không dùng một trạng thái duy nhất để đại diện cả proxy, tình trạng máy/app, kết quả kiếm tiền và tiến độ công việc. Cài proxy thành công là một sự kiện cấu hình, không tự ghi OK hoặc có tiền.

Ba câu đã gửi user:

1. SDK có thuộc EarnApp? Một VM chạy mấy app/tài khoản và một tài khoản có dùng nhiều VM không?
2. Ưu tiên dán bảng khác giá trị mỗi dòng, chọn nhiều VM đổi chung, hay cả hai?
3. Web là nơi sửa chính, Sheet nhập lại, hay cả hai có đối chiếu xung đột?

Cần hỏi tiếp theo câu trả lời: “OK” chứng minh điều gì; ba việc lặp nhiều nhất và quy mô mỗi đợt; nguồn file SDK xuất từ đâu/có format nào; server nào đã ngừng dùng; account là loại gì; trạng thái lỗi tự tạo việc cho ai; thế nào xác nhận hết lỗi. Không hỏi lại các quyết định đã chốt về Genjy, phạm vi VM nhân viên và công thức lợi nhuận USDT.
