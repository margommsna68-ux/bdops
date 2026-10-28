# Rút EarnApp → PayPal gọn lại — kiểm tra 28/10/2026

Nhánh `codex/payout-simple` (worktree `D:/MoneyToHome/dev-payout-simple-20261028`), mốc live `bebd5fd` (BUILD `DA1lGJ8RFpsq0u7O2EFoM`). Thiết kế `docs/superpowers/specs/2026-10-28-payout-simplify-design.md`, kế hoạch `docs/superpowers/plans/2026-10-28-payout-simplify.md`. **Chưa deploy.** Hai migration chỉ cộng thêm: `20261028120000_payout_simplify`, `20261028130000_approval_session_version`. OpenAPI 1.9.0.

## Đã kiểm

- **Toàn bộ vitest** (PowerShell, DB test `127.0.0.1:55432/proxy_test`):
  - 222 file / 1545 test passed tại `6c49237` (final fix wave).
  - Chạy lại trong Task 12 trên cùng commit cũng 222 file / 1545 test passed, 185 s.
  - `npx tsc --noEmit` sạch.
  - `npx next build` exit 0 (BUILD_ID local `52mOXxXJSeo5OCHVWQeVT`; build local, không phải bản phát hành).
- **Chrome thật** (playwright-core, headless) trên bản production build `next start` ở `127.0.0.1:3037`.
  - DB riêng `127.0.0.1:55432/payout_simple_ui_20261028`: tạo mới, `prisma migrate deploy`, dữ liệu giả, **xoá DB sau khi kiểm**.
  - Dữ liệu giả: dự án "Rút gọn thử", 2 server (Moon-thử 4 VM, An-thử 2 VM), 3 mã PP × 4 email `@example.invalid`, một ADMIN bật TOTP, một user AI + token giả, 2 lệnh `WITHDRAWAL_PREPARE` đang chờ.
  - Đăng nhập theo luồng thường: mật khẩu + mã TOTP tạo từ secret giả. Mỗi mã dùng một bước 30 s mới, vì máy chủ chặn dùng lại cùng bước.
  - Không có `FLEET_CONTROL_*` trong môi trường (không server nào nối điều khiển).
  - Kết quả: **89/89 PASS, 0 lỗi JS / console**. Chi tiết từng mục ở `browser-results.json`.

| Nhóm | Kết quả |
|---|---|
| Rút (một bấm giữ email) → Đã rút → Tiền đã về $18,40 cho $20 (ô số tiền để trống, phí $1,60 tự tính, "Chốt luôn, phần thiếu là phí" tick sẵn) → "Về thiếu (đã chốt)" → VM ở bộ lọc **Chờ tạo lại** | PASS (7) |
| Sửa (đổi email) trên yêu cầu đã rút: email cũ trả kho (không giữ, không dùng), email mới gắn; Bỏ "Đã rút" → Đang rút; Bỏ trên Đang rút → yêu cầu xoá, ảnh chụp `EarnPayoutRequestVoid` giữ lại, email trả kho | PASS (6) |
| EarnApp bị SUS trên yêu cầu đã rút $12: `LOST_SUS`, `lostAmount` 12, VM SUSPENDED, email rời kho (`archivedAt`), VM ở Chờ tạo lại và bộ lọc "Mất do SUS", trang Rút EarnAp hiện "Mất do SUS $12.00" | PASS (6) |
| Hàng loạt ở Server/VM: Rút 3 VM (khung đánh dấu 2 dòng vượt hạn mức 2 email/PP/ngày, chọn email PP khác), Đã rút 3 dòng, Tiền đã về 3 dòng (số từng dòng 10,20 / 12,10 / 13,05, phí từng dòng) | PASS (10) |
| Chờ tạo lại: 5 VM (gồm VM SUS). "Tạo lại 5 VM" khi không có server nối điều khiển: không gửi lệnh fleet nào, liệt kê "Tạo tay 5 VM", nút "Tạo lại 0 VM" tắt. "Ghi nhận đã tạo lại 5 VM": hộp xác nhận ghi "An-thử: 2 VM / Moon-thử: 3 VM", sau xác nhận 5 VM sang lượt 2, 0 `FleetCommand`; trang Rút EarnAp hiện "Đã xoá do ghi nhầm (1)" | PASS (6) |
| Trang Rút EarnAp: Rút lại trên VM đã xoá ghi nhầm, chọn dòng → "Đã rút 1 dòng"; "Tiền đã về 1 dòng" $9,55 cho $10 (ô trống, chốt tick sẵn) → VM ở Chờ tạo lại | PASS (6) |
| Phê duyệt: "Duyệt tất cả đang chờ (2)" bằng một mã; "Mở phiên 15 phút" (phiên WEB 900 s); "Khóa phiên ngay" đóng phiên, danh sách trống | PASS (4) |
| 4 giao diện chọn qua Thiết lập → Giao diện (Sáng / Tối / Vàng kim / Đồng ấm) × 1280 px và 390 px: trang Rút EarnAp, khung chi tiết, khung Rút (ô Tiền VM ở desktop, khung VM ở điện thoại). Không tràn ngang trang | PASS (44) |

