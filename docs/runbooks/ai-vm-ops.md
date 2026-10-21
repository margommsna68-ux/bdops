# Vận hành VM bằng AI qua AE Mini Tool (21/10/2026)

Brief chủ dự án 21/10/2026. MoneyToHome **không** kết nối tới VM, AE Mini Tool hay EarnApp: AI làm việc trên máy thật bằng AE Mini Tool rồi ghi lên web
đúng điều đã quan sát, qua `/api/ops/v1` (docs/runbooks/ops-api.md, hợp đồng docs/ops-api/openapi.json) và script `scripts/ops-client.mjs`.
Thiết kế: docs/superpowers/specs/2026-10-21-ai-vm-ops-design.md. Service: `src/server/vm-ops/jobs.ts`.

## 1. Tài khoản, quyền, bí mật

- User **ai-ops** (USER, dự án MOON, module Server / VM). Quyền: đọc Server / VM; ghi tình trạng, SDK, Blocked, ghi chú (quyền ASSIGN / BLOCK của USER có
  Server / VM); `EARN_BALANCE` (số dư); `VM_PROXY_FOR_OPS` (proxy đầy đủ của **VM đang xử lý**). Không: copy thông tin đăng nhập, nhập / replace proxy,
  xoá kho, chi phí, người dùng, `EARN_PAYOUT`, `PAYPAL_RECEIPT_RECORD`.
- Token theo máy: tên `<máy> · AI vận hành` (ví dụ `SERVER-01-8939C · AI vận hành`), thao tác READ, BALANCE_WRITE, VM_OPS, PROXY_CREDENTIALS, có hạn.
  Máy / AI khác → token riêng (cùng user ai-ops), để tra lịch sử theo token.
- Bí mật trên máy chạy AI: `%USERPROFILE%\.mth\ops-secret.json` (token + PIN của ai-ops; quyền đọc chỉ user Windows đó). Script tự đọc file; không in token /
  PIN. Không gõ bí mật qua chat. File nằm ngoài Git. Không cam kết AI trên cùng máy không đọc được file này: chỉ để token có quyền hẹp và có hạn.
- Proxy đầy đủ: `node scripts/ops-client.mjs proxy <projectId> <vmId> <jobId> <lượt>` → file riêng `%USERPROFILE%\.mth\proxy\<vmId>.json`
  (IP, port, user, pass, configurationId). Đưa file này cho AE Mini Tool; **xoá file sau khi cấu hình xong**. Không bao giờ in ra chat / stdout / nhật ký.

## 2. Trên web

- VM thêm trên web (thêm theo khoảng, thêm cùng server mới) = **New VM** (chỉ dòng vừa tạo). Thêm server không có nghĩa máy thật đã tạo.
- Chủ thay proxy (ô Proxy / Nhận replace ở Kho) cho VM đang **Blocked** → **Chờ áp dụng proxy** (không còn tự về OK). Tình trạng khác giữ nguyên; ô Proxy
  hiện “Chờ áp dụng trên máy”.
- Ô Tình trạng hiện “AI xử lý · <token> · đến hh:mm” khi có việc đang giữ.
- Lọc nhanh (giữ trong URL): `Chờ áp dụng trên máy` (`?view=APPLY`), `Cần xử lý` (`?view=TODO`: New VM, Chờ áp dụng proxy, Blocked, Earn/VM lỗi, proxy chờ
  áp dụng), tình trạng `st=NEW_VM`, `st=PROXY_PENDING`; sort “Cần xử lý trước” xếp Chờ áp dụng proxy cùng Blocked.

## 3. Quy trình cho AI

Mọi lệnh ghi: script tự gắn PIN + Idempotency-Key, in key trước khi gửi. Mất phản hồi → `retry <key>` (không key mới). **Khoá chống lặp của web không bảo
đảm thao tác trên máy thật chỉ chạy một lần:** trước khi làm lại một thao tác máy (tạo máy, áp dụng proxy, cài) phải kiểm tra máy thật.

Chung:
1. `resolve <projectId> <server> <vm>` → `vmId`, `expectedCycle`, `statusRevision`, `revision`, `proxy.configurationId`, `applyPending`, `currentSdk`.
2. `post vms/<vmId>/claim {projectId, expectedCycle, kind}` → việc (`job.id`). Một VM một việc; 409 khi người / token khác đang giữ. Hạn 60 phút, gia hạn bằng
   mỗi lần ghi bước (`ttlMinutes` tối đa 240). Nhận lại sau khi mất kết nối / hết hạn → `resumed: true` kèm bước, `machineRef`, SDK của lần làm dở: **kiểm
   máy thật đó có đúng là máy của lần này** trước khi làm tiếp; không tạo máy thứ hai; không chắc → ghi chú “cần kiểm tra” và nhả việc.
3. Ghi bước trước và sau mỗi thao tác máy: `post jobs/<jobId>/step {step, note?, machineRef?}` (bước viết HOA: `MACHINE_CREATING`, `MACHINE_CREATED`,
   `PROXY_APPLIED`, `EARNAPP_INSTALLED`, `FIREFOX_INSTALLED`, `SDK_READ`, `SDK_SAVED`, `CHECKED`, `BLOCKED_ON`…). Tên máy đã ghi thì không đổi.

