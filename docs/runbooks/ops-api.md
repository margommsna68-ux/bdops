# API vận hành AI — `/api/ops/v1` (21/10/2026)

API cho Claude vận hành (hoặc script khác) đọc MoneyToHome và ghi những việc đã làm ở nơi khác: số dư EarnApp đã đọc, chuẩn bị rút (giữ email PP),
đã gửi / chưa rõ kết quả trên EarnApp, tiền thực về PayPal.

**API này chỉ đọc / ghi MoneyToHome. Nó chưa tạo kết nối tới VM, không đăng nhập EarnApp và không tự rút tiền trên EarnApp.**

Hợp đồng đầy đủ: [docs/ops-api/openapi.yaml](../ops-api/openapi.yaml). Thiết kế: [docs/superpowers/specs/2026-10-21-ops-api-design.md](../superpowers/specs/2026-10-21-ops-api-design.md).

## 1. Quyền

Quyền hiệu lực = quyền hiện tại của người dùng trong dự án ∩ dự án của token ∩ thao tác của token. Token không có quyền riêng; hạ quyền hoặc bỏ
thành viên có hiệu lực ngay ở request sau (kể cả khi gửi lại một lệnh đã thành công).

| Endpoint | Thao tác token | Người dùng cần (kiểm trong service dùng chung với web) |
|---|---|---|
| GET /health | — (không cần token) | — |
| GET /me | token hợp lệ | — |
| GET /projects, /servers, /vms, /vms/resolve, /vms/{id}, /earnapp-accounts/{id}, /withdrawals, /withdrawals/{id} | READ | Server / VM (module Hạ tầng), dự án Proxy / VM |
| POST /vms/{id}/balance-check | BALANCE_WRITE | ADMIN / MODERATOR có ghi Server / VM, hoặc USER có **EARN_BALANCE** ("Ghi kiểm tra tiền EarnApp") |
| GET /paypal/suggest, POST /withdrawals/prepare, POST /withdrawals/{id}/status | PAYOUT | Người ghi Tiền vào PayPal (quản lý), hoặc USER (không phải VIEWER) có Hạ tầng + **EARN_PAYOUT** ("Chuẩn bị rút EarnApp") |
| POST /withdrawals/{id}/receipts | RECEIPT | Người ghi Tiền vào PayPal (quản lý), hoặc USER có Hạ tầng + **PAYPAL_RECEIPT_RECORD** ("Ghi khoản nhận PP của yêu cầu rút") |

- `EARN_PAYOUT` không mở: ghi yêu cầu "đã gửi" trực tiếp, thất bại / huỷ / gửi lại / sửa / chốt thiếu, đối chiếu tài khoản cũ, sổ PayPal, chi phí,
  rút / chuyển. Trên web người có quyền này thấy nút "Chuẩn bị rút (giữ email)" và "Đã gửi trên EarnApp / Chưa xác định kết quả".
- `PAYPAL_RECEIPT_RECORD` chỉ ghi khoản nhận gắn một yêu cầu rút đã gửi; không mở dán khoản nhận tổng quát, số dư đầu, thu hồi.
- Đọc tiền: số dư EarnApp cần quyền đọc số dư (đọc Tiền vào PayPal hoặc ghi số dư); tiền của yêu cầu rút cần đọc Tiền vào PayPal hoặc một trong hai
  quyền hẹp; sổ PayPal (số dư theo sổ của PP) chỉ với đọc Tiền vào + Rút / chuyển.
  Qua token, quyền đi kèm một thao tác ghi (EARN_BALANCE, EARN_PAYOUT, PAYPAL_RECEIPT_RECORD) chỉ mở dữ liệu khi token có thao tác đó: token chỉ READ
  của cùng người không thấy số dư / tiền yêu cầu / email PP đầy đủ nếu quyền đọc đó chỉ đến từ quyền hẹp.
- Không làm qua API: xoá / tạo lại VM, proxy, nhóm, liên kết tài khoản, SDK, tình trạng VM, rút / chuyển PayPal, USDT, chi phí, cấp lại email đã dùng.

## 2. Kích hoạt (chủ dự án làm, theo thứ tự)

1. **Cấp quyền** — Kho proxy → Quyền nhân viên (ADMIN): chọn tài khoản (ví dụ `ai-ops`), giữ Hạ tầng, tick các quyền cần
   (Ghi kiểm tra tiền EarnApp / Chuẩn bị rút EarnApp / Ghi khoản nhận PP của yêu cầu rút). Hai quyền mới mặc định tắt.
