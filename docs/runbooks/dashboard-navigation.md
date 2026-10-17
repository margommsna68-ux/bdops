# Tổng quan và điều hướng (17/10/2026)

## Tổng quan (`/dashboard`)

Dự án Proxy / VM và dự án đã bật thu chi USDT dùng màn Tổng quan mới. Dự án cũ giữ dashboard cũ.

- Số liệu đến từ một lần đọc `businessManagement.overview` (`src/server/dashboard/overview.ts`).
- Mỗi phần dùng lại phép đọc đã kiểm quyền của trang đích, tính trên toàn bộ kết quả trước phân trang:
  - **VM theo server:** `readVMWorkspace` + `vmView`. Không tính server/VM đã xoá. Server xếp tự nhiên.
  - **Kho proxy:** `loadRegistryRows` ở tab Đang quản lý, nhóm theo "Từ nhóm" × NEW / LIVE / BLOCKED / Khác (`state=OTHER`).
  - **Gói đến hạn:** `packageReminders`, cùng quy tắc với chuông.
  - **Việc giao nhân viên:** chỉ `kind=TASK`. Đối chiếu Sheet cũ đếm riêng.
  - **Việc cài bị bỏ lại:** `readOrphanTasks`.
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
- **`links.work({kind, vm})`**, **`links.installs({vm})`**.

## Việc cài bị bỏ lại

Việc cài còn mở nhưng cấu hình của nó không còn là cấu hình chờ cài của VM.

- Hiện ở `/vm-tasks#orphan` và ở tab Việc cài của VM.
- **Đóng việc** (`vmManagement.closeTask`):
  - đặt trạng thái CANCELLED;
  - ghi nhật ký `VM_TASK_CLOSE`, hoàn tác được;
  - không thay đổi máy;
  - từ chối việc đang gắn với cấu hình chờ cài.
- Chuông báo "N việc cài bị bỏ lại".

## Menu

- Dự án và Nhật ký chỉ hiện cho ADMIN.
- Nhân viên hiện cho ADMIN và MODERATOR.
- Mục tiền theo chế độ:
  - **Có thu chi USDT:** Nhận USDT về team, Tiền vào PayPal, Rút / chuyển gốc (`?view=original`).
  - **Không có:** Tiền vào PayPal, Rút / chuyển gốc.
- Mục đang sáng xét cả query.

## Kiểm tra

- **Test tự động:**
  - `dashboard-overview.integration.test.ts`: số liệu khớp trang đích, quyền, việc cài bị bỏ lại, tài chính.
  - `links.test.ts`: URL đi và đọc ngược.
  - `package-reminders`: người không có quyền chi phí không thấy liên kết thanh toán.
- **Trình duyệt:** `scratchpad/pw/dash-accept.js`, chạy trên dữ liệu thử cục bộ, kết quả 33/33. Dữ liệu tạo bằng `.runtime/dash-local-setup.ts`, không đẩy lên host.
- **Bằng chứng:** `docs/superpowers/evidence/2026-10-17-dashboard-navigation/`.
