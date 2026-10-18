# Sửa lỗi kiểm độc lập PayPal — 18/10/2026

Kịch bản người kiểm: `.runtime/paypal-independent-review-20261018.ts` (database test, fixture riêng, tự dọn). Kết quả trước sửa: `review-before.txt`; sau sửa: `review-after.txt`. Không quay video.

## Kết quả từng lỗi

| Lỗi | Trước | Sau |
|---|---|---|
| 1. `email \| \| 24` | đọc thành 24, lưu 1 khoản | lỗi tại dòng "Ô số tiền (cột 2) đang trống; cột 3 là mã giao dịch…", lưu 0 |
| 2a. Trừ 31, phí 1, nhận 31 USD | chấp nhận | từ chối: "Bên nhận phải nhận 30,00 USD = (31,00 − phí 1,00)…" |
| 2b. Trừ 31, phí 1, nhận 30 VND, tỷ giá 25.000 | chấp nhận | từ chối: "Bên nhận phải nhận 750.000,00 VND…" |
| 3. Nhận 10 hôm nay + 50 ngày 01/01/2099 | tổng 10, danh sách có khoản 50 | tổng 10, danh sách không có khoản 2099, ghi "1 khoản ghi ngày sau 18/10/2026" |
| 4. Câu "một PayPal riêng" | còn trên trang | "mỗi EarnApp có một email PayPal nhận tiền, nhiều EarnApp có thể dùng cùng mã PP qua các email riêng" |

## Quy tắc đã chốt

- **Dán tiền nhận:** với tab hoặc `|`, mỗi ô giữ đúng vị trí; chỉ bỏ dấu phân cách thừa ở cuối dòng. Ô email trống, ô tiền trống, thừa cột, số tiền sai đều báo tại dòng; backend dùng cùng hàm nên dòng lỗi không được ghi.
- **Chuyển / rút** (`src/lib/paypal-transfer.ts`, dùng chung cho form và server):
  - Phí nguồn ghi bằng đồng tiền nguồn và nằm trong tổng PP bị trừ.
  - Bên nhận = làm tròn nửa lên 2 chữ số ((tổng bị trừ − phí nguồn) × tỷ giá) − phí bên nhận. Cùng đồng tiền: tỷ giá 1, không nhập tỷ giá.
  - Phí phía bên nhận là ô riêng "Phí bên nhận" (đồng tiền bên nhận, cột mới `Withdrawal.receiverFeeAmount`); không có cách nào khác để giải thích chênh lệch.
  - Số bên nhận ghi tay phải khớp đúng; lỗi nói số đúng là bao nhiêu.
  - Dữ liệu cũ (v1) và cách gắn cờ "cần đối chiếu" giữ nguyên.
- **Form chuyển:** chưa gõ số bên nhận thì số này tính trực tiếp từ các ô khác (đổi tổng/phí/đồng tiền/tỷ giá là đổi theo, không giữ số cũ). Đã gõ tay thì giữ nguyên số người dùng, chỉ báo lỗi tại ô, kèm nút "Dùng số tính được". Không có dialog; lỗi không làm mất nội dung.
- **Tổng và danh sách:** cùng `ledgerRange`: tháng (ngày đầu → cuối tháng), hoặc toàn bộ đến ngày chốt (hôm nay theo giờ Việt Nam). Mở danh sách khi không chọn tháng ghi `?asof=YYYY-MM-DD` vào URL nên tải lại / Back / Forward giữ cùng phạm vi; đóng danh sách thì về hôm nay. Danh sách ghi "Cộng các khoản được tính: X = số đang xem"; khoản chờ nhận / không về / đã thu hồi / số dư đầu kỳ hiện "(không cộng)" kèm vai trò.
- **Bộ lọc PP:** Còn email chưa dùng · Hết email chưa dùng · có email đang gán · Hết email chưa dùng · không email nào đang gán · Khoá / ngừng dùng.

## Kiểm chứng

- **Test mới:**
  - `paypal-transfer-rule.test.ts` (6 test): quy tắc chung.
  - `paypal-review-fixes.integration.test.ts` (3 test): dán tiền, chuyển, phạm vi.
  - `account-url.test.ts`: thêm `asof`.
  - Tất cả đỏ trước khi sửa, xanh sau khi sửa.
- **Ca hợp lệ:** 46 − 30 = 16; chuyển 31 gồm phí 1 → nguồn −31, bên nhận +30; 31 − 1 × 25.000 = 750.000 VND được ghi; phí bên nhận 0,5 → nhận 29,5.
- **Toàn bộ:** 379/379 test, typecheck, lint 0 lỗi, build.
  - `registry-copy.integration.test.ts` hai lần lỗi ngẫu nhiên khi chạy song song, mỗi lần một test khác nhau; chạy riêng và chạy lại toàn bộ đều qua.
  - File này không liên quan PayPal.
