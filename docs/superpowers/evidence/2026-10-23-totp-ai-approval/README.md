# 2FA (Google Authenticator) + phê duyệt lệnh AI — bằng chứng 23/10/2026

Quyết định chủ (chat 23/10): bỏ PIN cho AI (chỉ token); ADMIN duyệt lệnh quan trọng trên web bằng mã 2FA; SDK che mã, chỉ trả đầy đủ khi được duyệt; người dùng dùng 2FA cả lúc đăng nhập lẫn mở khoá; user được bật 2FA bị popup bắt cài. Thiết kế: `docs/superpowers/specs/2026-10-23-totp-ai-approval-design.md`. Commit `b9b6a87` trên nhánh feat/proxy-inventory.

## Kiểm thử cục bộ
- `npx vitest run` → **758/758** (153 file) sau khi cập nhật các test ops-API cho hành vi mới (fixture tự duyệt trong DB cho luồng nghiệp vụ; luồng duyệt thật kiểm riêng).
- Mới: `src/__tests__/users/totp.integration.test.ts` (vector RFC 6238, cửa sổ ±1 bước, chống phát lại, mã dự phòng dùng một lần, khoá 3 lần/30 phút, mở khoá phiên theo version, ADMIN đặt lại / bắt buộc), `src/__tests__/ops-api/ops-approvals.integration.test.ts` (ghi thường không cần PIN; prepare → 202 → không phải ADMIN / ADMIN chưa bật 2FA / sai mã bị từ chối → duyệt đúng mã → gửi lại chạy một lần → CONSUMED → gửi lại replay; từ chối 403; hết hạn 410; cùng key khác nội dung 409; mã SDK che ở `vms/{id}` và `sdks`; `sdks/{id}/reveal` cần duyệt và trả mã đầy đủ), `src/__tests__/layout/pin-gate-totp.test.tsx` (popup bắt cài, nhập mã, PIN cũ), ops-client (202 → WAITING_APPROVAL / exit 4, retry, approvals, sdk-reveal).
- `npx tsc --noEmit` sạch; eslint chỉ 1 cảnh báo `<img>` cho ảnh QR (data URL, không tối ưu được bằng next/image).
- Lưu ý kiểm thử: vitest trước đây còn chạy cả bản sao release `.runtime/codex-release-2f1799a/` (test cũ chống server mới) → đã loại trong `vitest.config.ts`.

## Triển khai lên SERVER-01 (D:\MoneyToHome) — 23/10/2026 16:50
- Sao lưu `pg_dump` trước: `D:\MoneyToHome\backups\moneytohome-20261023-164808.dump` (38,5 MB).
- `git archive b9b6a87` → `D:\MoneyToHome\app-next`, `npm ci`, `prisma migrate deploy` (20261023120000_totp_approvals, cộng thêm), `npm run build`; đổi thư mục `app` ↔ `app-next` (bản cũ giữ ở `app-prev`), khởi động lại dịch vụ `MoneyToHome-Web`.
- Kiểm sau triển khai (HTTP thật): `/login` 200; `/api/ops/v1/health` ok qua https://wow.lalamail.sbs; đăng nhập `tut` (chưa bật 2FA) → `securityStatus` {totpEnabled:false, hasPin:true, unlocked:false} → mở khoá PIN cũ → unlocked:true; `opsApproval.pendingCount` 0; trang `/approvals` 200.
- Phát hiện khi triển khai: dịch vụ tunnel phụ thuộc dịch vụ web nên bị dừng theo khi dừng web để đổi bản (Cloudflare báo 1033 khoảng 1 phút); đã bỏ phụ thuộc đó (`MoneyToHome-Tunnel.xml`, `refresh`), tunnel giữ kết nối và trả 502 trong lúc web khởi động lại.
- Gói Central mới (không secret): `handoff/moneytohome-ops-central-b9b6a87-20261023(.zip)`, baseUrl https://wow.lalamail.sbs, client không PIN.

## Giới hạn
- Chưa kiểm trên trình duyệt thật (không có Playwright trong worktree); giao diện kiểm bằng jsdom + tsc; luồng server kiểm bằng test tích hợp và HTTP thật sau triển khai.
- Chủ phải tự bật 2FA (Thiết lập → Bảo mật → Bật 2FA) rồi mới duyệt được lệnh AI; token AI do chủ tạo trong UI.
