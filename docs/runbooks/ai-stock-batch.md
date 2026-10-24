# AI vận hành: kho, lô lệnh và duyệt tại CLI — OpenAPI 1.3.0

Hợp đồng: [openapi.json](../ops-api/openapi.json). Thiết kế: [ai-stock-batch](../superpowers/specs/2026-10-23-ai-stock-batch-design.md). Base `https://wow.lalamail.sbs/api/ops/v1`.

API ghi nhận và cấp kho trên MoneyToHome. Tạo máy, áp proxy, cài phần mềm, đăng ký / đăng nhập EarnApp vẫn phải làm trên máy thật. API thành công không chứng minh thao tác máy thật đã xảy ra. Không ghi vào Sheet Server Total nữa.

## Kết nối và phạm vi

Chủ tạo token **90 ngày trong UI**, đúng dự án GROUP MOON, cho user vận hành có Hạ tầng / ASSIGN; scope **READ, VM_OPS, BALANCE_WRITE, PROXY_CREDENTIALS, ACCOUNT_OPS**. Không PAYOUT / RECEIPT. User cần EARN_BALANCE để ghi tiền và VM_PROXY_FOR_OPS để lấy proxy đầy đủ. Quyền thực là giao của quyền user và scope / dự án token, kiểm lại khi ghi. Không đặt token, mật khẩu hoặc mã 2FA vào tài liệu, chat, ảnh, Git hay đối số lệnh.

Nạp token ở terminal riêng bằng `node scripts/ops-client.mjs init`. Trong PowerShell đặt `$env:MTH_BASE = 'https://wow.lalamail.sbs'`. Không PIN. Đọc `me` để kiểm `effective`, `pinRequired:false`, `limits` và `approvalRequired`; `projects` lấy projectId thật, không dùng mã MOON thay ID. Không thử đăng nhập owner bằng mật khẩu cũ.

**Chủ quyết định 24/10/2026:** account credentials, SDK reveal và proxy credentials lấy trực tiếp để AI vận hành không cần người trực duyệt; không approval, không PIN/TOTP. Vẫn kiểm quyền user/token, dự án/server hiện tại và job đúng VM/lượt ở các route cần job. SELECTED không có quyền kho chung; bỏ duyệt không mở stock/route hoặc server đang bị từ chối. SDK reveal không nhận jobId, vẫn phải là SDK trong phạm vi được phép. Giữ nguyên tệp bí mật và cách xoá sau dùng. Đây không phải xác nhận đã deploy.

Lệnh **lẻ** lấy bí mật đã chờ duyệt trước thay đổi: `retry <key>` đúng key/path/body cũ, kiểm quyền/job/server hiện tại, không gọi approve hoặc giả ADMIN. Không tự đổi trạng thái approval cũ. Quy tắc này không hứa bỏ gate outer của một lô cũ; lô vẫn cần đối chiếu từng mục.

Mọi POST cần `Idempotency-Key` (8–100 ký tự `A-Za-z0-9._:-`). Mất phản hồi: giữ nguyên key / path / body, `retry <key>`. Chỉ đổi key khi đã đối chiếu kết quả cũ và thực sự gửi lệnh mới. Việc idempotent trên web không bảo đảm một thao tác máy thật chỉ chạy một lần.

## Kho tài khoản

`GET earnapp-accounts?projectId=…&state=UNUSED|HELD|USED&type=GMAIL|APPLE&limit=50&cursor=…` cần ACCOUNT_OPS; service cũng nhận APPLE_ID. Trang tối đa 200. Dữ liệu chỉ có email che, loại, trạng thái, VM / server / lượt đang giữ, revision và thời điểm nhập; không thông tin đăng nhập. `items[].id` là **loginId** của kho; `items[].accountId` mới là EarnApp ID dùng trong đường dẫn ghi và có thể null. `revision` là phiên bản EarnApp, không phải VM.

Trước khi cấp: resolve VM → đọc VM / lượt / revision → claim → giữ `jobId`. Các lệnh kho chỉ cho **job ACTIVE, chưa hết hạn của chính user và chính token, đúng VM / lượt**. Cùng user nhưng token khác không nhận quyền trên job đó; quay lại sau gián đoạn phải kiểm máy thật trước khi tiếp tục.

