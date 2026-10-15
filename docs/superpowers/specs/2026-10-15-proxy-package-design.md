# Gói proxy: site, giá, ngày thanh toán, nhập gắn gói, sắp xếp — thiết kế 15/10/2026

Yêu cầu của anh (tối 15/10): sort thông minh để tìm đúng server / gói; khi nhập proxy ghi được tên gói và site để sau còn gia hạn; nhập tiền và nhắc khi gần tới lúc thanh toán proxy. Quy cách sắp xếp lấy theo Sheet proxy của anh (tab *Proxy Server*, *Total*, *final*): **Gói proxy → Server → VM → IP**; mỗi gói là một cột/khối riêng, trong gói xếp theo server rồi VM. SDK chỉ ở Server/VM, không vào trang proxy.

Tiếp tục mã hiện có: gói proxy = `ProxyProviderAccount` (nhận diện proxy theo user/pass), chi phí = `CostRecord` quy về USDT (`usdt-costs.ts`), nhật ký/hoàn tác dùng chung. Không viết lại.

## 1. Dữ liệu gói (migration chỉ thêm)

`ProxyProviderAccount` thêm: `site` (nhà cung cấp/site, tự do), `note`, `price` Decimal(24,8) + `priceCurrency` (USD/USDT/VND), `cycleMonths` Int mặc định 1, `nextDueDate` Date, `lastPaidAt`, `updatedAt`. Không đổi `code`/`label`/credential. `CostRecord` đã có `proxyAccountId`, không đổi.

Mỗi gói một cặp user/pass như hiện nay. Giá là giá dự kiến mỗi chu kỳ để điền sẵn khi thanh toán; chi phí thật là khoản chi đã ghi.

## 2. Sửa gói

Hộp **Gói proxy** thành bảng: tên gói, site, giá/chu kỳ, đến hạn, số proxy đang quản lý, nút **Sửa** và **Đã thanh toán**. Form: tên gói, site, user/pass (bắt buộc khi tạo; để trống khi sửa là giữ nguyên), giá, đồng tiền, chu kỳ (tháng), ngày đến hạn tiếp, ghi chú. `saveCatalog` nhận các trường mới; ảnh `ACCOUNT` trong nhật ký ghi đủ trường để hoàn tác.

## 3. Nhập proxy gắn gói

Hộp **Nhập mới** thêm chọn **Gói proxy**: *Tự nhận theo user/pass* (như hiện nay), một gói sẵn có, hoặc **Gói mới…** (tên gói + site). Xem trước từng dòng:

| Tình huống | Kết quả |
|---|---|
| Chọn gói sẵn có, user/pass khớp gói | Hợp lệ, gói đó |
| Chọn gói sẵn có, user/pass thuộc gói khác | Cần kiểm tra: "User/pass thuộc gói X" |
| Chọn gói sẵn có, user/pass chưa có ở gói nào | Cần kiểm tra: "User/pass không khớp gói đã chọn; dùng Gói mới hoặc sửa gói" |
| Gói mới, tất cả dòng cùng một user/pass chưa thuộc gói nào | Hợp lệ; khi lưu tạo gói với user/pass đó cùng giao dịch, cùng đợt nhật ký (hoàn tác đợt xóa cả gói nếu gói chưa có proxy nào khác) |
| Gói mới, dòng có user/pass khác dòng đầu hoặc đã thuộc gói X | Cần kiểm tra |
| Không chọn gói | Như hiện nay: tự khớp, không khớp thì "cần kiểm tra gói" |

Tên gói mới trùng tên gói cũ → lỗi ngay. Nhận replace giữ gói của proxy cũ (không đổi).

## 4. Thanh toán và nhắc

