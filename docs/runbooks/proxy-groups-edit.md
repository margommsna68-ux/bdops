# Nhóm proxy (Từ nhóm) và sửa nhóm / server / VM ngay trong bảng proxy

Triển khai 16/10/2026 theo yêu cầu "quản lý proxy theo gói, nhóm, server và VM; sửa một dòng hoặc nhiều dòng nhanh như bảng tính". Bằng chứng: `../superpowers/evidence/2026-10-16-proxy-groups-edit.md`. Lọc server, copy xem `proxy-registry.md`; gói proxy xem `proxy-packages.md`.

## Cột và tên hiển thị

| Cột | Nội dung |
|---|---|
| Gói proxy | mã gói, luôn hiện (kể cả khi bảng đang nhóm theo gói); `Chưa rõ gói` khi chưa xác định |
| IP proxy | IP + port |
| Từ nhóm | **TUT** (kho của anh, sở hữu `SELF`), **genjy** (+ *PC chung*), tên nhóm tự đặt, hoặc *Chưa xác định* |
| Server / VM / Ghi chú vận hành | như trước, tách riêng; không ghép *Chờ cài* vào tên máy |

"Thuộc về" → "Từ nhóm"; "Của anh" → "TUT" trên mọi màn proxy/VM. Từ nhóm và Gói proxy độc lập nhau.

## Nhóm proxy

- Dữ liệu: bảng `ProxyGroup` (theo dự án, tên chuẩn hóa duy nhất) + cột `ProxyIP.groupId`; giá trị sở hữu mới `OTHER` cho proxy trong nhóm tự đặt. Dữ liệu cũ giữ nguyên: `SELF` hiện là TUT, `GENJY` là genjy.
- **TUT** không phải dòng trong `ProxyGroup`; nhóm tự đặt không bao giờ là TUT: không được autofill (`getEligibleInventory` chỉ lấy `SELF`), không gán VM, không cài. Chỉ proxy TUT đủ điều kiện mới điền VM.
- **genjy / PC chung** luôn thuộc Genjy: không đổi nhóm, không gán VM từ bảng; giữ qua blocked/replace như trước.
- Tên nhóm: cắt khoảng trắng thừa, so trùng không phân biệt hoa/thường (`Nhóm A` = `nhóm  a`); tên có sẵn (`TUT`, `genjy`, `PC chung`…) bị từ chối. Tối đa 60 ký tự.
- **Nhập mới**: ô *Từ nhóm* chọn TUT / genjy / nhóm đã có / *Nhóm mới…* (nhập tên). Nhóm mới được tạo lúc lưu đợt nhập và chọn lại được ở lần sau; tên trùng báo `Nhóm "X" đã có; chọn nhóm sẵn có`.
- **Lọc Từ nhóm** (thay ô sở hữu): Tất cả / TUT / genjy / từng nhóm / Chưa xác định; kết hợp với gói, server, trạng thái, tìm kiếm; URL `?group=TUT|GENJY|UNKNOWN|<id nhóm>`. Ô tìm kiếm khớp cả tên nhóm.
- API: `proxyManagement.groups`, `createGroup`; `list` nhận `group`; `preview` (NEW) nhận `owner: OTHER` + `groupId` hoặc `newGroup:{name}`.

## Sửa một dòng (biểu tượng bút ở cuối dòng)

Mở một dải chỉnh ngay dưới dòng (không popup): **Từ nhóm**, **Server**, **VM** (chỉ VM trống trên server đó + VM hiện tại; VM đang giữ/dùng proxy khác không hiện), nút **Lưu**, **Bỏ gán**, **Huỷ**. Lưu = kiểm tra rồi ghi luôn nếu không lỗi; có lỗi thì hiện ngay dưới dải. Dòng genjy không có nút sửa; dòng nhóm tự đặt chỉ sửa được nhóm.

## Sửa hàng loạt (tick ô đầu dòng)

Thanh *Đã chọn N proxy* → **Đổi nhóm** / **Chuyển server** / **Gán VM** / Copy proxy / Bỏ chọn. Bảng chỉnh mở ngay dưới thanh, luôn có **Xem trước** (proxy, giá trị hiện tại, giá trị mới, kết quả/lý do) rồi **Lưu N dòng hợp lệ** một lần; thông báo *Đã ghi N dòng · M giữ nguyên · K lỗi*.

