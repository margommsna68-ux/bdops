# Bảng kiểm sửa lỗi 18/10/2026

Kiểm trên dữ liệu thử cục bộ: dự án PROXY_TRIAL (959 VM, 1.211 dòng proxy), DASH_EMPTY, FIX_LEGACY (dự án chế độ cũ, trống). Tài khoản dùng để kiểm:

- `proxy-trial` (ADMIN);
- `fix-profit` (chỉ PROFIT);
- `fix-costs` (COSTS + PROFIT);
- `fix-receipts` (WITHDRAWALS + PROFIT);
- `fix-viewer` (VIEWER, đủ module);
- `dash-paypal` (chỉ PAYPALS).

Kết quả: `result-local.txt`, **80/80**. Không quay video; ảnh nằm cùng thư mục.

## Đã kiểm trên trình duyệt

| Mục | Luồng | Kết quả |
|---|---|---|
| 1 | Bấm số trên thanh VM theo server | Mở đúng server + trạng thái; số trên thanh = tổng ở Server / VM. |
| 1 | Bấm số trên thanh Kho proxy | Mở `?group=…&state=…`; số trên thanh = tổng ở Kho proxy (`c2-stock-label-target.png`). |
| 1 | Bấm phần màu (mép thanh, không trúng số) | VM và Kho proxy mở đúng danh sách; số khớp ô tương ứng trong bảng số. |
| 2 | Tổng quan tháng 9 → thẻ Nhận USDT / Chi phí / Lợi nhuận | Mở trang đích tháng 9 (ô tháng = 2026-09). Back về Tổng quan tháng 9. |
| 2 | Cột thực nhận ngày 09/09, cột chi phí ngày 20/09 | Danh sách đúng ngày và tháng (`f2-receipts-day.png`). Tải lại, Back và Forward giữ ngữ cảnh. |
| 2 | Tháng trống (07/2026) | Một dòng ngắn; link Ghi chi phí mở Chi phí tháng 7. Đổi tháng ở Chi phí ghi vào URL, Back về tháng trước. |
| 3 | Kho proxy trang 2 → Server / VM → Back; tải lại | Giữ trang 2 (`Dòng 101–200`). |
| 3 | Mở thẳng `?state=LIVE&page=3` | Trang 3. Đổi nhóm hoặc gõ tìm kiếm thì về trang 1; Back về lại trang 3. |
| 3 | `?state=BLOCKED&page=9` (trang không còn) | Về trang cuối, URL sửa lại, có thông báo (`p1-registry-clamped.png`). |
| 4 | Chỉ PROFIT | Ba số vẫn hiện; chỉ Lợi nhuận bấm được; cột thực nhận không dẫn đi (`r1-profit-only.png`). |
| 4 | COSTS + PROFIT / WITHDRAWALS + PROFIT | Chỉ mục có quyền bấm được; mọi liên kết mở trang không bị từ chối. |
| 4 | VIEWER | Vận hành và tài chính có liên kết; Kho tài khoản xem được, không có nút nhập; Kho proxy trang 2. |
| 5 | Giả lập lỗi đọc tài chính (chặn phản hồi tRPC phần tài chính) | Vận hành vẫn hiện đủ 5 thẻ và biểu đồ. Khu tài chính báo "Chưa tải được phần tài chính … Thử lại", không hiện số 0. Thử lại thì hiện lại (`e1-finance-error.png`). |
| 6 | Menu ADMIN | Tổng quan · Kho tài khoản · Kho proxy · Server / VM · Nhận USDT về team · Tiền vào PayPal · Rút / chuyển gốc · Chi phí · Lợi nhuận · Lịch sử thao tác · Nhân viên · Dự án · Thiết lập. |
| 7 | Kho tài khoản | Hai tab: Gmail / Apple ID và PayPal. "Lịch sử nhập kho" là nút phụ. "Cần đối chiếu (5)" là cảnh báo bên Gmail; bên PayPal 0 mục nên không hiện (`a1-gmail-tab.png`). |
| 7 | Đang nhập PayPal (đã xem trước) → tab Gmail | Không còn khung hay bảng xem trước PayPal; nút nhập là "Nhập Gmail / Apple ID" (`a2-…png`). |
| 7 | Back / Forward giữa hai tab | Nháp và xem trước PayPal còn nguyên. Nháp Gmail (Apple ID, có mật khẩu) còn nguyên, không lẫn sang PayPal. |
| 7 | Chọn dòng Gmail → tab PayPal | Không còn lựa chọn. |
| 7 | Sang Tổng quan rồi quay lại trong app | Nháp còn. Mật khẩu và 2FA không nằm trong URL, localStorage hay sessionStorage. |
| 7 | Đổi sang dự án trống | Không có khung nhập hay nháp; đổi về thì nháp của dự án thử còn. |
| 7 | Lịch sử nhập kho → một đợt → tài khoản → Back | Chỉ đợt PayPal. Mở đợt thì hiện đúng 5 tài khoản của đợt, có lọc rõ "Đợt nhập … Bỏ lọc đợt". Back về lịch sử. |
| 7 | Nhập bổ sung 1 PayPal | Mở đúng đợt. Số khoản chi, tổng USDT chi và số đợt không đổi (đọc trực tiếp DB cục bộ). |
| 7 | Lần mua mới | Tạo đợt riêng (`PP-2026-10-18-…`), số đợt +1. |
| 7 | Cần đối chiếu | Mục có lý do ngắn ("Chưa chọn loại Gmail / Apple ID…"); nút Mở tài khoản tìm đúng tài khoản; Back về danh sách. |
| 7 | URL cũ | `/gmails?tab=batch` → `?view=history`; `/paypals?tab=review` → `?view=review`; `/paypals?tab=batch` → `?view=history`; `/paypals` mở tab PayPal. |
| 7 | Chỉ quyền PayPal | Chỉ tab PayPal, không thấy dữ liệu Gmail; lịch sử chỉ đợt PayPal; Cần đối chiếu không lộ mục Gmail. |
| — | Dự án trống | Tổng quan một dòng hướng dẫn; Kho proxy `?page=4` không lỗi, về trang 1. |
| — | Dự án chế độ cũ (FIX_LEGACY, trống) | `/dashboard`, `/gmails`, `/paypals`, `/costs`, `/withdrawals`, `/profit`, `/infrastructure/proxies` mở được; menu cũ giữ nguyên (`l1-legacy-dashboard.png`). |
| — | Theme sáng, golden | Tổng quan và Kho tài khoản hiển thị (`t-light-dashboard.png`, `t-golden-*.png`). Cảnh báo đối chiếu dùng màu tối trên golden. |
| — | Màn 390px | Kho tài khoản không cuộn ngang cả trang. |

