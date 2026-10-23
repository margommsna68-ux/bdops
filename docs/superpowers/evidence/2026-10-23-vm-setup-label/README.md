# Chưa cài và phạm vi cài VM — 23/10/2026

- Chủ chốt: lệnh server + danh sách proxy cụ thể; host thật đã sẵn sàng. Danh sách theo thứ tự VM_001…; không tự chạy khi nhập kho.
- Đổi nhãn NEW_VM thành Chưa cài ở bảng/lọc, khung tạo lại và thông báo công việc. Giữ enum, dữ liệu và điều kiện finish-prepare hiện có.
- Hoàn tất thật cần cài máy/proxy/EarnApp/Firefox và lưu SDK lần cài, đọc lại rồi mới NOT_LINKED. Không đăng ký/link tài khoản trong lệnh này.
- Test nhãn: đỏ trước, xanh sau. Hai file vm-ops-rules và ops-vm-work.integration: 17/17 qua; typecheck, lint/build đạt (cảnh báo cũ).
- Lần kiểm tích hợp đầu không chạy được vì PostgreSQL thử 55432 đang tắt. Bật đúng cluster thử, chạy lại 17/17. Không dùng database production cho test.
- Hướng dẫn chung Central được cập nhật, lưu bản cũ và kiểm hash qua SFTP. Không đổi token/config/journal, không chạy VM thật.
- API tạo server/VM hàng loạt từ danh sách proxy chưa được triển khai trong thay đổi nhãn này.
- Backup trước phát hành: moneytohome-20261023-184620.dump; trạng thái triển khai ghi bổ sung khi có kết quả thực.
