# Lịch sử nhập kho — bảng gọn (18/10/2026)

**Trước** (host, chỉ xem; `host-before.txt`, `host-before-1280.png`, `host-before-390.png`):
- Một dòng cao 153px; bảng phải kéo ngang ở 1280px.
- Cột ghép "Nguồn · ngày mua" và "— · 5".
- Ba nút: Xem tài khoản, Nhập bổ sung, Xem ở Chi phí.

**Sau:** kiểm trên dữ liệu thử cục bộ (`result-local.txt`, 17/17). Dữ liệu thử gồm:
- năm đợt cùng ngày 18/10;
- tiền USDT không ghi số lượng; VND theo đơn giá × 4 và tỷ giá;
- một đợt Apple ID không ghi giá;
- một khoản chi đã điều chỉnh 10 → 8,5 USDT và một khoản đã thu hồi;
- một mã PayPal dài 47 ký tự.

| Kiểm | Kết quả |
|---|---|
| Cột | Đợt nhập · Nơi mua · Số lượng mua · Đã nhập kho · Tổng tiền mua · Chi phí · Thao tác |
| TK-2026-10-18-1 | 18/10/2026 · 1trieumail · Chưa ghi · 5 · 2,12 USDT · Đã ghi |
| Chiều cao dòng (1280px) | 57–79px, không kéo ngang; mã đợt 13px |
| Thứ tự | Ngày mua mới nhất trước; cùng ngày, đợt tạo sau đứng trước (-5, -4, -3, -2, -1) |
| VND | 100.000 VND ≈ 3,824019 USDT; số lượng mua 4 (đã nhập 3) |
| Thiếu dữ liệu | Nơi mua, số lượng, tiền và chi phí đều "Chưa ghi"; không lấy số đã nhập để điền; có Ghi chi phí |
| Khoản chi điều chỉnh | Hiện 8,5 USDT; Chi tiết mở ngay dưới dòng với "ban đầu 10 USDT" |
| Khoản chi thu hồi | "Đã thu hồi" và có Ghi chi phí |
| Đã ghi | Mở đúng khoản chi ở Chi phí (dòng được đánh dấu); Back về lịch sử |
| Số Đã nhập kho | Mở đúng 5 tài khoản của đợt, tab Gmail |
| Mã dài (PayPal) | Một dòng, dòng 79px, không kéo ngang |
| Điện thoại 390px | Thẻ có nhãn, trang không tràn ngang |
| Không quyền tiền (dash-staff) | Không có cột Tổng tiền mua, không link Chi phí, không thấy số tiền |
| Hồi quy (`fix-accept.js`) | 80/80: chuyển tab, nháp, xem trước, chọn hàng loạt, bộ lọc, Back, quyền, dự án trống / cũ, theme |

**Kiểm tự động:** 363/363 test, typecheck, lint (0 lỗi), build. Test mới:
- định dạng tiền / ngày kiểu Việt Nam;
- thứ tự đợt cùng ngày;
- số lượng mua không bị tự điền.

## Phát hành

- **Commit:** `319d73d`, không có migration.
- **Backup host trước deploy:** `5bb8822b`.
- **Deploy:** `fa755f77`, SUCCESS.
- **Host verify:** 10 server / 576 VM.
- **Host xem chỉ đọc** (`host-after.txt`, `host-after-1280.png`, `host-after-390.png`):
  - TK-2026-10-18-1: dòng 57px · 18/10/2026 · Gmail · 1trieumail · Chưa ghi · 5 · 2,12 USDT · Đã ghi · Nhập bổ sung.
  - Không kéo ngang ở 1280px; trang không tràn ngang ở 390px.
  - Chỉ xác thực PIN và heartbeat; không ghi dữ liệu.
