# Trạng thái NEW / LIVE theo phân bổ VM — bằng chứng 16/10/2026

Yêu cầu: NEW = đủ điều kiện trong kho chưa gán VM; LIVE = đã gán VM trên web; gán NEW → LIVE trong cùng giao dịch; chỉ chọn server chưa VM → vẫn NEW; LIVE không phải đã cài; đồng bộ mọi đường gán, bỏ gán, huỷ giao, hoàn tác, API; có thao tác Trạng thái tại dòng và hàng loạt; đồng bộ dữ liệu cũ có xem trước; kiểm soát quyền, revision, lưu lặp, đồng thời. Hướng dẫn: `../../runbooks/proxy-state.md`.

## Đã làm

- Commit `34a2af5`, không đổi schema.
- `assignment-state.ts`: `expectedAssignmentState` và `syncAssignmentState`.
- Gọi trong `edits.ts` (gán / chuyển / dán / bỏ gán / khôi phục), `allocation.ts` (giao, autofill, thay kế hoạch) và `installation.ts` (xác nhận cài). Proxy cũ đã bắt đầu cài rồi bị thay thì sang *Cần kiểm tra*, cả khi đang LIVE.
- Hành động `STATE`: NEW/LIVE phải khớp phân bổ thật, có hướng dẫn. BLOCKED có kiểm soát theo quyền BLOCK.
- Chế độ `syncStates` (Thiết lập → Đồng bộ NEW / LIVE) và `stateCounts` trên bộ lọc.
- UI: huy hiệu NEW/LIVE bấm được, ô *Trạng thái* có gợi ý, VM không tự chọn khi đổi server, nút *Trạng thái* hàng loạt có tuỳ chọn bỏ gán.
- Sửa dọn dẹp test cũ (danh tính nhập trong test sửa nhóm không được xoá). Đã xoá 99 danh tính mồ côi trong **test DB**.

## Kiểm chứng

- `assignment-state.integration.test.ts` (3, DB thật):
  - Gán từng dòng, chuyển server hàng loạt và dán bảng → LIVE. Bỏ gán → NEW.
  - BLOCKED bị huỷ giao vẫn BLOCKED. Đã cài hoặc đang cài không bỏ gán được và vẫn LIVE.
  - Autofill Server/VM → LIVE. Hoàn tác autofill → NEW và thả bản giao. Lịch sử vẫn còn bản giao cũ.
  - Trạng thái LIVE khi chưa có VM bị chặn kèm "chọn Server/VM". NEW khi đang giữ bị chặn kèm "Bỏ gán". BLOCKED → BLOCKED.
  - Bỏ gán + NEW cùng lần lưu, gán VM + LIVE cùng lần lưu đều đúng. BLOCKED giữ VM và ghi sự kiện.
  - Hai người gán khác proxy vào cùng VM: chỉ một thành công.
  - Đồng bộ: LIVE thả → NEW, NEW đang giữ → LIVE, nhóm chung LIVE thả → NEW. Bản Giữ để kiểm tra giữ nguyên. BLOCKED và Genjy riêng không đổi. Lần sau 0 dòng, số đếm đúng, hoàn tác trả lại.
- Suite 293 tests / 73 files, tsc, lint (4 cảnh báo cũ), build đều qua.
- Trình duyệt local (bản sao mooon, ảnh `local-*.png`):

| Bước | Kết quả |
|---|---|
| Đồng bộ dữ liệu | 1 → LIVE, 39 → NEW, 1 giữ nguyên; số đếm NEW 3 → 41 |
| Trạng thái NEW trên dòng đang giữ | Gợi ý "Lưu sẽ bỏ gán / huỷ giao An-01/VM_001… rồi về NEW", lưu → NEW, Chưa gán |
| Chọn server An-01, chưa chọn VM | VM trống, Lưu tắt |
| Chọn LIVE | Gợi ý chọn VM; chọn VM_001 → LIVE, An-01 VM_001 Chờ cài |
| NEW hàng loạt 2 dòng không tick bỏ gán | 2 lỗi kèm hướng dẫn |
| Tick bỏ gán | 2 dòng NEW |
| Chuyển server hàng loạt | 2 dòng LIVE (VM_002, VM_003) |
| BLOCKED trên dòng đang giữ | Giữ An-01/VM_004; bỏ gán → vẫn BLOCKED, Chưa gán |
| Bản Giữ để kiểm tra (moon1/M-029) chọn NEW | "Còn bản Giữ để kiểm tra…; xử lý ở Server/VM trước" |

Số đếm cuối: NEW 41, LIVE 1160, BLOCKED 4.

## Railway

- Backup `6383da66-f5ad-4967-b49a-6072fc73f688`, rồi deploy `c948cc9c-aa91-4223-b45c-6c97eaa2ebe3` SUCCESS. Verify 10 server / 576 VM.
- Kiểm kê trước khi sửa (chỉ đọc): TUT NEW đang giữ 3; TUT LIVE không VM 9 (cổng `23.142.16.73`, gói LUONG_NGOAI); nhóm chung LIVE không VM 30; Genjy riêng LIVE 610 (ngoài quy tắc).
- Trên host, mở Thiết lập → Đồng bộ NEW / LIVE, xem trước *3 → LIVE | 39 → NEW | 0 giữ nguyên* (ảnh `host-02-sync-preview.png`), rồi lưu: **42 dòng**.
- Số đếm trước *NEW 3 · LIVE 1199 · BLOCKED 3*, sau *NEW 39 · LIVE 1163 · BLOCKED 3* (ảnh `host-01-before.png`, `host-03-after.png`, `host-04-new-filter-after.png`).
- Kiểm kê sau: TUT LIVE đang giữ 553, TUT NEW chưa gán 9, nhóm chung NEW 30; không còn dòng lệch.
- Trên host chỉ chạy bước đồng bộ. Các bước thử gán / bỏ gán / BLOCKED chạy trên bản sao local, không đụng dữ liệu thật.

## Giới hạn

1. 9 cổng `23.142.16.73` giờ là NEW và đủ điều kiện autofill (IP nhiều cổng đã duyệt). *Điền VM thiếu* có thể đề xuất chúng; luôn có bước xem trước.
2. Bảng đồng bộ hiện IP không kèm cổng, nên 9 dòng của `23.142.16.73` trông giống nhau.
3. Genjy riêng (610 LIVE) và nhóm tự đặt không theo quy tắc NEW/LIVE vì không nằm trên VM của anh.
4. Proxy từng cài trên máy khác rồi được thả về NEW vẫn bị autofill bỏ qua (theo luật cũ: có sự kiện đã cài / bắt đầu cài).
