# Bảng kiểm điều hướng — 17/10/2026

Kiểm tra trên dữ liệu thử cục bộ: PROXY_TRIAL, DASH_EMPTY và các tài khoản `dash-*`. Kết quả từng bước nằm trong `result.txt` (33/33).

## Đã kiểm trên trình duyệt

| Điểm bấm | Mở tới | Đối chiếu |
|---|---|---|
| Thẻ Thiếu proxy / Chờ cài / Cần kiểm tra / Đã xác nhận cài | `/infrastructure/servers?view=…` | Số trên thẻ = tổng VM của danh sách |
| Đoạn biểu đồ VM | `/infrastructure/servers/<server>?view=…`, Back về Tổng quan | Đúng server và bộ lọc |
| Bảng số Kho proxy, ô TUT·NEW | `/infrastructure/proxies?group=TUT&state=NEW` | Số khớp; ô lọc hiện đúng |
| Cần xử lý → Proxy BLOCKED | `?state=BLOCKED` | Số khớp |
| Kho proxy: đổi trạng thái, Back/Forward, tab Lịch sử + tải lại, ô tìm | URL cập nhật | Bộ lọc theo URL |
| Chuông → proxy BLOCKED khi đang ở Kho proxy | Bộ lọc cập nhật tại chỗ | Ô tìm được xoá |
| Chưa có SDK / tài khoản EarnApp / PayPal | `?view=SDK_MISSING` / `ACCOUNT_MISSING` / `PAYPAL_MISSING` | Số khớp |
| Việc cài bị bỏ lại | `/vm-tasks#orphan` | Số khớp |
| Mở VM | `?vm=…&tab=install` | Esc đóng và giữ server; Đóng việc hoạt động |
| Việc giao nhân viên / Đối chiếu Sheet cũ | `/work`, `/work?kind=SHEET_REVIEW` | Mở đúng tab |
| Đổi tháng tài chính | `?month=` | Phần vận hành không đổi; tháng trống báo chưa có dữ liệu; tải lại giữ tháng; Back về tháng trước |
| Thẻ Chi phí | `/costs?month=…` | Đúng tháng |
| ⋯ của VM → Chi phí server | `/costs?server=…` | Chỉ báo hiện; lọc còn 1 dòng, Bỏ lọc ra 18 dòng |
| `/costs?cost=<không có>` và `/infrastructure/servers?vm=<không có>` | Thông báo kèm lối quay lại | |
| Menu Nhận USDT về team / Tiền vào PayPal / Rút–chuyển gốc | Ba trang khác nhau | Mục sáng đúng theo query |
| Màn 390px | Không cuộn ngang | Cần xử lý hiện trước biểu đồ |
| Dự án trống | Trạng thái trống | Không có biểu đồ giả; ADMIN thấy lời mời bật thu chi |
| Nhân viên (Server/VM) | Chỉ phần vận hành | Menu không có mục tiền / quản trị |
| Kế toán (COSTS/PROFIT/WITHDRAWALS) | Chỉ phần tài chính | Menu không có Server/VM, Dự án |
| Người không có module | Báo chưa được cấp mục nào | Menu không có liên kết sẽ bị từ chối |

## Lỗi đã sửa

- **BusinessOverview đếm cả SHEET_REVIEW:** số đếm đã tách riêng; liên kết mở đúng tab.
- **Liên kết của ProxyDashboard và chuông:**
  - BLOCKED mở `?state=BLOCKED`.
  - Thiếu proxy mở `?view=MISSING`.
  - Cần kiểm tra mở `?view=REVIEW`.
  - "Xem VM" mở đúng server, VM và tab.
- **Chi phí server:** `?server=` trước đây không áp dụng trên màn USDT.
- **RegistryTable:** trước đây chỉ đọc URL một lần; tab kho/lịch sử không có trong URL.
- **Nút tiền:** các nút cùng trỏ `/withdrawals` nhưng mang nghĩa khác nhau.
- **Việc cài còn mở không còn cấu hình chờ cài:** trước đây không có nơi xử lý.
- **Menu:** mục Dự án và Nhật ký hiện cho MODERATOR, người sẽ bị từ chối khi mở.
- **Chuông thông báo:**
  - Liên kết thanh toán gói hiện cả với người không có quyền chi phí.
  - Tác vụ quá hạn của dự án cũ mở `/infrastructure/vms` thay vì `/vm-tasks`.

## Chưa kiểm

- Trên host chỉ đọc và xem, không ghi.
- Chưa kiểm VIEWER trên trình duyệt; quyền đóng việc của VIEWER chỉ có test tự động.
- Chưa kiểm trang LegacyPage của dự án loại cũ trên trình duyệt; chỉ build.
- Chưa kiểm theme sáng và golden.

## Phát hành

- Commit `7a8e920` + `8aa9bcf`; backup host `b35fc71a` (trước lần 1) và `7ed395df` (trước lần 2); deploy `7895cb62` và `9e949504` SUCCESS; không migration.
- Host chỉ đọc: 10 server / 576 VM. Tổng quan mooon: Chờ cài 553 = Server/VM 553, Cần kiểm tra 23 = 23, TUT·LIVE 553 = Quản lý proxy 553. Không ghi dữ liệu (chỉ xác thực PIN và heartbeat phiên).
