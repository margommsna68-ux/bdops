# Tiền / Rút tại VM — 20/10/2026

Chủ dự án yêu cầu theo dõi tiền EarnApp từng VM và nối với luồng rút về PayPal sẵn có. Runbook: `docs/runbooks/vm-ops-cycle.md` (mục "Tiền / Rút tại VM").

## Kiểm tra tự động

- `src/__tests__/proxy-management/earn-money-rules.test.ts` (7): trạng thái số dư, lọc, mốc rút, gợi ý PP, sắp xếp, tóm tắt.
- `src/__tests__/proxy-management/earn-money.integration.test.ts` (8): $10 chưa rõ điều kiện; 0 khác chưa kiểm tra; kiểm tra lỗi; bản cũ đến muộn; gửi lại cùng khoá; lượt sai / EarnApp đã đổi; VM tạo lại không mang số dư; số dư không vào sổ PayPal / team, không đọc tiền SDK; dán bảng; quyền (nhân viên, EARN_BALANCE, VIEWER, dự án khác); $82 + $18 chờ thì gợi ý pp-85; chuẩn bị / giữ email / chưa xác định / đã gửi; khoản nhận không gắn trước khi gửi; nhận $6 trên $10 còn chờ $4; huỷ chuẩn bị nhả email, huỷ sau khi gửi vẫn giữ dấu đã dùng.
- Toàn bộ: 120 tệp / 576 test, typecheck, lint, build.

## Kiểm tra trình duyệt (máy local, dữ liệu giả example.invalid, không quay video)

`local-browser-result.txt`: 45 PASS / 0 FAIL. Ảnh:
- `th-light.png`, `th-dark.png`, `th-golden.png`, `th-bronze.png`, `th-bronze-phone.png`: cột và dải tóm tắt ở bốn giao diện và điện thoại 390px.
- `c-grid-light.png`: bảng mặc định; `e-balance-form.png`: ghi kiểm tra tại ô; `r-suggest.png`: gợi ý PP kèm lý do; `r-unknown.png`: chưa xác định kết quả; `p-paste.png`: dán bảng số dư.

## Host

Chỉ đọc trước / sau triển khai; không ghi dữ liệu thử. Kết quả ở `host-check.md`.
