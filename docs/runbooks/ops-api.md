# API vận hành AI — `/api/ops/v1` (21/10/2026; không PIN + duyệt lệnh từ 23/10/2026)

API cho Claude vận hành (hoặc script khác) đọc MoneyToHome và ghi những việc đã làm ở nơi khác: số dư EarnApp đã đọc, chuẩn bị rút (giữ email PP),
đã gửi / chưa rõ kết quả trên EarnApp, tiền thực về PayPal.

**API này chỉ đọc / ghi MoneyToHome. Nó chưa tạo kết nối tới VM, không đăng nhập EarnApp và không tự rút tiền trên EarnApp.**

Hợp đồng đầy đủ: [docs/ops-api/openapi.json](../ops-api/openapi.json) (bản 1.3.0). Thiết kế: [docs/superpowers/specs/2026-10-21-ops-api-design.md](../superpowers/specs/2026-10-21-ops-api-design.md)
và [2026-10-23-totp-ai-approval-design.md](../superpowers/specs/2026-10-23-totp-ai-approval-design.md).

**Bổ sung 1.3.0 (23/10 tối):** [Kho / batch / CLI TOTP](ai-stock-batch.md) là hướng dẫn hiện hành cho ACCOUNT_OPS, proxy / SDK từ kho, duyệt CLI hoặc web và lô có kết quả từng phần. Chủ tạo token **90 ngày** trong UI: READ, VM_OPS, BALANCE_WRITE, PROXY_CREDENTIALS, ACCOUNT_OPS; **không PAYOUT / RECEIPT**. Các ví dụ payout bên dưới chỉ mô tả API cho người đã được cấp quyền tương ứng, không phải quyền của token vận hành này.

## Quy tắc hiện hành — quyết định chủ 24/10/2026

- AI lấy bí mật kho trực tiếp bằng Bearer token + Idempotency-Key: `POST earnapp-accounts/{id}/credentials` (ACCOUNT_OPS), `POST sdks/{id}/reveal` (VM_OPS), và `POST vms/{id}/proxy-credentials` (PROXY_CREDENTIALS + VM_PROXY_FOR_OPS). Không approval, không PIN/TOTP, không cần ADMIN có mặt cho các lần đọc này.
- Không nới quyền: vẫn kiểm token còn hiệu lực, scope, quyền user và dự án/server hiện tại. Account credentials cần tài khoản hiện hành và job ACTIVE của chính user/token đúng VM/lượt; proxy credentials cũng cần job hiện hành đúng VM/lượt. SDK reveal kiểm SDK trong phạm vi hiện tại, không thêm jobId vào body `{projectId}`. User SELECTED không được dùng kho chung hoặc đọc SDK/proxy ngoài server được giao; bỏ duyệt không mở các route đang bị giới hạn server từ chối.
- Chỉ các lệnh tài chính `withdrawals/prepare`, `withdrawals/{id}/status`, `withdrawals/{id}/receipts` còn cần ADMIN duyệt bằng 2FA. Token vận hành không PAYOUT/RECEIPT vẫn không được gọi chúng. Không tự xác nhận approval, giả ADMIN hoặc tìm mã TOTP để lấy bí mật kho.
- Yêu cầu **lẻ** lấy account credentials / SDK reveal / proxy đã PENDING trước thay đổi: `retry <key>` với đúng key/path/body cũ; máy chủ kiểm quyền/job/server hiện tại rồi đọc trực tiếp, không cần duyệt bản ghi cũ. Mất quyền hoặc job hết hạn vẫn bị từ chối; không tạo key mới để vượt kiểm tra. Không coi approval cũ là đã APPROVED/CONSUMED. Lô cũ vẫn đối chiếu từng mục; không suy quy tắc retry lệnh lẻ thành bỏ gate toàn lô.
- Giữ nguyên cách xử lý bí mật: credential/proxy vào tệp riêng theo client, xoá sau dùng; SDK reveal theo luồng đầu ra bí mật hiện có, không ghi nhật ký/chat/Git. Ví dụ HTTP dưới đây mô tả hợp đồng; không đưa đầu ra bí mật vào log dùng chung. Đây là hướng dẫn cho thay đổi được chủ yêu cầu, không phải bằng chứng đã deploy.

