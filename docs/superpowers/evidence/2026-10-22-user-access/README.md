# Quản trị user / PIN / token — bằng chứng (22/10/2026)

Runbook: docs/runbooks/user-access.md. Dữ liệu thử local (DB trial local, user thử, dự án "Proxy & VM — Bản thử"); không quay video; ảnh không có token / PIN.

- `local-browser.txt`: 30/30 PASS trên Chrome thật (local `next start`): PIN do server giữ (gọi API trước PIN → PIN_REQUIRED), Nhân viên → user → ba phần,
  nhãn Đặt / Đổi / Xoá PIN, form token đúng user + chỉ quyền dùng được, 3 lần bấm cùng lúc → 1 token, token hiện một lần, tải lại không hiện lại, thu hồi →
  401, đổi PIN → phiên mở khoá cũ bị chặn / PIN cũ hỏng / PIN mới dùng được, vô hiệu hoá với phiên web + token đang mở → bị chặn, đăng nhập bị từ chối, bật lại
  → cookie phiên cũ vẫn 401, token cũ vẫn 401, đăng nhập mới được; Dự án: tên là tiêu đề, nhãn Proxy / VM, mã trong chi tiết kỹ thuật; vào từ Dự án đúng
  chế độ + quyền người đăng nhập, khung API còn, Back / Forward đúng; Thiết lập chỉ dẫn tới Nhân viên; điện thoại 390px không tràn.
- Ảnh: `user-page.png` (trang user, sau khi ẩn token), `projects.png` (Dự án), `theme-light|dark|golden|bronze.png` (phần quản trị trên trang user ở bốn
  theme), `phone-top.png` (390px; chụp trước khi cho đầu trang xuống dòng — đã sửa sau đó).
- Test: `src/__tests__/users/user-access.integration.test.ts` (5 ca: phiên + mở khoá PIN, vô hiệu hoá / bật lại, ghi đồng thời với vô hiệu hoá — lệnh đã qua
  kiểm trước mốc xong, lệnh sau mốc bị từ chối, giới hạn ai được vô hiệu hoá, token theo user + mã yêu cầu + người không phải ADMIN không cấp được).

## Phát hành (21–22/10/2026)

- Commit a6c8371 (+ 8e757a8 nút / nhãn), cùng đợt với f1a8fbd (vận hành VM bằng AI). Backup 579af65e trước deploy 673131bd (migration 20261021150000_ai_vm_ops
  + 20261022090000_user_access, chỉ thêm); backup 3a47140f trước deploy 931c06e6. Ảnh chụp số liệu host trước / sau mỗi lần giống hệt (10 server, 576 VM,
  1261 proxy).
- Host chỉ đọc + điều hướng (`host-projects.png`, `host-user-ai-ops.png`, email / tên thành viên đã che): gọi API trước PIN → PIN_REQUIRED; Dự án: **MOON**
  [Proxy / VM], **AE** [Proxy / VM] (tên trong DB đã đúng, không cần đổi); không còn "PERSONAL_SHEET —"; Nhân viên → ai-ops → "ai-ops · MOON" với ba phần;
  Thiết lập chỉ dẫn tới Nhân viên. Không tạo token, không đổi PIN, không cấp quyền, không vô hiệu hoá ai trên host.
- Sau triển khai, các phiên đăng nhập cũ (JWT chưa có phiên server) phải đăng nhập lại một lần.
