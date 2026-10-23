# 2FA (TOTP) cho người dùng và phê duyệt lệnh AI — thiết kế 23/10/2026

Quyết định của chủ (23/10/2026, chat): PIN cố định không đủ; thay bằng mã Google Authenticator (TOTP). AI chỉ cần token; không còn `X-Ops-Pin`. Chỉ ADMIN quản lý user AI. Lệnh quan trọng của AI (rút tiền, xoá VM, xuất / hiện SDK, lấy proxy đầy đủ) phải được ADMIN duyệt trên web bằng mã 2FA; AI không bao giờ cầm mã. Người dùng được bật 2FA sẽ bị popup bắt cài khi vào. 2FA dùng cả lúc đăng nhập lẫn mở khoá / hành động nhạy cảm. SDK che mã trong API; mã đầy đủ chỉ trả khi được duyệt.

## Mục tiêu / không mục tiêu
- Mục tiêu: (1) TOTP chuẩn RFC 6238 (SHA-1, 6 số, 30 s, cửa sổ ±1 bước, chống dùng lại cùng bước) cho mọi người dùng web, thay cho PIN ở đúng những chỗ PIN đang được kiểm; thêm bước mã ở đăng nhập. (2) Hàng đợi phê duyệt cho AI: lệnh quan trọng bị giữ lại cho tới khi một ADMIN của dự án duyệt bằng TOTP; AI gửi lại cùng `Idempotency-Key` thì chạy. (3) API không trả mã SDK đầy đủ; xem mã đầy đủ là một lệnh cần duyệt. (4) Không còn PIN cho token AI.
- Không mục tiêu: WebAuthn/passkey; SMS/email OTP; duyệt qua Telegram; đổi quy tắc nghiệp vụ nào khác (rút tiền, SDK, proxy) ngoài việc thêm bước duyệt.
- Phản mục tiêu: AI hoặc token AI biết khoá TOTP của bất kỳ ai; mã TOTP đi qua chat / log; lệnh được duyệt mà nội dung khác lúc ADMIN xem; duyệt một lần dùng cho nhiều lệnh.

## Dữ liệu (migration cộng thêm `20261023120000_totp_approvals`)
- `User`: `totpSecretCipher String?` (khoá base32 mã hoá bằng ENCRYPTION_KEY), `totpEnabledAt DateTime?`, `totpRequiredAt DateTime?` (ADMIN bắt buộc), `totpLastStep Int?` (bước thời gian cuối đã dùng, chống phát lại), `totpFailedCount Int @default(0)`, `totpLockedAt DateTime?`, `totpVersion Int @default(0)` (tăng khi cài lại / ADMIN đặt lại; phiên mở khoá gắn với version này). PIN cũ giữ nguyên cột, không dùng khi user đã bật TOTP; bị xoá dần.
- `UserBackupCode`: `id, userId, codeHash, usedAt?, createdAt` — 8 mã dự phòng 10 ký tự, băm bcrypt, dùng một lần.
- `UserSession`: thêm `totpUnlockedAt DateTime?`, `totpVersion Int?`, `totpAtLogin Boolean @default(false)`. Mở khoá = `totpUnlockedAt` và `totpVersion === user.totpVersion` (thay cho `pinUnlocked` khi user đã bật TOTP).
- `OpsApproval`: `id, projectId, tokenId, userId (AI), action (route action), method, path, objectId?, requestKey (serviceKey), payloadHash, summary Json (các trường được phép: VM/server, số tiền, email che, mã SDK che…), status PENDING|APPROVED|REJECTED|EXPIRED|CONSUMED, requestedAt, expiresAt (requestedAt + 15 phút), decidedById?, decidedAt?, decisionNote?, consumedAt?, consumedRequestId?`. Chỉ số: (projectId,status), (requestKey) unique theo status mở.

