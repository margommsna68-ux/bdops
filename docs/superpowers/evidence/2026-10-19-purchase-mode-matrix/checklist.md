# Chuyển chế độ tiền mua, cả hai chiều (kiểm tra độc lập 19/10/2026)

Bộ tái hiện `.runtime/review-purchase-mode-matrix-20261019.test.ts` (riêng tư): 4/4 thất bại trước khi sửa, 4/4 qua sau khi sửa. Ca
tái hiện trước `.runtime/review-purchase-inexact-20261019.test.ts` vẫn qua.

## Lỗi

Nhánh `next === 'TOTAL'` của `switchMode` lấy `s.total` làm dự phòng khi đơn giá hoặc số lượng không dùng được: đơn giá 9 chưa có số
lượng → tổng trống (nhập không chi phí); đơn giá "9," → mất lỗi và tiền; số lượng 0 → không chi phí; tổng cũ 10, sửa đơn giá 9 rồi bỏ số
lượng → lấy lại 10.

## Sửa (`src/components/account-store/purchase-money.ts`)

- Đơn giá → Tổng chỉ khi đơn giá hợp lệ và số lượng hợp lệ, bằng tích chính xác. Còn lại (thiếu / 0 số lượng, đơn giá sai định dạng)
  ở lại chế độ Đơn giá, giữ nội dung, lỗi tại ô cần sửa và ghi chú. Không lấy tổng cũ, không thành không chi phí.
- Tổng → Đơn giá giữ cách đã sửa: chia không hết / thiếu số lượng / lỗi thì ở lại Tổng, chỉ hiện phân bổ tham khảo.
- Ô đang hiện trống thì chuyển tự do; chỉ xoá ô tiền đang hiện mới bỏ khoản chi (xoá cả số ở chế độ kia).
- Phòng thủ cả hai chiều: ô đang hiện trống mà chế độ kia còn tiền (bản nháp cũ) thì báo lỗi và khoá, không gửi priceMode NONE.
- Dùng chung cho Nhập Gmail / Apple ID, Nhập PayPal, Ghi chi phí của lô. Không thêm hộp thoại.

## Test tự động (`money-input.test.ts`)

- Ma trận 36 tổ hợp: chế độ Tổng / Đơn giá × tiền hợp lệ / trống / sai định dạng × số lượng 3 / thiếu / 0 × có / không có tiền cũ ở
  chế độ kia; mỗi tổ hợp chuyển 4 lần. Bất biến: tiền chưa xoá thì luôn có chi phí; tổng lưu được chỉ là tổng của dữ liệu đang nhập (không
  bao giờ tiền cũ); không tính được thì có lỗi và giữ nguyên chế độ cùng nội dung.
- Chuỗi thao tác: 9 × 3 → 27 → 9 → sửa 10 → 30; thiếu / 0 số lượng ở lại rồi sửa số lượng thì chuyển; xoá tiền rồi chuyển qua lại vẫn
  không chi phí, gõ lại thì có.
- Kỳ vọng cũ "đơn giá 70.000 chưa có số lượng → Tổng trống" đổi thành "ở lại Đơn giá 70.000" theo yêu cầu.
- Trên mã cũ 14 ca đỏ; trên mã mới toàn bộ 102 file / 507 test qua (gồm hai bộ tái hiện). Typecheck, lint, build qua.

## Trình duyệt (dữ liệu thử cục bộ, đọc lại lô và khoản chi sau lưu)

**36/36 PASS** (`browser-result.txt`), gồm lại các ca A (10 / 3, 100.000 VND / 3, 2,12 / 5, chưa nhập tiền, xoá tiền, Ghi chi phí của lô,
mất phản hồi) và các ca mới:
- B1 đơn giá 9 chưa có số lượng → bấm Tổng: ở lại, lỗi tại ô số lượng, nút khoá, không ghi gì; thêm số lượng 3 → 27, lưu một khoản 27 USDT.
- B2 đơn giá "9," → ở lại, lỗi tại ô, không ghi gì.
- B3 số lượng 0 → ở lại, lỗi, không ghi gì; sửa 2 → 18, lưu 18 USDT.
- B4 tổng cũ 10 → đơn giá 5 → sửa 9, bỏ số lượng → bấm Tổng: ở lại 9, không lấy lại 10, không ghi gì; số lượng 4 → 36, lưu 36 USDT.
- B5 xoá tiền rồi chuyển qua lại 3 lần: hai ô trống, lô không chi phí.
- B6 Ghi chi phí của lô đó: đơn giá 9 chưa có số lượng → nút khoá; số lượng 2 → 18, lưu một khoản 18 USDT.
- B7 đơn giá 4 × 3 → 12, mất phản hồi (bấm đúp gửi 1 lệnh) rồi Thử lại → một lô, một khoản 12 USDT.

Lượt đầu có 2 ca lỗi kịch bản (nhãn "Giá mỗi PP" trùng chữ trong thông báo lỗi của ô số lượng), dữ liệu đúng; sửa cách tìm ô và chạy lại
một lượt sạch trên dữ liệu mới. Ảnh: `b1-unit-no-quantity.png`, `b6-batch-cost-unit.png`, `a1-inexact-kept-total.png`. Không quay video.