- **Đã thanh toán** trên gói mở đúng form khoản chi hiện có, điền sẵn: loại *IP_PROXY*, gói, số tiền = giá, đồng tiền, ngày hôm nay; thêm ô **Dời ngày đến hạn sang …** (mặc định bật, = max(đến hạn hiện tại, ngày chi) + chu kỳ; sửa được). Lưu là một lệnh `TEAM_CASH_COST` duy nhất: ghi khoản chi và cập nhật `nextDueDate`, `lastPaidAt`, `revision` của gói (ảnh `PACKAGE` trong nhật ký; hoàn tác khoản chi trả lại ngày cũ). Form khoản chi trong Chi phí USDT cũng hiện ô này khi loại IP_PROXY và có chọn gói. Tỷ giá VND/USD theo luồng hiện có (Binance P2P hoặc nhập tay).
- Trạng thái hạn của gói: *quá hạn* (đến hạn < hôm nay), *sắp đến hạn* (≤ 7 ngày), *còn hạn*, *chưa đặt*. Tổng quan thêm mục **Gói proxy sắp đến hạn** (đếm quá hạn + sắp đến hạn) → trang proxy lọc `?package=due`. Trang proxy có thẻ **Sắp đến hạn** và dòng tiêu đề mỗi gói hiện `site · giá/chu kỳ · đến hạn dd/mm (còn N ngày | quá hạn N ngày)` tô cam/đỏ. Không gửi email/thông báo đẩy.

## 5. Sắp xếp và lọc

Trang **Quản lý proxy** thêm chọn **Sắp xếp** và lọc **Gói**, giữ trong URL (`?sort=`, `?package=`):

| Sort | Thứ tự |
|---|---|
| Gói (mặc định, theo Sheet) | gói (số trước, chữ sau, chưa rõ gói cuối) → server → VM → IP → port |
| Server / VM | server → VM (số tự nhiên) → gói → IP; chưa gán VM xếp cuối |
| Ghi nhận mới nhất | ngày ghi nhận tình trạng giảm dần, chưa rõ ngày cuối → gói → IP |
| IP | IP số → port |

So sánh mã server/VM theo số tự nhiên (`VM_2` trước `VM_10`, `M-002` trước `M-010`). Dòng tiêu đề nhóm gói chỉ hiện khi sort theo gói. Phân trang con trỏ giữ nguyên.

Trang **Server / VM** thêm **Sắp xếp** (`?sort=`): mã VM (mặc định), chưa có SDK trước, thiếu proxy trước; vẫn chọn server như hiện nay.

## 6. Quyền, nhật ký, hoàn tác

Quyền như gói/proxy hiện nay: MANAGE để sửa gói và nhập; module COSTS để ghi thanh toán. Mọi ghi đi qua `proxyManagement.saveCatalog` / `preview` / `commit` và `businessManagement.saveCost` (AI và nhân viên cùng đường). Nhật ký: sửa gói = thao tác gói (ảnh ACCOUNT đủ trường); nhập mới có gói mới = một đợt gồm proxy + gói; thanh toán = một lệnh chi phí gồm ảnh COST + PACKAGE. Idempotency và revision như hiện có.

## 7. Kiểm thử

- Unit: so sánh sort (4 chế độ, số tự nhiên, nhóm chưa rõ cuối); trạng thái hạn theo ngày; tính ngày đến hạn mới.
- Integration: xem trước/lưu nhập mới với gói sẵn có / gói mới / lỗi (bảng mục 3) và hoàn tác đợt gói mới; `saveCatalog` trường mới + hoàn tác; thanh toán gói ghi chi phí USDT + dời hạn + hoàn tác trả lại ngày; `catalog` trả số proxy và trạng thái hạn; `list` sort/lọc gói và `package=due`.
- UI: hộp Nhập mới hiện chọn gói và gói mới; bảng gói với Đã thanh toán; trang proxy đổi sort/lọc đọc từ URL.
- Trình duyệt thật trên dự án mẫu trước khi đẩy host; host chỉ kiểm tra đọc.

## 8. Không làm trong mốc này

Nhiều cặp user/pass trong một gói; tự lấy giá từ site nhà cung cấp; email/thông báo đẩy; gia hạn tự động; lịch sử giá; SDK trong trang proxy.