## Luồng người dùng
1. Đăng nhập: NextAuth credentials thêm trường `code` (tuỳ chọn). Nếu user có `totpEnabledAt` → bắt buộc `code` đúng (TOTP hoặc mã dự phòng); sai → tính vào `totpFailedCount` (3 lần → khoá 30 phút, chung một bộ đếm với mở khoá). Đăng nhập đúng mã → phiên mở với `totpAtLogin=true`, `totpUnlockedAt=now` (không hỏi lại ngay sau đăng nhập). Form đăng nhập: ô "Mã Google Authenticator" hiện khi server trả `TOTP_REQUIRED` (lần đầu gửi không có mã).
2. Cài 2FA: `user.totpBegin` (tạo khoá tạm trong phiên, trả `otpauth://` + QR data URL + khoá chữ; khoá tạm lưu ở `UserSession.totpSetupCipher`… đơn giản hơn: lưu trong `User.totpSecretCipher` với `totpEnabledAt=null` = "đang cài"), `user.totpConfirm({code})` → bật, tăng `totpVersion`, tạo 8 mã dự phòng (trả một lần), xoá PIN cũ (`pin=null`, `pinVersion++`). Mở khoá phiên hiện tại.
3. Popup bắt buộc: `TotpGate` thay `PinGate`. Trạng thái từ `user.securityStatus`: `{totpEnabled, totpRequired, unlocked, hasPin}`. Nếu `totpRequired && !totpEnabled` → màn cài (không bỏ qua được). Nếu `totpEnabled && !unlocked` → nhập mã. Nếu chưa bật và không bắt buộc → giữ luồng PIN cũ (giai đoạn chuyển) + nút "Bật 2FA". ADMIN có thể bật `totpRequiredAt` cho user (trang `/users/{id}` nút "Bắt buộc 2FA"), và "Đặt lại 2FA" (xoá khoá, `totpVersion++`, user phải cài lại ở lần vào sau; mọi phiên mở khoá cũ mất).
4. Mở khoá / hành động nhạy cảm: `user.verifyTotp({code})` thay `verifyPin` cho user đã bật TOTP; `trpc.ts` middleware `PIN_REQUIRED` giữ nguyên tên mã lỗi nhưng kiểm `unlocked` theo TOTP khi user đã bật. `verifyBusinessPin` (copy credentials) nhận mã TOTP khi user đã bật TOTP.
5. ADMIN quản lý user AI: `ai-ops` không có 2FA (không đăng nhập web). Chỉ ADMIN được sửa quyền / token của user AI (đã đúng từ 22/10; giữ).

## Luồng AI (ops API)
- Bỏ bước 4 (X-Ops-Pin). `PIN_*` không còn phát sinh cho AI. Thêm mã lỗi `APPROVAL_REQUIRED` (HTTP 202, `ok:false`, `error.code='APPROVAL_REQUIRED'`, `details:{approvalId, expiresAt, status:'PENDING'}`) và `APPROVAL_REJECTED` (403), `APPROVAL_EXPIRED` (410, gửi lại tạo yêu cầu mới).
- Route cần duyệt (`approval:true`): `WITHDRAWAL_PREPARE`, `WITHDRAWAL_STATUS`, `WITHDRAWAL_RECEIPT`, `VM_PROXY_CREDENTIALS`, mới `SDK_REVEAL` (`POST /sdks/{id}/reveal`, scope VM_OPS, trả `code` đầy đủ một lần). Các route ghi khác (trạng thái, ghi chú, SDK quan sát, số dư, việc) chỉ cần token.
- Cơ chế: với route cần duyệt, sau bước token/scope/body, tính `requestKey=serviceKey` và `payloadHash=sha256(canonical body)`. Tìm `OpsApproval` theo `requestKey`: không có → tạo PENDING (summary từ body + tên VM / số tiền; không secret) → 202. PENDING → 202 (cùng id). APPROVED và `payloadHash` khớp và chưa hết hạn → chạy lệnh trong cùng transaction đánh dấu CONSUMED (`consumedRequestId`), trả kết quả thường. APPROVED nhưng hash khác → `IDEMPOTENCY_CONFLICT`. REJECTED → 403. EXPIRED/hết hạn → 410 và tạo PENDING mới chỉ khi AI gửi lại với key mới. CONSUMED → lệnh thường replay theo key (service idempotency) không cần duyệt lại.
- Web: trang **Phê duyệt** (`/approvals`, menu cho ADMIN; chip số chờ duyệt ở sidebar): bảng PENDING của dự án (ai, token, hành động, đối tượng, nội dung tóm tắt, hết hạn), nút Duyệt / Từ chối; Duyệt yêu cầu mã TOTP của chính ADMIN (kiểm `verifyTotpCode` + chống dùng lại; không dùng unlock của phiên). Quyết định ghi `auditLog` (`OPS_APPROVE`/`OPS_REJECT`). Chỉ ADMIN của dự án đó (membership ADMIN, có 2FA đã bật) mới duyệt được; ADMIN chưa bật 2FA không duyệt được.
- SDK che mã: `vmDetail.sdk.items[].code`, `sdkLookup.items[].code` (chỉ khi `found`), `jobDetail.sdkCode`, `vmSdkObserve.recorded.sdks[].code`, `vmSdk.recorded.sdk.code` → `maskSdk(code)` = 4 ký tự đầu + `…` + 4 ký tự cuối (ví dụ `sdk-…9f2a`), kèm `sdkId`. Lệnh ghi vẫn nhận mã đầy đủ từ AI (AI đọc trên máy). `sdkLookup` vẫn chấp nhận `code` đầy đủ để đối chiếu revision.
- ops-client: bỏ MTH_PIN / `x-ops-pin`; `init` chỉ hỏi token; khi nhận 202 APPROVAL_REQUIRED: lưu trạng thái `WAITING_APPROVAL` cho key, in `approvalId` + hạn, mã thoát 4; `retry <key>` gửi lại cùng nội dung; `approvals` lệnh mới liệt kê các key đang chờ. `sdk-prepare`/`sdk-survey` không cần đổi (không đọc mã từ web).
- OpenAPI: version 1.2.0; bỏ `X-Ops-Pin`; thêm `APPROVAL_REQUIRED` envelope, `/sdks/{id}/reveal`, trường `code` mô tả "đã che".