- **Đổi nhóm**: một nhóm (hoặc nhóm mới) áp cho mọi dòng đã chọn.
- **Chuyển server**: mỗi proxy nhận VM trống kế tiếp trên server đích (ô proxy `BLANK`, không ai giữ/dùng, thứ tự tự nhiên `VM_002 < VM_010`); proxy đã ở server đó giữ nguyên; hết VM trống → lỗi *Hết VM trống trên server*.
- **Gán VM**: dán mỗi dòng `Proxy | Server | VM` (ngăn bằng `|` hoặc tab; ô dán có sẵn dòng mẫu của các proxy đã chọn). Ghép theo danh tính proxy (IP, hoặc đầy đủ `IP:port:user:pass` khi IP có nhiều proxy) và Server + mã VM, không theo thứ tự dòng, không tự tạo VM. Ô Server/VM trống = giữ nguyên; `-` ở cột Server = bỏ gán. Một VM cho nhiều proxy trong cùng đợt, hoặc một proxy ở nhiều dòng → lỗi cả các dòng đó.

## Quy tắc liên kết server/VM

- Vị trí là dữ liệu có cấu trúc (hold `VMProxyAllocation` + cấu hình VM), không sửa chuỗi hiển thị. Gán VM = giao cấu hình mới (`VMConfiguration` + hold *Chờ cài* + việc cài), server luôn là server của VM đó; người vận hành vẫn xác nhận cài theo luồng Việc cài / Server-VM.
- Chỉ **bản giao Chờ cài chưa bắt đầu cài** mới chuyển/bỏ gán được từ bảng. *Đã cài*, *Giữ để kiểm tra* hoặc đã bấm *Bắt đầu cài* → lỗi, không tự đổi; xử lý ở Server/VM.
- VM đích phải trống: đang giữ/dùng proxy khác (hold bất kỳ, cấu hình chờ/đã cài, liên kết Sheet) → lỗi *VM đang giữ hoặc dùng proxy X*; không tự chiếm hay ghi đè.
- Bỏ gán / chuyển đi: huỷ cấu hình chờ, huỷ việc cài, thả hold (lý do ghi rõ), xoá liên kết Sheet nếu có; VM không còn gì thì ô proxy về `BLANK` để có thể điền lại.
- Đổi nhóm cho proxy đang giữ/cài trên VM bị từ chối (bỏ gán trước) để nhóm không bao giờ lệch với kế hoạch VM.

## Kiểm soát

- Quyền kiểm tra tại backend mỗi lần gọi: đổi nhóm cần quyền nhập proxy (`IMPORT`), chuyển server/VM/bỏ gán cần quyền gán VM (`ASSIGN`); dự án phải bật PROXY_VM; mọi id phải thuộc dự án.
- Luồng `editPreview` → `editCommit` dùng `ProxyBatch` kind `PROXY_EDIT`: idempotency key + hash payload (cùng key khác dữ liệu → từ chối), bản xem trước hết hạn 10 phút, lúc lưu lập kế hoạch lại trong transaction và so revision proxy/VM/hold/nhóm (đổi là `STALE_PREVIEW`). Cùng key + cùng dữ liệu → trả lại kết quả cũ, không ghi lần hai. Dán lại cùng dữ liệu khi đã đúng vị trí → mọi dòng *Giữ nguyên*, không có gì để lưu, không thêm lịch sử.
- Nhật ký thao tác kind `PROXY_EDIT` (Lịch sử thao tác: *Sửa nhóm / vị trí proxy*) lưu ảnh trước/sau của proxy (gồm nhóm và sở hữu), VM, cấu hình, hold, việc cài; **Hoàn tác** khôi phục cả sở hữu TUT↔nhóm và vị trí, chỉ khi dữ liệu chưa bị sửa tiếp. Audit `PROXY_EDIT` ghi số lượng, không ghi credentials.
- Copy một dòng / hàng loạt và SDK không đổi; SDK vẫn không có trên trang proxy.

## Giới hạn

- Chưa đổi tên / xoá nhóm; nhóm trống vẫn nằm trong bộ lọc.
- VM có ô proxy Sheet là công thức / placeholder / chưa rõ vẫn chọn được khi gán VM tay (không được tự chọn khi *Chuyển server*).
- Sửa dòng chỉ dành cho proxy có endpoint trong dự án (dòng chỉ có IP genjy không sửa được).