## 0. Lịch sử thay đổi 23/10/2026 — phần duyệt bí mật kho được thay thế bởi quy tắc 24/10 ở trên

- **Không còn `X-Ops-Pin`.** Token là chứng thực duy nhất của AI; `PIN_REQUIRED / PIN_INVALID / PIN_LOCKED` không còn phát sinh. Mọi chỗ bên dưới
  còn nhắc PIN cho AI là lịch sử. (Người dùng web dùng 2FA Google Authenticator thay PIN — xem user-access.md.)
- **Lệnh quan trọng cần ADMIN duyệt** (`POST withdrawals/prepare`, `withdrawals/{id}/status`, `withdrawals/{id}/receipts`,
  `sdks/{id}/reveal` và `earnapp-accounts/{id}/credentials`): sau khi kiểm token / thao tác / nội dung, lệnh lẻ **chưa chạy** và trả **HTTP 202**
  `{ok:false, data:null, error:{code:"APPROVAL_REQUIRED", message, details:{approvalId, status:"PENDING", expiresAt}}}`. Yêu cầu hiện ở trang
  **Phê duyệt** (`/approvals`, menu ADMIN; chip số chờ duyệt ở sidebar) với tóm tắt cho phép (hành động, VM, số tiền, email PP che, mã SDK che; không
  có bí mật). Chỉ ADMIN của đúng dự án **đã bật 2FA** duyệt / từ chối được. CLI `approve <approvalId> --admin <username>` nhận mã ẩn để duyệt; web Phê duyệt vẫn duyệt / từ chối được. Không lưu mã trong journal hay body file. Chi tiết lô và confirm ở [hướng dẫn 1.3.0](ai-stock-batch.md).
  - Được duyệt → AI gửi lại **cùng `Idempotency-Key` + cùng nội dung** trong 15 phút → lệnh chạy một lần (200, `replay:false`), yêu cầu thành
    CONSUMED; gửi lại nữa → replay bình thường theo key (không cần duyệt lại).
  - Chờ duyệt mà gửi lại → 202 lần nữa (cùng `approvalId`). Cùng key + nội dung khác → 409 `IDEMPOTENCY_CONFLICT` (duyệt gắn với hash nội dung).
  - Từ chối → 403 `APPROVAL_REJECTED` (details: approvalId, status REJECTED): key này kết thúc, không ghi.
  - Quá 15 phút → 410 `APPROVAL_EXPIRED` (details: approvalId, status EXPIRED, expiresAt): không ghi; muốn xin duyệt lại thì gửi lệnh với **key mới**.
  - Các lệnh ghi khác (giữ / trả / ghi đã dùng tài khoản, gán proxy / SDK từ kho, SDK đã nối, số dư, trạng thái VM, ghi chú, SDK quan sát, việc, Blocked…) chỉ cần token + Idempotency-Key như trước.
- **Mã SDK bị che ở mọi câu trả lời đọc**: `currentSdk.code`, `sdk.items[].code`, `GET sdks` `items[].code`, `job.sdkCode`, `recorded.sdk.code`,
  `recorded.sdks[].code`, `recorded.sdkCode` đều là 4 ký tự đầu + `…` + 4 ký tự cuối (ví dụ `sdk-…3456`); tên trường không đổi, luôn kèm `sdkId`.
  Lệnh ghi vẫn nhận mã đầy đủ từ AI (AI đọc trên máy); `GET sdks?projectId=…&code=` giữ lookup cũ (không nextCursor). Tìm SDK chưa dùng: `GET sdks?projectId=…&state=UNLINKED&place=STOCK&limit=50` **không code**: found:true, sdkId/revision, code che, vị trí và tiền theo quyền; nextCursor chỉ có ở chế độ danh sách. Lọc state=UNLINKED/LINKED/UNCONFIRMED, place=STOCK/VM; phân trang limit/cursor như thường.
- **`POST /sdks/{id}/reveal`** (thao tác token `VM_OPS`, body `{projectId}`, cần duyệt): trả mã đầy đủ một lần `{replay, sdkId, code, revision,
  linkState, currentOf, note}`; audit `SDK_REVEAL`. Không dán mã vào chat / file commit; script in ra stdout một lần và không ghi vào nhật ký lệnh.
