# Ngừng quản lý proxy, nhóm/gói, hạn thanh toán và nhắc gia hạn

Triển khai 16/10/2026. Bằng chứng: `../superpowers/evidence/2026-10-16-proxy-retire-reminders.md`. Liên quan: `proxy-groups-edit.md` (sửa nhóm/server/VM), `proxy-packages.md` (gói, nhập gắn gói, sắp xếp).

## Ngừng quản lý (thay cho "xoá")

- Trạng thái `RETIRED` hiện là **Ngừng quản lý**: dòng rời tab *Đang quản lý*, còn ở *Lịch sử IP* / *Toàn bộ IP* cùng IP, user/pass mã hoá, nhóm, gói, sở hữu và mọi sự kiện. Không xoá cứng. IP đã ngừng quản lý **không nhập lại được** (báo *IP đã xuất hiện trước đây*); muốn dùng lại thì **Khôi phục**.
- **Một dòng**: nút bút → **Ngừng quản lý** → chọn lý do nhanh (*Hết hạn, không gia hạn* / *Nhà cung cấp thu hồi* / *Không dùng nữa* / *Nhập nhầm* / *Khác…*) → **Xác nhận**. **Hàng loạt**: tick dòng → **Ngừng quản lý** → một lý do cho cả đợt → **Xem trước** → **Lưu N dòng hợp lệ**.
- Theo tình trạng phân bổ:
  | Tình trạng | Kết quả |
  |---|---|
  | Chưa gán | ngừng quản lý ngay |
  | *Chờ cài* chưa bắt đầu | phải tick **Huỷ giao …** (xem trước nêu rõ server/VM); huỷ cấu hình chờ, việc cài và thả hold; VM về ô trống. Huỷ giao trên web **không** đồng nghĩa đã gỡ ngoài máy |
  | Đã bắt đầu cài / Đã cài / Giữ để kiểm tra | từ chối; thay hoặc gỡ proxy ở Server/VM rồi mới ngừng quản lý |
  | genjy / PC chung | từ chối: do Sheet Genjy quản, chỉ lọc/ẩn bằng ô *Từ nhóm* |
- **Khôi phục**: ở tab *Lịch sử IP*, nút bút → **Khôi phục** (hoặc tick nhiều dòng → **Khôi phục**). Trả về đúng trạng thái trước (NEW/LIVE/BLOCKED…); từ chối nếu IP đã có dòng khác đang quản lý.
- Mọi thao tác đi qua `editPreview`/`editCommit` (ProxyBatch `PROXY_EDIT`, idempotent, kiểm tra revision), ghi sự kiện `RETIRED`/`RESTORED` kèm lý do, nhật ký *Sửa nhóm / vị trí / ngừng quản lý proxy* và **hoàn tác** (khôi phục cả kế hoạch VM đã huỷ giao). Quyền: như nhập proxy (`IMPORT`), kể cả huỷ giao trong cùng đợt (đây là thu hồi khỏi kho, không phải giao mới).

## Nhóm và gói

- **Thiết lập → Nhóm proxy**: đổi tên ngay trong ô (id giữ nguyên, proxy và lịch sử không đổi; tên trùng hoa/thường bị chặn), **Lưu trữ** / **Mở lại**. Nhóm lưu trữ biến mất khỏi ô chọn (nhập mới, sửa dòng, đổi nhóm hàng loạt) nhưng proxy trong nhóm vẫn thuộc nhóm đó, **không tự chuyển về TUT**; vẫn lọc được. Nhật ký kind `GROUP`, hoàn tác được.
- **Tắt gói** (Thiết lập → Gói proxy → *Tắt gói*): chỉ chặn nhập/cấp mới (chọn gói khi nhập báo không có; tự nhận theo user/pass → *cần kiểm tra gói*). Proxy đang dùng, khoản chi, ngày đến hạn và nhắc thanh toán **giữ nguyên**; *Bật gói* mở lại. Sửa gói không còn tự bật lại gói.
- **Ngừng gia hạn**: nút riêng ở dòng gói (ghi lý do, xác nhận) — cách duy nhất để dừng nhắc khi gói có hạn. *Nhắc lại* bật lại. Ngày đến hạn không bị xoá.
- Không đổi nhóm/tắt-bật gói nào vượt được kiểm soát Genjy hay cấp phát: genjy không đổi nhóm, nhóm tự đặt không được điền VM, gói tắt không nhận proxy mới.

