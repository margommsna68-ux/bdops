# API vận hành AI (`/api/ops/v1`) — thiết kế ngắn (21/10/2026)

Brief chủ dự án 21/10/2026 "YÊU CẦU HOÀN CHỈNH: API VẬN HÀNH AI". API chỉ là lớp xác thực + chuyển đổi vào các service đang có; không có sổ tiền,
cơ chế giữ email, quy tắc cấp tài khoản hay hệ thống lượt thứ hai. API không kết nối VM, không đăng nhập EarnApp, không gửi tiền.

## 1. Quyền

Quyền hiệu lực = quyền hiện tại của user trong dự án (đọc lại DB mỗi request, trong giao dịch khi ghi) ∩ dự án của token ∩ thao tác của token.

| Thao tác token (`scope`) | Endpoint | Quyền nghiệp vụ (kiểm trong service dùng chung) |
|---|---|---|
| `READ` | GET /me, /projects, /servers, /vms, /vms/resolve, /vms/{id}, /earnapp-accounts/{id}, /withdrawals, /withdrawals/{id} | Server / VM đọc (module INFRASTRUCTURE). Tiền trong kết quả lọc như UI (xem dưới) |
| `BALANCE_WRITE` | POST /vms/{id}/balance-check | `balanceRights.write`: ADMIN / MODERATOR có ghi Server / VM, hoặc USER có `EARN_BALANCE` |
| `PAYOUT` | GET /paypal/suggest, POST /withdrawals/prepare, POST /withdrawals/{id}/status | `payoutRights.payout`: người ghi Tiền vào PayPal (quản lý), hoặc USER không phải VIEWER có module INFRASTRUCTURE + `EARN_PAYOUT` |
| `RECEIPT` | POST /withdrawals/{id}/receipts | `payoutRights.receipt`: người ghi Tiền vào PayPal (quản lý), hoặc USER không phải VIEWER có `PAYPAL_RECEIPT_RECORD` |

- `EARN_PAYOUT` (mới, mặc định tắt): chuẩn bị yêu cầu (submission PREPARING, giữ email), ghi SENT / UNKNOWN. Không mở: ghi yêu cầu SENT trực tiếp,
  FAILED / CANCELLED / RETRY / CORRECT / SETTLE, đối chiếu lịch sử tài khoản cũ, sổ PayPal, chi phí, rút / chuyển. Các việc đó vẫn của quản lý.
- `PAYPAL_RECEIPT_RECORD` (mới, mặc định tắt): chỉ ghi khoản nhận gắn một yêu cầu rút đã SENT (`recordPayoutReceipt`). Không mở dán
  khoản nhận tổng quát, số dư đầu, rút / chuyển, thu hồi.
- Đọc tiền: số dư EarnApp = `balanceRights.read` (như UI: đọc Tiền vào PayPal, hoặc có quyền ghi số dư). Tiền của yêu cầu rút (yêu cầu / đã nhận /
  còn chờ) = đọc Tiền vào PayPal, hoặc `EARN_PAYOUT`, hoặc `PAYPAL_RECEIPT_RECORD`. Số dư theo sổ của PP chỉ với đọc Tiền vào + Rút / chuyển;
  người chỉ có `EARN_PAYOUT` nhận gợi ý và "sau khoản này ~$x" của PP được gợi ý, không nhận sổ.
- Qua token, quyền đọc đến từ một quyền hẹp chỉ mở khi token có thao tác tương ứng (BALANCE_WRITE / PAYOUT / RECEIPT); đọc Tiền vào PayPal là READ.
- UI dùng cùng `payoutRights` / `balanceRights`: nút "Chuẩn bị rút" + "Đã gửi / Chưa rõ kết quả" theo `payout`; các nút quản lý theo `writeMoney`.
- `runBusinessCommand` nhận `authorize` riêng cho các lệnh này (không nới điều kiện FUNDS tổng quát).

## 2. Token, PIN, giới hạn, IP, nhật ký

- Bảng `OpsToken`: `mth_` + 32 byte ngẫu nhiên (base64url); lưu SHA-256; `prefix` 12 ký tự để nhận diện; user, `projectIds[]`, `scopes[]`, hạn
  (≤ 90 ngày), `allowedIps[]` tuỳ chọn, `revokedAt`, `lastUsedAt` / `lastUsedIp`. ADMIN tạo trong Thiết lập (PIN của ADMIN), chỉ cho dự án mình là
  ADMIN và chỉ thao tác user nhận đang có quyền; bản đầy đủ trả đúng một lần. Danh sách không có token. Thu hồi = `revokedAt`.
- Mỗi request: token tồn tại, chưa thu hồi, chưa hết hạn; user còn mật khẩu và không bị khoá đăng nhập; còn là thành viên dự án; thao tác nằm trong
  token. Bearer không gọi được tRPC, không tạo token, không đổi quyền / PIN.