- **ops-client** (`scripts/ops-client.mjs`): bỏ `MTH_PIN` / `x-ops-pin`; `init` chỉ hỏi token (file bí mật cũ còn `pin` vẫn đọc được, pin bị bỏ qua).
  202 → trạng thái lệnh **`WAITING_APPROVAL`** (giữ key, nội dung, hash, `approvalId`, `approvalExpiresAt`), in JSON `commandState:"WAITING_APPROVAL"`
  + approvalId + hạn + "ADMIN duyệt CLI (approve) hoặc web (Phê duyệt), rồi chạy lại: retry <key>", **mã thoát 4**. `retry <key>` gửi lại đúng nội dung: 200 → DONE
  (0); 403 APPROVAL_REJECTED → `REJECTED` (1, kết thúc); 410 APPROVAL_EXPIRED → `EXPIRED` (1, dùng key mới). Lệnh `approvals` liệt kê các key đang
  chờ (approvalId, hạn, đã quá hạn hay chưa). `sdk-reveal <projectId> <sdkId> [--key K]` = POST reveal (chờ duyệt rồi `retry`). Một lần gửi lại bị từ
  chối vì token / quyền / giới hạn khi đang chờ duyệt vẫn giữ `WAITING_APPROVAL` (lệnh lẻ chưa chạy; với batch có thể đã ghi mục khác); phản hồi không rõ khi gửi lại vẫn là UNKNOWN (có thể
  đã được duyệt và chạy) → `retry <key>`. `pending` không liệt kê lệnh chờ duyệt (không phải "chưa rõ kết quả").
- Trên web, Thiết lập → Token API vận hành / trang user vẫn cần ADMIN (giờ với mã 2FA thay PIN) để tạo token.

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
| GET /jobs/{id}, POST /vms/{id}/claim, /jobs/{id}/step, /jobs/{id}/release, /vms/{id}/sdk, /vms/{id}/status, /vms/{id}/proxy-blocked, /vms/{id}/notes, /jobs/{id}/finish-prepare, /jobs/{id}/finish-proxy (21/10/2026) | READ (GET) / **VM_OPS** | USER (không phải VIEWER) có Server / VM (quyền ASSIGN / BLOCK hiện có). Xem docs/runbooks/ai-vm-ops.md |
| POST /vms/{id}/proxy-credentials (21/10/2026) | **PROXY_CREDENTIALS** | ADMIN, hoặc USER có **VM_PROXY_FOR_OPS** ("Lấy proxy của VM đang xử lý (AI)"), **và** việc đang giữ (claim) của chính token đó trên VM đó; **không cần ADMIN duyệt** (quyết định 24/10/2026) |
| POST /sdks/{id}/reveal (23/10/2026) | **VM_OPS** | Quyền đọc Server / VM và SDK trong phạm vi dự án/server hiện tại; **trực tiếp, không approval/PIN/TOTP**; câu trả lời đọc thường vẫn che mã |
| GET /earnapp-accounts; POST /earnapp-accounts/hold, /earnapp-accounts/{id}/credentials, /used, /release | **ACCOUNT_OPS** | ASSIGN + Hạ tầng; POST cần job ACTIVE của chính token đúng VM / lượt, theo giới hạn server hiện tại; credentials **trực tiếp, không approval/PIN/TOTP** |
| GET /proxies; POST /vms/{id}/proxy-assign, /sdk-assign, /sdk-linked | READ (GET) / **VM_OPS** (POST) | ASSIGN + job ACTIVE của token; kỳ / VM revision / SDK revision theo từng request |
| GET /approvals/{id}; POST /approvals/{id}/confirm | READ (GET) / token hợp lệ (POST) | Chỉ approval của token; confirm bằng TOTP ADMIN đúng dự án; Idempotency-Key bắt buộc nhưng không lưu mã |
| POST /batch | Theo từng mục | 1–100 POST, key riêng; một approval cho mục đặc quyền; 202 mixed / 200 final, kiểm từng item |

Chỉ các lệnh `withdrawals/prepare`, `withdrawals/{id}/status`, `withdrawals/{id}/receipts` **cần ADMIN duyệt** (202 `APPROVAL_REQUIRED`; cơ chế tài chính ở mục 0 vẫn giữ).

