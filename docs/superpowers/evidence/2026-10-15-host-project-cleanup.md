# Dọn dự án trên host moneytohome — 15/10/2026 (tối)

Yêu cầu của anh: xóa dự án rác; dự án đang làm việc tên **mooon**; dự án chưa có dữ liệu tên **AE**. Kiểm tra trước: web mới có 4 dự án (Sheet 15/10 thật, Bản thử mẫu, 2 Kiểm chứng host); production cũ `bdops-production` chỉ có DNPP và AEPP (PayPal), không đụng. Anh xác nhận cách hiểu: giữ dự án thật và đổi tên thành mooon, tạo AE trống, xóa 3 dự án mẫu.

## Code (commit `650a023`)

- `src/server/project-lifecycle/destroy.ts`: `destroyProject` xóa toàn bộ dữ liệu một dự án theo đúng thứ tự khóa ngoại trong một giao dịch (VM task/allocation/configuration/SDK history, tài chính, VM, Gmail/PayPal, replacement/event/source/batch/snapshot, proxy, identity mồ côi, gói, server, chia lợi nhuận, audit/journal, thành viên, dự án). Identity proxy là toàn cục theo IP nên chỉ xóa identity không còn endpoint/tham chiếu/sự kiện nào.
- `project.deleteProject`: ADMIN của dự án xóa được dự án proxy/VM (trước đây bị chặn "cần quy trình lưu trữ"); ADMIN bất kỳ xóa được dự án **không còn thành viên** (dự án mẫu/QA mồ côi). `wipeProjectData` vẫn giữ chặn cũ. Nút **Xóa dự án** ở Quản trị → Dự án dùng endpoint này.
- Tests: `project-destroy.integration.test.ts` (2) + cập nhật `final-review.integration.test.ts`. Suite 232 tests / 62 files qua; tsc, lint (4 cảnh báo cũ) qua.

## Host

- Backup trước: `70708bdc-6dda-407d-b686-6572ef0e9d29` (35.133.815 bytes, SHA-256 `6897a7b6adda27a7ace4289a921ea9e986773d8210991ad41f3efc81ef6e2e1c`), ngoài ra `08b308e0` lúc 16:00 trước lần đẩy trước.
- Deploy `0bc812e1-ecb3-4412-9dc1-b2abc9034366` SUCCESS (không migration).
- Script `.runtime/host-cleanup-projects.ts` qua API chủ: đổi tên PERSONAL_SHEET → **mooon** (mã giữ nguyên), tạo **AE** (`cmv9s93z5000210ddsxbf0cb1`, PROXY_VM, chủ là ADMIN), xóa PROXY_TRIAL, HOST_QA_1792044713095, HOST_QA_1792044785407. Sau: 2 dự án; mooon vẫn 10 server / 574 VM / 1362 proxy. Kết quả lưu `.runtime/host-cleanup-projects.json`.
- Tài khoản chủ đã đổi theo yêu cầu (user `tut`), xem runbook railway-trial.
