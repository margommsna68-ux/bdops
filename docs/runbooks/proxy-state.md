# Trạng thái NEW / LIVE theo phân bổ VM

Quy tắc chốt ngày 16/10/2026. Bằng chứng: `../superpowers/evidence/2026-10-16-proxy-state.md`.

## Quy tắc

- **NEW**: proxy đủ điều kiện trong kho, chưa gán VM.
- **LIVE**: proxy đã được gán cho VM trên web, tức có bản giao *Chờ cài* hoặc *Đã cài*. LIVE **không** có nghĩa đã cài thật hay đã kiểm tra mạng.
- Bản *Giữ để kiểm tra* không tính là đã gán. Khi còn bản này, proxy không được đưa lại vào kho NEW.
- Chỉ áp cho **TUT** và **Chung mooon–Genjy**, hai nhóm được nằm trên VM của anh. Genjy riêng và nhóm tự đặt giữ trạng thái như cũ.
- **BLOCKED, cần kiểm tra, đã replace, ngừng quản lý** không bao giờ tự đổi thành NEW hay LIVE.
- Lịch sử vẫn giữ mọi bản giao cũ (đã thả), nên biết proxy từng gán ở đâu.

## Mọi đường gán dùng chung một hàm

Hàm `syncAssignmentState` (`src/server/proxy-management/assignment-state.ts`) chạy trong cùng giao dịch với việc giữ hoặc thả VM. Các đường gọi:

- Gán từng dòng, chuyển server hàng loạt, dán bảng `Proxy | Server | VM`, bỏ gán, huỷ giao khi ngừng quản lý, khôi phục (bảng proxy).
- Giao proxy và autofill *Điền VM thiếu* (Server/VM), thay kế hoạch chưa bắt đầu.
- Xác nhận cài. Proxy cũ đã bắt đầu cài rồi bị thay thì sang *Cần kiểm tra*, không về NEW.
- Hoàn tác: trả cả phân bổ lẫn trạng thái theo ảnh chụp trước–sau.

API cho nhân viên và AI dùng chung các endpoint này, không có đường tắt.

Chọn server mà chưa chọn VM thì không lưu gì, nên proxy vẫn NEW. Nút *Chuyển server* hàng loạt tự lấy VM trống, nên đó là gán VM thật và chuyển LIVE.

## Thao tác trạng thái

- **Tại dòng**: bấm huy hiệu NEW/LIVE (hoặc nút bút) rồi chọn ô *Trạng thái*.
  - **LIVE** khi chưa có VM: hướng dẫn chọn Server/VM bên cạnh. Lưu thì giao VM và chuyển LIVE trong một lần.
  - **NEW** khi đang giữ VM: lưu sẽ bỏ gán hoặc huỷ giao rồi về NEW (chưa gỡ ngoài máy).
  - **BLOCKED**: theo quyền báo BLOCKED; giữ vị trí VM, ghi sự kiện BLOCKED. Nhận replace sau như cũ.
- **Hàng loạt**: tick dòng rồi bấm **Trạng thái**, chọn NEW (tick *Bỏ gán / huỷ giao* nếu cần), LIVE hoặc BLOCKED. Xem trước nêu từng dòng hợp lệ hay bị chặn và lý do.
- Không sửa trạng thái được để vượt chặn cấp trùng, gói tắt hay Genjy riêng, cũng không xoá lịch sử replace. Server luôn kiểm tra quyền, revision, lưu lặp và thao tác đồng thời.
- Bộ lọc trạng thái hiện số dòng của từng trạng thái theo các bộ lọc đang bật.

## Đồng bộ dữ liệu cũ

**Thiết lập → Đồng bộ NEW / LIVE**: bấm xem trước để thấy danh sách dòng lệch kèm lý do (*Đang giữ ở … · Chờ cài* hoặc *Không còn VM nào giữ*), rồi lưu một lần. Mỗi dòng ghi sự kiện `STATE_SYNC` và hoàn tác được.