- `EARN_PAYOUT` không mở: ghi yêu cầu "đã gửi" trực tiếp, thất bại / huỷ / gửi lại / sửa / chốt thiếu, đối chiếu tài khoản cũ, sổ PayPal, chi phí,
  rút / chuyển. Trên web người có quyền này thấy nút "Chuẩn bị rút (giữ email)" và "Đã gửi trên EarnApp / Chưa xác định kết quả".
- `PAYPAL_RECEIPT_RECORD` chỉ ghi khoản nhận gắn một yêu cầu rút đã gửi (`recordPayoutReceipt`, chung cho web và API); trên web người có quyền này
  thấy "Ghi tiền về PP" ở khung của ô Tiền VM (trước là Tiền / Rút; chỉ khoản đã nhận, không có Chờ nhận / Khoản riêng). Không mở dán khoản nhận tổng quát, số dư đầu, sửa / thu hồi
  giao dịch, chuyển / rút PP, chi phí.
- Đọc tiền: số dư EarnApp cần quyền đọc số dư (đọc Tiền vào PayPal hoặc ghi số dư); tiền của yêu cầu rút cần đọc Tiền vào PayPal hoặc một trong hai
  quyền hẹp; sổ PayPal (số dư theo sổ của PP) chỉ với đọc Tiền vào + Rút / chuyển.
  Qua token, quyền đi kèm một thao tác ghi (EARN_BALANCE, EARN_PAYOUT, PAYPAL_RECEIPT_RECORD) chỉ mở dữ liệu khi token có thao tác đó: token chỉ READ
  của cùng người không thấy số dư / tiền yêu cầu / email PP đầy đủ nếu quyền đọc đó chỉ đến từ quyền hẹp.
- Proxy đầy đủ (21/10/2026, ngoại lệ hẹp): danh sách / chi tiết vẫn che; chỉ `POST /vms/{id}/proxy-credentials` trả IP:port:user:pass của cấu hình hiện
  hành của VM đang xử lý (token, không duyệt, đúng dự án / server / VM / lượt / việc); audit `VM_PROXY_FOR_OPS` (người, token, VM, proxy id, cấu hình), không user / pass.
- Không làm qua API: xoá / tạo lại VM, thay nhóm sở hữu, chuyển SDK của VM khác, xoá SDK, VM deleted, rút / chuyển PayPal, USDT, chi phí, cấp lại email đã dùng. 1.3.0 mở gán proxy đủ điều kiện từ kho, giữ / trả / ghi đã dùng tài khoản và gán / ghi SDK đã nối trong đúng job, không thay quy tắc dùng vĩnh viễn. (Từ 21/10/2026 API ghi được: nhận việc, bước, SDK của lần cài cho VM đang xử lý, tình trạng quan sát, Blocked, ghi chú.)

- SDK khảo sát (22/10/2026): `POST vms/{id}/sdk-observations` ghi mã cần `VM_OPS`; kèm tiền tích luỹ SDK cần thêm `BALANCE_WRITE` (user `EARN_BALANCE`), như ghi số dư EarnApp; đọc tiền SDK (`sdk.items[].amount`, `GET sdks`) cần quyền đọc số dư. Không mở rút tiền, PayPal hay chi phí. Chi tiết: vm-sdk.md (mục cuối).

## 2. Kích hoạt (chủ dự án làm, theo thứ tự)

1. **Cấp quyền** — Kho proxy → Quyền nhân viên (ADMIN): chọn tài khoản (ví dụ `ai-ops`), giữ Hạ tầng, tick các quyền cần
   (Ghi kiểm tra tiền EarnApp / Chuẩn bị rút EarnApp / Ghi khoản nhận PP của yêu cầu rút). Hai quyền mới mặc định tắt.
