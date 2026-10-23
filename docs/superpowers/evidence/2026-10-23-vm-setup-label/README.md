# Chưa cài và phạm vi cài VM — 23/10/2026

- Chủ chốt: lệnh server + danh sách proxy cụ thể; host thật đã sẵn sàng. Danh sách theo thứ tự VM_001…; không tự chạy khi nhập kho.
- Đổi nhãn NEW_VM thành Chưa cài ở bảng/lọc, khung tạo lại và thông báo công việc. Giữ enum, dữ liệu và điều kiện finish-prepare hiện có.
- Hoàn tất thật cần cài máy/proxy/EarnApp/Firefox và lưu SDK lần cài, đọc lại rồi mới NOT_LINKED. Không đăng ký/link tài khoản trong lệnh này.
- Test nhãn: đỏ trước, xanh sau. Hai file vm-ops-rules và ops-vm-work.integration: 17/17 qua; typecheck, lint/build đạt (cảnh báo cũ).
- Lần kiểm tích hợp đầu không chạy được vì PostgreSQL thử 55432 đang tắt. Bật đúng cluster thử, chạy lại 17/17. Không dùng database production cho test.
- Hướng dẫn chung Central được cập nhật, lưu bản cũ và kiểm hash qua SFTP. Không đổi token/config/journal, không chạy VM thật.
- API tạo server/VM hàng loạt từ danh sách proxy chưa được triển khai trong thay đổi nhãn này.
- Backup trước phát hành: moneytohome-20261023-184620.dump; trạng thái triển khai ghi bổ sung khi có kết quả thực.

## Triển khai thực tế

23/10/2026 18:51 Bangkok: Windows chấp thuận lần mở lại; deploy thành công, build rXZZwpQbQIXxLnytV_xNw. Không migration. Health và manifest bản mới qua tên miền trả 200, me không token trả 401. Nhãn trong client compiled được giải mã escape và xác nhận Chưa cài. Lần tìm nguyên văn đầu không khớp vì bundler dùng escape hex cho chữ à, không phải lỗi sản phẩm. Snapshot trước/sau cùng fingerprint 572d8a6c957901b3eff7bfeac02a3361429e8fcc3419a3351b213381d462857b (11 server/678 VM/486 SDK/1463 proxy). Chưa kiểm giao diện bằng phiên đăng nhập trong đợt nhãn này.

Chủ nhắc moon007 chỉ là ví dụ; tên vận hành moon1 không được tự alias sang server-01. Máy chạy web và server VM được định danh riêng; không đổi tên dữ liệu.
