# Vận hành VM → rút EarnApp → tiền về PP → tạo lại VM (19/10/2026)

Hướng dẫn dùng: [docs/runbooks/vm-ops-cycle.md](../../../runbooks/vm-ops-cycle.md). Không quay video.

Dữ liệu thử chỉ ở môi trường cục bộ:
- Tạo bằng `.runtime/ops-local-setup.ts`: server `opsx-<tag>`, PP `pp13<tag>` / `pp82<tag>`, email `@example.invalid`, IP 203.0.113.x.
- Đọc lại bản ghi bằng `.runtime/ops-local-probe.ts`.

## Kiểm trên trình duyệt (`result-browser-local.txt`, 50/50)

| Yêu cầu | Kết quả thật |
|---|---|
| **Đổi tình trạng tại ô** | Chọn là lưu ngay, không dialog; ghi người, giờ, cũ → mới. Chọn lại giá trị cũ không ghi lịch sử. Tải lại vẫn giữ. |
| **Màu và chữ** | Mỗi trạng thái có màu riêng kèm chữ (ví dụ LINKED màu xanh dương); có theme tối (ảnh `o1`). |
| **Đổi hàng loạt** | Chọn 3 VM → OFF VM → Áp dụng: 3 VM đổi, mỗi VM một dòng lịch sử. |
| **Không suy ra trạng thái** | VM có SDK, tài khoản, PayPal và proxy đã cài vẫn hiện "Chưa ghi". |
| **Lọc** | Lọc nhiều trạng thái, có số lượng; giữ trong URL; Back / Forward / tải lại mở đúng. Lọc riêng proxy BLOCKED và mốc tiền. |
| **Sort "Cần xử lý trước"** | SUS → proxy BLOCKED → Earn/VM lỗi → OFF → … ; cùng mức thì VM_009 trước VM_010. |
| **24 + 10 + 12** | Ba EarnApp dùng ba email của pp13: sổ 46,00 USD, nhãn "Đang gom · thiếu 54". Sức khoẻ PP vẫn "Dùng được". |
| **82 + chờ 18** | Chỉ "Dự kiến đủ 100 USD" (ảnh `o6`); nhận đủ 18 thì 100,00 USD "Đạt mức gom". |
| **Nhận từng phần** | Yêu cầu 24, nhận 10: sổ +10, còn chờ 14 (không cộng cả 24); chưa có nút tạo lại (ảnh `o3`). |
| **Nhãn tính lại tại chỗ** | Ghi tiền ở Kho tài khoản thì số dư và nhãn đổi ngay, không cần tải lại (71 / chờ 14 / thiếu 29). |
| **Email đã dùng** | pp13 đã cấp hết email nên không được đề xuất. pp82 cũ vẫn chọn được email mới; email đã dùng không hiện. |
| **Tạo lại VM** (ảnh `o4`, `o5`) | Giữ id và mã, mở lượt 2 với New VM; bấm hai lần vẫn một lượt. SDK cũ vào lịch sử. Proxy hợp lệ được giữ, có cấu hình mới chờ cài. EarnApp cũ đóng, Gmail ở trạng thái "Đã dùng". Không phát sinh chi phí. Lịch sử có lượt 1. |
| **Lệnh lượt cũ** | Gửi trạng thái cho lượt 1 sau khi đã tạo lại: bị từ chối ("lượt 2"). |
| **SUS** | Tạo lại không cần tiền; PP mẹ vẫn Dùng được. Yêu cầu cũ vẫn chờ; tiền về muộn gắn vào yêu cầu cũ; lượt mới không thành "Cần tạo lại". |
| **Hai người cùng lúc** | Cùng gán email cuối của pp82: chỉ một yêu cầu được ghi, người kia thấy lý do tại chỗ. |
| **Quyền** (ảnh `o7`) | Nhân viên chỉ có Server/VM thấy mốc tiền, không thấy số tiền. Gọi thẳng `vmOps.gather` không trả tiền; `vmOps.requestPayout` bị chặn (FORBIDDEN). |
| **Laptop 1280** | Trang không tràn ngang; bảng cuộn ngang trong khung; cột Tình trạng cố định khi cuộn (ảnh `o8`). Không có lỗi JavaScript. |

Lỗi tìm ra khi kiểm và đã sửa trước khi phát hành:
- Popover Rút tiền tràn khỏi màn hình nên nút Lưu không bấm được.
- Bấm ô ngay sau khi lưu thì mở lại form yêu cầu cũ.
- Nhãn gom ở Kho tài khoản không tính lại sau khi ghi tiền.

## Hồi quy

- **Trình duyệt** (`regression-browser.txt`):
  - PayPal email / sổ: 30/30. Kịch bản cũ được sửa để chỉ so số dư, vì ô số dư nay có thêm nhãn gom.
  - Kiểm độc lập: ô tiền trống, phí, tỷ giá, khoảng ngày: 24/24.
  - Luồng 18/10: 80/80.
  - Phí bên nhận: 11/11.
  - Lịch sử nhập kho: 17/17.
- **Test:** 401/401.
  - Mới: `vm-ops.integration.test.ts` (13), `vm-ops-rules.test.ts` (5); cập nhật `vm-grid-model.test.ts` và bộ giả lập trong `vm-sdk-ui.test.tsx`.
  - `registry-copy.integration.test.ts` một lần lỗi ngẫu nhiên khi chạy song song như trước; chạy riêng và chạy lại toàn bộ đều qua.
- **Typecheck, build:** qua. **Lint:** không có lỗi mới; còn cảnh báo cũ ở `agent-pp`.

## Chưa kiểm / giới hạn

- **Host:** chỉ xem đọc, không ghi dữ liệu ví dụ. Host chưa có PayPal và EarnApp, nên luồng tiền và tạo lại chỉ kiểm trên dữ liệu thử cục bộ.
- **Cấu hình proxy giữ lại:** cần cài và xác nhận lại ở lượt mới. Bước xác nhận dùng luồng cài hiện có.
- **Proxy BLOCKED khi tạo lại:** web để nguyên cấu hình cũ cho luồng thay proxy; bản cài cũ vẫn hiện "Đã cài" cho tới khi thay.
- **Endpoint cho AI:** dùng chung `vmOps.*` với phiên đăng nhập; chưa có token riêng (ngoài phạm vi đợt này).
