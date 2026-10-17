# Gói proxy: site, giá, ngày thanh toán, nhập gắn gói, sắp xếp

Triển khai 16/10/2026 theo thiết kế `../superpowers/specs/2026-10-15-proxy-package-design.md`. Bằng chứng: `../superpowers/evidence/2026-10-16-proxy-package.md`. Quy cách sắp xếp lấy theo Sheet proxy của anh: **Gói → Server → VM → IP**.

## Gói proxy

Mở **Kho proxy → Thiết lập → Gói proxy**. Bảng gói hiện tên gói, site, giá / chu kỳ, ngày đến hạn (kèm *còn N ngày* / *quá hạn N ngày*), số proxy đang quản lý, nút **Sửa** và **Đã thanh toán**.

- **Thêm gói**: tên gói (ví dụ `240292`, `Account VietPhe`), site/nhà cung cấp, user/pass (bắt buộc khi tạo), giá mỗi chu kỳ, đồng tiền (USD/USDT/VND), chu kỳ tính theo tháng, ngày đến hạn tiếp, ghi chú.
- **Sửa**: để trống user/pass là giữ nguyên. Tên gói không đổi được (là mã nhận diện).
- Mỗi gói một cặp user/pass; proxy dán vào được nhận diện gói theo cặp đó. Sửa gói là một thao tác trong Lịch sử, hoàn tác được.

## Nhập proxy gắn gói

Trong **Nhập mới** có ô **Gói proxy**:

| Chọn | Kết quả |
|---|---|
| Tự nhận theo user/pass | Như trước: khớp gói theo user/pass; không khớp thì vào *cần kiểm tra gói* |
| Một gói sẵn có | Dòng có user/pass đúng gói → hợp lệ; thuộc gói khác hoặc không khớp → *cần kiểm tra* |
| Gói mới… | Nhập tên gói + site. Tất cả dòng phải cùng một user/pass chưa thuộc gói nào. Lưu sẽ tạo gói cùng đợt; hoàn tác đợt thì gói bị tắt |

Tên gói mới trùng gói cũ bị từ chối ngay. Nhận replace giữ gói của proxy cũ.

## Thanh toán và nhắc đến hạn

- Bấm **Đã thanh toán** ở gói → mở đúng form Chi phí, điền sẵn loại *Proxy*, gói, số tiền = giá, đồng tiền, ngày hôm nay, và ô **Dời ngày đến hạn của gói … sang** (mặc định = ngày đến hạn hiện tại hoặc ngày chi, cộng một chu kỳ; sửa được). Lưu là một lệnh: ghi khoản chi quy về USDT và dời hạn, cùng một mục trong Lịch sử thao tác; hoàn tác trả lại ngày cũ và thu hồi khoản chi.
- Form **Chi phí** thông thường cũng hiện ô này khi chọn loại Proxy và một gói.
- Tổng quan có mục **Gói proxy sắp đến hạn** (quá hạn hoặc ≤ 7 ngày) → mở Kho proxy với bộ lọc *Sắp đến hạn / quá hạn*. Trang proxy có thẻ **Gói sắp đến hạn** và dòng tiêu đề mỗi gói hiện `site · giá / chu kỳ · đến hạn dd/mm/yyyy (còn N ngày)` với huy hiệu cam/đỏ. Không gửi email.
- "Hôm nay" tính theo lịch Việt Nam (Asia/Bangkok).

## Sắp xếp và lọc

Từ 16/10 (mốc bảng proxy) có thêm ô **Lọc server** nhiều lựa chọn, cột Server/VM tách riêng và copy một bấm / hàng loạt: xem `proxy-registry.md`.

**Kho proxy**: ô **Gói proxy** (tất cả / sắp đến hạn / từng gói) và **Sắp xếp**: *Theo gói (như Sheet)* → gói (số trước, chữ sau, chưa rõ gói cuối) → server → VM → IP; *Theo server / VM* (chưa gán VM xếp cuối); *Ghi nhận mới nhất*; *Theo IP*. Lựa chọn giữ trên URL (`?sort=`, `?package=`), dòng tiêu đề nhóm gói chỉ hiện khi sắp theo gói. Mã server/VM so sánh theo số tự nhiên (`VM_2` trước `VM_10`).

**Server / VM**: ô **Sắp xếp** (`?sort=`): theo server / mã VM; chưa có SDK trước; thiếu proxy trước. SDK chỉ quản lý ở trang này, không ở trang proxy.

## Quyền và dữ liệu

MANAGE để sửa gói và nhập; module Chi phí (COSTS, team cash bật) để ghi thanh toán. AI và nhân viên dùng cùng endpoint: `proxyManagement.saveCatalog` / `catalog` / `preview` (thêm `packageCode` hoặc `newPackage`) / `list` (thêm `sort`, `due`) và `businessManagement.saveCashCost` (thêm `packageDue`).

Migration `20261016000000_proxy_package_terms`: thêm `site`, `note`, `price`, `priceCurrency`, `cycleMonths`, `nextDueDate`, `lastPaidAt`, `updatedAt` vào `ProxyProviderAccount`; chỉ thêm. Ảnh nhật ký `ACCOUNT` ghi đủ trường mới; thanh toán thêm ảnh `PACKAGE` (ngày đến hạn, lần trả gần nhất).

## Chưa làm

Nhiều cặp user/pass trong một gói; lấy giá tự động từ site; email/thông báo đẩy; gia hạn tự động; lịch sử giá.