| POST (đường dẫn tương đối) | Body bắt buộc ngoài projectId | Ý nghĩa |
|---|---|---|
| `earnapp-accounts/hold` | `vmId, expectedCycle, expectedVmRevision, jobId, loginType` | Giữ một login UNUSED theo thứ tự nhập; VM đã có tài khoản hiện hành trả `already:true`. Không chứng minh đã đăng ký. |
| `earnapp-accounts/{accountId}/credentials` | `vmId, jobId` | **Trực tiếp, không approval/PIN/TOTP**; tài khoản hiện hành, job ACTIVE của chính user/token đúng VM/lượt và quyền server hiện tại. Trả email, password, twoFa, token, twoFaLink, smsLink, phone (các bí mật có thể null). |
| `earnapp-accounts/{accountId}/used` | `vmId, expectedCycle, jobId, expectedRevision, evidence` | Chỉ ghi sau khi quan sát đăng ký / đăng nhập thành công thật. Thêm `sdkId` thì bắt buộc thêm `expectedSdkRevision`; đánh dấu SDK hiện hành đã nối trong cùng giao dịch. |
| `earnapp-accounts/{accountId}/release` | `vmId, expectedCycle, jobId, expectedRevision, reason` | Chỉ tài khoản chưa đăng ký; đã dùng / đã đóng không được phát lại. Kết quả đăng ký chưa rõ thì giữ chỗ, không release. |

`expectedRevision` lấy từ tài khoản đang giữ. `expectedVmRevision` chỉ có ở hold, không thay thế cho expectedRevision ở used/release. used và release cần expectedCycle dù ví dụ thiết kế ban đầu bỏ sót. Lấy thông tin đăng nhập không tự đánh dấu đã dùng; gán tài khoản, lưu SDK và ghi nhận đã nối là ba sự kiện riêng. `registeredAt` / SDK LINKED là vĩnh viễn.

Client lưu credential vào tệp runtime riêng có ACL chỉ user hiện tại (`~/.mth/runtime/secret-<hash>-<accountId>.json`; `MTH_RUNTIME_DIR` đổi thư mục). Kết quả API là `{replay:false,accountId,vmId,credentials:{email,password,twoFa,token,twoFaLink,smsLink,phone}}`; client chỉ trả `secretFile`, không stdout / nhật ký / chat; xoá sau khi dùng. Không đưa kết quả bí mật của từng mục lô vào nhật ký lô. Việc trả thành UNUSED sau khi release phải theo quy tắc service cuối cùng; không tự suy từ việc bỏ gán.

**Quy tắc tái cấp đã chốt:** tài khoản chưa từng đăng ký, chưa đóng và không VM giữ có thể trở lại UNUSED sau release. Việc đã đọc bí mật không phải bằng chứng đã đăng ký và không tự cấm trả / tái cấp. Nếu chưa rõ kết quả đăng ký thì AI phải giữ chỗ và đối chiếu, không release. Không tự suy tình trạng đăng ký từ việc reveal hoặc bỏ gán.

## Lỗi đăng nhập: tự ghi lỗi, lấy tài khoản chưa dùng và tiếp tục — chủ chốt 24/10/2026

Chủ đã chọn xử lý tự động trong công việc được giao: khi máy thật báo Apple Locked / Google Verify / Google Disabled, ghi đúng lỗi rồi nhận tài khoản chưa dùng để tiếp tục; không chờ ADMIN duyệt từng lỗi, không cố đăng nhập lại tài khoản lỗi. `APPLE_LOCKED` chỉ cho APPLE_ID; `GOOGLE_VERIFY` / `GOOGLE_DISABLED` chỉ cho GMAIL.

Đọc `GET earnapp-accounts/{accountId}?projectId=…`: ngoài dữ liệu cũ có `loginId`, `loginRevision`, `loginStatus`, `loginIssueNote`, `loginIssueAt`. Chụp VM hiện hành, lượt, revision và job trước khi gửi; `expectedLoginRevision` là revision login, không phải `expectedRevision` của EarnApp.

`POST earnapp-accounts/{accountId}/login-issue` cần **ACCOUNT_OPS**, không approval/PIN/TOTP. Body bắt buộc:

```json
{
  "projectId": "<project-id>",
  "vmId": "<vm-id>",
  "jobId": "<active-job-id>",
  "expectedCycle": 1,
  "expectedVmRevision": 0,
  "expectedLoginRevision": 0,
  "issue": "GOOGLE_VERIFY",
  "note": "Google yêu cầu xác minh khi đăng nhập trên VM được giao"
}
```

Đây là mẫu cấu trúc; ID/lượt/revision phải lấy từ lần đọc hiện tại, không dùng giá trị mẫu để ghi thật. `issue` chỉ `APPLE_LOCKED|GOOGLE_VERIFY|GOOGLE_DISABLED`; `note` 1–500 ký tự, không mật khẩu, mã 2FA, token hoặc link bí mật. Cần quyền user/token, VM thuộc server được giao, job ACTIVE của chính user/token đúng VM/lượt và revision khớp.