2. ~~Đặt PIN cho tài khoản đó~~ — AI **không cần PIN/TOTP khi đọc bí mật kho**. Chỉ lệnh tài chính nêu trên cần ADMIN duyệt; việc ADMIN tạo token vẫn theo bảo mật web hiện có.
3. **Tạo token** — ADMIN mở trang user / Thiết lập → Token API vận hành, chọn dự án và hạn **90 ngày**, scope READ, VM_OPS, BALANCE_WRITE, PROXY_CREDENTIALS, ACCOUNT_OPS; không PAYOUT / RECEIPT trong đợt này. Xác nhận 2FA → token hiện **một lần**. Copy ngay vào kho bí mật; không gửi qua chat, không dán vào lệnh, file commit hay ví dụ.
4. **Nạp bí mật ngoài cuộc chat** — mở terminal của chính bạn (không qua ô chat Claude, không dùng cú pháp `!`), trong thư mục source:
   `node scripts/ops-client.mjs init` → gõ token (không hiện ký tự) → lưu ở `~/.mth/ops-secret.json`. Hoặc đặt biến môi trường
   `MTH_TOKEN` trong phiên terminal của bạn (`MTH_PIN` không còn dùng; file bí mật cũ còn `pin` vẫn đọc được). Lưu ý: một công cụ chạy cùng tài khoản máy vẫn đọc được file / biến đó; đây là
   nơi cất bên ngoài cuộc chat, không phải nơi AI tuyệt đối không đọc được.
5. **Thử đọc một VM**: `node scripts/ops-client.mjs me` → `projects` → `resolve <projectId> <server> <vm>` → `vm <projectId> <vmId>`.
6. **Vận hành trong phạm vi được giao** (mục 4). Thu hồi token ở Thiết lập khi không dùng nữa; lệnh sau bị từ chối ngay, kể cả lệnh ghi đang chờ vào giao dịch (token được kiểm lại trong giao dịch ghi).

## 3. Quy ước

- Header: `Authorization: Bearer $MTH_TOKEN`; lệnh ghi thêm `Idempotency-Key` (8–100 ký tự `A-Za-z0-9._:-`). Không còn `X-Ops-Pin` (23/10/2026).
- Trả về `{ "ok": true, "data": …, "error": null }` hoặc `{ "ok": false, "data": null, "error": { "code", "message", "details"? } }`, kèm
  `X-Request-Id`. HTTP: lệnh lẻ 202 chờ ADMIN duyệt (`APPROVAL_REQUIRED`, chưa chạy); batch 202 `ok:true` có thể đã ghi một số mục, đọc từng kết quả, 401 xác thực, 403 quyền / `APPROVAL_REJECTED`, 404 không thấy (kể cả dự án ngoài token),
  409 xung đột, 410 `APPROVAL_EXPIRED`, 422 dữ liệu sai, 429 giới hạn.
- ID ổn định; `projectId` lấy từ `/projects` (MOON là tên hiển thị, không phải code). Tiền là chuỗi thập phân "10.00"; đồng tiền rõ ràng.
- `expectedCycle` = lượt VM (`VmOperation.cycle`); `expectedVmRevision` = `VirtualMachine.revision`; `expectedRequestRevision` = revision của yêu cầu
  rút. Kiểm trong cùng giao dịch ghi. 409 trả `details.current` (trạng thái hiện tại theo quyền); không tự lấy revision mới để ép ghi.
- Các lệnh ghi nghiệp vụ có wrapper `{ replay, recorded, current }` (không áp dụng chung cho confirm, batch hoặc reveal): `recorded` là đúng lệnh đó như lần ghi đầu (VM, lượt, EarnApp, số tiền, id bản ghi) — gửi lại vẫn
  y nguyên, không bao giờ lấy tài khoản / số dư đang có trên VM thay vào; `current` là trạng thái lúc này (có thể là tài khoản / lượt khác), tách riêng.
  Ghi số dư còn có `vm` / `balance` = số dư mà bản ghi đó để lại (cùng VM / lượt / EarnApp).
- Gửi lại: cùng key + cùng nội dung → kết quả cũ (`replay: true`), không ghi lần hai, kể cả khi dữ liệu đã đổi sau đó; cùng key + nội dung khác →
  `IDEMPOTENCY_CONFLICT`. Key nghiệp vụ thường gắn người dùng + dự án; riêng approval và outer batch key còn gắn chính token, không xoay token để tiếp tục chúng. Mất phản hồi → gửi lại **cùng key**.
- Giới hạn (dùng chung mọi instance): 120 đọc / phút và 30 ghi / phút mỗi token; 30 lần xác thực sai / phút mỗi IP. Lô thêm 10/phút/token, 1–100 mục; một lô tính một hit ghi. 429 có `Retry-After`.
  (Khoá vì PIN sai không còn áp dụng cho AI từ 23/10/2026; mã 2FA sai 3 lần khoá chính ADMIN đang duyệt 30 phút, không khoá token.)