## Hạn thanh toán và nhắc gia hạn

- Mỗi gói: tên, site, giá dự kiến + đồng tiền, chu kỳ (tháng), **ngày đến hạn tiếp**, **nhắc trước N ngày** (mặc định 7, 1–90). Hạn thuộc gói thuê: BLOCKED, replace, đổi nhóm, chuyển VM, ngừng quản lý **không** chạm vào `nextDueDate`; không suy hạn từ ngày nhập.
- Bảng gói hiện ngày đến hạn, *còn N ngày* / *đến hạn hôm nay* / *quá hạn N ngày* / **Chưa đặt hạn**, nút **Ghi thanh toán** tại dòng, ô lọc: *Hạn gần nhất trước* / *Đã quá hạn* / *Chưa đặt hạn* / *Đã ngừng gia hạn*. Số tiền chỉ hiện với ADMIN hoặc thành viên có module Chi phí (người khác thấy *Ẩn theo quyền*).
- **Nhắc trên web** (chuông thông báo + *Việc cần làm → Gói proxy cần thanh toán*): mỗi gói đúng **một** thông báo `pkg-due-<id>` tính trực tiếp từ dữ liệu (không lưu, không trùng), xuất hiện khi còn ≤ N ngày hoặc quá hạn; mức: *info* (trong khoảng nhắc) → *warning* (≤ 3 ngày) → *error* (≤ 1 ngày, đúng hạn, quá hạn). Bấm thông báo mở **Quản lý proxy → Gói proxy** với form *Ghi thanh toán* của đúng gói (`?package=…&pay=…`). Ngày tính theo Asia/Bangkok. Gói tắt vẫn nhắc; gói ngừng gia hạn hoặc chưa đặt hạn thì không. Quá hạn chỉ là nhắc thanh toán, không kết luận proxy mất kết nối.

## Ghi thanh toán

- **Ghi thanh toán** mở form Chi phí hiện có, điền sẵn gói, giá dự kiến, đồng tiền, ngày hôm nay; người dùng xác nhận **số thực trả**, ngày, tỷ giá (nếu không phải USDT) và ngày đến hạn mới (gợi ý = hạn hiện tại + một chu kỳ, cuối tháng được kẹp). Form hiện **Hạn: cũ → mới** trước khi lưu.
- Một lần lưu = một giao dịch: khoản chi `IP_PROXY` (giữ tiền gốc, tỷ giá, USDT quy đổi) + dời hạn + `lastPaidAt`, khoá bằng `key` (bấm hai lần cùng key → một khoản), kiểm tra revision gói, khoá kỳ tài chính. Hoàn tác trong Lịch sử thao tác thu hồi khoản chi và trả lại hạn cũ nếu chưa bị sửa tiếp.

## API (AI và nhân viên dùng chung)

`proxyManagement.editPreview/editCommit` (`items[].manage = {kind:'RETIRE', reason, releasePlans?} | {kind:'RESTORE'}`), `renameGroup`, `archiveGroup`, `groups({activeOnly})`, `saveCatalog` (+ `reminderDays`, `disabled`), `setPackageRenewal`, `catalog` (+ `reminderDays`, `renewalStoppedAt`, `reminder`, `priceHidden`), `notification.alerts` (type `PACKAGE_DUE`), `businessManagement.saveCashCost` (+ `packageDue`). Migration `20261016150000_proxy_retire_reminders` chỉ thêm (`RETIRED`, `ProxyGroup.archivedAt`, `reminderDays`, `renewalStoppedAt`, `renewalStopNote`).

## Giới hạn

- Chưa xoá cứng; chưa gộp nhiều đợt thuê khác hạn trong cùng gói (mỗi gói một hạn; nếu thực tế có nhiều đợt, tách gói hoặc chốt cách quản lý trước).
- Thông báo chỉ trên web; không email/Telegram.
- Nhóm lưu trữ chưa xoá được; gói chưa xoá được (chỉ tắt).
