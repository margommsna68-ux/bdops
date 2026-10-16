# Quản trị Server / VM — bằng chứng 16/10/2026

Yêu cầu chủ dự án: tạo VM theo khoảng, sửa server/VM tại chỗ, xoá có khôi phục (đơn, hàng loạt, server), bảng gọn không lặp. Hướng dẫn: `../../runbooks/server-vm-admin.md`.

## Đã làm

- Commit `e391db2`, sửa thêm `4017aee`. Không đổi schema, dùng `archivedAt` có sẵn.
- `vm-codes.ts`: hàm thuần `expandVmRange`, `splitVmCodes`, `suggestNextVmCode`, `displayNote`.
- `metadata.ts`:
  - `parseVmRange` và `addManagedVMs` bỏ qua mã đã có hoặc đã xoá, trả số liệu tách riêng.
  - `updateManagedVM` (mã, ghi chú, revision, trùng mã) và `updateManagedServer` (không ghi khi giữ nguyên giá trị, chặn trùng tên, chỉ đổi trường được gửi).
  - `archiveVMs` / `restoreVMs` (lý do chặn từng dòng, xung đột SDK, server còn xoá) và `archiveServer` / `restoreServer` (cùng một giao dịch, cùng thời điểm).
  - Tạo server trùng tên báo rõ.
- Router: thêm `updateVM`, `deleteVMs`, `restoreVMs`, `deleteServer`, `restoreServer`.
- Thông báo lỗi cho người dùng bỏ mã kỹ thuật (`userMessage`) ở router vm, proxy và business.
- UI: `ServerWorkspace` viết lại, cùng `InlineText` (sửa tại chỗ) và `VmForms` (Thêm VM, Thêm server).

## Kiểm chứng

- `vm-admin.integration.test.ts` (5, DB thật):
  - Khoảng mã giữ số 0 đầu; khác tiền tố, ngược thứ tự hay quá 500 mã bị chặn.
  - Tạo bỏ qua mã đang có và mã đã xoá; bấm lặp tạo 0; hai lệnh đồng thời tạo đúng 30.
  - USER không có quyền MANAGE bị chặn.
  - Đổi mã giữ ID và bản giao proxy; trùng mã (kể cả máy đã xoá) bị chặn; revision cũ bị chặn; giữ nguyên giá trị thì không ghi nhật ký; tên server trùng bị chặn; đổi tên server giữ ghi chú.
  - Xoá đơn rồi hoàn tác. Hàng loạt: 1 dòng xoá, 2 dòng bị chặn (Chờ cài, việc cài chưa xong), proxy không bị thả.
  - Autofill bỏ qua máy đã xoá. Khôi phục bị chặn khi SDK đã thuộc máy khác.
  - Xoá server bị chặn khi còn proxy; xoá và khôi phục server kèm VM; VM của server đã xoá phải chờ server được khôi phục.
- `vm-codes.test.ts` (gợi ý mã, tách danh sách, ẩn ghi chú hệ thống).
- `vm-sdk-ui.test.tsx` (+1): một server thì tên chỉ ở tiêu đề, có cột Ghi chú, Đã xoá (1), chọn tất cả kết quả lọc; tất cả server thì có cột Server.
- Suite 302 tests / 75 files, tsc, lint (4 cảnh báo cũ), build đều qua.
- Giao diện thật, dữ liệu thử riêng: server `uitest-srv2` và `uitest-srv3` trong dự án mẫu local, video `bdops-proxy-app/.runtime/evidence/2026-10-16-server-vm-admin-local.webm` (ngoài Git). Kết quả từng bước:

| Bước | Kết quả |
|---|---|
| Thêm server với khoảng VM_001→VM_005 | "5 VM mới · 0 đã tồn tại · 0 đã xoá" → Tạo; trang server chỉ có cột VM, tên server xuất hiện 1 lần |
| Mở Thêm VM | Gợi ý VM_006 |
| Khoảng VM_003→VM_012 | "7 VM mới · 3 đã tồn tại", Tạo 7 VM |
| Đến < Từ | Báo "Mã đầu phải nhỏ hơn hoặc bằng mã cuối" |
| Xoá VM_012 | Có Hoàn tác; bấm Hoàn tác thì máy trở lại |
| Xoá lại VM_012, rồi khoảng VM_010→VM_013 | "1 VM mới · 2 đã tồn tại · 1 đã xoá" |
| Đổi mã VM_001 → VM_101 (Enter), ghi chú (✓) | Đã lưu |
| Esc khi đang sửa | Giữ nguyên mã |
| Đổi mã sang VM_002 | Báo "Mã VM_002 đã có trên server này (kể cả máy đã xoá)", chữ đang gõ vẫn còn |
| Gán proxy 203.0.113.58 cho VM_004, rồi chọn tất cả → Xoá 12 | "Đã xoá 11 VM"; VM_004 bị chặn "Còn proxy … · Chờ cài" kèm *Mở VM* |
| Lọc Đã xoá, khôi phục 2 VM | Đúng |
| Xoá server khi VM_004 còn proxy | Báo chặn ngay, không hỏi |
| Bỏ gán proxy, xoá server | 1 xác nhận → xoá; dải *Server đã xoá* có nút Khôi phục → khôi phục đủ 3 VM |

Tổng popup: 2 (xoá server, bỏ gán proxy).

## Railway

- Backup `333a805e-0d25-4513-936b-5bd4920c9ad9`, deploy `83aa7361-f617-4cf7-a431-7cd42446fee0`. Sau đó backup `da48657a-7c3b-4a86-afcf-8a9d10c6c096`, deploy `6dc09326-d572-4109-b2be-b13769858a3d`. Cả hai SUCCESS, verify 10 server / 576 VM.
- Host mooon, chỉ xem, không ghi:
  - Ảnh trước (`host-before-*.png`): mỗi dòng ghi "moon05 VM_…".
  - Ảnh sau (`host-after-*.png`): tiêu đề moon05 có IP và ghi chú sửa tại chỗ, dòng chỉ `VM_001`, cột Ghi chú riêng.
  - Thêm VM gợi ý VM_081; gõ *Đến* VM_082 thì hiện "2 VM mới · 0 đã tồn tại · 0 đã xoá". Bấm Huỷ, không tạo gì.
- Ghi chú hệ thống trên host được ẩn khi hiển thị, dữ liệu giữ nguyên: 567 VM có "Recorded on Sheet…", 10 server có "Imported from personal Sheet…". 5 ghi chú Proxiware vẫn hiện.

## Giới hạn

Xem mục *Giới hạn và việc tiếp theo* trong runbook, có danh sách chỗ lặp ở các trang khác.
