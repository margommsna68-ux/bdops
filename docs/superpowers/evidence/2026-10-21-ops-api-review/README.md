# Rà soát API AI-OPS trước triển khai (21/10/2026)

Bản được rà: commit 1cca9fc (+ ghi nhận 487fbb7). Bộ tái hiện độc lập `.runtime/review-ops-api-ack-20261021.test.ts`: trước sửa 3 đỏ / 3
(`repro-before.txt`), sau sửa 3 xanh / 3 (`repro-after.txt`), kỳ vọng không đổi. Ba ca đó được giữ nguyên trong test chính thức
`src/__tests__/ops-api/ops-api-review.integration.test.ts`. Dữ liệu thử là dữ liệu giả, DB test riêng / DB trial local; không quay video.

| # | Trước | Sau | Kiểm chứng |
|---|---|---|---|
| 1 | Gửi lại ghi số dư của A (cùng key) sau khi VM đổi sang B và B có $99 → `replay: true` nhưng trả account B, $99 | Service lưu bản ghi đã tạo trong kết quả chống lặp; mọi lệnh ghi trả `{replay, recorded, current}`: `recorded` = đúng lệnh lần đầu (id bản ghi, VM, lượt, EarnApp, số tiền), `current` = trạng thái lúc này, tách riêng; ghi số dư thêm `vm` / `balance` = số dư mà bản ghi đó để lại. Prepare / status / receipts cùng ý nghĩa. Quyền hiện tại vẫn kiểm trước khi trả | Ca tái hiện; đổi account, số dư mới hơn của cùng account, VM tạo lại; prepare / status / receipts gửi lại sau khi yêu cầu đã đổi; số bản ghi không tăng |
| 2 | Token thu hồi ngay trước giao dịch ghi → HTTP 200, ghi 1 bản số dư | Định danh token đi theo lệnh trong bộ nhớ server (AsyncLocalStorage, không tự khai được qua request); `runBusinessCommand` kiểm lại token (đọc FOR SHARE: thu hồi đồng bộ với ghi), hạn, người dùng, dự án, thao tác trong giao dịch, trước cả replay | Ca tái hiện (401 TOKEN_REVOKED, 0 bản ghi); gửi lại lệnh đã thành công sau khi thu hồi → 401; token hết hạn ngay tại ranh giới → 401 TOKEN_EXPIRED |
| 3 | Bốn lần kiểm PIN cùng lúc: 3 sai khoá user, lần đúng xong sau vẫn OK | `checkPin`: so sánh bcrypt ngoài khoá, rồi áp kết quả trong giao dịch ngắn `SELECT … FOR UPDATE` trên user: khoá mới hơn thắng, PIN đổi giữa chừng → so lại với hash mới, bộ đếm ghi trên kết nối riêng (không mất khi giao dịch nghiệp vụ rollback). Web (`user.verifyPin`) dùng chung | Ca tái hiện (LOCKED); PIN đổi giữa chừng → PIN cũ INVALID; sai PIN qua API → bộ đếm = 1, không ghi nghiệp vụ |
| 4 | Script in key sau khi có phản hồi; mất kết nối → mất key | Key + nội dung ghi vào nhật ký lệnh cục bộ (không token / PIN) và in ra trước khi gửi; mất phản hồi → `RESULT_UNKNOWN` "Chưa xác định kết quả"; `retry <key>` gửi lại đúng lệnh; `pending`; key không dùng cho nội dung khác | `ops-client.test.ts`: server giả nhận POST rồi ngắt → thử lại cùng key, cùng nội dung, 1 tác động |
| 5 | `../../../outside-ops` thoát khỏi /api/ops/v1/ nhưng vẫn mang Bearer / PIN | Chuẩn hoá URL, đúng origin + tiền tố trước khi gắn thông tin xác thực; chặn `..`, `.`, `%2e`, `%2f`, `%5c`, tuyệt đối, URL khác; không đi theo redirect; https (http chỉ localhost) | `ops-client.test.ts` (token / PIN giả): 8 dạng đường dẫn bị từ chối, server không nhận request; redirect không được đi theo, server ngoài không nhận gì |
| 6 | API đọc cả hold đã nhả: VM từng UNCERTAIN, đã gán proxy mới vẫn REVIEW / proxy=null | `vmSelect` chỉ lấy hold còn hiệu lực (`releasedAt: null`), cùng quy tắc Server / VM; lịch sử giữ nguyên | Danh sách, resolve, chi tiết = ASSIGNED + proxy mới, khớp web |
| 7 | Người có PAYPAL_RECEIPT_RECORD ghi được qua API nhưng web không có nút | Ô Tiền / Rút hiện "Ghi tiền về PP" cho quyền hẹp, gọi `vmOps.payoutReceipt` → `recordPayoutReceipt` (chung với API); không Chờ nhận / Khoản riêng; quản lý giữ form cũ | Test qua tRPC + API với USER chỉ có quyền hẹp (từng phần, revision, trùng mã, vượt phần chờ; dán khoản nhận chung / số dư đầu / chốt thiếu bị chặn); trình duyệt local R1–R6 (`result-local-ui.txt`, ảnh r2 / r4 / r5) |
| 8 | OpenAPI khai `/vms/resolve` trả Vm trực tiếp (thực tế `{ok, data, error}`) | `docs/ops-api/openapi.json` (thay YAML): mọi response là envelope, object đóng (`additionalProperties: false`), đủ ID / revision / lượt / trang / nullable / tiền + đơn vị, lỗi 401 / 403 / 404 / 409 / 422 / 429 | Test đối chiếu phản hồi thật với schema: mọi endpoint, ghi và lỗi (≥ 20 tổ hợp phương thức / đường dẫn / mã) |

Cả bộ: 130 file / 626 test đạt; typecheck sạch; lint chỉ còn cảnh báo cũ; build đạt.

## Phát hành

- Commit 05b64cb (sửa) trên 1cca9fc / 487fbb7. Migration vẫn chỉ là 20261021090000_ops_api (chỉ thêm bảng), không có migration mới.
- Backup host mới trước khi thử deploy: eaf569f4-cfb2-47bf-86cb-50df7f67820c (41 096 889 byte). Ảnh chụp số liệu: `.runtime/p20-host-before44.json` (local).
- `railway up` (môi trường proxy-trial-20261015, service moneytohome) trả nguyên văn: `Deploys have been paused temporarily`. Không có deployment
  mới; host vẫn chạy 28b250e7, migration chưa áp dụng, `/api/ops/v1/health` = 404 trên host. **Chưa triển khai.**
- Vì chưa deploy: chưa kiểm IP thật qua proxy Railway bằng header giả, nên chưa tuyên bố giới hạn IP của token là an toàn trên host.
