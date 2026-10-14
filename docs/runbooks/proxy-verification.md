# Kiểm chứng kho proxy local — 14/10/2026

Source: branch `feat/proxy-inventory`, bản UI `0536567`; môi trường thử riêng, không dữ liệu vận hành.

| Kiểm tra | Kết quả đã đọc |
|---|---|
| npm test | 103/103 kiểm tra, 26 file; gồm PostgreSQL transaction, owner, source, API và legacy bypass |
| npx tsc --noEmit | Exit 0 |
| npm run build | Exit 0; toàn bộ route đóng gói được |
| npm run lint | Exit 0, 4 cảnh báo hook đã có ở agent-pp; phần proxy không có lỗi/cảnh báo |
| git diff --check | Exit 0 |
| Browser | NEW → BLOCKED → replace → history; copy; chống IP hiện hành/Genjy; input đổi phải preview lại; hai tab phát hiện stale |
| Lượt rà độc lập | Rà độc lập đã nhận 3 Critical + 3 Important; đã sửa trong một lượt TDD. Có thêm test cached scanner và VIEWER server credentials; 103/103 qua. Không có Minor từ reviewer. Public deploy vẫn có cổng nâng cấp dependency |

Build local phải dừng đúng process Next dev để Prisma Windows không bị DLL lock. Output kiểm tra production nằm trên D thông qua `.next-build` vì C gần đầy; dependency junction riêng của runtime D giải quyết Node module realpath. Máy chạy web/database thử trên localhost, không phải dịch vụ đã publish.

## Trước khi lên Railway

Audit runtime trên baseline hiện tại báo 12 dependency entries (4 critical, 7 high, 1 moderate). Có cả Next/Auth và SheetJS. Đây là cổng phải xử lý trước public deploy/dữ liệu thật; không chạy npm audit fix --force để tự đổi major. Bản local chỉ chứa proxy và tài khoản thử, bind 127.0.0.1. Phần nâng cấp nền và rà tương thích cần kiểm tra các luồng auth/Prisma/React, không chỉ build.

Chưa có Railway login/target đã xác minh, chưa push hoặc deploy. Không cần mua gói để phát triển local. Tài khoản nhân viên ở web và quyền developer Railway là hai việc riêng.

Nguồn Genjy của bản local là workbook mẫu; chỉ lần nhập thật mới dùng nguồn Google hiện hành. Snapshot cá nhân đã phân loại được lưu mã hoá qua server seam, không nhận quyết định READY từ client. Server/VM và xác nhận cài là mốc tiếp theo.
