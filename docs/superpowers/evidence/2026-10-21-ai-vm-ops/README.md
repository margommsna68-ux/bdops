# Vận hành VM bằng AI — bằng chứng (21/10/2026)

Brief "triển khai luồng vận hành AI qua AE Mini Tool và kích hoạt tài khoản ai-ops". Runbook: docs/runbooks/ai-vm-ops.md. Không quay video.

## Phân biệt mức kiểm

| Mức | Đã làm | Ghi chú |
|---|---|---|
| AE Mini Tool thật trên máy thật | **Chưa** | Không tìm thấy chương trình / tài liệu tên "AE Mini Tool" hay cách nối server trên máy này (đã rà Desktop, Downloads, D:\, phiên Claude / Codex khác). Gần nhất: bộ AVC (`C:\Program Files\AVC`, `avcctl.exe`, trợ giúp EarnApp / proxy / Firefox, mã nguồn `D:\AVC`), nhưng không có lệnh tạo VM / đặt proxy / đọc SDK được ghi lại. Không chạy, không nối tới server nào. |
| API qua HTTP thật, máy **giả lập** | Có (local) | `next start` local + DB trial local, dữ liệu thử; `scripts/ops-client.mjs` như AI dùng; bước máy (tạo máy, cài, SDK) là giả lập. `local-api-flow.txt` 16/16 PASS. |
| Giao diện local | Có | `local-ui.txt` 8/8 PASS; ảnh `u1-table.png`, `u2-todo.png`, `u3-label.png` (IP thử 198.18.x, không user / pass). |
| Test tự động (DB thử) | Có | `src/__tests__/ops-api/ops-vm-work.integration.test.ts` (11), `ops-client-proxy.test.ts` (1), `proxy-change.integration.test.ts` (12, cập nhật theo quy tắc mới), cả bộ (xem dưới). |

## Đã kiểm (test + local)

- New VM: VM thêm trên web → New VM (chỉ dòng mới, VM cũ không đổi). Nhận việc → bước + tên máy → proxy vào file riêng (stdout không có user / pass) → hoàn tất
  khi chưa có SDK bị từ chối (giữ New VM) → SDK đã có từ trước bị từ chối → SDK mới thành mã hiện hành + trong danh sách → gửi lại cùng mã = đọc lại, không mã
  trùng → kiểm tra chưa đạt bị từ chối → hoàn tất → Chưa nối, hết dấu chờ áp dụng. SDK cũ giữ tiền ghi chú, chưa dùng; không SDK nào bị đánh dấu đã dùng.
- Làm dở: việc hết hạn → nhận lại trả bước, tên máy, SDK của lần trước; tên máy khác bị từ chối; không thêm SDK.
- Blocked → chủ thay proxy → Chờ áp dụng proxy (không tự về OK) → AI nhận việc, lấy proxy; chủ thay lần nữa → kết quả cũ bị từ chối; lấy proxy mới → OK.
- Báo Blocked cũ sau khi chủ đã thay proxy → 409, proxy mới không bị BLOCKED.
- OFF giữ nguyên khi áp dụng (chỉ gỡ dấu); chủ đổi tình trạng sau khi AI nhận việc → kết quả AI bị từ chối.
- Hai token cùng nhận một VM → 409; token khác không ghi được vào việc đó; bảng hiện "AI xử lý · <token> · đến hh:mm".
- Proxy cần thao tác PROXY_CREDENTIALS + quyền VM_PROXY_FOR_OPS + việc của chính token trên đúng VM; sai PIN → PIN_INVALID; token thu hồi → TOKEN_REVOKED; VM
  sang lượt mới → CYCLE_CHANGED. Audit lấy proxy không chứa user / pass.
- Ghi chú AI vào lịch sử VM (người, token, giờ), che mật khẩu; ghi chú của chủ không đổi.
- Mọi trả lời của các endpoint mới đúng docs/ops-api/openapi.json (schema đóng).
- Script: proxy chỉ ghi vào file (cả khi đến qua `retry`), nhật ký lệnh và stdout không có token / PIN / mật khẩu.

## Chưa kiểm

- Mọi thao tác trên máy thật qua AE Mini Tool (xem trên).
- Số dư EarnApp trên VM thật (endpoint cũ giữ nguyên, đã có test riêng).
- Hai AI thật chạy song song (đã kiểm bằng hai token trong test).

## Test bộ tái hiện cũ

`.runtime/review-money-proxy-20261019.test.ts` (bộ tái hiện 19/10) còn 2 ca kỳ vọng "thay proxy trả về tình trạng trước Blocked" — quy tắc này được brief
21/10/2026 thay bằng "Chờ áp dụng proxy". File của người kiểm không sửa.