- IP (sửa 21/10/2026, `requestIp` trong src/server/ops-api/safety.ts): **một** địa chỉ dùng chung cho giới hạn IP của token, đếm xác thực sai theo
  địa chỉ, `OpsAudit.ip` và `lastUsedIp`.
  - Trên Railway (biến `RAILWAY_ENVIRONMENT_ID` do nền tảng đặt trong tiến trình, không phải từ request; Host / tên miền không bao giờ là bằng chứng):
    `X-Real-IP`, phải đúng một IPv4 / IPv6 (chuẩn hoá; IPv4-mapped → IPv4); thiếu / sai định dạng / danh sách / có port → không có địa chỉ.
    `X-Forwarded-For` không dùng trên Railway.
  - Ngoài Railway: `X-Forwarded-For` đếm từ phải theo `OPS_TRUSTED_PROXY_HOPS` (local / test). `OPS_CLIENT_IP_SOURCE=railway|xff|none` ghi đè.
  - Token có danh sách IP: không có địa chỉ xác minh được → 403, không bao giờ tự bỏ giới hạn. Luật IP: IPv4 / IPv6 chính xác (so ở dạng chuẩn) hoặc
    IPv4/nn (0–32); IPv6/nn, octet > 255, `/33`… bị từ chối khi tạo và không bao giờ khớp.
  - `GET /health` trả `verifiedIp` + `ipSource`; `GET /health?diag=net` thêm đúng các trường mạng của chính request đó (X-Real-IP, chuỗi
    X-Forwarded-For, X-Railway-Request-Id, X-Railway-Edge; mỗi địa chỉ là IP hợp lệ hoặc `INVALID`), không bao giờ header khác.
  - **Kiểm trên host 21/10/2026 (deploy b4be51aa):** 6 request ghép theo X-Railway-Request-Id với HTTP log Railway: `srcIp` = `X-Real-IP` = IP
    công khai thật ở cả 6. Railway thay thế giá trị client tự gửi: `X-Real-IP: 9.9.9.9` / `not-an-ip` → IP thật; `X-Forwarded-For: 1.2.3.4[, 5.6.7.8]`
    → bị viết lại thành `[IP thật, IP nút biên]`; `X-Railway-Request-Id` giả → id mới. Chưa kiểm trên host: IPv6 (máy kiểm không có IPv6), token có
    danh sách IP (chưa có token trên host). Lưu ý: dịch vụ khác trong cùng mạng riêng Railway của dự án có thể gọi thẳng container bỏ qua nút biên.
- Câu trả lời đọc thông thường không trả mật khẩu, 2FA, link lấy mã, token hoặc credentials proxy; các route bí mật riêng trả trực tiếp theo quyền hiện tại, không approval/PIN/TOTP. Proxy ở câu trả lời thường: id + host che + port + nhóm. Email đăng nhập che. Email PP nhận tiền đầy đủ cho
  người có quyền rút / ghi khoản nhận. Ghi chú tự do được che link / mật khẩu / mã trước khi lưu và trước khi trả.
- Nhật ký: `OpsAudit` (requestId, tokenId, userId, projectId, action, objectId, thời gian, IP đã xác minh, HTTP, kết quả, replay) cho mọi lệnh ghi và
  mọi lần bị từ chối; không có header / body / token. Quyết định duyệt / từ chối ghi `auditLog` `OPS_APPROVE` / `OPS_REJECT` (ADMIN, yêu cầu, hành động);
  `OpsApproval` giữ yêu cầu (tóm tắt cho phép, hash nội dung, hạn, trạng thái PENDING / APPROVED / REJECTED / EXPIRED / CONSUMED / LOCKED). Nhật ký nghiệp vụ vẫn là Lịch sử thao tác của web.

## 4. Ví dụ (biến môi trường, không ghi token vào lệnh)

