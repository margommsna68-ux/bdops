# Sửa sau kiểm tra độc lập 19/10/2026: số lẻ, Blocked kiểu cũ, chọn proxy Cần kiểm tra

Bộ tái hiện `.runtime/review-money-proxy-20261019.test.ts` (riêng tư, không đưa lên): 4/4 ca thất bại trước khi sửa, 4/4 qua sau khi sửa.

## Lỗi và cách sửa

| # | Lỗi | Nguyên nhân | Sửa |
|---|---|---|---|
| 1 | 2,12 USDT / 5 PP → "Tính theo giá mỗi PP" điền 0,424 rồi tự báo "nếu có phần lẻ thì ghi 0,424" và khoá Nhập | `parseViNumber` chặn mọi số dạng `x,yyy` (1–3 chữ số nguyên, đúng 3 chữ số lẻ) | Cảnh báo dấu phẩy hàng nghìn chỉ ở ô VND (số tiền VND, tỷ giá "1 USDT = N VND") và không bao giờ cho `0,xxx`; số web tự viết luôn đọc lại đúng (`viInput`); đổi tổng ↔ đơn giá giữ tổng, chia không hết thì để trống đơn giá kèm ghi chú và giữ tổng |
| 2 | VM Blocked từ trước khi có cột mốc (blocked* trống), thay proxy xong vẫn Blocked | `restoreAfterBlocked` thoát sớm khi không có `blockedEndpointId`; nhánh đọc lịch sử chỉ chạy khi báo Blocked lại | `blockedSource` dùng chung cho kiểm tra và lưu: mốc của đúng lượt, hoặc lịch sử lượt hiện tại còn kết thúc ở Blocked → tình trạng trước đó; không xác định → Chưa ghi kèm lý do; không dùng lượt trước; tình trạng chọn sau Blocked được giữ. Mốc của lượt khác cũng xử lý như dữ liệu cũ (trước đây VM ở lại Blocked) |
| 3 | Chọn đúng proxy "Giữ để kiểm tra" duy nhất: kiểm tra READY, lưu changed:true nhưng vẫn UNCERTAIN | `assignProxyToVm` giữ cấu hình được giao và bỏ qua liên kết cùng `configurationId` dù vai trò UNCERTAIN | Liên kết đó chuyển thành DESIRED (ảnh hoàn tác lưu trước), proxy LIVE, VM Có proxy; cấu hình và lịch sử giữ nguyên; không ghi đã cài. Khung Thay proxy nay có nút "Dùng <IP>" và câu giải thích cả khi chỉ có một proxy cần đối chiếu |

## Test tự động

- `money-input.test.ts`: 11 ca (thêm số lẻ hợp lệ, đọc lại số web viết, 2,12 / 5 đổi qua lại 3 lần, 16,125, VND 15.625 / 15,6250, chia không hết). Ca cũ "70,000 / 25,820 báo nhầm" nay kiểm ở ô VND theo đúng yêu cầu mới.
- `proxy-change.integration.test.ts`: 12 ca (thêm Blocked kiểu cũ có / không lịch sử + hoàn tác, lịch sử lượt khác, OFF trong lúc chờ, Nhận replace ở Kho, chọn proxy Cần kiểm tra + chọn lại + hoàn tác, proxy BLOCKED vẫn Cần kiểm tra). Ca cũ "mốc lượt 1 trên VM lượt 2" nay kỳ vọng Chưa ghi kèm lý do thay vì ở lại Blocked.
- Chạy các test mới trên mã cũ: 9 ca thất bại đúng lý do; trên mã mới: toàn bộ 100 file / 458 test qua. Typecheck, lint (chỉ cảnh báo cũ), build qua.

## Trình duyệt (dữ liệu thử riêng ở máy cục bộ, `.runtime/p21-local-setup.ts`)

Một lượt chạy sạch trên dữ liệu mới: **29/29 PASS** (`browser-result.txt`). Hai lượt trước có 3 rồi 1 kiểm tra sai do kịch bản (đọc chữ của ô chọn tình trạng, tên nút khi ô tiền lỗi, bộ lọc khoản chi lẫn khoản mua, chuỗi kỳ vọng thiếu tỷ giá 1 của USDT), dữ liệu lưu đúng; đã sửa kịch bản và chạy lại trên dữ liệu mới.

- Tiền: 0,424 / 2,12 đổi qua lại 3 lần, lưu 5 PP × 0,424 = 2,12 USDT; 16,125 tổng và đơn giá (2 × 16,125 = 32,25); VND "25,820" vẫn cảnh báo, "25.820,5" nhận và lưu 100.000 ÷ 25.820,5 = 3,872892 USDT; Chi phí 16,125 USDT, 0,424 USDT, 420.000 VND @ 25.820,5 = 16,266145 USDT.
- Proxy: Blocked kiểu cũ có lịch sử OK → OK; không lịch sử → Chưa ghi kèm lý do; Blocked có mốc → OK; OFF chọn trong lúc chờ → giữ OFF; proxy cũ vẫn BLOCKED khi đổi sang dự phòng; Nhận replace ở Kho với Blocked kiểu cũ → LINKED, proxy cũ Đã replace; chọn proxy Cần kiểm tra → DESIRED / LIVE / hết Cần kiểm tra, chọn lại là không đổi; proxy Cần kiểm tra đang BLOCKED → lỗi tại chỗ, vẫn Cần kiểm tra.

Ảnh: `m1-unit-0424.png`, `m3-vnd-rate-decimal.png`, `p1-restored-ok.png`, `p5-kho-replace.png`, `p6-choose-review.png`. Không quay video.

## Chưa kiểm

- Trên host chỉ kiểm đọc; không thay proxy, không đánh dấu, không xử lý hàng loạt 23 VM Cần kiểm tra.
- Giá Binance thật không dùng (máy chủ giá giả cố định 25.820 trên 127.0.0.1).
