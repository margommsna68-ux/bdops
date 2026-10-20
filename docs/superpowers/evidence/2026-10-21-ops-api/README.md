# API vận hành AI `/api/ops/v1` — bằng chứng (21/10/2026)

Brief chủ dự án 21/10/2026 "YÊU CẦU HOÀN CHỈNH: API VẬN HÀNH AI". Thiết kế: `docs/superpowers/specs/2026-10-21-ops-api-design.md`; hướng dẫn:
`docs/runbooks/ops-api.md`; hợp đồng: `docs/ops-api/openapi.yaml`. Không quay video; dữ liệu thử là dữ liệu giả (example.invalid).

## Test tự động (DB test riêng)

- `src/__tests__/ops-api/ops-api.integration.test.ts` (7 ca) + `ops-safety.test.ts` (4 ca):
  token (hash, hiện một lần, thu hồi, hết hạn, user khoá, bỏ thành viên, ADMIN chỉ cấp trong quyền người nhận, dự án ngoài token, thao tác ngoài token,
  đường dẫn ngoài API); PIN (thiếu, sai, khoá 3 lần theo user, đổi token không vượt khoá, 5 lần sai khoá riêng token); giới hạn tần suất dùng chung hai
  client DB, 429 + Retry-After; IP client tự khai bị bỏ; resolve đúng mã / AMBIGUOUS / không gần đúng; phân trang ổn định; số dư (chuỗi thập phân,
  "0.00", ERROR không nhận amount, withdrawable cần căn cứ, sai lượt / account / revision → 409 kèm trạng thái hiện tại, cùng key cùng nội dung → replay,
  khác nội dung → IDEMPOTENCY_CONFLICT, hai request đồng thời cùng key, xoay token vẫn replay, quyền bị gỡ → retry bị từ chối, bản cũ đến muộn chỉ vào
  lịch sử); rút tiền (gợi ý không giữ, EUR không áp mục tiêu USD, prepare đồng thời cùng key, hai token tranh một email, EarnApp đã có yêu cầu → DUPLICATE,
  PP bị khoá, UNKNOWN chặn ghi tiền về, SENT đánh dấu email đã dùng, nhận 6 + 4, cùng mã giao dịch key khác → DUPLICATE, vượt phần còn chờ, khác đồng tiền,
  không mã giao dịch → nghi trùng, đổi account cùng lượt → ACCOUNT_CHANGED, VM tạo lại → CYCLE_CHANGED, tiền về muộn cho account đã đóng gắn đúng yêu cầu
  cũ); không có mật khẩu / PIN / token / ghi chú bí mật trong response và audit; web dùng cùng quy tắc (EARN_PAYOUT chỉ chuẩn bị + đã gửi / chưa rõ).
- Cả bộ: 127 file / 611 test đạt; typecheck sạch; build đạt.

## Trình duyệt + script local (`result-local.txt`, 27 PASS / 0 FAIL)

- U1–U9 (giao diện): Quyền nhân viên có 2 quyền mới; Thiết lập → Token API vận hành (ADMIN); token hiện một lần (ảnh đã che), danh sách chỉ có phần
  nhận diện; người có EARN_PAYOUT thấy "Chuẩn bị rút (giữ email)", form chỉ chuẩn bị có gợi ý PP, nút "Lưu chuẩn bị rút (giữ email)"; ô Tiền / Rút trên web
  hiện đúng dữ liệu API vừa ghi; thu hồi.
- F1–F17 (script mẫu `scripts/ops-client.mjs`, bí mật đọc từ file ngoài repo): /me → /projects → resolve → chi tiết → ghi số dư → gợi ý → prepare →
  gửi lại cùng key (replay) → UNKNOWN → ghi tiền bị chặn → SUBMITTED → nhận 6 → trùng mã → nhận 4 (đủ 10 theo sổ) → đọc lại → revision cũ 409 → sau thu
  hồi 401 TOKEN_REVOKED; script không in token / PIN.
- Ảnh: `u1-member-rights.png`, `u3-token-once-masked.png`, `u6-ai-prepare-form.png`, `u7-revoked.png`, `u8-web-after-api.png`.

## Host

Xem `host-check.md`.