Ảnh chụp (email đã che `•••@example.invalid`, dữ liệu giả) trong `shots/`: khung Rút, khung ở 4 giao diện trên điện thoại, trang Rút EarnAp và khung chi tiết, nhập tiền về hàng loạt, phiên duyệt. Ảnh chụp chưa che của lượt chạy đầu đã xoá. Không quay video.

## Sửa trong bộ kiểm (không phải lỗi sản phẩm)

- **Ô "Đổi email" (Sửa):** `getByLabel('Đổi email')` không khớp. Thẻ `<label>` bọc `<select>`, nên tên truy cập có cả lựa chọn đang chọn. Bộ kiểm chuyển sang `label:has-text`.
- **Báo cáo:** khung chi tiết của báo cáo là dialog; bộ kiểm cũ tìm class `.pr-detail` của bản trước.
- **390 px:** ô Tiền VM nằm sau các cột dính của bảng cuộn ngang, nên bấm tự động bị cột dính che. Bộ kiểm mở cùng khung Rút từ khung VM (Tổng quan). Bảng vẫn cuộn ngang được bằng tay; hành vi này có từ trước nhánh.
- **Lượt chạy đầu của C:** đếm tiêu đề "Đã xoá do ghi nhầm" luôn hiện, kể cả khi chưa xoá gì. Đã thay bằng kiểm "(1)" sau B.

## Giới hạn

- **Không có lỗi sản phẩm phải sửa trong Task 12.**
- **Luồng thật chưa chạy trong trình duyệt:**
  - Luồng AI qua `/api/ops/v1` (session-open bằng CLI, prepare trong phiên, settleRemainder, `GET withdrawals?email=`) chỉ có test tích hợp, không chạy ở đây.
  - "Tạo lại N VM" qua điều khiển fleet cho server đã nối chưa chạy. Môi trường không có server nối, nên chỉ kiểm nhánh đóng an toàn.
- **Gợi ý email hàng loạt:** "Rút N VM" gợi ý mọi dòng về cùng PP gần 100 USD. Khi PP đó còn ít suất trong ngày, các dòng vượt bị đánh dấu và người dùng tự chọn PP khác; web không tự chuyển sang PP kế tiếp. Đây là luật gợi ý hiện có, không đổi.
- **Khung "Tiền đã về N dòng" ở 1280 px:** cột Phí / Mã giao dịch nằm trong vùng cuộn ngang của khung.
- **Chưa kiểm:** người dùng giới hạn server và người không có quyền tiền trên giao diện mới (đã có test tích hợp / UI).
- **Không kiểm trên production:** không đăng nhập production, không đụng DB 5432, cổng 3000 hay dịch vụ MoneyToHome-*.

Script kiểm (riêng, không commit): `.runtime/payout-simple-ui/` (seed.ts, flows.cjs, bulk.cjs, report-bulk.cjs, ui.cjs).
