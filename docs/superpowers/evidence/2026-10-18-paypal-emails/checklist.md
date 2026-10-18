# PayPal nhiều email, nhập một lần, sổ tiền PayPal — 18/10/2026

Quy tắc mới thay quy tắc cũ "cả mã PP chỉ cho một EarnApp":

- Một mã PP có nhiều email.
- Mỗi EarnApp có một email nhận hiện hành.
- Mỗi email chỉ cho một EarnApp. Bỏ gán không giải phóng email, nhưng email vẫn nhận tiền nhiều lần.

Đã kiểm trên dữ liệu thử cục bộ (PROXY_TRIAL, server `ppx-<tag>` gồm 7 VM và 7 Gmail NEW, tạo bằng `.runtime/pp-local-setup.ts`). Không quay video.

## Kiểm tự động

Tổng cộng 370/370 test, cùng typecheck, lint (0 lỗi) và build.

### Test mới

- **`paypal-email-ledger.integration.test.ts`:**
  - Mã PP có 5 email, mã lặp được gộp. Dán lại không tạo PP, đợt hay chi phí; Bổ sung email không phát sinh chi phí. Email trùng PP khác hoặc dự án khác bị chặn.
  - 5 email cấp cho 5 VM; không tự tạo email thứ sáu. Mã PP đứng riêng bị chặn. Email đã dùng không cấp cho EarnApp khác; bỏ gán vẫn là Đã dùng. PP bị limit không cấp email. Hai người cấp cùng một email thì chỉ một người thành công.
  - Hoàn tác lần gán đầu: trả email về Chưa dùng khi chưa có tiền; đã có tiền thì bị chặn.
  - Tiền: nhận 24 + 10 + 12 = 46; chuyển ra 30 còn 16; email đã bỏ gán vẫn nhận thêm được; PP bị trừ 31 gồm phí 1 thì bên nhận nhận 30 và nguồn chỉ giảm 31.
  - Tổng thu EarnApp không cộng chuyển nội bộ.
  - Khác đồng tiền cần tỷ giá. Khoản chờ nhận và khoản thu hồi không được cộng.
  - Số dư đầu kỳ và lọc tháng (tháng 9 chuyển sang làm số dư đầu tháng 10).
  - Khoản cũ thiếu email vẫn tính vào PP, hiện "Chưa xác định email".
  - Nghi trùng và mã giao dịch lặp được báo tại dòng.
  - Quyền: chỉ có quyền kho PP thì không thấy tiền; chỉ có quyền FUNDS thì không thấy số dư.
- **`paypal-email-migration.integration.test.ts`:** chạy lại bước dữ liệu của migration trên dữ liệu giả.
  - PP có 1 email: liên kết cũ chuyển sang email đó.
  - PP có 2 email: giữ liên kết cũ ở mức PP, tạm giữ cả 2 email và hiện ở Cần đối chiếu.
  - PP có `firstEarnAppId` và 1 email: email đó ghi là Đã dùng.
  - Chạy lại lần nữa không đổi gì.
- **Test cũ cập nhật theo quy tắc mới:** dán `Email PP`, nhập PP gộp mã.

## Đã kiểm trên trình duyệt

| Bộ kiểm | Kết quả |
|---|---|
| `result-paypal-local.txt` | 30/30 |
| `result-regression-local.txt` (chuyển tab, nháp, xem trước, chọn hàng loạt, bộ lọc, Back, quyền, dự án trống / cũ, theme) | 80/80 |
| `result-history-local.txt` (Lịch sử nhập kho) | 17/17 |

### Chi tiết các luồng PayPal

- **Nhập PP** (`p1`):
  - Không còn nút Xem trước; web tự kiểm tra khi dán.
  - Dán `pp13 e1 e2 e3` và `PP13 | e4 | e5 | e5` được gộp thành 1 PP, 5 email; kết quả "2 PP mới (6 email) · 1 dòng cần sửa".
  - Nhập một lần, chỉ còn lại dòng lỗi; không có chi phí.
  - Dán lại thì báo "0 PP mới" và nút nhập bị khoá.
- **Gán tại Server/VM** (`p2`):
  - Ô VM_001 chọn Mã PP rồi Email, hiện ngay "pp13 · e1". Dán bảng 4 VM bằng Email PP.
  - VM thứ sáu không được đề xuất pp13.
  - Bỏ gán VM_001 thì e1 thành Đã dùng, không về Chưa dùng.
- **Dòng PP** (`p3`): "5 đã dùng / 0 còn dùng được". Email mở dưới dòng có EarnApp / Server / VM, tình trạng, tiền và nút copy. Tìm được theo bất kỳ email nào.
- **Tiền** (`p4`–`p6`):
  - 24 + 10 + 12 = 46,00 USD.
  - Nghi trùng hiện "Khoản riêng"; mã giao dịch lặp bị chặn.
  - Chuyển ra 30 còn 16,00. Nhận thêm 20 vào email đã bỏ gán thành 36,00.
  - Chuyển nội bộ 31 gồm phí 1, bên nhận 30: pp13 còn 5,00, pp14 nhận +30,00.
  - Tổng thu EarnApp không đổi khi chuyển nội bộ.
  - Bấm Tiền ra mở các khoản 30 và 31 (phí 1); tải lại, Back, Forward đều đúng. Lọc tháng 9 / 10 đúng; có ghi "đến hết ngày 31/10/2026".
- **Bổ sung email:** thêm 1 email mới, email đã có giữ nguyên; không tạo đợt hay chi phí.
- **Lịch sử nhập kho** (`p7`): "2 PP · 7 email".
- **Điện thoại 390px** (`p8`): không tràn ngang.
- **Quyền:**
  - Người chỉ có quyền kho PayPal: không có cột tiền, không có nút Ghi tiền / Ghi chuyển, vẫn có Bổ sung email.
  - VIEWER đủ module: thấy số dư 5,00 USD, không có nút ghi.

## Quyết định khi rà dữ liệu cũ

- **`Withdrawal.amount` cũ:**
  - Luồng collector cũ coi `amount` là tổng PP bị trừ và `paypalFee` là phí phía collector, nên giữ nguyên là "tiền ra".
  - Chuyển nội bộ cũ chưa có số bên nhận và khoản cũ có phí mà không qua collector: vẫn tính như đã ghi, kèm cờ "cần đối chiếu".
- **Dữ liệu cục bộ:** 19 liên kết cũ, tất cả thuộc PP chỉ có 1 email, nên đều chuyển sang email; không có email nào phải tạm giữ.

## Chưa kiểm

- Dữ liệu PayPal thật trên host: host chưa có PayPal, nên migration chỉ đổi cấu trúc bảng.
- Nhiều đồng tiền và số dư đầu kỳ trên trình duyệt: mới kiểm trong test tích hợp, chưa bấm qua giao diện.
- Mất phản hồi khi lưu ("Thử lại" với cùng khoá): đã kiểm phát lại cùng khoá ở server; chưa giả lập mất mạng trên trình duyệt.
- Dán bảng tài khoản ở Server/VM vẫn bấm Xem trước rồi Áp dụng (yêu cầu bỏ xem trước chỉ áp cho Kho tài khoản và giao dịch PayPal).