2. **Đặt PIN** cho tài khoản đó (Nhân viên → Đặt lại PIN, hoặc người đó tự đặt) — mọi lệnh ghi cần PIN.
3. **Tạo token** — Thiết lập → Token API vận hành: chọn người, tên, thao tác, hạn (7 / 30 / 90 ngày), IP (tuỳ chọn), nhập PIN của ADMIN →
   token `mth_…` hiện **một lần**. Copy ngay vào kho bí mật; không gửi qua chat, không dán vào lệnh, file commit hay ví dụ.
4. **Nạp bí mật ngoài cuộc chat** — mở terminal của chính bạn (không qua ô chat Claude, không dùng cú pháp `!`), trong thư mục source:
   `node scripts/ops-client.mjs init` → gõ token và PIN (không hiện ký tự) → lưu ở `~/.mth/ops-secret.json`. Hoặc đặt biến môi trường
   `MTH_TOKEN` / `MTH_PIN` trong phiên terminal của bạn. Lưu ý: một công cụ chạy cùng tài khoản máy vẫn đọc được file / biến đó; đây là
   nơi cất bên ngoài cuộc chat, không phải nơi AI tuyệt đối không đọc được.
5. **Thử đọc một VM**: `node scripts/ops-client.mjs me` → `projects` → `resolve <projectId> <server> <vm>` → `vm <projectId> <vmId>`.
6. **Vận hành trong phạm vi được giao** (mục 4). Thu hồi token ở Thiết lập khi không dùng nữa; lệnh sau bị từ chối ngay.

## 3. Quy ước

- Header: `Authorization: Bearer $MTH_TOKEN`; lệnh ghi thêm `X-Ops-Pin` và `Idempotency-Key` (8–100 ký tự `A-Za-z0-9._:-`).
- Trả về `{ "ok": true, "data": …, "error": null }` hoặc `{ "ok": false, "data": null, "error": { "code", "message", "details"? } }`, kèm
  `X-Request-Id`. HTTP: 401 xác thực / PIN, 403 quyền / PIN khoá, 404 không thấy (kể cả dự án ngoài token), 409 xung đột, 422 dữ liệu sai, 429 giới hạn.
- ID ổn định; `projectId` lấy từ `/projects` (MOON là tên hiển thị, không phải code). Tiền là chuỗi thập phân "10.00"; đồng tiền rõ ràng.
- `expectedCycle` = lượt VM (`VmOperation.cycle`); `expectedVmRevision` = `VirtualMachine.revision`; `expectedRequestRevision` = revision của yêu cầu
  rút. Kiểm trong cùng giao dịch ghi. 409 trả `details.current` (trạng thái hiện tại theo quyền); không tự lấy revision mới để ép ghi.
- Gửi lại: cùng key + cùng nội dung → kết quả cũ (`replay: true`), không ghi lần hai, kể cả khi dữ liệu đã đổi sau đó; cùng key + nội dung khác →
  `IDEMPOTENCY_CONFLICT`. Key gắn với người dùng + dự án (không gắn token), nên xoay token vẫn chống trùng. Mất phản hồi → gửi lại **cùng key**.
- Giới hạn (dùng chung mọi instance): 120 đọc / phút và 30 ghi / phút mỗi token; 30 lần xác thực sai / phút mỗi IP; PIN sai 3 lần khoá người dùng
  30 phút (như web), 5 lần sai / 30 phút khoá riêng token. 429 có `Retry-After`.
- IP: lấy từ X-Forwarded-For theo số proxy tin cậy (`OPS_TRUSTED_PROXY_HOPS`, mặc định 1 = Railway); phần client tự khai bị bỏ. `GET /health` trả
  `verifiedIp` để kiểm.
- Không trả mật khẩu, 2FA, link lấy mã, token, credentials proxy. Proxy: id + host che + port + nhóm. Email đăng nhập che. Email PP nhận tiền đầy đủ cho
  người có quyền rút / ghi khoản nhận. Ghi chú tự do được che link / mật khẩu / mã trước khi lưu và trước khi trả.
- Nhật ký: `OpsAudit` (requestId, tokenId, userId, projectId, action, objectId, thời gian, IP đã xác minh, HTTP, kết quả, replay) cho mọi lệnh ghi và
  mọi lần bị từ chối; không có header / body / PIN / token. Nhật ký nghiệp vụ vẫn là Lịch sử thao tác của web.

## 4. Ví dụ (biến môi trường, không ghi token vào lệnh)

