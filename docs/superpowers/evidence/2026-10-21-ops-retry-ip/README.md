# Ops API: kết quả lệnh qua nhiều lần thử lại + IP trên Railway (21/10/2026)

Bản được rà: 15ebaa9 / 25c30f2 (deploy 7134f316). Sửa ở commit b4e9e60. Dữ liệu thử là server giả / DB test riêng, token / PIN giả; không quay video.

## 1. Trạng thái lệnh ≠ kết quả lần gửi gần nhất

Bộ tái hiện độc lập `.runtime/review-ops-client-retry-refused-20261021.test.ts`: trước sửa 3 đỏ / 3 (`repro-before.txt`: lần đầu ghi rồi trả 502, retry
nhận 401 TOKEN_REVOKED / 403 FORBIDDEN / 429 RATE_LIMITED → script thoát 1, `pending` trống), sau sửa 3 xanh / 3 (`repro-after.txt`: thoát 3, lệnh vẫn
trong `pending`, khôi phục quyền rồi retry cùng key → `replay`, 1 tác động). Kỳ vọng không đổi.

- `scripts/ops-client.mjs`: nhật ký giữ `state` của lệnh và `lastAttempt`. Lệnh từng SENDING / UNKNOWN chỉ chốt bằng một phản hồi thành công; lần thử lại
  bị từ chối → vẫn UNKNOWN, thoát 3, "Lần thử lại bị từ chối: <mã> — <lời>; kết quả lệnh ban đầu vẫn chưa xác định. Khôi phục quyền truy cập rồi chạy
  lại retry <key> (không tạo key mới cho lệnh này)." DONE luôn là DONE (thoát 0, lần thử lại chỉ ghi vào `lastAttempt`). Lệnh mới bị từ chối rõ ràng ngay
  lần đầu → ANSWERED như trước. Mã thoát theo trạng thái lệnh (0 / 1 / 3). API không đổi; quyền / PIN không nới cho lần gửi lại.
- Test chính thức `src/__tests__/ops-api/ops-client-state.test.ts` (10 ca; với script cũ 9 đỏ): ba ca của người kiểm; nhiều lần 502 / 403 / 429 liên tiếp;
  DONE rồi retry 401 / 403 / 429 / 502 → vẫn DONE, không pending; lệnh mới 422 → ANSWERED, 422 lần nữa → ANSWERED, sau đó thành công → DONE; ANSWERED rồi
  502 → UNKNOWN.
- Runbook: bỏ "4xx = chưa ghi"; giải thích theo lịch sử lệnh.

## 2. IP trên Railway

Tài liệu Railway (specs-and-limits) chỉ nói `X-Real-IP` là IP máy khách; không nói có thay giá trị client gửi hay không, không nhắc X-Forwarded-For.
Kiểm thực tế trên host (deploy b4be51aa, `GET /api/ops/v1/health?diag=net`, chỉ trả các trường mạng; IP thật che: 118.69.***.32):

| Header client gửi | X-Real-IP app nhận | X-Forwarded-For app nhận | X-Railway-Request-Id | srcIp trong HTTP log Railway (ghép theo id) |
|---|---|---|---|---|
| (không) | IP thật | IP thật, 152.233.15.121 | fiD7kWdgS6ip3moXacI7Nw | IP thật |
| `X-Real-IP: 9.9.9.9` | IP thật | IP thật, 152.233.15.120 | EMMhYcSYQNyXNXzO0ubPiw | IP thật |
| `X-Forwarded-For: 1.2.3.4` | IP thật | IP thật, 79.127.228.18 | O54ING1kTqubfpWcipRofQ | IP thật |
| `X-Forwarded-For: 1.2.3.4, 5.6.7.8` | IP thật | IP thật, 79.127.228.18 | dEnPITkASa-7Kge3V7rehQ | IP thật |
| `X-Real-IP: not-an-ip` | IP thật | IP thật, 79.127.228.17 | RoaDyyplTXGjB9xbDcO5xA | IP thật |
| `X-Railway-Request-Id: forged-id-123` | IP thật | IP thật, 152.233.15.123 | fkDbxOnNTj2ThM6fDcO5xA (id mới) | IP thật |

Kết luận đã kiểm: nút biên Railway thay X-Real-IP và viết lại X-Forwarded-For (giá trị giả không lọt qua); X-Real-IP = srcIp. Bản cũ đọc phần tử
phải nhất của X-Forwarded-For nên ra IP nút biên. Sửa: `requestIp` dùng X-Real-IP trên Railway (nền tảng đặt `RAILWAY_ENVIRONMENT_ID`, không dựa vào Host
/ tên miền, không đếm hop), một địa chỉ cho giới hạn IP token, đếm xác thực sai, audit, lastUsedIp; `ipSource` = `railway` trên host. Địa chỉ phải đúng
một IP (port, danh sách, zone, octet > 255 → không có địa chỉ); token có danh sách IP mà không có địa chỉ → 403.

Test `src/__tests__/ops-api/ops-ip.integration.test.ts` (6 ca, DB test): IP đúng / CIDR / IPv6 viết khác dạng đi qua; IP sai, thiếu X-Real-IP, chỉ có
X-Forwarded-For giả, có port, danh sách, IPv6 sai, rác → 403 và audit ghi đúng địa chỉ (hoặc null); đếm xác thực sai theo X-Real-IP, không theo XFF giả;
luật IP sai định dạng bị từ chối khi tạo token; `/health?diag=net` không lộ Authorization / PIN / Cookie.

**Chưa kiểm trên host:** IPv6 (máy kiểm không có IPv6); token có giới hạn IP (chưa có token trên host; không tự tạo). Gọi qua mạng riêng Railway (dịch vụ
khác trong cùng dự án) có thể bỏ qua nút biên — hiện chỉ có Postgres trong môi trường này.

## Kiểm và phát hành

- Nhóm API / script + ba bộ tái hiện: 10 file / 60 ca xanh (41 ca cũ giữ nguyên). Cả bộ 135 file / 660 test xanh; typecheck sạch; lint không lỗi; build đạt.
- Backup host trước deploy e1bd51e1-2d7b-44ff-9ab3-1d700845b314 (41 102 513 byte). Deploy b4be51aa SUCCESS (proxy-trial-20261015 / moneytohome), "No pending
  migrations to apply". Ảnh chụp số liệu host trước / sau (`.runtime/p20-host-before46.json` / `after46`, local) giống hệt (10 server, 576 VM, 1261 proxy).
  Host chỉ đọc: không ghi số dư / rút vào MOON, không tạo token, không cấp quyền cho ai-ops.