- PIN: header `X-Ops-Pin`, `checkPin` dùng chung với `verifyBusinessPin` (sai 3 lần khoá 30 phút theo user). Thêm giới hạn theo token: 5 lần sai
  / 30 phút → `PIN_LOCKED` cho token đó; đổi token không vượt khoá theo user.
- Giới hạn tần suất: bảng `OpsRateBucket` (cửa sổ cố định, `INSERT … ON CONFLICT` nguyên tử, dùng chung mọi instance / restart): token đọc 120 / phút,
  ghi 30 / phút, IP lỗi xác thực 30 / phút. 429 + `Retry-After`.
- IP: lấy từ `X-Forwarded-For` đếm từ phải sang đúng `OPS_TRUSTED_PROXY_HOPS` (mặc định 1 = proxy Railway); phần client tự khai bên trái bị bỏ.
  `GET /health` trả IP đã xác minh của chính người gọi để kiểm.
- `OpsAudit`: requestId, tokenId, userId, projectId, action, objectId, thời gian, IP đã xác minh, httpStatus, kết quả (mã), replay. Ghi cả lệnh bị
  từ chối. Không lưu header, body, PIN, token. Nhật ký nghiệp vụ vẫn là `OperationJournal` trong cùng giao dịch của service.
- Ghi chú tự do (`evidenceNote`, `errorMessage`) qua `redactSecrets`: che link có mã / query, `mật khẩu:` / `password=`, chuỗi 2FA, proxy đầy đủ
  `ip:port:user:pass`, Bearer / `mth_` token trước khi lưu.

## 3. Định danh, phiên bản, gửi lại

- `/projects` trả id, code, name; mọi lệnh dùng `projectId`. `resolve` khớp đúng server code + VM code (không phân biệt hoa thường, không gần đúng);
  VM đã xoá không khớp; nhiều kết quả → `AMBIGUOUS`.
- Lượt = `VmOperation.cycle` (`expectedCycle`). Revision VM = `VirtualMachine.revision` (`expectedVmRevision`); revision yêu cầu rút =
  `EarnPayoutRequest.revision` (`expectedRequestRevision`). Ghi số dư, chuẩn bị rút, ghi trạng thái không tăng revision VM; khoản nhận tăng revision
  yêu cầu. Tất cả kiểm trong giao dịch của service.
- Gửi lại: `Idempotency-Key` → khoá lệnh service `ops:` + SHA-256(userId, projectId, key) (không theo token, nên xoay token vẫn chống trùng).
  Service so `requestHash` của nội dung đã chuẩn hoá (không có token / PIN): cùng nội dung → kết quả cũ (`replay: true`), khác → `IDEMPOTENCY_CONFLICT`.
  Hai request đồng thời bị xếp hàng bởi khoá dự án (`pg_advisory_xact_lock`). Retry vẫn kiểm token, quyền, PIN; dữ liệu trả về đọc lại theo quyền
  hiện tại.

## 4. Endpoint ghi → service

| Endpoint | Service | Ghi chú |
|---|---|---|
| POST /vms/{id}/balance-check | `recordBalanceChecks` (source AI, strict) | OK: amount + currency bắt buộc, "0.00" hợp lệ; ERROR: không nhận amount, cần errorMessage; withdrawable true cần evidenceNote |
| GET /paypal/suggest | `suggestPayout` | amount + currency; mục tiêu 100 chỉ áp cho USD; không có amount → `exact: false` |
| POST /withdrawals/prepare | `createPayoutRequest` (PREPARING) | paypalEmailId bắt buộc; giữ email có điều kiện; EarnApp đã có yêu cầu → `DUPLICATE` + id |
| POST /withdrawals/{id}/status | `updatePayoutRequest` (SENT / UNKNOWN) | observedAt lưu ở dòng lịch sử, giờ máy chủ riêng; lượt / account cũ → `CYCLE_CHANGED` / `ACCOUNT_CHANGED` |
| POST /withdrawals/{id}/receipts | `recordPayoutReceipt` (mới) | chỉ yêu cầu SENT; đúng PP / email / EarnApp / VM lịch sử của yêu cầu; transactionId duy nhất; thiếu mã → nghi trùng cùng email / ngày / số tiền = `DUPLICATE`; không vượt phần còn chờ; kỳ khoá |

## 5. Không làm

Xoá / khôi phục / tạo lại VM, proxy, nhóm, liên kết tài khoản, SDK, tình trạng VM, rút / chuyển PayPal, USDT, chi phí, cấp lại email đã dùng, tạo user /
nâng role / cấp quyền thật cho ai-ops trên host.