**New VM (kind PREPARE)** — “Chuẩn bị các New VM trên An-01; lưu SDK đầy đủ rồi chuyển Chưa nối.”
1. Nhận việc; ghi `MACHINE_CREATING`; tạo máy bằng AE Mini Tool; ghi `MACHINE_CREATED` + `machineRef`.
2. `proxy …` → file; áp dụng proxy bằng AE Mini Tool; xoá file; ghi `PROXY_APPLIED`.
3. Cài EarnApp + Firefox; ghi bước.
4. Lấy SDK thực tế **của lần cài này**; `post vms/<vmId>/sdk {projectId, jobId, expectedCycle, expectedVmRevision, code}` → mã hiện hành + trong danh sách VM.
   Đọc lại (`vm …` → `currentSdk.code`). Gửi lại đúng mã = đọc lại (không tạo mã trùng, không cài lại để ép mã khác). SDK đã có trên web từ trước lần này,
   của VM khác, đã dùng hay chưa xác nhận → bị từ chối.
5. Kiểm máy, proxy / internet, EarnApp, Firefox.
6. `post jobs/<jobId>/finish-prepare {projectId, configurationId, checks:{machine,proxy,internet,earnapp,firefox}}` → Chưa nối. Thiếu SDK của lần này, proxy
   đã đổi, kiểm tra chưa đạt, tình trạng / lượt đã đổi → từ chối, **giữ New VM**: ghi bước đang vướng (`BLOCKED_ON` + note), sửa rồi hoàn tất, hoặc nhả việc.
   Mỗi lần cài / cài lại EarnApp đều phải ghi SDK mới.

**Chờ áp dụng proxy (kind PROXY_APPLY)** — “Áp dụng proxy mới cho các VM Chờ áp dụng proxy trên moon05; kiểm tra và cập nhật tình trạng.”
1. Nhận việc; `proxy …` → file; áp dụng bằng AE Mini Tool; xoá file.
2. Kiểm máy dùng đúng cấu hình, internet, EarnApp.
3. `post jobs/<jobId>/finish-proxy {projectId, configurationId, result, note?}`: `OK` (đạt, SDK đã nối tài khoản), `NOT_LINKED` (tốt nhưng SDK chưa nối),
   `EARN_ERROR` (không đạt, ghi lỗi), `PROXY_BLOCKED` (proxy mới cũng bị chặn, ghi căn cứ). Chủ thay proxy lần nữa trong lúc làm → 409: lấy proxy mới, làm lại.
   OFF VM / SUS / VM deleted / Đã login mail giữ nguyên (chỉ gỡ dấu chờ áp dụng); không tự bật máy OFF hay tạo lại máy SUS.

**Báo Blocked** — chỉ khi xác định proxy thật sự bị chặn: `post vms/<vmId>/proxy-blocked {projectId, expectedCycle, expectedStatusRevision, configurationId,
evidence, observedAt?}` → VM Blocked + proxy BLOCKED trong Kho proxy. Proxy đã đổi từ lúc kiểm → 409, proxy mới không bị đánh dấu. Lỗi mạng / không vào được VM
mà chưa rõ nguyên nhân → `post vms/<vmId>/status {…, status:"EARN_ERROR", note:"lý do"}`, không báo Blocked.

**Số dư** — “Kiểm tra số dư EarnApp các VM trên An-01 và ghi lên web.”: `post vms/<vmId>/balance-check` (endpoint cũ: số tiền, đồng tiền, giờ thấy, điều kiện
rút chỉ khi thấy). Chưa thấy số dư → `status: ERROR` + lý do, không ghi 0. VM chưa có tài khoản EarnApp đúng → báo thiếu liên kết (ghi chú), không gán số
sang tài khoản khác.

**Ghi chú** — `post vms/<vmId>/notes {projectId, expectedCycle, note, jobId?}`: vào lịch sử VM (người, token, giờ); ghi chú của chủ không bị đụng.

### Khảo sát SDK đang chạy (22/10/2026)
Không phải lần cài: `node scripts/ops-client.mjs sdk-check <survey.json>` (cả bảng, không gửi) rồi `sdk-observe <one-vm.json>` từng VM →
`POST vms/{id}/sdk-observations` (token cần `VM_OPS`; kèm tiền thì thêm `BALANCE_WRITE` + user `EARN_BALANCE`; mỗi mã gửi `expectedSdkRevision` đã đọc; cả bảng: `sdk-survey`). Mã mới = Chưa xác nhận; mã ở VM khác bị từ chối
cả lệnh; tiền là số đọc gần nhất kèm `observedAt`, không cộng, không phải số dư EarnApp. Chi tiết: docs/runbooks/vm-sdk.md (mục cuối).

## 4. Chống lệnh cũ / làm trùng

Lệnh mang dự án, VM, lượt (`expectedCycle`), phiên bản tình trạng (`expectedStatusRevision` / việc nhớ phiên bản lúc nhận), cấu hình proxy (`configurationId`),
thêm EarnApp khi liên quan số dư. VM đổi lượt / chủ đổi tình trạng → từ chối, trả lý do + `details.current`. New VM không cần EarnApp.

## 5. Kiểm đã làm (21/10/2026)

- Test tự động (DB thử): `src/__tests__/ops-api/ops-vm-work.integration.test.ts`, `ops-client-proxy.test.ts`, `proxy-change.integration.test.ts`.
- Local qua HTTP thật tới `next start` + DB trial local, **máy giả lập** (không AE Mini Tool, không VM): evidence docs/superpowers/evidence/2026-10-21-ai-vm-ops/.
- **Chưa** chạy AE Mini Tool thật: trên máy này không tìm thấy chương trình / tài liệu tên “AE Mini Tool” và cách nó nối tới server (xem evidence). Lần chạy máy
  thật đầu tiên chỉ khi chủ giao phạm vi cụ thể.