Phản hồi stockAck `{replay,recorded,current}`: `recorded` chứa accountId/loginId cũ, status/loginRevision và thông tin lỗi, `replacementStatus`, `replacement`, `sdkReuseBlocked`. `replacement` là null hoặc `{accountId,loginId,loginType,email,revision,loginRevision}` (email che). Đọc cả kết quả đã ghi lẫn `current`, không suy tài khoản hiện hành chỉ từ accountId trên đường dẫn cũ.

- **ASSIGNED:** tự chọn hàng chưa dùng hợp lệ cùng nhà cung cấp trước, rồi loại còn lại; không chọn lại tài khoản lỗi. EarnApp cũ đóng/tách khi thay thành công. Tài khoản mới chỉ được giữ. Đọc lại VM + tài khoản mới, lấy credentials trực tiếp theo job, dùng đúng `loginType`, tiếp tục đăng nhập/đăng ký thật trong phạm vi công việc.
- **NO_STOCK:** ghi lỗi, giữ tài khoản lỗi hiện hành, dừng bước này và báo thiếu hàng. Không tự release để làm mất dấu lỗi, không đánh dấu OK.
- **NEEDS_ADMIN_STOCK:** SELECTED chỉ ghi lỗi của VM thuộc server mình; không lấy kho chung. Dừng, nhờ ADMIN cấp hàng vào phạm vi; không đổi token hoặc xin approval để vượt quyền.

PP, tiền, payout và SDK đã dùng vẫn ở tài khoản/lịch sử cũ. Sau thành công thật mới `/used` và `sdk-linked` với SDK chưa dùng hợp lệ. Kiểm `sdkReuseBlocked`: SDK hiện hành LINKED không dùng cho tài khoản mới; không tự cài lại/xoá SDK/tạo lại VM khi chưa có nhiệm vụ cho phép. Còn vướng SDK thì ghi bước bị chặn thay vì ghi đã nối.

Mất phản hồi → retry nguyên key/path/body. Retry key cũ trả lại kết quả cũ, kể cả NO_STOCK; nhập thêm hàng không làm key đó tự cấp sau này. Khi đã có hàng/quyền phù hợp: đọc lại VM/login/job + revision mới rồi gửi lệnh mới/key mới. Không dùng key mới để né UNKNOWN/revision conflict; đối chiếu trước. Không ghép login-issue với lệnh credentials/used phụ thuộc accountId hoặc revision chưa biết trong cùng lô.

Người quản lý lọc kho theo `status=APPLE_LOCKED|GOOGLE_VERIFY|GOOGLE_DISABLED`, chọn `sort=ERRORS_FIRST|LATEST_ISSUE|EMAIL` trong URL để đối chiếu với nơi bán hoặc ADMIN xoá theo quy tắc hiện có (còn gán vẫn chặn xoá). Không thêm trường theo dõi nhà cung cấp. Bí mật vẫn dùng tệp riêng, xoá sau dùng.

## Proxy và SDK từ kho

`GET proxies?projectId=…&state=FREE|ASSIGNED|BLOCKED&group=TUT|SHARED&package=…&limit=50&cursor=…` cần READ. Trả host, port, packageCode, group, inventoryState, state, VM nếu có, revision; không user/pass. Không lọc state thì có thể thấy OTHER; group phản hồi còn có GENJY / OTHER. FREE là đúng kho đủ điều kiện của web: NEW, đủ cấu hình / gói, không ai giữ, không từng cài ở vị trí không phù hợp; Genjy riêng và BLOCKED không được cấp.

SDK trong kho: `GET sdks?projectId=…&state=UNLINKED&place=STOCK&limit=50` (READ) để tìm **sdkId và revision** mà không cần biết mã đầy đủ. Không có `code` → danh sách theo thời điểm tạo rồi ID; `nextCursor` dùng làm `cursor` trang sau (null là hết), limit 1–200, mặc định 50. Lọc state=UNLINKED/LINKED/UNCONFIRMED, place=STOCK/VM; STOCK nghĩa holderVmId và vmId đều trống, VM nghĩa ít nhất một trường có giá trị. Item danh sách có `found:true`, code che, inListOf/currentOf và tiền theo quyền hiện có. `GET sdks?projectId=…&code=<mã đầy đủ>` vẫn lookup cũ, có thể `found:false`, không nextCursor. Không dùng mã che để gán; dùng sdkId + revision từ danh sách.

