# Nghiệm thu 19/10/2026: tiền VND → USDT, nhãn $, chống ghi đè SDK, proxy không có bước cài

Dữ liệu thử riêng trên bản thử cục bộ (fixture `.runtime/p20-local-setup.ts` + `p20-local-extra.ts`, địa chỉ 100.80.x / 100.64.x / 198.18.x, email example.invalid; nguồn giá Binance giả cố định 25.820 trên 127.0.0.1). Kịch bản trình duyệt chạy một lượt trên dữ liệu mới: **63/63 PASS**, không lỗi JavaScript (`browser-result.txt`, user/pass giả đã che). Không quay video.

## Đối chiếu yêu cầu

| Yêu cầu | Kiểm |
|---|---|
| 6 PP / 30 email × 70.000 VND, tỷ giá 25.820 → 420.000 VND = 16,266460 USDT, hiện 16,27 | M1c, M4b (DB: 420000 / 25820 / 16.26646, BINANCE_P2P_BUY), M5a/b; test `account-store` |
| "70000" = "70.000"; "25,820" / "25.82" báo tại ô; API chỉ nhận số chuẩn | M2a/b; test `money-input`, `account-store` ("25.820" bị từ chối) |
| Đơn giá ↔ tổng tiền không đổi tổng thực trả; số lượng PP không lấy từ email | M1d/e/f |
| Tỷ giá tự lấy, sửa tay, lỗi nguồn, hết hạn, đổi đồng tiền | M1a/b, M2c–f, M3a/b |
| Bấm lặp, mất phản hồi, nhập bổ sung: một lô, một khoản chi | M4a/b, M5c |
| Sửa Chi phí rồi quay lại Kho: tổng và phân bổ khớp, giữ giá ban đầu | M6a/b/c |
| Nhãn $: 0, chờ về, dự kiến đủ, đạt mức gom; khung chọn PP | D1a–e |
| Hai người sửa cùng SDK qua hai màn hình | S1a; test `sdk-stale` (2 ca review độc lập + 2 ca mới) |
| Nháp SDK của lượt cũ không lưu vào lượt mới | S2a/b/c (lượt mới mô phỏng bằng `p20-bump-cycle.ts`) |
| Đổi / xoá nội dung dán khi đang kiểm tra | S3a/b |
| SDK mất phản hồi: cùng khoá | S4 |
| Gán proxy hoàn tất ngay, không bước cài | P1a–d |
| Blocked ở VM và ở Kho đồng bộ; báo lặp giữ mốc | P2a–d |
| Thay từ VM và từ Kho, khôi phục đúng tình trạng | P3a, P4a/b; test `proxy-change` (OK, Chưa nối, LINKED, Chưa ghi) |
| SUS giữ SUS; đang Blocked đổi OFF thì giữ OFF; lượt mới không dùng mốc cũ | P5a–d |
| Proxy dự phòng: proxy Blocked cũ vẫn copy được; replace thì rời danh sách | P6d, P3a, P4a |
| Copy theo lựa chọn, theo bộ lọc nhiều trang, port-stream | P6a/b/c |
| Hai người cùng thay một VM; mất phản hồi rồi thử lại | P7a/b; test `proxy-change` |
| Dữ liệu cũ nhiều proxy: giữ đối chiếu, không đoán | P8a/b |
| Không còn link / bộ lọc / thông báo tới bước cài | P9a–e, host |
| Hồi quy tạo lại VM, SDK, tài khoản, gán / replace | test tự động: 99 file / 446 test (vm-ops 4a/4b, sdk-store, account-store, proxy-edit, batches, vm-admin…) |

## Host (Railway trial, chỉ đọc)

- Backup trước deploy: `e6fc9c30-8491-4e1e-a99b-982f6c9deca1` (40.437.958 byte). Deploy `d987e812-f016-4379-b546-b0d472976268` SUCCESS. Migration `20261019210000_vm_blocked_from` (chỉ thêm cột, không ghi dữ liệu).
- Trước / sau (không có dữ liệu nào bị đổi): 10 server / 576 VM → 10 / 576.
  - Quy tắc cũ (trước): 574 VM "Chờ cài", 1 VM "Đã cài", 22 VM có bản "Giữ để kiểm tra".
  - Quy tắc mới (sau): Có proxy 553, Cần kiểm tra 23, Thiếu proxy 0, Proxy Blocked 0.
  - Kho proxy: 1261 proxy hiện hành, BLOCKED 3 (không ở VM nào), NEW 9.
  - Lô PP-2026-10-19-1: 6 PP / 30 email, 420.000 VND, tỷ giá 25.820, 16,26646 USDT: đã đúng, giữ nguyên (không nhập lại, không áp tỷ giá hôm nay).
  - Kho SDK: 5 mã. Nhãn gom PayPal: 6 PP, đều số dư $0,00.
- Kiểm đọc sau deploy: `proxyCheck` trên An-01/VM_001 trả SKIP (không ghi); lệnh `start` cũ bị từ chối với thông báo rõ; trình duyệt chỉ gọi lệnh đọc (`host-result.txt`, ảnh `host-*.png`).

## Chưa kiểm được

- Mọi thao tác ghi chỉ kiểm trên dữ liệu thử cục bộ; trên host không gán / thay / báo Blocked / copy.
- Tạo lại VM thật trên trình duyệt cần khoản rút đã về; luồng này kiểm bằng test tự động (vm-ops 4a/4b), lượt mới trên trình duyệt được mô phỏng.
- Giá Binance thật không dùng trong nghiệm thu (dùng máy chủ giá giả để cố định số). Trên host nguồn giá Binance thật không được gọi trong lần kiểm đọc.
- Bộ gõ Unikey / EVKey thật chưa thử.
