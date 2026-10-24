# Trạng thái NEW / LIVE theo phân bổ VM

Quy tắc chốt ngày 16/10/2026. Bằng chứng: `../superpowers/evidence/2026-10-16-proxy-state.md`.

## Quy tắc

- Bổ sung 24/10/2026: nếu proxy hiện hành xác định rõ là BLOCKED, không đặt VM thành OK / Chưa nối / LINKED. Thay proxy theo luồng hiện hành; OFF, SUS và lỗi vẫn ghi được. Đây là chặn mâu thuẫn dữ liệu, không phải tự xác nhận máy đã chạy tốt.

- **NEW**: proxy đủ điều kiện trong kho, chưa gán VM.
- **LIVE**: proxy người dùng ghi nhận **đang sử dụng**, kể cả khi chưa cập nhật vị trí VM (quyết định 16/10, thay quy tắc cũ bắt LIVE phải có VM). Gán VM thành công thì tự chuyển LIVE. LIVE **không** có nghĩa đã cài thật hay đã kiểm tra mạng.
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

Chọn server mà chưa chọn VM thì không lưu gì. Gán lại đúng vị trí hiện tại thì giữ nguyên, không báo lỗi. Bỏ gán bản cuối cùng thì về NEW; LIVE không có VM do người dùng chọn thì không bị tự đổi. Nút *Chuyển server* hàng loạt tự lấy VM trống, nên đó là gán VM thật và chuyển LIVE.

## Thao tác (ít bước nhất)

- **Tại dòng**: ô trạng thái ngay trong bảng, chọn NEW / LIVE / BLOCKED là lưu, hiện "Đã lưu". Chọn lại giá trị đang có thì không làm gì, không ghi lịch sử. Riêng NEW trên dòng đang giữ VM sẽ hỏi một lần "Bỏ gán … để về NEW?", vì thao tác này thay đổi phân bổ.
- **Hàng loạt**: tick dòng, chọn ở ô *Trạng thái…*, bấm **Áp dụng**. Dòng hợp lệ được lưu; dòng bị chặn hiện lý do ở thông báo.
- **Gán VM**: nút bút, chọn Server, chọn VM là lưu ngay. Danh sách chỉ có VM trống và VM hiện tại. Đổi nhóm cũng lưu khi chọn; nhóm mới thì gõ tên rồi bấm *Lưu nhóm mới*.
- **Sửa hàng loạt** (Đổi nhóm, Chuyển server, Gán VM theo bảng dán, Ngừng quản lý, Khôi phục): bấm **Áp dụng** một lần, không qua bước xem trước. Dòng bị chặn hiện ngay trong khung, nội dung đang nhập vẫn giữ.
- **Hoàn tác**: lý do không bắt buộc, bấm **Hoàn tác** là xong.
- Backend vẫn kiểm tra quyền, dự án, revision, cấp trùng VM, trùng IP, sở hữu và nhóm chung. Trạng thái không thay cho điều kiện cấp phát: autofill vẫn chỉ lấy NEW chưa ai giữ và đủ điều kiện kho. Không đổi trạng thái được để hồi sinh proxy đã replace hay ngừng quản lý; phải dùng *Khôi phục*.

## Đồng bộ dữ liệu cũ

**Thiết lập → Đồng bộ NEW / LIVE**: chỉ sửa dòng NEW mà VM đang giữ thành LIVE (*Đang giữ ở … · Chờ cài*). LIVE không có VM là hợp lệ nên không bị liệt kê. Xem trước rồi lưu một lần; mỗi dòng ghi sự kiện `STATE_SYNC` và hoàn tác được.
