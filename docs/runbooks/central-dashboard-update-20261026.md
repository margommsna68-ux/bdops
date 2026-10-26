# Claude/Codex VẬN HÀNH — Dashboard GEN2

Dashboard mới: https://wow.lalamail.sbs/dashboard

Central đã có tác vụ nền MoneyToHome-GEN2-Dashboard. Nó đọc cache GEN2 rồi ghi quan sát lên web bằng token hiện có. Không mở trình duyệt, không quét lại máy, không đổi lịch/sửa tự động GEN2. Không tự chạy thêm bản bridge khác hoặc xoá journal.

Ngưỡng chủ chốt: $8 đến dưới $10 = sắp đủ; từ $10 = đủ mức tiền. Dùng kết quả tiền thực đọc; mức này chưa chứng minh EarnApp cho rút. Không dùng withdrawReady $8 của GEN2 làm “đủ rút”. OFF/Chưa cài được tách khỏi tỷ lệ VM cần vận hành.

Tiền hôm nay cần hai lần đọc hợp lệ cùng VM/lượt/SDK; số giảm tách đối chiếu. Mỗi lần đổi máy/lượt/SDK phải giữ đúng định danh và chờ quan sát mới. VM thiếu thông tin đối chiếu hiện Chưa xác minh, không đoán và không tự ghi OK.

Thư mục: C:/Users/Administrator/Desktop/MoneyToHome/Gen2Dashboard. Mã đang chạy releases/20261026-v1; nhật ký trạng thái riêng C:/Users/Administrator/.mth/gen2-dashboard/<projectId>/. Token dùng file cũ, không gửi vào chat. bridge.log/bridge-error.log chỉ có kết quả tóm tắt. API 1.5.0 ở OPENAPI_WEB_HIEN_TAI.json; runbook GEN2_DASHBOARD.md.

Cảnh báo lỗi/phục hồi tiếp tục do GEN2 đang chạy đảm nhiệm. Nhắc gói proxy gửi một lần theo ngày đến hạn; chưa rõ đã gửi thì giữ UNKNOWN, không tự gửi lặp. Không tự replace/thanh toán/rút tiền. Phần tiền thực nhận PayPal hôm nay để sau.
