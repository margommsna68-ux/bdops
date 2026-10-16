# Đơn giản hoá thao tác Quản lý proxy — bằng chứng 16/10/2026

Quyết định của anh: LIVE là trạng thái người dùng ghi nhận proxy đang sử dụng, kể cả khi chưa cập nhật vị trí VM. Quyết định này thay quy tắc cũ bắt LIVE phải có VM, và bỏ lỗi "Chưa gán VM; chọn Server/VM để chuyển LIVE". Hướng dẫn: `../../runbooks/proxy-state.md`.

## Đã làm

- Commit `c61f849`, không đổi schema.
- Server:
  - Trạng thái LIVE không cần VM.
  - Gán lại đúng VM hiện tại (kể cả đã cài hoặc giữ để kiểm tra) là SKIP.
  - `syncAssignmentState` chỉ về NEW khi thật sự thả bản giao; LIVE người dùng đặt không bị tự đổi.
  - Đồng bộ NEW/LIVE chỉ sửa dòng NEW đang được giữ.
  - Hoàn tác không bắt lý do (mặc định "Hoàn tác").
- UI:
  - `StatusQuick`: ô trạng thái trong bảng, chọn là lưu.
  - Thanh chọn nhiều dòng có ô *Trạng thái…* và nút *Áp dụng*.
  - Editor dòng tự lưu khi chọn nhóm, VM hoặc trạng thái.
  - Các khung sửa hàng loạt chỉ còn nút *Áp dụng*; lỗi hiện tại chỗ, nội dung giữ nguyên.
  - Chỉ còn một hộp xác nhận: chọn NEW trên dòng đang giữ VM, vì nó bỏ gán.
  - `quickEdit` gọi đúng `editPreview` / `editCommit`. Chỉ báo "Đã lưu" khi commit thành công.

## Số bước trước / sau

| Thao tác | Trước | Sau |
|---|---|---|
| Proxy chưa có VM → LIVE | Bút → Trạng thái → bắt chọn Server → VM → Lưu (5), hoặc bị lỗi "Chưa gán VM" | Chọn LIVE tại ô (1) |
| Đổi trạng thái nhiều dòng | Tick → Trạng thái → chọn → Xem trước → Lưu (4 + tick) | Tick → chọn trạng thái → Áp dụng (2 + tick) |
| Gán vào VM trống | Bút → Server → VM → Lưu (4) | Bút → Server → VM (3) |
| Gán lại đúng vị trí | Có thể báo lỗi (đã cài / giữ để kiểm tra) | "Không thay đổi", không lỗi |
| Đổi nhóm một dòng | Bút → chọn nhóm → Lưu (3) | Bút → chọn nhóm (2) |
| Sửa hàng loạt (nhóm / server / dán bảng / ngừng quản lý) | … → Xem trước → Lưu | … → Áp dụng (bớt 1 bước) |
| Hoàn tác | Chọn thao tác → nhập lý do (bắt buộc) → Xác nhận (3) | Chọn thao tác → Hoàn tác (2) |

## Kiểm chứng

- `assignment-state.integration.test.ts` cập nhật theo quyết định mới:
  - LIVE không VM được lưu; chọn lại cùng giá trị không ghi lịch sử.
  - NEW trên dòng đang giữ phải kèm bỏ gán.
  - Gán lại VM hiện tại (Chờ cài và Đã cài) là SKIP "Đã ở VM này".
  - Đồng bộ chỉ sửa NEW đang giữ.
  - Hoàn tác với lý do trống chạy được.
  - Cấp trùng VM đồng thời vẫn chỉ một người thắng.
- Suite 293 tests / 73 files, tsc, lint (4 cảnh báo cũ), build đều qua.
- Giao diện thật trên bản sao local của mooon. Video: `bdops-proxy-app/.runtime/evidence/2026-10-16-quick-edit-local.webm`, ngoài Git, khoảng 12 MB.

| Bước | Kết quả |
|---|---|
| `84.32.136.57` (TUT, chưa gán) chọn LIVE | "Đã lưu" → LIVE, vẫn *Chưa gán* |
| Chọn lại LIVE | Không có gì, 0 popup |
| Tick 2 dòng → LIVE → Áp dụng | "Đã lưu 2 dòng" |
| Đưa 3 dòng về NEW | Một lần Áp dụng |
| Bút → An-01 → VM_004 | Lưu ngay, LIVE, *An-01 VM_004 · Chờ cài* |
| Dán lại `84.32.136.57 \| An-01 \| VM_004` | "Không thay đổi" |
| Dán `178.95.180.143 \| An-01 \| VM_004` | "1 dòng bị chặn: VM đang giữ hoặc dùng proxy 84.32.136.57"; dòng đó vẫn NEW |
| Chọn NEW trên dòng đang ở VM_004 | 1 hộp xác nhận "Bỏ gán An-01/VM_004 · Chờ cài để về NEW?" → Đã lưu, NEW, Chưa gán |

Tổng popup cả buổi: 1, đúng trường hợp thay đổi phân bổ.

## Railway

- Backup `9e564d63-bd14-4bb6-933d-19ac7001c003`, rồi deploy `8e28ffbb-2a00-4dbd-9e35-92ef087bbb2d` SUCCESS. Verify 10 server / 576 VM.
- Host mooon, chỉ xem: 30 ô trạng thái hiện trong lọc nhóm chung. Thanh chọn 2 dòng có *Trạng thái… · Áp dụng*. Không bấm Áp dụng, không popup (ảnh `host-*.png`). Dữ liệu thật không đổi.

## Giới hạn

1. Video quay trên bản sao local, không quay trên host, để không ghi thử vào dữ liệu thật.
2. Ô trạng thái ở nền tối dùng kiểu chọn của trình duyệt; mũi tên nhỏ khó thấy.
3. Thêm proxy mới, nhận replace và đối chiếu Sheet vẫn có bước kiểm tra trước khi lưu, vì là nhập dữ liệu nhiều dòng.
