# Quyền kho + lệnh hàng loạt + duyệt bằng 2FA tại CLI cho AI vận hành — thiết kế 23/10/2026 (tối)

Nguồn: prompt của Claude VẬN HÀNH trên moon-01 (`PROMPT_BUILD_QUYEN_KHO_AI.md`, bản sao trong private-config) và quyết định chủ (chat tối 23/10):
- **Duyệt:** AI được nhận mã 2FA của ADMIN **tại CLI** ("anh nhập 2FA tại CLI, đúng thì tiếp tục, không qua web cho nhanh"). Web vẫn duyệt được (trang Phê duyệt) như một đường thứ hai. Mã không bao giờ được ghi vào nhật ký / log / chat.
- **Phạm vi duyệt:** giữ như hiện tại (rút tiền, ghi tiền về, proxy đầy đủ, mã SDK đầy đủ) **+ thông tin đăng nhập tài khoản EarnApp**. Ghi SDK đọc từ máy, gán proxy / tài khoản / SDK **từ kho**, tình trạng, ghi chú: chạy ngay với kiểm lượt / revision (chủ không chọn "mọi lệnh SDK đều duyệt").
- **server-02 → server-09:** thuộc nhóm AE, xử lý sau; không nằm trong đợt này.
- Token `AI vip` đã thu hồi (lộ trong chat). Token mới do chủ tạo trong UI: hạn 90 ngày, scope READ, VM_OPS, BALANCE_WRITE, PROXY_CREDENTIALS, **ACCOUNT_OPS**; không PAYOUT / RECEIPT.

## Không mục tiêu
Không đổi quy tắc nghiệp vụ kho (một VM một tài khoản hiện hành; email/tài khoản đã dùng là vĩnh viễn; SDK đã nối là vĩnh viễn; một proxy một VM đang chạy; Genjy riêng không vào VM); không tạo dự án / server mới; không rút tiền tự động; không nhập dữ liệu mới.

## A. Kho tài khoản EarnApp cho AI (scope mới `ACCOUNT_OPS`)
Dữ liệu dùng lại: `GmailAccount` (kho đăng nhập Gmail / Apple ID), `EarnAppAccount` (tài khoản đang gắn VM; `registeredAt` = đã dùng thật). "Giữ cho VM" = `applyLinks` (tạo EarnAppAccount, trạng thái kho "Đã gán"); "Đã dùng" = `markEarnAppRegistered`; "Trả lại" = bỏ gán qua đường hiện có (`applyLinks` với `login:null`) chỉ khi chưa `registeredAt`.
- `GET earnapp-accounts?projectId&state=UNUSED|HELD|USED&type=GMAIL|APPLE&limit&cursor`: email **che**, loginType, trạng thái, VM đang giữ (server/vm/lượt), `revision`; không mật khẩu / link 2FA / phone.
- `POST earnapp-accounts/hold {projectId, vmId, expectedCycle, expectedVmRevision, jobId, loginType}`: giữ **một** tài khoản UNUSED kế tiếp (thứ tự nhập) cho VM đang có việc của chính token (job ACTIVE, cùng VM, cùng lượt). VM đã có tài khoản hiện hành → trả tài khoản đó (`already:true`), không giữ thêm. Trả `accountId` (EarnAppAccount), `loginId`, email che, `revision`.
- `POST earnapp-accounts/{id}/credentials {projectId, vmId, jobId}` — **cần duyệt**: email + mật khẩu + link 2FA / SMS / phone của đúng tài khoản đang giữ cho VM đó, job ACTIVE của token. Audit không chứa bí mật; client ghi vào tệp riêng (`runtime/account-<id>.json`, ACL riêng), không in.
- `POST earnapp-accounts/{id}/used {projectId, vmId, jobId, sdkId?, evidence}`: chỉ khi đăng ký / đăng nhập EarnApp thành công thật (`registeredAt`, người = token); nếu có `sdkId` thì gọi luôn `linkVmSdk` (Đã nối, vĩnh viễn). Không tự suy từ tiền hay SDK.
- `POST earnapp-accounts/{id}/release {projectId, vmId, jobId, reason}`: trả tài khoản chưa dùng về kho (bỏ gán); đã `registeredAt` → từ chối; kết quả chưa xác định → AI không gọi (giữ chỗ).
Quyền: `ACCOUNT_OPS` trên token + user có quyền ASSIGN (như VM_OPS) + module INFRASTRUCTURE. `credentials` thêm duyệt.

