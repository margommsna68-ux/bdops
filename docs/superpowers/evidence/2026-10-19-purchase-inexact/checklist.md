# Đổi Tổng tiền ↔ giá mỗi tài khoản không bỏ sót chi phí (kiểm tra độc lập 19/10/2026)

Ca tái hiện `.runtime/review-purchase-inexact-20261019.test.ts` (riêng tư, không đưa lên): thất bại trước khi sửa, qua sau khi sửa.

## Lỗi

10 USDT / 3 PP → "Tính theo giá mỗi PP": đơn giá để trống vì chia không hết, `readPurchase` chỉ đọc ô đang hiện nên `priced=false`,
ImportPanel gửi `priceMode NONE` và lô thành "Chưa ghi chi phí", nút Nhập vẫn sáng.

## Sửa (`src/components/account-store/purchase-money.ts`, `PurchaseMoneyFields.tsx`)

- Tổng thực trả là căn cứ ghi sổ. Không chuyển được thành đơn giá chính xác (chia không hết đến 8 chữ số lẻ, chưa có số lượng, ô tổng
  đang lỗi) thì `switchMode` giữ chế độ Tổng tiền thực trả cùng số tiền và tỷ giá, ghi chú tại chỗ; chỉ hiện giá phân bổ tham khảo.
  Không lấy đơn giá làm tròn nhân ngược thay tổng. Không thêm hộp thoại.
- "Chưa ghi chi phí" chỉ khi chưa nhập tiền hoặc chủ động xoá ô tiền đang hiện (`editAmount`: xoá cả số của chế độ kia, đổi chế độ không
  làm sống lại).
- Phòng thủ: chế độ đơn giá trống mà vẫn còn tổng (bản nháp cũ) thì báo lỗi tại ô và khoá Nhập, không bao giờ nhập không kèm chi phí.
- Dùng chung cho Nhập Gmail / Apple ID, Nhập PayPal và Ghi chi phí của lô. Khoá yêu cầu chống lưu lặp, nháp và quyền không đổi.

## Test tự động

`money-input.test.ts`: thêm 5 ca (10 / 3 đổi qua lại 3 lần → một payload TOTAL 10; 100.000 VND / 3 giữ tổng và tỷ giá, quy đổi theo
tổng; tổng chưa có số lượng / tổng lỗi giữ nguyên; 2,12 / 5 → 0,424 và form trống vẫn nhập không chi phí; chỉ xoá ô tiền mới là không
chi phí, đơn giá trống trên tổng còn giữ thì khoá). Hai kỳ vọng cũ "chia không hết → chế độ đơn giá trống" đổi thành "giữ Tổng" theo
yêu cầu mới. Toàn bộ 101 file / 464 test qua (gồm ca tái hiện), typecheck, lint, build qua.

## Trình duyệt (dữ liệu thử cục bộ, nguồn mua mang TAG, đọc lại lô và khoản chi sau lưu)

**15/15 PASS** (`browser-result.txt`): 10 USDT / 3 PP đổi 3 lần vẫn Tổng 10, ghi chú và ≈ 3,33 USDT / PP tham khảo, lưu một lô TOTAL và
một khoản 10 USDT; Gmail 100.000 ₫ / 3 tỷ giá 25.820 giữ, lưu 100.000 VND, 25.820, 3,872967 USDT; 2,12 / 5 → 0,424 lưu UNIT 2,12 USDT;
chưa nhập tiền → lô Chưa ghi, không khoản chi; gõ rồi xoá tiền, đổi chế độ không làm sống lại; Ghi chi phí của lô 10 / 3 → một khoản
10 USDT; mất phản hồi (bấm đúp gửi 1 lệnh) rồi Thử lại → một lô, một khoản 10 USDT. Lượt đầu có 2 kiểm tra sai do kịch bản (ký hiệu ₫,
làm tròn 3,872967), dữ liệu đúng; đã sửa kịch bản và chạy lại một lượt sạch.

Ảnh: `a1-inexact-kept-total.png`, `a2-vnd-kept-total.png`, `a5-batch-cost-form.png`. Không quay video.

## Giới hạn

- Host chỉ kiểm đọc, không nhập dữ liệu thử. Giá Binance thật không dùng (máy chủ giá giả 25.820 cục bộ).
- Lô đã nhập trước bản sửa không bị sửa; lô nào từng bị nhập "Chưa ghi chi phí" do lỗi này thì ghi lại bằng Ghi chi phí ở Lịch sử nhập kho.