```bash
B=https://wow.lalamail.sbs/api/ops/v1
H=(-H "Authorization: Bearer $MTH_TOKEN")
W=(-H "Content-Type: application/json")   # không còn X-Ops-Pin (23/10/2026)
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
# Chỉ prepare / status / receipts trả 202 APPROVAL_REQUIRED → ADMIN duyệt → retry cùng key/body.
# SDK reveal trả trực tiếp theo quyền hiện tại, không PIN/TOTP/approval; giữ đầu ra trong luồng bí mật:
curl -s "${H[@]}" "${W[@]}" -H "Idempotency-Key: rev-$SDK-1" -X POST "$B/sdks/$SDK/reveal" -d '{"projectId":"'$P'"}'
```

Script mẫu `scripts/ops-client.mjs` làm cùng việc (đọc `MTH_TOKEN` hoặc file bí mật; không in token, header hay môi trường; không còn PIN):
- `post <path> <body.json>`: key và nội dung được ghi vào nhật ký lệnh cục bộ (`~/.mth/ops-journal`, không có token) và key được in ra **trước khi gửi**.
- 202 `APPROVAL_REQUIRED` → `commandState: "WAITING_APPROVAL"`, mã thoát **4**, in `approvalId` + hạn + "ADMIN duyệt trên web (Phê duyệt), rồi chạy lại:
  retry <key>"; `approvals` liệt kê các lệnh đang chờ; `retry <key>` sau khi duyệt → DONE; `REJECTED` / `EXPIRED` là trạng thái kết thúc (mã thoát 1; hết hạn thì
  gửi lệnh với key mới). `sdk-reveal <projectId> <sdkId>` in mã đầy đủ **một lần** ra stdout, không ghi vào nhật ký lệnh.
- Mất phản hồi / ngắt kết nối → `RESULT_UNKNOWN` "Chưa xác định kết quả" (lệnh có thể đã ghi): chạy `retry <key>` — gửi lại đúng đường dẫn, nội dung và
  key; không tạo lệnh mới. `pending` liệt kê lệnh chưa rõ kết quả. Một key không bao giờ dùng cho nội dung khác (script từ chối).
- **Trạng thái lệnh ≠ kết quả lần gửi gần nhất** (sửa 21/10/2026). Nhật ký giữ `state` (của lệnh) và `lastAttempt` (lần gửi cuối). Mã thoát theo
  trạng thái lệnh: 0 DONE, 1 ANSWERED / REJECTED / EXPIRED, 3 UNKNOWN, 4 WAITING_APPROVAL; đầu ra có `commandState`.
  - Phản hồi không rõ (mọi 5xx — 502 / 503 / 504 từ gateway có thể đến **sau khi** ứng dụng đã ghi; 500 INTERNAL —, HTML, JSON sai cấu trúc, 2xx mà
    `ok:false`, phản hồi đứt, mất kết nối) không chốt gì: lệnh chưa DONE thành UNKNOWN, nằm trong `pending`, in "Chưa xác định kết quả. Gửi lại bằng
    retry <key>."
  - 2xx + `{ok:true, data, error:null}` → DONE.
  - 4xx đúng hợp đồng (`{ok:false, data:null, error:{code, message}}`) **không** có nghĩa chung là "chưa ghi"; ý nghĩa tuỳ lịch sử của lệnh:
    - lần gửi đầu tiên, hoặc mọi lần trước cũng bị từ chối rõ ràng → ANSWERED (chưa ghi; sửa nội dung thì dùng key mới cho lệnh mới);
    - lệnh từng SENDING / UNKNOWN (lần trước có thể đã ghi) → vẫn UNKNOWN trong `pending`, thoát 3: "Lần thử lại bị từ chối: <mã> — <lời>; kết quả lệnh
      ban đầu vẫn chưa xác định…". 401 TOKEN_REVOKED, 403 FORBIDDEN, 429 RATE_LIMITED… bị từ chối **trước khi** máy chủ tra kết quả cũ, nên không
      chứng minh lần đầu chưa ghi. Không tạo key mới: khôi phục token / quyền / chờ hết giới hạn rồi `retry <key>` để nhận kết quả ban đầu (`replay`);
    - lệnh đã DONE → vẫn DONE (thoát 0), lần thử lại bị từ chối / không rõ chỉ ghi vào `lastAttempt`.
  - Kiểm tra quyền của API không nới cho lần gửi lại: muốn nhận kết quả cũ vẫn cần token và quyền hợp lệ.
  - Lệnh đang `WAITING_APPROVAL` mà lần gửi lại bị từ chối vì token / quyền / giới hạn → vẫn `WAITING_APPROVAL` (duyệt vẫn chờ tới hạn; batch có thể đã ghi mục khác);
    phản hồi không rõ khi gửi lại → UNKNOWN (có thể đã được duyệt và chạy) → `retry <key>`.
