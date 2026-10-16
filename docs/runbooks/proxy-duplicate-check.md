# Kiểm tra trùng khi mua proxy mới và nhận replace

Hoàn thiện 16/10/2026 trên nền chống trùng đã có (kho chuẩn hoá theo IP từ 14/10). Bằng chứng: `../superpowers/evidence/2026-10-16-proxy-duplicate-check.md`. Liên quan: `proxy-packages.md` (chọn gói khi nhập), `proxy-groups-edit.md` (chọn nhóm), `proxy-retire-reminders.md` (Ngừng quản lý / Khôi phục).

## Nguyên tắc nhận diện

- IP được chuẩn hoá trước khi so (bỏ số 0 thừa, kiểm tra 4 octet, port 1–65535). **Cùng IP là trùng** dù khác port, user, pass hay gói.
- Đối chiếu toàn bộ lịch sử, không giới hạn chu kỳ: kho hiện tại (mọi trạng thái, kể cả BLOCKED / cần kiểm tra), proxy đang giao / đã cài trên VM, danh tính Genjy / PC chung và bằng chứng nguồn Genjy, dòng đã replace / ngừng quản lý / hoàn tác / DIE, sự kiện đã ghi, các lần nhận replace trước, và **các dự án khác** (chỉ báo "thuộc dự án khác", không lộ server / VM / tên dự án).
- Không xoá dấu vết: muốn dùng lại IP đã ngừng quản lý thì **Khôi phục** ở Lịch sử IP, không nhập lại thành NEW.
- **Ngoại lệ nhiều cổng** chỉ theo danh tính đã duyệt (`ProxyIdentity.allocationMode = APPROVED_PORT_STREAM`, hiện là IP port stream nhập từ Sheet 15/10): cùng chủ sở hữu được thêm cổng khác; **cùng cổng** vẫn là trùng, lịch sử của cổng đó vẫn tính, chủ khác / nhóm khác bị từ chối. Không suy ngoại lệ theo nhà cung cấp hay dải IP. Mỗi cổng có khoá kho riêng `identity:port`, nên hai người cùng thêm một cổng không thể cùng thành công.

## Preview từng dòng (Nhập mới)

Mọi dòng dán đều có kết quả riêng; không dòng nào bị bỏ hay đổi thứ tự:

| Kết quả | Mã | Ý nghĩa |
|---|---|---|
| Hợp lệ | — | IP mới đủ điều kiện (hoặc *Thêm cổng vào IP nhiều cổng đã duyệt*) |
| Trùng | `DUPLICATE_INPUT` | Trùng IP với dòng N trong cùng danh sách dán (dòng đầu được xét, dòng sau bị từ chối) |
| Trùng | `CURRENT_IP` | Đã có trong kho (trạng thái) · server/VM nếu đang giao hoặc đã cài; hoặc *IP đang thuộc dự án khác* |
| Trùng | `HISTORICAL_IP` | Đã replace bằng X ngày …, Đã ngừng quản lý ngày … (khôi phục ở Lịch sử IP), Đã hoàn tác / huỷ ghi nhận, Đã ghi DIE, Từng BLOCKED… |
| Trùng | `GENJY_RESERVED` | IP dành cho Genjy (kèm trạng thái / VM nếu dự án này đang giữ) |
| Cần kiểm tra | `INVALID_INPUT` / `PACKAGE_MISMATCH` / `OWNER_CONFLICT` | Sai định dạng, thiếu port/user/pass, user/pass không khớp gói đã chọn, PC chung không thuộc Genjy |

Dòng trùng / lỗi **không bao giờ** tạo proxy hay thành NEW. Vẫn chọn gói (tự nhận / gói sẵn có / gói mới + site) và nhóm (TUT / genjy / nhóm tự đặt) như trước.

## Nhận replace

- Dòng N ô *Proxy cũ* ghép dòng N ô *Proxy mới* theo **vị trí**: dòng trống hoặc dòng lỗi giữ nguyên chỗ, không làm lệch các cặp sau; trống ở một bên → `COUNT_MISMATCH` cho đúng cặp đó; cả hai bên trống → bỏ qua. Vẫn nhận thông điệp nhà cung cấp dán nguyên khối (*Removed IPs … Added IPs …*).
- IP mới viết tắt kế thừa port/user/pass của **đúng proxy cũ cùng cặp**; nhập đầy đủ thì giữ thông tin đã nhập.
- Kiểm tra cả hai phía, báo rõ từng cặp: proxy cũ không tìm thấy / có nhiều endpoint / chưa BLOCKED; **proxy cũ trùng cặp dòng N**; **IP mới trùng cặp dòng N**; **IP mới trùng proxy cũ ở cặp dòng N trong cùng đợt**; IP mới bằng IP cũ (*IP thay thế giống IP cũ*, không coi là đã thay); IP mới trùng kho / VM / dự án khác / lịch sử (cùng thông điệp như nhập mới).
- Sở hữu và chuỗi A→B→C giữ nguyên; ngoại lệ hoàn thiện bare-IP Genjy chỉ khi nguồn Genjy chứng minh IP mới thuộc cùng Genjy / cùng nhóm con, không có thông tin tay, không mở rộng thành bỏ qua kiểm tra trùng. Replace không chạm ngày đến hạn gói.

## Thao tác gọn

- Sau *Kiểm tra và lưu*: dòng tóm tắt **N hợp lệ | N trùng | N cần kiểm tra** (+ N giữ nguyên nếu có). Nút **Lưu N dòng hợp lệ** lưu các dòng / cặp hợp lệ trong một lần; dòng lỗi ở lại preview.
- **Copy N dòng bị từ chối**: `Dòng · IP (cũ → mới) · Trùng/Cần kiểm tra · lý do`, chỉ IP, **không** port/user/pass → không cần quyền copy credentials; nếu trình duyệt chặn clipboard, hiện ô để copy tay. Không gửi danh sách đi đâu.
- Dòng trùng hiện vị trí (*Đang ở server/VM* / *Chưa gán VM* / *Thuộc dự án khác*) và nút **Lịch sử** mở timeline của IP (chỉ với IP thuộc dự án này; quyền READ).

## Kiểm tra lại khi lưu (backend)

- `preview` và `commit` là đường ghi duy nhất cho UI và AI (`proxyManagement.preview/commit`). Lúc lưu, backend kiểm tra lại quyền, nguồn Genjy (hash phải khớp bản preview), revision của mọi danh tính / endpoint liên quan và catalog, rồi tính lại toàn bộ kế hoạch: khác bản preview → `STALE_PREVIEW`, kiểm tra lại.
- Hai người cùng nhận / nhập một IP: giao dịch Serializable + khoá duy nhất `ProxyIdentity.ip` và `ProxyIP.inventoryKey` (đang quản lý) → chỉ một đợt thành công, đợt kia báo kiểm tra lại. Bấm lại cùng yêu cầu (cùng `idempotencyKey`) trả đúng kết quả cũ, không thêm proxy / sự kiện / nhật ký.
- Preview, nhật ký, audit và thông báo không chứa user/pass.

## Giới hạn

- Danh sách bị từ chối chỉ copy IP + lý do; không có nút copy proxy đầy đủ bị từ chối (người dùng đã có nguyên văn đã dán).
- Ngoại lệ nhiều cổng chỉ áp dụng cho danh tính đã được duyệt trong DB (chưa có màn hình duyệt port stream; hiện chỉ IP port stream từ Sheet 15/10).
- Xung đột với dự án khác chỉ báo "thuộc dự án khác"; cần chủ hệ thống tra ở dự án đó.
