# Lọc và thống kê Server / VM theo server — thiết kế 23/10/2026 (tối)

Nguồn: brief chủ "CẢI THIỆN LỌC VÀ THỐNG KÊ SERVER / VM CHO TOÀN BỘ TRƯỜNG HỢP" (chat 23/10). Trang `/infrastructure/servers[/<id>]`.

## Hiện trạng (khảo sát)
- Toàn bộ VM của dự án được tải về trình duyệt (`vmManagement.workspace`, `vmOps.board`, `accountStore.vmAccounts`); lọc / sắp / phân trang chạy ở `ServerWorkspace.tsx` bằng các closure rời (`inView`, `opsView`, `moneyMatch`, `needle`).
- Số trên chip nhóm vấn đề đếm `active` (chỉ theo server), bỏ qua tình trạng / tiền / tìm kiếm; chip tình trạng và chip tiền cũng vậy → ba cách đếm khác nhau, có thể lệch với bảng.
- Chọn server ở bộ chọn xoá ô tìm (`q:''`); không có phân bố theo server; không có copy định danh; dữ liệu phụ thuộc chưa tải thì bảng rỗng không khác gì 0 kết quả.

## Thiết kế
1. **Một mô hình lọc thuần** `src/components/vm-management/vm-grid/filter-model.ts` (không React, test đơn vị):
   - `VmFacts`: các sự kiện đã rút ra cho mỗi VM (server, mã, đã xoá, view proxy, applyPending, cần xử lý, chưa SDK, có tài khoản / PayPal (`null` = chưa tải), tình trạng vận hành, mốc tiền + cờ tiền (`null` = chưa tải board), trạng thái Tiền VM, chuỗi tìm kiếm).
   - `GridFilters` = `{serverId, view, st[], money, warn, q}` — đúng các trường đã có trong URL + server trong đường dẫn; không thêm trạng thái nghiệp vụ.
   - `matchVm(facts, filters, omit?)` → `true | false | null` (`null` = cần dữ liệu chưa tải). Quy tắc: trong nhóm tình trạng OR; giữa nhóm vấn đề · tình trạng · tiền · cảnh báo · tìm kiếm · server AND. `omit` bỏ một nhóm (dùng cho phân bố theo server).
   - `countWith(rows, filters, patch)` → số VM khi thay một nhóm bằng giá trị khác (số cạnh mỗi lựa chọn: các nhóm khác áp dụng, nhóm của chính nó thay bằng lựa chọn đó); `null` khi thiếu dữ liệu.
   - `serverDistribution(rows, filters)` → `{total, items:[{serverId, code, count}]}` áp dụng mọi điều kiện TRỪ server, sắp giảm dần theo số VM rồi theo tên tự nhiên; `null` khi thiếu dữ liệu.
   - `applyFilters(rows, filters)` → các VM của "Kết quả đang xem" (có server), đếm trước phân trang; mỗi VM một lần.
   - `vmIdLines(rows)` → `Server | VM` mỗi dòng, sắp server rồi mã VM; chỉ định danh.
2. **`ServerWorkspace`** dựng `VmFacts` một lần (useMemo) từ ba query, rồi dùng mô hình cho bảng, mọi chip, phân bố và copy. Chip nhóm vấn đề / tình trạng / tiền đếm bằng `countWith`.
3. **Vùng "Phân bố theo server"** ngay trên bảng (sau thanh tìm / sắp xếp): "170 VM phù hợp · 8 server", các mục `moon06 78` (bấm → trang server đó, giữ q / view / st / money / sort, về trang 1), `Tất cả` để về toàn bộ; danh sách > 8 server thu gọn / mở rộng. Trong trang một server: "Đang xem moon06 · 78 VM". Chưa tải dữ liệu phụ thuộc → "Đang tải…"; lỗi → thông báo + Thử lại (đã có).
4. **Điều kiện đang áp dụng** hiện trên cùng vùng, mỗi điều kiện có × riêng; "Xoá bộ lọc" về phạm vi mặc định (trang một server vẫn ở server đó).
5. **Điều hướng**: bộ chọn server và phân bố cùng điều hướng, giữ nguyên q / view / st / money / warn / sort / size; về trang 1; bỏ `vm` đang mở. URL như cũ (không thêm tham số mới). Nhãn sắp xếp mặc định ở trang tất cả server: "Theo server → mã VM" (đã sắp tự nhiên: VM_002 trước VM_010).
6. **Copy danh sách VM** ở vùng phân bố: các dòng đã chọn, hoặc toàn bộ kết quả đang lọc (mọi trang) khi chưa chọn; nhãn nêu phạm vi + số lượng; nội dung `Server | VM`; không mật khẩu / proxy / SDK / tiền. Các nút copy chuyên biệt giữ nguyên.
7. **Hết kết quả ở server đang chọn** (phân bố còn VM ở server khác): "Không còn VM phù hợp ở moon06" + "Về Tất cả server" (giữ bộ lọc); không tự nhảy server. Tự tải lại 30 s giữ nguyên bộ lọc / trang / chọn / nháp như hiện nay (ids, không vị trí).
8. **Tiền & quyền**: không đổi backend. Người không có quyền tiền: `vmMoneyState` = HIDDEN → các chip / phân bố tiền không có số (ẩn), copy chỉ định danh.

## Kiểm thử
- Đơn vị: `vm-filter-model.test.ts` (AND / OR, omit server, sắp giảm dần + tên tự nhiên, `null` khi thiếu dữ liệu, đếm mọi trang, mỗi VM một lần, copy lines, Đã xoá).
- Render tĩnh (`vm-sdk-ui.test.tsx`): vùng phân bố, nhãn copy, chip đếm theo điều kiện khác.
- Trình duyệt trên bản thử cục bộ: các tổ hợp của brief §10, Back / tải lại, 4 theme, 1280 px có sidebar, 390 px; ảnh chụp các trường hợp chính (không video). Deploy self-hosted sau backup; host chỉ đọc.
