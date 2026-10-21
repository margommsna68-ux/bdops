# Vận hành VM bằng AI (AE Mini Tool) — thiết kế (21/10/2026)

Brief chủ dự án 21/10/2026 "triển khai luồng vận hành AI qua AE Mini Tool và kích hoạt tài khoản ai-ops". Mở rộng API vận hành
(`/api/ops/v1`, docs/runbooks/ops-api.md) và bảng Server / VM hiện có; không thêm menu Việc cài, không thêm cột, không thêm màn hình giao việc.

## 1. Tình trạng và dấu "chờ áp dụng"

- Tình trạng mới `PROXY_PENDING` = "Chờ áp dụng proxy" (enum thêm giá trị, migration chỉ thêm). Nghĩa: web đã có proxy mới, máy thật chưa áp dụng.
- `VmOperation.proxyPendingConfigId` (mới): cấu hình proxy mà máy thật còn phải áp dụng. Đặt mỗi khi proxy hiện hành của VM thực sự đổi
  (`assignProxyToVm` changed = true: ô Proxy, Dán bảng, Kho proxy, Nhận replace). Gỡ khi AI / người xác nhận đã áp dụng **đúng** cấu hình đó
  (`proxyAppliedConfigId`, `proxyAppliedAt/ById`). Không đổi `VmOperation.revision` (revision = phiên bản tình trạng). Dữ liệu cũ: null (không
  đánh dấu hàng loạt).
- Replace khi VM đang Blocked của đúng proxy cũ (dấu Blocked hiện có): tình trạng → `PROXY_PENDING` (thay cho "trả về tình trạng trước Blocked").
  Tình trạng khác (OK, Chưa nối, LINKED, OFF, Earn/VM lỗi, SUS, VM deleted, Đã login mail, New VM) giữ nguyên; ô Proxy hiện "Chờ áp dụng trên máy".
- VM mới tạo trên web (thêm theo khoảng, thêm cùng server mới): tạo `VmOperation` lượt 1, tình trạng `NEW_VM`, sự kiện STATUS "VM mới thêm trên web".
  Chỉ dòng vừa tạo; VM khôi phục / VM cũ không đổi.

## 2. Nhận việc (một lượt xử lý chủ động / VM)

Bảng `VmJob`: dự án, VM, lượt, loại (`PREPARE` | `PROXY_APPLY` | `CHECK`), trạng thái (`ACTIVE` | `DONE` | `RELEASED`), người nhận, token, hạn
(`expiresAt`, mặc định 60 phút, tối đa 240, gia hạn bằng heartbeat), bước hiện tại + ghi chú, `machineRef` (tên máy trong AE Mini Tool),
`configurationId` (cấu hình đã lấy proxy), `sdkId` (SDK ghi trong lần này), `resumeOf`. Một VM chỉ một job ACTIVE chưa hết hạn (khoá dòng
VmOperation `FOR UPDATE` khi nhận). Job hết hạn coi như nhả; nhận lại cùng loại / lượt trả về bước, machineRef, SDK của lần làm dở (`resumeOf`)
để AI kiểm máy thật trước khi làm tiếp. Không có lịch chạy nền.

## 3. API mới (scope token `VM_OPS`, `PROXY_CREDENTIALS`)

Mọi lệnh ghi: Bearer + X-Ops-Pin + Idempotency-Key, `{replay, recorded, current}`, kiểm lại token trong giao dịch, gọi service dùng chung.

- `POST vms/{id}/claim` {projectId, expectedCycle, kind, ttlMinutes?} → job; 409 khi VM đang được job khác giữ, lượt đổi.
- `POST jobs/{id}/step` {step, note?, machineRef?} (gia hạn), `POST jobs/{id}/release` {note?}.
- `POST vms/{id}/proxy-credentials` {projectId, jobId, expectedCycle} (scope PROXY_CREDENTIALS + quyền `VM_PROXY_FOR_OPS` + PIN + job ACTIVE của
  chính người gọi cho VM đó): IP:port:user:pass của cấu hình hiện hành duy nhất; ghi `job.configurationId`; audit (ai, token, VM, proxy id, cấu hình),
  không có user / pass. Danh sách / chi tiết vẫn che.
- `POST vms/{id}/sdk` {projectId, jobId?, expectedCycle, expectedVmRevision, code} → `saveVmSdk` (mã hiện hành, vào danh sách VM; mã của VM khác /
  đã dùng / chưa xác nhận bị từ chối như web); ghi `job.sdkId`. Cùng mã đã ghi → giữ nguyên.
- `POST vms/{id}/status` {projectId, expectedCycle, expectedStatusRevision, status, note?} → `setVmStatus` (kiểm revision tình trạng). AI không
  rời New VM bằng lệnh này (phải qua finish-prepare).
- `POST vms/{id}/proxy-blocked` {projectId, expectedCycle, expectedStatusRevision, configurationId, evidence} → Blocked đúng proxy của cấu hình đó;
  proxy đã đổi → 409, proxy mới không bị đánh dấu.
- `POST jobs/{id}/finish-prepare` {configurationId, checks{machine,proxy,internet,earnapp,firefox}, note?} → chỉ khi job PREPARE của lượt hiện
  hành, VM đang New VM, `job.sdkId` là SDK hiện hành của VM (ghi trong job này), `configurationId` = cấu hình hiện hành = cấu hình job đã lấy,
  mọi kiểm tra đạt → Chưa nối, gỡ dấu chờ áp dụng, job DONE. Thiếu gì → 409/422 với lý do, giữ New VM.
- `POST jobs/{id}/finish-proxy` {configurationId, result OK | NOT_LINKED | EARN_ERROR | PROXY_BLOCKED, note} → cấu hình phải còn là hiện hành; gỡ
  dấu; tình trạng: từ Chờ áp dụng proxy / Blocked → result; tình trạng giữ nguyên (OFF, SUS, …) không bị ghi đè; tình trạng đã bị người đổi sau khi
  nhận việc → 409.
- `POST vms/{id}/notes` {projectId, expectedCycle, note} → sự kiện NOTE (người, token, giờ) trong lịch sử VM; ghi chú của chủ không bị đụng.
- Số dư: `POST vms/{id}/balance-check` hiện có (không đổi).

## 4. Quyền

ai-ops: USER, module Server / VM; capability `EARN_BALANCE` + mới `VM_PROXY_FOR_OPS` ("Lấy proxy của VM đang xử lý (AI)"). Ghi tình trạng / SDK /
Blocked dùng quyền ASSIGN / BLOCK hiện có của USER có module Server / VM. Không COPY_CREDENTIALS, không IMPORT / REPLACE, không xoá, chi phí,
người dùng; EARN_PAYOUT / PAYPAL_RECEIPT_RECORD không cấp.

## 5. Bảng Server / VM

Ô Tình trạng: "Chờ áp dụng proxy" (màu riêng), dòng nhỏ "AI đang xử lý · <token> · đến hh:mm" khi có job. Ô Proxy: "Chờ áp dụng trên máy" khi có
dấu. Lọc (URL): `st=PROXY_PENDING`, `st=NEW_VM`, view `APPLY` (mọi VM có dấu chờ áp dụng), view `TODO` (New VM, Chờ áp dụng, Blocked, Earn/VM lỗi,
Chưa ghi có proxy mới). Sort STATUS / PRIORITY xếp các tình trạng cần xử lý trước.
