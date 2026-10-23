# Quản trị user: quyền, PIN, truy cập, token API (22/10/2026)

Brief chủ dự án 22/10/2026. Một trang cho mỗi người (người hay AI như nhau), không có hệ quản trị AI riêng.

## Đường vào

- **Nhân viên** (`/admin/users`): mỗi dòng có vai trò, tình trạng tài khoản (Đã vô hiệu hoá / Khoá tạm), PIN đã đặt / chưa đặt, số token còn hiệu lực, và
  lối vào **"Quyền · PIN · API →"** (bấm tên cũng vào). Nút "Đặt PIN" / "Đổi PIN" trên dòng giữ như cũ (form nhỏ, Lưu).
- **Trang user** (`/users/{id}`): đầu trang "Đang quản lý <login> · <tên dự án>" (ví dụ `ai-ops · MOON`), rồi cạnh nhau:
  - **Quyền trong dự án** (dự án Proxy / VM, ADMIN): cùng form và backend với Kho proxy → Thiết lập → Quyền nhân viên (`proxyManagement.setCapabilities`).
  - **PIN và truy cập**: Đặt PIN (chưa có) / Đổi PIN (đã có) — một ô PIN mới + nút, không hiện PIN hiện tại; **Xoá PIN** (xoá thật, ghi đúng nhãn); Mở khoá
    tạm (khi bị khoá do sai 3 lần); **Vô hiệu hoá… / Bật lại** (ADMIN).
  - **Kết nối API** (dự án Proxy / VM, ADMIN): token của **đúng user và dự án đang xem** (lọc ở server). Tạo token: tên, quyền, hạn dùng, PIN của ADMIN; IP
    trong "Tuỳ chọn". Quyền chỉ hiện những thao tác user này làm được ngay; quyền chưa cấp ghi riêng ("Chưa được cấp…") — cấp ở mục Quyền ngay trên.
- Thiết lập: không còn form token riêng; chỉ dẫn tới Nhân viên.
- Đổi dự án ngay trên trang user (các nút dự án ở đầu trang): mọi phần đọc lại theo dự án đó; quyền của người xem được kiểm theo dự án đó ở server.

## Quy tắc

- **PIN**: ADMIN dùng PIN của chính mình khi tạo token. AI vận hành dùng PIN riêng của user ai-ops cho lệnh ghi. Token không thay PIN, không thêm quyền.
- **Mở khoá PIN ở server** (`src/server/users/access.ts`): đăng nhập mở một phiên (`UserSession`, JWT chỉ mang id); mọi request tRPC kiểm phiên còn mở,
  đúng user, đúng `authEpoch`, user chưa bị vô hiệu hoá. Trước khi nhập PIN, mọi lệnh (trừ hasPin / verifyPin / setPin) bị từ chối `PIN_REQUIRED`, kể cả
  gọi API trực tiếp. Mở khoá gắn với phiên + phiên bản PIN (`User.pinVersion`): đổi / xoá PIN, đăng xuất, vô hiệu hoá → phải nhập lại. Không có thời hạn
  mở khoá riêng (chưa chốt). `sessionStorage` không còn là bằng chứng. Lần đầu sau khi triển khai, mọi người phải đăng nhập lại một lần.
- **Vô hiệu hoá ≠ khoá tạm**: khoá tạm do sai mật khẩu / PIN (tự mở sau 30 phút); vô hiệu hoá do ADMIN (`User.disabledAt`). Vô hiệu hoá: chặn đăng nhập,
  phiên web đang mở, token API (thu hồi hết), token autotype, lệnh ghi (kiểm trong chính giao dịch ghi: `assertUserEnabled` FOR SHARE — lệnh đã qua kiểm
  trước mốc thì xong, lệnh sau mốc bị từ chối), nhả việc VM đang giữ. Không xoá user / lịch sử / dữ liệu. Bật lại: đăng nhập mới; phiên, token, mở khoá PIN
  cũ không sống lại. Không tự vô hiệu hoá mình, không làm mất ADMIN cuối cùng của dự án. User thuộc nhiều dự án: người làm phải là ADMIN của **mọi** dự án
  đó (`assertUserTarget`); áp dụng cho cả tài khoản, ghi audit ở từng dự án. Gỡ quyền trong một dự án vẫn ở Nhân viên (chỉ dự án đó).