## Bảo mật
- Khoá TOTP sinh 20 byte ngẫu nhiên, lưu mã hoá; không bao giờ trả lại sau khi xác nhận. QR chỉ tạo phía server dưới dạng data URL cho phiên đang cài.
- Chống phát lại: `totpLastStep` ghi bước đã dùng (FOR UPDATE), mã cùng bước hoặc cũ hơn bị từ chối; cửa sổ ±1 bước (90 s) cho lệch giờ.
- Khoá 3 lần sai / 30 phút (một bộ đếm `totpFailedCount` cho đăng nhập, mở khoá, duyệt). ADMIN mở khoá sớm bằng `adminUnlockAccount` (mở rộng).
- Mã dự phòng dùng một lần; dùng mã dự phòng cũng mở khoá; hết mã → cài lại 2FA qua ADMIN.
- Duyệt gắn với `payloadHash`: ADMIN duyệt đúng nội dung AI gửi; AI đổi nội dung → không dùng được duyệt cũ.
- Thời gian máy chủ: kiểm `w32tm /query /status` khi triển khai; lệch > 30 s báo lỗi trong trang Thiết lập (hiển thị giờ server).

## Kiểm thử
- Đơn vị: vector RFC 6238 (SHA-1), cửa sổ, chống phát lại, mã dự phòng, mask SDK, canonical payload hash.
- Tích hợp: đăng nhập cần mã khi bật; popup bắt buộc (`securityStatus`); mở khoá theo version; ADMIN đặt lại 2FA làm mất unlock; ops API: route thường không cần PIN; route quan trọng → 202 → duyệt (sai mã / đúng mã / người không phải ADMIN / ADMIN chưa bật 2FA) → gửi lại chạy → CONSUMED → replay; hash khác → 409; hết hạn → 410; mã SDK bị che ở mọi câu trả lời đọc; `sdks/{id}/reveal` cần duyệt và trả mã đầy đủ một lần; ops-client xử lý 202 và `approvals`.
- Trình duyệt (bản local): cài 2FA, đăng nhập với mã, popup bắt buộc, trang Phê duyệt.

## Triển khai
Migration cộng thêm; bản build mới lên D:\MoneyToHome (backup trước); chủ cài 2FA trước, rồi bật bắt buộc cho các user khác; Central ops-client bản mới (không PIN).