## Kiểm tự động

- 361/361 test (85 tệp), chạy lại sau lần sửa cuối.
- Typecheck và build đều qua. Lint 0 lỗi; còn 2 cảnh báo cũ ở `agent-pp`, không thuộc đợt này.
- **Một lần chạy lỗi:**
  - Test: `team-cash-period-ui.test.tsx`, lỗi "invariant expected app router to be mounted".
  - Nguyên nhân: trang Lợi nhuận nay đọc tháng từ URL, còn test chưa giả lập router.
  - Đã thêm mock router và kiểm ô tháng lấy từ URL. Log trong scratchpad `suite-1.log`.
- **Test mới:**
  - Trang Kho proxy: số trang trong URL và server trả trang cuối khi trang cũ không còn.
  - Liên kết tài chính theo quyền, `readPeriod`.
  - Đọc từng khu và lỗi tài chính không làm mất vận hành; quyền PROFIT riêng, COSTS không PROFIT, VIEWER.
  - URL Kho tài khoản và nháp theo loại / dự án.
  - Mục đối chiếu có nhóm và đường mở; người chỉ có quyền PayPal không nhận mục Gmail.
  - Thứ tự menu.

## Chưa kiểm

- Dự án chế độ cũ có dữ liệu thật: chỉ kiểm dự án cũ trống ở máy cục bộ.
- Lỗi thật của máy chủ tài chính: chỉ giả lập bằng cách chặn phản hồi trên trình duyệt; test tự động giả lập lỗi bảng nhận tiền.
- Theme: chỉ chụp Tổng quan và Kho tài khoản, chưa duyệt mọi trang.

## Phát hành

- **Commit:** `accb334`, không có migration.
- **Backup host trước deploy:** `0cf66976`.
- **Deploy:** `dea20433`, SUCCESS.
- **Host verify:** 10 server / 576 VM.
- **Host xem chỉ đọc trên mooon** (`host-result.txt`, ảnh `h1`–`h3`):
  - Menu: Tổng quan · Kho tài khoản · Kho proxy · Server / VM · …
  - Bấm số 553 trên thanh LIVE của TUT → `?group=TUT&state=LIVE`, 553 dòng (lỗi đã tái hiện trước đây).
  - Bấm số 69 trên thanh VM → đúng server, Chờ cài, 69 VM.
  - Bấm phần màu → đúng nhóm/trạng thái.
  - Kho proxy trang 2 → Server / VM → Back: trang 2 (`Dòng 101–200`); tải lại vẫn trang 2.
  - Kho tài khoản: hai tab, "Lịch sử nhập kho (1)", không có cảnh báo đối chiếu (0 mục).
  - `/gmails?tab=batch` → `?view=history`; `/paypals?tab=review` → `?view=review`; `/paypals` → tab PayPal.
  - Phần tài chính chưa kiểm trên host vì mooon chưa bật thu chi USDT.
- **Ghi dữ liệu trên host:** chỉ xác thực PIN và heartbeat phiên. Sheet và production cũ giữ nguyên.
