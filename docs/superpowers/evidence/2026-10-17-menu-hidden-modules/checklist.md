# Bảng kiểm menu gọn, module ẩn và điều hướng — 17/10/2026

Kiểm trên dữ liệu thử cục bộ: dự án PROXY_TRIAL (959 VM, 1.211 dòng proxy), DASH_EMPTY và các tài khoản `dash-*`.

- Kết quả từng bước:
  - `result-off.txt`: bản build mặc định, hai module ẩn, 42/42.
  - `result-on.txt`: bản build `NEXT_PUBLIC_MTH_MODULES=INSTALL_TASKS,WORK`, 3/3.
- Không quay video. Ảnh nằm cùng thư mục.

## Đã kiểm trên trình duyệt

| Luồng | Kết quả |
|---|---|
| Menu ADMIN | Tổng quan · Kho proxy · Server / VM · Kho tài khoản · Nhận USDT về team · Tiền vào PayPal · Rút / chuyển gốc · Chi phí · Lợi nhuận · Lịch sử thao tác · Nhân viên · Dự án · Thiết lập. Không còn Việc cài proxy, Giao việc, PayPal riêng. |
| Tổng quan | Không có khối Giao việc / Đối chiếu Sheet. Laptop 1440×900 thấy biểu đồ VM và Cần xử lý ở màn đầu. |
| Thẻ Chờ cài / Cần kiểm tra / Thiếu proxy | Số khớp danh sách Server / VM (387 / 5 / 565). |
| Proxy BLOCKED | Mở Kho proxy `?state=BLOCKED`, số khớp (3). |
| Gói proxy cần thanh toán | Mở danh sách gói, lọc "Hạn gần nhất trước". Đóng thì bỏ `packages` khỏi URL. |
| Dòng một gói | Mở thẳng form Ghi thanh toán của gói đó; ghi thử thành công trên dữ liệu thử. |
| Việc cài bị bỏ lại | Mở đúng VM ở tab Cài proxy. Đóng việc tại VM, số trên Tổng quan giảm 1. |
| Chưa có SDK / tài khoản EarnApp / PayPal | Bộ lọc thật ở Server / VM, số khớp (602 / 940 / 943), chip sáng. |
| Luồng VM | Danh sách lọc trang 2 → VM → tab Tài khoản → Kho tài khoản → Back về đúng VM, bộ lọc, trang, tab. Esc giữ bộ lọc và trang. |
| `/vm-tasks` | Chuyển tới Server / VM lọc Chờ cài; Back không vòng lại. |
| `/vm-tasks#orphan` | Chuyển tới lọc Việc cài bị bỏ lại. |
| `/vm-tasks?vm=` | Chuyển tới đúng VM, tab Cài proxy. |
| `/work` | Báo "Giao việc đang tạm ẩn", nút Về Tổng quan hoạt động. |
| `/paypals` | Kho tài khoản, tab PayPal; menu sáng Kho tài khoản. |
| Lô nhập → Xem ở Chi phí | Đúng khoản chi, đúng tháng, dòng được đánh dấu; Back về Lô nhập. |
| Kho proxy | Nhiều trang (1.211 dòng); Back theo URL. |
| Tháng không có giao dịch | Một dòng thông báo kèm lối ghi, không hiện khối số 0. |
| Đổi sang dự án trống | Một dòng hướng dẫn, không thẻ số 0, không biểu đồ. Đổi về dự án có dữ liệu bình thường. |
| Màn 390px | Tổng quan và Kho tài khoản không cuộn ngang cả trang. |
| Chỉ quyền PayPal (MODERATOR) | Menu: Tổng quan, Kho tài khoản, Lịch sử thao tác, Thiết lập. Mở thẳng tab PayPal, không có tab Gmail; `/gmails` cũng về tab PayPal. |
| Nhân viên Server / VM | Có Kho proxy, Server / VM, Kho tài khoản; không có mục tiền / quản trị / module ẩn. Tổng quan chỉ có vận hành. |
| Không có quyền | Menu chỉ Tổng quan, Lịch sử thao tác, Thiết lập. |
| Bật lại hai module | Menu hiện lại; `/vm-tasks` và `/work` mở trang cũ, không chuyển hướng. |

## Lỗi đã sửa trong đợt này

- **"Quản lý proxy" → "Kho proxy":** menu, tiêu đề, nút, dashboard và runbook.
- **Hai module ẩn:**
  - Việc cài proxy và Giao việc bị ẩn khỏi menu, dashboard, menu ⋯ của Server / VM, nút "Xem việc cài" và tab Công việc của VM.
  - Cấu hình tập trung ở `src/lib/features.ts`. Dữ liệu và endpoint giữ nguyên.
- **PayPal gộp vào Kho tài khoản:**
  - Còn một mục menu.
  - Người chỉ có quyền PayPal được đưa thẳng tới `/paypals` (tab PayPal) thay vì tab Gmail không phải của họ.
- **Thông báo cài proxy:**
  - "N VM chờ cài" mở Server / VM lọc Chờ cài.
  - "Việc cài bị bỏ lại" mở VM (một việc) hoặc bộ lọc mới Việc cài bị bỏ lại (nhiều việc).
- **Gói đến hạn:** trước đây mở danh sách proxy của các gói đến hạn. Nay mở danh sách gói (`?packages=due`) hoặc form thanh toán.
- **Mục Nhân viên:** trước đây hiện cho mọi MODERATOR, kể cả người mà trang sẽ báo chưa được cấp quyền. Nay chỉ hiện cho ADMIN hoặc MODERATOR có quyền quản lý user.
- **NEW đủ điều kiện giao:** dashboard tách NEW (trạng thái) với NEW đủ điều kiện giao VM, gồm TUT tự điền được và Chung chỉ giao tay.
- **Trạng thái trống:** tháng không có giao dịch và dự án trống không còn hiện khối số 0.

## Chưa kiểm

- **Host:** chỉ xem, không ghi (xem `host-result.txt` sau khi deploy).
- **Trên trình duyệt:**
  - tài khoản VIEWER;
  - dự án loại cũ (LegacyPage, `/paypals` riêng của dự án cũ);
  - theme sáng và golden.
- **Bảng proxy:** chưa bấm trực tiếp từng đoạn biểu đồ kho proxy; chỉ kiểm qua bảng số ở đợt trước.
- **Bộ test:** một lần chạy toàn bộ có 1 test lỗi không lặp lại; hai lần chạy sau đó đạt 352/352. Chưa xác định test nào.
