# Rà soát độc lập 22/10/2026 — PIN và SDK của AI (nền 2ca1b41)

Bộ tái hiện `.runtime/review-user-ai-20261022.test.ts`: trước 4 đỏ / 4 (`repro-before.txt`), sau 4 xanh / 4 (`repro-after.txt`), kỳ vọng không đổi; bốn ca
giữ nguyên trong `src/__tests__/users/user-ai-review.integration.test.ts` (17 ca). Dữ liệu thử; không quay video; không có PIN / token trong bằng chứng.

| # | Trước | Sau | Kiểm |
|---|---|---|---|
| 1 | verifyPin: checkPin OK rồi unlock đọc pinVersion lúc đó → ADMIN đổi PIN xen giữa thì PIN cũ mở khoá cho PIN mới | `checkPinVersion` trả kèm phiên bản PIN đã so (đọc trong bước khoá dòng user); `unlockWebSession(…, verifiedVersion)` một giao dịch: đúng phiên bản đó, còn PIN, user chưa tắt, không khoá tạm, phiên còn mở cùng authEpoch — sai một điều là từ chối, không mở khoá. Đặt / đổi / xoá PIN (của mình, ADMIN, project.setPin / removePin) ghi hash + phiên bản trong cùng một lệnh | Ca tái hiện; xen giữa: xoá PIN, vô hiệu hoá, bị khoá, phiên bị thu hồi → không mở khoá; ADMIN đổi / xoá → mở khoá cũ hết |
| 2 | setPin so currentPin bằng bcrypt riêng, reset bộ đếm, xoá khoá, mở khoá phiên | `setOwnPin`: PIN lần đầu không cần PIN cũ; đổi PIN đã có bắt buộc PIN hiện tại qua quy tắc chung (bộ đếm, khoá 30 phút); đang khoá → từ chối; ghi trên đúng phiên bản đã kiểm (FOR UPDATE), rồi mở khoá phiên với phiên bản mới. ADMIN "Mở khoá tạm" giữ nguyên | Ca tái hiện; 3 lần sai PIN hiện tại qua setPin → khoá (không thử vô hạn); ADMIN mở khoá → đổi được |
| 3 | recordJobSdk tự đọc SDK rồi đưa expectedSdkRevision vào payload của saveVmSdk → gửi lại cùng key thành IDEMPOTENCY_CONFLICT | Một lệnh `VM_JOB_SDK` với danh tính là yêu cầu (VM, việc, lượt, revision VM, mã); revision của mã đọc trong giao dịch, không nằm trong danh tính. Gửi lại cùng key + nội dung → `replay: true`, recorded y như lần đầu (cả sau khi việc hết hạn / nhả / VM đổi), sau khi kiểm lại token / quyền; khác nội dung → 409 | Ca tái hiện; HTTP thật + đọc DB (`local-http-sdk.txt` H1–H6) |
| 4 | Kiểm việc ở giao dịch 1, ghi SDK ở giao dịch 2 (saveVmSdk), gắn vào việc ở giao dịch 3 → việc nhả giữa chừng vẫn lưu SDK | Tách phần ghi dùng chung `placeVmSdk` (sdk-store.ts, saveVmSdk của web gọi lại); trong MỘT giao dịch của lệnh: token, quyền, việc còn của đúng người / VM / lượt, quy tắc mã, ghi mã hiện hành + danh sách + lịch sử, gắn vào việc, kết quả chống lặp. Kiểm trước (chỉ đọc) chỉ để báo sớm; giao dịch kiểm lại tất cả | Ca tái hiện; xen giữa: nhả việc, hết hạn, người khác giữ việc, VM sang lượt mới, mất quyền, thu hồi token → từ chối, DB 0 SDK / 0 lịch sử / mã VM trống; HTTP H7 |

Trình duyệt thật, hai phiên của user thử (`local-browser-pin.txt` 12/12, ảnh `locked.png`): sai 3 lần → khoá; PIN đúng / setPin gọi thẳng / form Thiết lập
đều không vượt khoá; ADMIN mở khoá tạm; đổi PIN của mình → phiên kia phải dùng PIN mới; ADMIN đổi PIN → cả hai phiên nhập lại, PIN trước không dùng được.

Hồi quy: user-access, ops-api, SDK (18 file / 116 ca) xanh; cả bộ xanh trừ 2 ca của bộ tái hiện 19/10 (`review-money-proxy-20261019`, quy tắc Blocked cũ đã
được brief 21/10 thay — vấn đề khác, không liên quan bốn lỗi này) và 1 ca `vm-table` chạy riêng thì xanh (trùng dữ liệu khi chạy song song). Typecheck,
lint (không lỗi), build đạt.

Giới hạn: đây là web / API (thử local + test). AE Mini Tool chưa chạy thật; chưa kích hoạt AI vận hành trên host.