Các lệnh gán dưới cần VM_OPS, ASSIGN và job đang giữ của chính token, đúng VM / lượt. Gán và lấy bí mật kho **không cần duyệt/PIN/TOTP**; scope, quyền user, phạm vi server và điều kiện job theo từng route vẫn giữ.

| POST | Body bắt buộc ngoài projectId | Kiểm tra / kết quả |
|---|---|---|
| `vms/{vmId}/proxy-assign` | `expectedCycle, expectedVmRevision, jobId` + đúng một trong `proxyId` hoặc `pick:{group:"TUT"\|"SHARED", packageCode?:…}` | Chọn proxy FREE trong giao dịch có khoá; không lấy của VM khác. Trả endpointId / configurationId / host / port; cấu hình trên web chưa phải đã áp lên máy. |
| `vms/{vmId}/proxy-credentials` | `expectedCycle, jobId` | PROXY_CREDENTIALS + quyền user; **không cần duyệt** (24/10/2026), việc đúng VM/lượt còn hiệu lực, tệp riêng, xoá sau khi áp trên máy thật. |
| `vms/{vmId}/sdk-assign` | `expectedCycle, expectedVmRevision, jobId, sdkId, expectedSdkRevision` | Chỉ UNLINKED trong kho hoặc danh sách chính VM; mã cũ vẫn ở danh sách VM; UNCONFIRMED / LINKED / mã VM khác bị từ chối. |
| `vms/{vmId}/sdk-linked` | `expectedCycle, jobId, sdkId, expectedSdkRevision, accountId, evidence` | SDK hiện hành và tài khoản mở hiện hành của VM; ghi sau khi nối thật, vĩnh viễn. Không có expectedVmRevision ở request này. |
| `sdks/{sdkId}/reveal` | — | VM_OPS + quyền đọc và SDK trong phạm vi dự án/server hiện tại; **trực tiếp, không approval/PIN/TOTP**, không yêu cầu jobId; mã đầy đủ chỉ dùng trong luồng bí mật, không vào log/chat. |

`package` là bộ lọc URL, `pick.packageCode` là trường service, không dùng `pick.package`. Đọc revision SDK từ VM detail hoặc lookup `sdks`; mã trong câu trả lời thường bị che, không dùng mã che làm mã SDK thật. Ghi SDK mới đọc từ lần cài (`vms/{id}/sdk`) khác với dùng mã có sẵn (`sdk-assign`); không dùng đường ghi mã lần cài để lấy mã từ VM khác.

## Chỉ duyệt tài chính bằng CLI hoặc web

Chỉ payout `withdrawals/prepare`, `withdrawals/{id}/status`, `withdrawals/{id}/receipts` cần duyệt; token vận hành đợt này **không có scope** để gọi chúng. Account credentials, SDK reveal, proxy credentials, gán kho, ghi SDK quan sát, tình trạng và ghi chú không phát sinh duyệt. Phần confirm dưới đây chỉ dành cho lệnh tài chính có quyền tương ứng, không phải bước vận hành kho.

Lệnh tài chính lẻ cần duyệt trả **202 `{ok:false,data:null,error:{code:"APPROVAL_REQUIRED",details:{approvalId,status:"PENDING",expiresAt}}}`**; chưa thực hiện lệnh đó. Hạn 15 phút; chỉ ADMIN đúng dự án đã bật 2FA quyết định được.

1. `GET approvals/{approvalId}?projectId=…` (READ) chỉ đọc approval của chính token: status, summary, expiresAt, attemptsLeft, decidedAt, consumedAt, decisionNote; không bí mật.
2. `node scripts/ops-client.mjs approve <approvalId> --admin <username>` hỏi mã ẩn trên TTY; `--totp-stdin` chỉ dùng ống dẫn riêng không lưu mã. Không gõ mã vào đối số, body file, generic `post`, chat hay nhật ký.
3. Client gọi `POST approvals/{id}/confirm {projectId,admin,totp}` một lần với Bearer và **Idempotency-Key bắt buộc ở HTTP**; không scope riêng, không business journal, không lưu body / code / hash code. ADMIN có thể là username hoặc email. Mã đã dùng trong cùng bước TOTP bị từ chối; sai ba mã khoá ADMIN 30 phút; năm lần confirm sai khoá approval thành LOCKED (`attemptsLeft:0`). Không tự lặp thử mã.
4. Confirm thành APPROVED chưa thực hiện lệnh gốc. Client approve tự retry key đã liên kết; nếu không còn journal để liên kết thì đối chiếu rồi `retry <key>` gốc. Mất phản hồi confirm: đọc status trước; không gửi lại mã cũ. Web `/approvals` vẫn duyệt / từ chối cùng bản ghi bằng 2FA.

