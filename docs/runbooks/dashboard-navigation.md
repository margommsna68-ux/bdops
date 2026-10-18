# Tổng quan và điều hướng (17/10/2026)

## Tổng quan (`/dashboard`)

Dự án Proxy / VM và dự án đã bật thu chi USDT dùng màn Tổng quan mới. Dự án cũ giữ dashboard cũ.

- Số liệu đến từ một lần đọc `businessManagement.overview` (`src/server/dashboard/overview.ts`).
- Mỗi phần dùng lại phép đọc đã kiểm quyền của trang đích, tính trên toàn bộ kết quả trước phân trang:
  - **VM theo server:** `readVMWorkspace` + `vmView`. Không tính server/VM đã xoá. Server xếp tự nhiên.
  - **Kho proxy:** `loadRegistryRows` ở tab Đang quản lý, nhóm theo "Từ nhóm" × NEW / LIVE / BLOCKED / Khác (`state=OTHER`).
  - **Gói đến hạn:** `packageReminders`, cùng quy tắc với chuông.
  - **Không có khối Giao việc** (module ẩn). Đối chiếu Sheet cũ không được đếm là việc chưa xong.
  - **Việc cài bị bỏ lại:** `readOrphanTasks`. Link `links.orphanTasks` mở VM đó ở tab Cài proxy (một việc) hoặc Server / VM `?view=TASK_ORPHAN`.
  - **NEW đủ điều kiện giao:** `getEligibleInventory` (TUT tự điền) và `getManualInventory` (Chung, chỉ giao tay). Khác với số NEW.
  - **Thiếu SDK / tài khoản EarnApp / PayPal:** các nhóm này có thể trùng nhau, không cộng thành "VM lỗi".
  - **Tài chính:** báo cáo thu chi (USDT thực nhận đã xác nhận trừ chi phí hợp lệ theo tỷ giá từng khoản). Chuỗi theo ngày lấy từ cùng các bản ghi; tháng không có bản ghi thì không có biểu đồ.
- Phần người dùng không có quyền đọc trả về `null` và không hiện. Lỗi khác hiện thông báo kèm nút Thử lại, không hiện số 0.
- `?month=` chỉ tác động phần tài chính. Đổi tháng tạo một mục lịch sử, nên Back quay về tháng trước.

## Đường dẫn dùng chung (`src/lib/links.ts`)

Thẻ, biểu đồ, chuông, bảng và khung chi tiết đều tạo đường dẫn qua `links.*`, không tự ghép chuỗi.

- **`links.vms({serverId, view, q, vm, tab})`**
  - Các view: `MISSING`, `PENDING`, `INSTALLED`, `REVIEW`, `SDK_MISSING`, `ACCOUNT_MISSING`, `PAYPAL_MISSING`, `DELETED`.
  - `vm` + `tab` mở khung chi tiết của VM đó.
- **`links.proxies({q, servers, group, state, package, tab, pay})`**
  - `RegistryTable` đọc mọi bộ lọc trực tiếp từ URL (`registry-url.ts`).
  - Đổi bộ lọc là push; gõ ô tìm là replace.
  - Back/Forward, tải lại và liên kết trên cùng trang đều cập nhật danh sách.
- **`links.costs({month, cost, server})`**: `?server=` lọc thật, có chỉ báo và nút Bỏ lọc.
- **Ba luồng tiền:**
  - `links.teamReceipts()`: Nhận USDT về team.
  - `links.paypalIn()`: Tiền vào PayPal.
  - `links.originalWithdrawals(cashMode)`: Rút / chuyển gốc.
- **`links.packages()`**: danh sách gói lọc hạn gần nhất (`?packages=due`). `links.packages({pay})`: form thanh toán của gói.
- **`links.installs({vm})`**: khi module Việc cài ẩn, trỏ tới VM ở tab Cài proxy (hoặc Server / VM lọc Chờ cài).
- **`links.work({kind, vm})`**: chỉ dùng khi module Giao việc bật.

## Module ẩn (`src/lib/features.ts`)

Việc cài proxy và Giao việc đang ẩn trong dự án Proxy / VM. Dữ liệu, lịch sử, endpoint và quy tắc kiểm tra vẫn giữ nguyên.

- **Bật lại:** đặt biến `NEXT_PUBLIC_MTH_MODULES=INSTALL_TASKS,WORK` rồi build / deploy lại. Biến được đọc lúc build.
- **Khi ẩn:**
  - Menu, dashboard, menu ⋯ của Server / VM, nút "Xem việc cài" và tab Công việc của VM không trỏ tới hai trang này.
  - Chuông "N VM chờ cài" mở Server / VM lọc Chờ cài.
