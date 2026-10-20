# Sửa 4 lỗi kiểm độc lập — Tiền / Rút (20/10/2026)

Bản gốc: 563c642 / a688690. Dữ liệu thử là dữ liệu giả (example.invalid) trên DB trial local; không quay video.

| Lỗi | Tái hiện (trước sửa) | Sửa | Kiểm chứng |
|---|---|---|---|
| 1. Yêu cầu rút cũ gán email sang account mới | `.runtime/review-earn-money-20261020.test.ts` ca 1–2 đỏ | `updatePayoutRequest` / `createPayoutRequest` (`src/server/vm-ops/payout.ts`) nhận và kiểm `vmId` + `expectedCycle` + `earnAppId` trong giao dịch; yêu cầu không còn là yêu cầu mở của VM → lệnh vận hành bị từ chối; đối chiếu lịch sử (`history: true`) chỉ tác động tài khoản cũ | 2 ca tái hiện xanh; `earn-money.integration.test.ts`: SUS → tạo lại → B1, A → B cùng lượt (SENT / UNKNOWN / FAILED / RETRY, form tạo yêu cầu cũ), đối chiếu lịch sử, tiền về muộn gắn yêu cầu cũ, chống lưu lặp; trình duyệt R1.6, H1, R2 |
| 2. Nháp số dư tự chuyển sang account / lượt mới | `.runtime/review-earn-money-ui-20261020.test.tsx` ca 1 đỏ | `BalanceSection` gắn nháp với dự án + VM + lượt + EarnApp khi bắt đầu nhập; form yêu cầu rút gắn lượt + EarnApp; form thao tác gắn yêu cầu lúc mở; đổi định danh → giữ nháp, báo tại chỗ, khoá Lưu, "Ghi lần mới" | Ca tái hiện xanh; `earn-money-ui.test.tsx` (khoá, Ghi lần mới, thử lại cùng khoá / nội dung / định danh); trình duyệt R1.1–R1.5, R2.2, R3 |
| 3. Lộ tiền qua nội dung tự do | `.runtime/review-earn-money-20261020.test.ts` ca 3 đỏ | `view()` trong `balance.ts`: điều kiện / lý do / căn cứ chỉ trả khi có quyền đọc số dư; người khác nhận trạng thái trung tính + `noteHidden` | Ca tái hiện xanh; integration (nhân viên không quyền, chủ dự án đọc đủ, EARN_BALANCE không mở tiền PayPal); trình duyệt S1–S4 kiểm phản hồi API thật |
| 4. "Đã về PP" phải là tiền thực nhận | `.runtime/review-earn-money-ui-20261020.test.tsx` ca 2 đỏ | `requestLine`: RECEIVED hiện `received`, dòng phụ "Đã chốt thiếu $x" | Ca tái hiện xanh; `earn-money-ui.test.tsx` ($6 + chốt $4, nhận đủ $10); trình duyệt R4 (chốt ngay trên bảng, sổ tiền không thêm giao dịch) |

## Trình duyệt local (hai phiên thật)

`result-local.txt`: 22 PASS / 0 FAIL. Phiên A (ADMIN) đang nhập / mở form; phiên B (ADMIN, trình duyệt khác) đổi tình trạng SUS và bấm "Ghi nhận đã tạo lại VM" bằng giao diện. B gán / đổi / bỏ gán tài khoản qua API thật của web (`accountStore.linkApply`) từ trình duyệt của B, không bấm qua ô tài khoản. Nhân viên không quyền tiền được kiểm bằng phản hồi API `vmOps.board` / `vmOps.balanceHistory`. Sau mỗi thao tác, DB local được đọc lại để xem tài khoản mới và dấu email.

Ảnh: `r1-draft-locked.png`, `r2-action-locked.png`, `r3-request-locked.png`, `h1-history-old.png`, `h2-history-done.png`, `r4-settled.png`, `s-staff-frame.png`.

## Chưa kiểm

- Phiên B không đổi tài khoản bằng thao tác bấm trong ô Tài khoản; dùng API cùng đường ghi.
- Không kiểm trên dữ liệu thật của host (host chỉ đọc, chưa có EarnApp).
- Không kiểm lại bốn giao diện / điện thoại cho riêng các thông báo mới (chỉ giao diện tối mặc định).