## B. Kho proxy cho AI
- `GET proxies?projectId&state=FREE|ASSIGNED|BLOCKED&group=TUT|SHARED&package&limit&cursor` (scope READ): host, port, gói, nhóm, trạng thái kho, vị trí VM nếu có; **không user / pass**. FREE = NEW, đủ điều kiện cấp (TUT hoặc Chung theo quy tắc hiện có), không giữ ở VM nào.
- `POST vms/{id}/proxy-assign {projectId, expectedCycle, expectedVmRevision, jobId, proxyId? | pick:{group:'TUT'|'SHARED', package?}}` (scope VM_OPS): gán một proxy FREE cho VM đang có việc của token; không `proxyId` thì lấy FREE kế tiếp đúng nhóm/gói. Dùng `assignProxyToVm` trong một giao dịch có `SELECT … FOR UPDATE` trên endpoint (hai lô song song không lấy trùng). Trả `configurationId`, `endpointId`, host:port. Genjy riêng không bao giờ được chọn. Blocked không chọn.
- `vms/{id}/proxy-credentials` giữ nguyên (cần duyệt; trong lô dùng chung một approval).

## C. Kho SDK cho AI
- `POST vms/{id}/sdk-assign {projectId, expectedCycle, expectedVmRevision, jobId, sdkId, expectedSdkRevision}` (VM_OPS): lấy mã **UNLINKED trong kho** (không ở VM nào, hoặc trong danh sách của chính VM) làm SDK hiện hành của VM — chính là `placeVmSdk` với `from` rỗng ("Dùng SDK trong kho"); mã hiện hành cũ chưa nối ở lại danh sách VM (quy tắc 20/10). UNCONFIRMED / LINKED / mã của VM khác → từ chối.
- `POST sdks/{id}/reveal` giữ nguyên (cần duyệt; lô = một approval).
- `POST vms/{id}/sdk-linked {projectId, expectedCycle, jobId, sdkId, expectedSdkRevision, accountId, evidence}` (VM_OPS): = `linkVmSdk` (Đã nối EarnApp với tài khoản đang giữ); ba sự kiện riêng (SDK ghi, tài khoản gán, đã nối) vẫn tách.

## D. Hàng loạt
- `POST batch {projectId, items:[{method:'POST', path, body, idempotencyKey}]}` (Idempotency-Key của lô bắt buộc; 1–100 mục; path chỉ các route ghi hiện có trừ `batch`; mỗi mục có `idempotencyKey` riêng ≠ nhau).
- Chạy **tuần tự** trong một request; mỗi mục đi qua đúng máy route lẻ (scope, quyền, service key, audit riêng, replay riêng). Kết quả: `{items:[{index, path, status, body}], summary:{ok, refused, waiting}}`; một mục lỗi không dừng lô.
- Mục cần duyệt: trước khi chạy, gom tất cả mục cần duyệt của lô thành **một** approval (`OpsApproval.items` = tóm tắt từng mục, `payloadHash` = hash toàn lô) → nếu chưa duyệt: 202 cho cả lô (các mục không cần duyệt **vẫn chạy** và trả kết quả; mục chờ duyệt trả `status:202`). Khi duyệt xong, gửi lại cùng Idempotency-Key lô: mục đã DONE replay, mục chờ nay chạy.
- Giới hạn: `batch` = 1 hit ghi; thêm bucket `batch` 10 lô/phút/token; mục trong lô không tính vào 30 ghi/phút (vẫn ≤100 mục). `GET me` trả `limits` và `approvalRequired` (danh sách action).

## E. Duyệt bằng 2FA của ADMIN tại CLI
- `POST approvals/{id}/confirm {projectId, admin:'<username>', totp:'123456'}` (token của AI; không cần scope riêng; chỉ cho approval do **chính token** này tạo, còn PENDING, chưa hết hạn). Server kiểm: `admin` là ADMIN của dự án, đã bật 2FA, mã đúng qua `checkTotp` (chống dùng lại cùng bước, 3 sai/30 phút trên ADMIN). Mỗi approval đếm sai riêng: **5 sai → `LOCKED`** (phải xin lại). Đúng → APPROVED (decidedById = ADMIN, `via:'CLI'`, audit `OPS_APPROVE`); từ chối tại CLI không có (ADMIN không nhập mã thì hết hạn).
- `GET approvals/{id}` (READ): trạng thái, tóm tắt, hết hạn, số lần sai còn lại.
- Web `/approvals` vẫn duyệt / từ chối như hiện tại; hai đường dùng chung bản ghi.
- Client: `approve <approvalId> --admin <username>` hỏi mã **ẩn** trên TTY (hoặc `--totp-stdin` cho ống dẫn), gửi một lần, không ghi vào nhật ký (nhật ký chỉ ghi "đã gửi mã, kết quả"); sau APPROVED tự `retry` key liên quan (lệnh lẻ hoặc lô).