- AI bị thu hồi quyền / token / vô hiệu hoá: lệnh API tiếp theo bị từ chối (token kiểm lại trong giao dịch ghi). Không cam kết dừng thao tác AE Mini Tool đã
  bắt đầu bên ngoài web.
- **Token**: giữ hash, hạn, kiểm quyền hiện tại, thu hồi, audit. Token đầy đủ hiện một lần (Copy, Đã lưu); nút Tạo token ẩn khi token đang hiện. Mỗi form
  một mã yêu cầu (`OpsToken.createKey`): bấm lặp / mất phản hồi trả lại token đã tạo (không kèm bí mật), không sinh token thừa. Token cũ giữ nguyên.
- **Tên dự án**: hiển thị `project.name` (`projectLabel`), mã nội bộ (PERSONAL_SHEET) và ID chỉ trong "Chi tiết kỹ thuật" ở Dự án; nhãn loại theo chế độ
  (Proxy / VM, Chỉ PayPal, Đầy đủ). Chọn / đổi dự án ở mọi nơi dùng `useSelectProject` (membership của chính người đăng nhập, đủ chế độ / tên / quyền); đổi
  tên dự án chỉ đổi tên trong bộ nhớ trình duyệt (`renameCurrentProject`) — trước đây mất chế độ Proxy / VM nên mục token biến mất.

## 2FA Google Authenticator thay PIN (23/10/2026)

Quyết định chủ dự án 23/10/2026 (thiết kế docs/superpowers/specs/2026-10-23-totp-ai-approval-design.md). Mã TOTP (RFC 6238, 30 s, cửa sổ ±1 bước,
chống dùng lại cùng bước) thay cho PIN ở mọi chỗ web từng hỏi PIN; AI (ops API) không còn PIN và cũng không có mã 2FA.

- **Đăng nhập + mở khoá**: sau mật khẩu, user đã bật 2FA nhập mã 6 số; mở khoá phiên (trước đây PIN) cũng bằng mã 2FA, vẫn gắn phiên + phiên bản
  2FA (đặt lại 2FA → phải mở khoá lại). Sai 3 lần → khoá 30 phút (một bộ đếm cho đăng nhập, mở khoá, duyệt); ADMIN "Mở khoá tạm" mở sớm.
- **Bắt buộc cài**: user chưa bật 2FA mà dự án / ADMIN yêu cầu thì sau đăng nhập chỉ thấy popup cài (QR tạo ở server cho phiên đang cài, nhập mã xác
  nhận; khoá bí mật không bao giờ hiện lại). Chủ cài trước, rồi bật bắt buộc cho người khác.
- **ADMIN yêu cầu / đặt lại**: trên trang user: "Yêu cầu 2FA" và "Đặt lại 2FA" (xoá khoá cũ, user cài lại ở lần đăng nhập sau; mọi mở khoá đang có của
  user đó mất hiệu lực). Không ai xem được khoá của người khác.
- **Mã dự phòng**: cấp một lần khi cài (dùng một lần, có thể dùng để mở khoá); hết mã → ADMIN đặt lại 2FA.
- **Duyệt lệnh AI (Phê duyệt)**: lệnh quan trọng của ops API (chuẩn bị rút, trạng thái rút, tiền về PP, proxy đầy đủ của VM, xem mã SDK đầy đủ) chờ ở
  `/approvals` (menu ADMIN; chip số chờ duyệt). Duyệt / Từ chối cần mã 2FA của chính ADMIN (không dùng mở khoá của phiên), chỉ ADMIN của đúng dự án và
  **đã bật 2FA**; ADMIN chưa bật 2FA không duyệt được. Hạn 15 phút; quyết định ghi audit `OPS_APPROVE` / `OPS_REJECT`. Tạo token API cũng xác nhận bằng mã 2FA
  của ADMIN thay PIN. Chi tiết phía AI: ops-api.md mục 0.
- Đồng hồ máy chủ phải đúng (lệch > 30 s mã sẽ sai); kiểm `w32tm /query /status` khi triển khai.

## Kiểm (22/10/2026)

Test `src/__tests__/users/user-access.integration.test.ts`; trình duyệt local 30/30 (evidence docs/superpowers/evidence/2026-10-22-user-access/).
