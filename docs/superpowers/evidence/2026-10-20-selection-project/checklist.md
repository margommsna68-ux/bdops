# Đổi dự án huỷ lựa chọn đã giữ (20/10/2026)

Chủ dự án tái hiện trên host: Kho proxy MOON chọn 84.32.138.211, 84.32.138.213 → Thiết lập → đổi MOON → AE → MOON → Back: vẫn "Đã chọn 2
proxy". Nguyên nhân: lựa chọn giữ trong bộ nhớ phiên theo khoá dự án; quay lại đúng dự án và đúng bộ lọc thì được khôi phục, vì đổi dự án
khi trang Kho proxy không mở không xoá gì.

Sửa: `setCurrentProject` (src/lib/store.ts) khi đổi sang dự án khác gọi `clearProjectSelections(dự án cũ)` (src/lib/session-selection.ts):
chỉ xoá các mục `mth-selection:*:*:<dự án>` của tab (Server / VM và Kho proxy, mọi người dùng), dù hai trang đó đang mở hay không.
Đọc lại cùng dự án (layout làm mỗi lần mở trang) không xoá. Không đụng nháp, PIN / đăng nhập, theme, cấu hình cột.

## Kiểm

- Test `session-selection-project.test.ts` (3 ca, đi qua rời trang → đổi dự án bằng đúng action của store → bước khôi phục khi quay lại):
  trên mã cũ 2 ca đỏ, mã mới xanh.
- Trình duyệt, dữ liệu thử cục bộ, thao tác thật (bộ chọn dự án ở sidebar khi đang ở Thiết lập, rồi Back): **7/7 PASS**
  (`browser-result.txt`): Kho proxy chọn 2 → A → B → A → Back: 0 dòng chọn; Server / VM chọn 2 → tương tự: 0; có lựa chọn ở cả hai trang
  (không mở) → đổi dự án xoá cả hai khoá, quay lại không phục hồi; chỉ đổi theme: Kho proxy còn 2, Server / VM còn 2; cấu hình cột, theme,
  PIN, đăng nhập còn nguyên; không có lệnh ghi; không lỗi JS.

## Phát hành và host

Commit 572ddca, backup host 50a6439d-bf67-483e-8bef-9af3daaac7d9 trước khi deploy, deploy 79ab6de8 SUCCESS, không migration. Host, chỉ
thao tác trình duyệt: Kho proxy MOON chọn 84.32.138.211, 84.32.138.213 → Thiết lập → AE → MOON → Back: không còn dòng chọn; chỉ đổi theme
(Đồng ấm, Tối) rồi Back: còn "Đã chọn 2 proxy" (sau đó Bỏ chọn); Server / VM chọn An-01/VM_001, VM_002 → đổi dự án → Back: 0. Chỉ POST
verifyPin / heartbeat, không lỗi JS; số liệu host trước / sau giống hệt.