```bash
B=https://moneytohome.up.railway.app/api/ops/v1
H=(-H "Authorization: Bearer $MTH_TOKEN")
W=(-H "X-Ops-Pin: $MTH_PIN" -H "Content-Type: application/json")
curl -s "$B/health"
curl -s "${H[@]}" "$B/me"
curl -s "${H[@]}" "$B/projects"
curl -s "${H[@]}" "$B/servers?projectId=$P"
curl -s "${H[@]}" "$B/vms?projectId=$P&limit=100"
curl -s "${H[@]}" "$B/vms/resolve?projectId=$P&server=moon05&vm=VM_078"
curl -s "${H[@]}" "$B/vms/$VM?projectId=$P"
curl -s "${H[@]}" "$B/earnapp-accounts/$EA?projectId=$P"
curl -s "${H[@]}" "$B/paypal/suggest?projectId=$P&earnAppAccountId=$EA&amount=10.00&currency=USD"
curl -s "${H[@]}" "$B/withdrawals?projectId=$P&status=PREPARING"
curl -s "${H[@]}" "$B/withdrawals/$WD?projectId=$P"
# Ghi số dư (OK, "0.00" hợp lệ; ERROR: bỏ amount, ghi errorMessage)
curl -s "${H[@]}" "${W[@]}" -H "Idempotency-Key: bal-$VM-20261021-1" -X POST "$B/vms/$VM/balance-check" \
  -d '{"projectId":"'$P'","expectedVmRevision":3,"expectedCycle":1,"earnAppAccountId":"'$EA'","status":"OK","amount":"12.40","currency":"USD","withdrawable":true,"checkedAt":"2026-10-21T09:15:00+07:00","evidenceNote":"Nút Redeem hiện trên EarnApp"}'
# Chuẩn bị rút (giữ email từ /paypal/suggest)
curl -s "${H[@]}" "${W[@]}" -H "Idempotency-Key: prep-$EA-1" -X POST "$B/withdrawals/prepare" \
  -d '{"projectId":"'$P'","vmId":"'$VM'","expectedVmRevision":3,"expectedCycle":1,"earnAppAccountId":"'$EA'","paypalEmailId":"'$EM'","amount":"10.00","currency":"USD","requestedAt":"2026-10-21T09:20:00+07:00"}'
# Đã gửi trên EarnApp (thấy trong lịch sử rút) / UNKNOWN_RESULT
curl -s "${H[@]}" "${W[@]}" -H "Idempotency-Key: sent-$WD-1" -X POST "$B/withdrawals/$WD/status" \
  -d '{"projectId":"'$P'","vmId":"'$VM'","expectedVmRevision":3,"expectedCycle":1,"earnAppAccountId":"'$EA'","expectedRequestRevision":0,"status":"SUBMITTED_ON_EARNAPP","evidenceNote":"Thấy yêu cầu $10 trong Payout history","observedAt":"2026-10-21T09:25:00+07:00"}'
# Tiền thực về PP (từng phần được; không vượt phần còn chờ)
curl -s "${H[@]}" "${W[@]}" -H "Idempotency-Key: rcv-$WD-1" -X POST "$B/withdrawals/$WD/receipts" \
  -d '{"projectId":"'$P'","expectedRequestRevision":1,"amount":"6.00","currency":"USD","receivedAt":"2026-10-23T08:00:00+07:00","transactionId":"<mã giao dịch PayPal>","evidenceNote":"PayPal activity"}'
```

Script mẫu `scripts/ops-client.mjs` làm cùng việc (đọc `MTH_TOKEN` / `MTH_PIN` hoặc file bí mật; không in token, PIN, header hay môi trường):
`post <path> <body.json>` in ra `idempotencyKey`; gửi lại sau khi mất phản hồi bằng `--key <cùng key>`.

## 5. Luồng chuẩn cho AI

1. `/me` (xem `effective`) → `/projects` → `/vms/resolve` → `/vms/{id}` (lấy `expectedCycle`, `revision`, `earnAppAccount.id`).
2. Đọc số dư trên EarnApp (ngoài web) → `balance-check` với `checkedAt` là lúc đọc thật; `withdrawable: true` chỉ khi thấy điều kiện rút.
3. `paypal/suggest` với số tiền → `withdrawals/prepare` với `paypalEmailId` (gợi ý chưa giữ gì; prepare mới giữ email).
4. Bấm rút trên EarnApp (ngoài web) → thấy trong lịch sử EarnApp → `status SUBMITTED_ON_EARNAPP`; không chắc → `UNKNOWN_RESULT`, đối chiếu lịch sử
   EarnApp trước, không bấm lần hai.
5. Tiền về PayPal → `receipts` đúng số thực nhận, có mã giao dịch. Yêu cầu 10, về 6 → còn chờ 4; không tự chốt thiếu (việc của quản lý trên web).
6. 409 `CYCLE_CHANGED` / `ACCOUNT_CHANGED`: VM đã sang lượt mới hoặc đổi tài khoản — dừng, đọc lại; tài khoản cũ đối chiếu trên web (Lịch sử VM).
   Tiền về muộn của tài khoản cũ vẫn ghi `receipts` vào đúng yêu cầu cũ (không cần khớp tài khoản hiện tại).
