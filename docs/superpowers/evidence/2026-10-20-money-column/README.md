# Cột Tiền / Rút ở Server / VM — vị trí, cách đọc, mép bảng (20/10/2026)

Dữ liệu thử là dữ liệu giả (example.invalid) trên DB trial local (`.runtime/p33-local-setup.ts`, `.runtime/p33-viewer.ts`); không quay video. Ảnh trước / sau cùng kích thước, sidebar mở.

## Vị trí cột (đo bằng trình duyệt, `layout-before-after.txt`)

| Màn hình | Trước | Sau |
|---|---|---|
| 1280, tất cả server | Tiền / Rút 1467–1697 px (ngoài màn hình) | 667–887 px |
| 1280, một server | 1371–1601 px (ngoài) | 571–791 px |
| 1440, một server | 1371–1601 px (một phần ngoài) | 571–791 px |
| Điện thoại 390 | 1099 px | 299 px (bảng cuộn trong khung, trang không cuộn ngang) |

Ảnh: `before-*.png` / `after-*.png`.

## Nghiệm thu local (`result-local.txt`: 22 PASS / 0 FAIL)

- C1–C5 cấu hình cột: bản lưu cũ đúng mặc định → chuyển (PayPal ẩn, độ rộng Ghi chú 300 giữ nguyên); tải lại giữ; thứ tự tự đổi giữ nguyên; menu Cột vẫn đổi vị trí, tải lại không bị chuyển lại. Ảnh `c1-old-layout-migrated.png`, `c5-column-menu.png`.
- M1–M9 nội dung ô: Chưa gán tài khoản / Chưa kiểm tra / $0,00 / $12,40 Có thể rút / $8,75 + Chờ về PP $10,00; dòng tổng hợp; lọc Chưa tài khoản → một câu; bấm mở phần ghi số dư và bộ chọn tài khoản. Ảnh `m7-*.png`, `m8-*.png`, `m9-*.png`.
- X1–X2 cuộn ngang / dọc: tiêu đề và cột cố định đứng yên, nền kín, không bóng; đường mép chỉ khi có ô trượt dưới.
- P1 điện thoại: trang không cuộn ngang. Ảnh `p2-phone-scrolled.png`.
- S1–S3 nhân viên (USER, không quyền tiền): ô và dòng tổng hợp không có số tiền; phản hồi API `vmOps.board` không chứa 12.40 / 8.75 / 10.00. Ảnh `s-staff.png`.
- W1 người xem (VIEWER, không quyền gán): "Chưa gán tài khoản" là chữ, không nút. Ảnh `w-viewer.png`.
- Bốn giao diện ở 1440, đứng yên và đã cuộn: `theme-{light,dark,golden,bronze}[-scrolled].png`.

Test: `vm-grid-model.test.ts` (thứ tự mặc định, chuyển cấu hình cũ, giữ cấu hình tự đổi), `earn-money-rules.test.ts` (đếm VM chưa gán), `money-column-ui.test.tsx` (ô chưa gán có / không quyền, chưa kiểm tra, số dư $ / $0 / không quyền) — đỏ trước khi sửa.

## Chưa kiểm

- Không gán tài khoản thật qua bộ chọn mở từ ô Tiền (chỉ mở bộ chọn; đường lưu là của ô Tài khoản EarnApp, không đổi).
- Host chỉ xem (không gán tài khoản, không ghi tiền): host chưa có EarnApp nên chỉ thấy trạng thái "Chưa gán tài khoản".