- **Trình duyệt, dữ liệu thử cục bộ** (`result-review-local.txt`): 24/24.
  - Ô tiền trống bằng `|` và tab; thừa cột.
  - Chuyển nội bộ tự tính 30. Sửa phí → 29. Gõ tay 31 → lỗi tại ô, Lưu khoá. Sửa phí khi đang gõ tay không ghi đè. "Dùng số tính được".
  - Đổi sang VND đòi tỷ giá. Tỷ giá 25.000 → 750.000. Gõ 30 → lỗi. Về USD.
  - Lưu 31 / phí 1: nguồn −31, nhận +30.
  - Khoản chờ nhận và khoản 2099 không đổi số Tiền vào. Tổng danh sách = số trong ô (Tiền vào và Tiền ra; tháng 10). Tải lại, Back, Forward.
- **Hồi quy trình duyệt:** 80/80 (các luồng 18/10), 17/17 (Lịch sử nhập kho).
- **Ảnh:**
  - `r1-empty-amount.png`: ô tiền trống.
  - `r2-transfer-fee.png`: nhận 31 khi trừ 31 phí 1.
  - `r3-transfer-fx.png`: 30 VND với tỷ giá 25.000.
  - `r4-entries.png`: danh sách Tiền vào đến hết 18/10.

## Phát hành

- **Commit:** `f05c623`.
- **Backup host trước deploy:** `0e5e4531`.
- **Deploy:** `145249ac`, SUCCESS. Migration `20261018180000_paypal_receiver_fee` (chỉ thêm cột) chạy ở bước pre-deploy.
- **Host verify:** 10 server / 576 VM.
- **Host xem chỉ đọc** (`host-result.txt`, `h1-host-paypal.png`):
  - Câu đầu trang theo quy tắc mới; không còn "một PayPal riêng".
  - Bộ lọc PP nói về email.
  - Chỉ có xác thực PIN và heartbeat. Một role=alert là route announcer của Next.js.
  - Host chưa có PayPal nên không có số tiền để bấm; không nhập ví dụ vào dữ liệu thật.

## Giới hạn

- Chưa giả lập mất mạng khi lưu trên trình duyệt; phát lại cùng khoá đã kiểm ở server.
- Đổi đồng tiền nguồn (không phải USD) trên trình duyệt chưa bấm; quy tắc giống nhau và có test.
- Host chưa có PayPal: các luồng tiền chỉ kiểm trên dữ liệu thử cục bộ.

## Lỗi còn lại: phí bên nhận bị bỏ khi rút ra ngoài (18/10/2026, kiểm độc lập UI)

- **Trước:** Rút ra ngoài USD → USD, trừ 31, phí nguồn 1, phí bên nhận 2, để trống số nhận → lưu thành công với `receiverFee=null, received=null`. Form chỉ tự tính số nhận khi chuyển nội bộ hoặc khác đồng tiền, và chỉ gửi phí bên nhận khi có số nhận.
- **Sửa:** logic form chuyển vào `transferDraft` trong `src/lib/paypal-transfer.ts` (test được). Có phí bên nhận thì số nhận tự tính như chuyển nội bộ; phí bên nhận luôn được gửi. Quy tắc chung báo "Có phí bên nhận: ghi số bên nhận thực nhận" và đòi tỷ giá khi khác đồng tiền, nên không tính được thì lỗi tại ô và Lưu khoá. Backend không nới.
- **Test:** 4 test mới trong `paypal-transfer-rule.test.ts`, đỏ trước sửa; toàn bộ 383/383, typecheck, lint, build.
- **Trình duyệt, dữ liệu thử cục bộ** (`result-receiver-fee-local.txt`, 11/11, đọc bản ghi sau lưu):
  - 31 / 1 / 2 → ô nhận tự hiện 28.00; bản ghi `debited 31, sourceFee 1, receiverFee 2, received 28 USD` (`rf1-derived-28.png`).
  - Gõ tay 29 → giữ 29, lỗi "phải nhận 28,00 USD", Lưu khoá; đổi phí bên nhận thành 3 vẫn giữ 29, lỗi thành 27,00 (`rf2-typed-mismatch.png`).
  - Phí bên nhận + đồng tiền nhận VND chưa có tỷ giá → lỗi tại ô tỷ giá và ô số nhận, Lưu khoá, không ghi gì (`rf3-fee-no-rate.png`).
  - Không phí bên nhận, không biết số nhận (trừ 20, phí 1) → lưu được, bản ghi `receiverFee null, received null`.
- **Hồi quy trình duyệt:** 24/24 (ô tiền trống, phí / tỷ giá, phạm vi ngày), 30/30 (PayPal email và sổ; nhãn ô cũ trong kịch bản đã cập nhật), 80/80 (luồng 18/10).
- **Phát hành:** commit `440c025`; backup host `1b2b2482` trước deploy; deploy `830de684` SUCCESS, không migration; host verify chỉ đọc 10 server / 576 VM. Không ghi thử trên host (host chưa có PayPal), không quay video.