## F. Token
- `OPS_SCOPES` += `ACCOUNT_OPS` (nhãn: "Kho tài khoản EarnApp: xem danh sách che, giữ / trả / đánh dấu đã dùng cho VM đang nhận việc; thông tin đăng nhập cần duyệt"). `memberOps.ACCOUNT_OPS` = ASSIGN. Form token hiển thị scope mới. Chủ tạo token mới 90 ngày (UI). Token `AI vip` đã thu hồi 23/10 10:45 UTC.

## Kiểm thử
Tích hợp cho từng endpoint mới; batch (mục lỗi không kéo lô; replay từng mục; 202 một phần); approval confirm (sai 5 lần → LOCKED; đúng; dùng lại bước; ADMIN chưa 2FA; approval của token khác); chống trùng khi hai lô song song giành cùng proxy / tài khoản / SDK (một bên thắng, bên kia bị từ chối, không nửa vời); client `batch` (run file, chạy lại an toàn) và `approve` (không ghi mã). OpenAPI 1.3.0; runbooks; gói Central mới chép lên moon-01 (manifest SHA-256).

## Tiến độ (23/10/2026 tối — phiên dừng vì hết hạn mức sử dụng)
- Đã làm, chưa commit: `tokens.ts` (scope ACCOUNT_OPS), `limits.ts` (bucket batch 10/phút), schema + migration `20261023140000_approval_confirm_failed` (đã áp dụng DB thử/test), `approvals.ts` (LOCKED, `readApprovalForToken`, `confirmApprovalByToken`), `api.ts` (tách `executeRoute`, `runBatch`, route `POST batch`, `POST approvals/{id}/confirm`, `GET approvals/{id}`, `me` trả `limits` + `approvalRequired` + `pinRequired:false`). `tsc` sạch cho các file này.
- Subagent đang viết: `src/server/ops-api/ai-accounts.ts` (+ test) và `ai-inventory.ts` (+ test); file test ai-accounts đang dở (lỗi cú pháp tạm thời).
- Còn lại: nối route A/B/C vào `api.ts`; test tích hợp `ops-batch-approve` (202 một phần → confirm TOTP → chạy lại; 5 sai → LOCKED); client `approve` / `batch` / lệnh kho; OpenAPI 1.3.0; runbooks + PROMPT_CLAUDE_VAN_HANH_WEB.md; full suite; commit; backup → deploy D:\MoneyToHome (app-next swap); gói Central chép lên moon-01; AGENTS.md / memory.

## Tiếp quản Codex 23/10/2026 — ledger
- Inherited service tests: ai-accounts7 + ai-inventory9 passed, not unfinished anymore. Do not rewrite these services without an observed issue.
- Main owns backend routing/approvals and HTTP integration. Parallel agent owns ops-client + CLI tests; second owns OpenAPI/runbooks/prompt, disjoint files.
- Ruling: pending mixed batch returns HTTP202 + ok:true data (per-item statuses), final200 can contain per-item refusals. Unauthorized/invalid items fail individually; request-wide malformed batch still rejects before writes.
- Ruling: bind ALL outer batch keys to exact canonical payload using additive OpsBatchKey hash table; secret values/results are never stored there. Per-item services own recorded/replay responses.
- New HTTP tests initially4/4 RED (missing routes, batch200pending, wholebatch403, lockedapproval recreated); after integration4/4 GREEN. Added migration20261023150000_ops_batch_key to TEST DB only. Existing20261023140000 already applied toTEST by priorworker. Nothing deployed in this takeover yet.
- Remaining: type/full checks, actual CLI flow and API contracts, final security review/fixes, backup+deployment, immutable Central package+verified copy. Owner creates new90daytoken withoutPAYOUT/RECEIPT afterdeployment; do not auto-create token or operateVMs.
- Final takeover checks:165files/825testsPASS, NextbuildYYuyeK5O_AbCdn_o8iq1h, lint0errors, realHTTP+CLI+backend+isolatedDB successful. Independent reviewer2important issuesfixed withreprotests. Credentials nowrejectoldjobround. No actualVM, tokencreation orproductionstockwrite. Deployment/transferpendingverification.