Gate lệnh gốc: REJECTED hoặc LOCKED → **403 APPROVAL_REJECTED**, LOCKED có `details.status:"LOCKED"`; hết hạn → **410 APPROVAL_EXPIRED**, cùng key vẫn 410. Chỉ xin lại bằng key mới khi chủ vẫn yêu cầu và đã đối chiếu phần đã ghi. Confirm trực tiếp trên approval không còn PENDING có thể trả 409 REVISION_CONFLICT; sai quyền / mã hoặc LOCKED trả 403 FORBIDDEN. Không nhầm lỗi confirm với lỗi gate.

## Lô có kết quả từng phần

`POST batch` cần outer Idempotency-Key, body `{projectId,items:[{method:"POST",path,body,idempotencyKey}]}`; 1–100 mục, item key khác nhau. Path tương đối dưới API, không URL ngoài, không batch lồng hoặc confirm trong lô. Thiếu projectId trong body mục thì dùng projectId lô; khác projectId lô thì riêng mục đó bị VALIDATION. Outer key còn gắn token, không dùng token thay thế để tiếp tục lô cũ. Tránh đặt lệnh phụ thuộc kết quả chưa biết trong cùng lô: hold trước để biết accountId, đọc lại revision sau mỗi thay đổi.

Mỗi mục đi qua scope / service / audit / replay riêng, chạy **tuần tự**; mục sai route, thiếu scope hoặc bị service từ chối không dừng mục khác. Đây không phải giao dịch nguyên lô. Body lô sai cấu trúc, key trùng hoặc outer key đổi nội dung vẫn có thể làm cả request bị từ chối.

- Có mục tài chính cần duyệt: một approval cho các mục đó, hash ràng buộc toàn lô. Các mục đọc bí mật kho không tự yêu cầu approval; lô mới chỉ có mục kho không chờ ADMIN/PIN/TOTP. Trong khi chờ tài chính, mục thường vẫn chạy. Outer trả **HTTP 202, `ok:true`**, `data:{batchKey,approval,items,summary}`; mỗi mục chờ có `status:202` và body `ok:false / APPROVAL_REQUIRED`.
- Hết mục chờ: outer **200, `ok:true`**, kể cả có mục bị từ chối. Luôn đọc `summary:{ok,refused,waiting}` và từng `items[]:{index,path,idempotencyKey,status,body}`. HTTP 200 không có nghĩa mọi mục thành công.
- Retry cùng outer key / body sau duyệt: mục đã xong replay, mục đã được duyệt chạy. Lưu key và payload trước khi gửi; outer key ràng buộc bền với payload kể cả lô không cần duyệt. Không lưu secret results trong bản ghi outer key; client cũng phải che credential / reveal khỏi journal và stdout.
- Lệnh `batch <file.json>` của client mới giữ journal cho lô; `approve` duyệt rồi retry lô liên quan. Pending vẫn WAITING_APPROVAL (exit 4) dù outer `ok:true`. Khi final có refused, báo từng mục, không tuyên bố DONE toàn bộ chỉ theo outer ok. Mất phản hồi → UNKNOWN (exit 3), không gửi lô mới.
- Giới hạn token: 120 đọc/phút, 30 ghi/phút; lô thêm bucket **10/phút**, tối đa 100 mục. Một lô tính một hit ghi; không tính từng mục vào bucket ghi. 429: theo Retry-After. `/me.limits` là thông tin kiểm lúc vận hành.

## Đối chiếu trước phát hành

Route kho và lệnh client batch/approve đã xuất hiện trong source khi đối chiếu. Stock writes trả `{replay,recorded,current}`; credentials dùng wrapper riêng nêu trên. Đã đối chiếu source cho batch 202 / tiếp tục sau lỗi scope-route, ràng buộc outer key và gate LOCKED / EXPIRED. Credentials đã kiểm rõ job thuộc đúng lượt hiện hành của VM. Quy tắc tái cấp tài khoản chưa đăng ký đã chốt ở trên; không chặn chỉ vì từng reveal. Chưa có bằng chứng phát hành hay chạy thật; kiểm lại các sửa này trước phát hành. Không dùng tài liệu này làm bằng chứng đã deploy, đã cấp token hay đã thao tác VM.

Automatic login-issue replacement is stricter than an ordinary hold: only ACTIVE, unarchived logins with a stored password and no EarnApp record are selected, so no prior PayPal/payout state is carried into the replacement.
