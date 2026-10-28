# Cập nhật 28/10/2026 — Rút EarnApp gọn lại (web build 2RHnkRVDs2G_mKoGCWyTd, OpenAPI 1.9.0)

Đọc kèm PROMPT_CLAUDE_VAN_HANH_WEB.md (đã cập nhật) và OPENAPI_WEB_HIEN_TAI.json.

## Duyệt
- CHỈ `POST withdrawals/prepare` còn cần ADMIN duyệt. Trạng thái (`withdrawals/{id}/status`), tiền về (`withdrawals/{id}/receipts`), thành viên rút gộp, sửa / bỏ đã rút / xoá ghi nhầm, SUS: chạy thẳng.
- Phiên duyệt 15 phút: chủ gõ mã Google Authenticator trong chat → chạy
  `mth-wow.ps1 session-open --admin tut --totp-stdin` (đưa mã qua stdin; không ghi mã vào file, log, chat trả lời).
  Trong 15 phút mọi lệnh prepare của token này được duyệt ngay. `session` xem trạng thái, `session-close` khoá.
  Chủ khoá trên web ("Khóa phiên ngay") thì lệnh prepare đã duyệt nhưng chưa chạy sẽ hết hiệu lực (410, gửi lại bằng key mới).

## Lệnh mới
- `POST withdrawals/{id}/edit` — sửa email / số tiền / ngày rút / mã tham chiếu (lệnh đã rút phải có `note`). Email cũ chưa nhận tiền thì trả về kho; email đã nhận tiền → 409 `EMAIL_HAS_MONEY`.
- `POST withdrawals/{id}/unsend` — bỏ "Đã rút" (về Đang rút, email vẫn giữ).
- `POST withdrawals/{id}/void` — xoá yêu cầu ghi nhầm (chưa có tiền về); VM tạo yêu cầu mới được.
- `POST vms/{id}/suspended` — EarnApp bị SUS: lệnh rút → "Mất do SUS" (`state` LOST_SUS, `phase` LOST), email PP của EarnApp bị xoá khỏi kho, VM vào "Chờ tạo lại". Ghi SUS qua `vms/{id}/status` cũng đóng y hệt.
- `GET withdrawals?projectId=…&email=<email PayPal nhận>` — tìm lệnh đang chờ theo email trong thư báo tiền PayPal (cần quyền PAYOUT hoặc RECEIPT).

## Tiền về
- Luôn ghi ĐÚNG số tiền thấy trong PayPal kèm mã giao dịch PayPal (`transactionId`). Số PayPal là con số chính xác và cuối cùng (chủ quyết định 28/10/2026).
- Thường thấp hơn số rút vì phí: kèm `settleRemainder:true` để chốt phần thiếu là phí.
- Có thể cao hơn một chút: vẫn ghi đúng số đó (không bị từ chối). Lệnh tự đóng là đã về (VM vào Chờ tạo lại), phần dư ghi `shortfall` âm (ví dụ `-0.06`) với ghi chú "Nhận dư $0.06"; `recorded.settled:true`. Cùng mã giao dịch ghi lần hai → bị từ chối (DUPLICATE).
- Tiền về muộn sau SUS: vẫn ghi được; về một phần thì phần còn lại vẫn là "Mất do SUS"; về đủ hoặc dư thì mở lại thành đã về (dư ghi như trên).