- Mỗi lệnh lưu trong file `k-<sha256 của key nguyên bản>.json`, nên key chỉ khác nhau ở `:` / `_` hay chữ hoa / thường (Windows) không chung file; bản ghi
  chỉ dùng khi key bên trong khớp tuyệt đối. File cũ (tên `key` thay `:` → `_`) vẫn đọc được khi đúng key, không bị sửa / xoá; file cũ giữ key khác, bản ghi
  hỏng hoặc sai cấu trúc → dừng, báo rõ, không gửi gì (lệnh mới thì dùng key khác; kiểm tra yêu cầu trên MoneyToHome trước khi gửi lại lệnh cũ).
- Token chỉ gửi tới đúng origin của `MTH_BASE` dưới `/api/ops/v1/`: đường dẫn có `..`, dạng mã hoá (`%2e`, `%2f`), tuyệt đối hoặc URL khác bị từ
  chối trước khi gửi; không đi theo redirect; `MTH_BASE` phải là https (http chỉ cho localhost khi thử).

## 5. Luồng payout tham khảo cho token có PAYOUT / RECEIPT

1. `/me` (xem `effective`) → `/projects` → `/vms/resolve` → `/vms/{id}` (lấy `expectedCycle`, `revision`, `earnAppAccount.id`).
2. Đọc số dư trên EarnApp (ngoài web) → `balance-check` với `checkedAt` là lúc đọc thật; `withdrawable: true` chỉ khi thấy điều kiện rút.
3. `paypal/suggest` với số tiền → `withdrawals/prepare` với `paypalEmailId` (gợi ý chưa giữ gì; prepare mới giữ email). **Cần duyệt**: 202 → báo
   ADMIN duyệt CLI hoặc web → `retry <key>` (chưa bấm gì trên EarnApp khi lệnh chưa DONE).
4. Bấm rút trên EarnApp (ngoài web) → thấy trong lịch sử EarnApp → `status SUBMITTED_ON_EARNAPP`; không chắc → `UNKNOWN_RESULT`, đối chiếu lịch sử
   EarnApp trước, không bấm lần hai. (`status` cũng cần duyệt; chờ duyệt không đổi việc đã làm trên EarnApp — vẫn `retry <key>`, không gửi key mới khi chưa hết hạn.)
5. Tiền về PayPal → `receipts` đúng số thực nhận, có mã giao dịch (cần duyệt). Yêu cầu 10, về 6 → còn chờ 4; không tự chốt thiếu (việc của quản lý trên web).
6. 409 `CYCLE_CHANGED` / `ACCOUNT_CHANGED`: VM đã sang lượt mới hoặc đổi tài khoản — dừng, đọc lại; tài khoản cũ đối chiếu trên web (Lịch sử VM).
   Tiền về muộn của tài khoản cũ vẫn ghi `receipts` vào đúng yêu cầu cũ (không cần khớp tài khoản hiện tại).


## Quyền vận hành proxy — 24/10/2026

Khi chủ giao việc, AI dùng VM_OPS để đọc kho, chọn proxy FREE đủ điều kiện và gán qua proxy-assign cho VM của việc đang giữ. Không cần duyệt gán hoặc lấy proxy. Sau khi gán, đọc lại VM, lấy proxy-credentials với PROXY_CREDENTIALS + VM_PROXY_FOR_OPS, đúng job/token/VM/lượt hiện hành; lưu tệp riêng, áp dụng lên máy thật và kiểm tra rồi finish-proxy. Proxy BLOCKED, đang được VM khác giữ, Genjy riêng hoặc không đủ điều kiện vẫn bị chặn. Không tự tạo tác vụ ngoài phạm vi chủ giao. Yêu cầu proxy đã chờ duyệt trước bản này: retry đúng key và nội dung cũ, không cần ADMIN duyệt; nếu job đã hết hạn thì nhận lại việc theo quy trình.