- **Link cũ:**
  - `/vm-tasks` chuyển (replace) tới Server / VM lọc Chờ cài.
  - `/vm-tasks#orphan` chuyển tới lọc Việc cài bị bỏ lại.
  - `/vm-tasks?vm=` chuyển tới VM ở tab Cài proxy.
  - `/work` báo tạm ẩn, kèm Về Tổng quan / Mở Server / VM.
- Dự án loại cũ giữ trang cũ.

## Việc cài bị bỏ lại

Việc cài còn mở nhưng cấu hình của nó không còn là cấu hình chờ cài của VM.

- Hiện ở Server / VM lọc **Việc cài bị bỏ lại** (`TASK_ORPHAN`, chỉ hiện khi có) và ở tab Cài proxy của VM.
- **Đóng việc** (`vmManagement.closeTask`):
  - đặt trạng thái CANCELLED;
  - ghi nhật ký `VM_TASK_CLOSE`, hoàn tác được;
  - không thay đổi máy;
  - từ chối việc đang gắn với cấu hình chờ cài.
- Không tự đóng hay xoá việc.

## Menu (`src/components/layout/nav.ts`)

Một hàm `visibleMenu` dùng cho mọi chế độ.

- **MoneyToHome:** Tổng quan, Kho proxy, Server / VM, Kho tài khoản, mục tiền, Chi phí, Lợi nhuận, Lịch sử thao tác, Nhân viên, Dự án, Thiết lập.
- **Kho tài khoản:**
  - Một mục cho Gmail / Apple ID, PayPal, Lô nhập và Cần kiểm tra.
  - Hiện khi có quyền Server / VM hoặc PayPal.
  - Người chỉ có quyền PayPal được đưa tới `/paypals` (tab PayPal). `/gmails` cũng tự về tab PayPal cho họ.
  - Backend quyết định phần được đọc.
- **Quyền theo mục:**
  - Dự án và Nhật ký: chỉ ADMIN.
  - Nhân viên: ADMIN hoặc MODERATOR có quyền quản lý user.
- **Mục tiền theo chế độ:**
  - **Có thu chi USDT:** Nhận USDT về team, Tiền vào PayPal, Rút / chuyển gốc (`?view=original`).
  - **Không có:** Tiền vào PayPal, Rút / chuyển gốc.
- Mục đang sáng xét cả query và đường dẫn phụ (`also`).

## Kiểm tra

- **Test tự động:**
  - `dashboard-overview.integration.test.ts`: số liệu khớp trang đích, quyền, việc cài bị bỏ lại, tài chính.
  - `links.test.ts`: URL đi và đọc ngược.
  - `package-reminders`: người không có quyền chi phí không thấy liên kết thanh toán.
- **Trình duyệt:** `scratchpad/pw/mth-accept.js` (42/42 ẩn, 3/3 bật lại, MODE=on); trước đó `scratchpad/pw/dash-accept.js`, chạy trên dữ liệu thử cục bộ, kết quả 33/33. Dữ liệu tạo bằng `.runtime/dash-local-setup.ts`, không đẩy lên host.
- **Bằng chứng:** `docs/superpowers/evidence/2026-10-17-dashboard-navigation/` và `docs/superpowers/evidence/2026-10-17-menu-hidden-modules/`.
- **Test:** `menu-modules.test.ts` (menu, quyền PayPal, bật/tắt module, link cũ); `account-store` (người chỉ có quyền PayPal).

## 18 October 2026 fixes

- **Menu order:** Tổng quan → Kho tài khoản → Kho proxy → Server / VM, then the rest by rights (`src/components/layout/nav.ts`).
- **Chart clicks:** the number printed on a segment has `pointer-events: none`, so clicking the number or the coloured part opens
  the same list (server + VM state, or group + proxy state).
- **Finance month and day:** money links carry `?month=YYYY-MM` and, from a chart column, `&date=YYYY-MM-DD` (a day implies its
  month).
  - Nhận USDT về team, Chi phí and Lợi nhuận read them with `readPeriod` (`src/lib/links.ts`). Changing the month on those pages
    is a history entry and clears the day.
  - CashNav keeps the month between the money pages.
- **Rights on finance numbers:** the summary shows to members with PROFIT, but each number links only to a list the member may
  read (`src/components/dashboard/finance-links.ts`): received → WITHDRAWALS, costs → COSTS, profit → PROFIT. Otherwise it is
  plain text and chart columns do not navigate. Backend rights are unchanged.
- **Errors per section:** the page reads `businessManagement.overview` twice, `part: 'operations'` and `part: 'finance'`.
  - A failure in one section shows *Chưa tải được phần …* with its own *Thử lại* and leaves the other section on screen.
  - A section the member may not read is null, never an error and never zeros.
