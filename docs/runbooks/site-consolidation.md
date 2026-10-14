# Rà cấu trúc site và thứ tự hợp nhất

14/10/2026. Bảng dưới ghi nhận cấu trúc trước khi hợp nhất. Mốc proxy và Server/VM hiện đã hoàn thiện trên bản local thử; chưa phải chứng nhận toàn bộ business hoặc vận hành dữ liệu thật.

| Phần đang có | Vấn đề thực tế | Cách hợp nhất |
|---|---|---|
| Dashboard cũ | Chưa phân nhánh PROXY_VM; vẫn có finance/PayPal/Agent PP | Dashboard cá nhân chỉ số NEW/BLOCKED, VM thiếu, chờ cài, cần kiểm tra |
| Máy chủ | UI gán proxy/Gmail và billing cũ; writer proxy/VM đã bị chặn trong PROXY_VM | Màn riêng Server/VM dùng reservation + cấu hình chờ cài; các dự án cũ giữ màn riêng |
| /infrastructure/vms | Đây là màn vòng rút EarnApp, không phải VM cá nhân | Route VM mới rõ nghĩa, sửa thông báo đang trỏ nhầm vào màn EarnApp |
| /vm-tasks | Công việc kiểu cũ, chưa version cấu hình/xác nhận cài/audit đủ | Việc cài liên kết đúng desired version, người/giờ xác nhận, không copy secrets nếu thiếu quyền |
| /history, /audit-log, lịch sử IP | Nhiều nguồn lịch sử, history chung chỉ 30 ngày/200 entries; undo cũ không guarded | OperationJournal là nền ghi/undo mới, IP timeline giữ provenance; header/Sidebar đưa về màn Lịch sử phù hợp businessMode |
| Dự án/thành viên | UI dự án chưa có lựa chọn cá nhân rõ; quyền proxy đã có panel riêng | Tạo workspace PROXY_VM rõ ràng, quyền xem/thao tác/quản lý và capability copy/import/replace chung |
| Sheet/final/Genjy | Snapshot cũ không phải nguồn live migration | Quét nguồn mới, preview đối chiếu owner/gói/VM, xem chênh lệch trước cutover |
| Railway/runtime | Chưa đăng nhập đúng target; Next/Auth/SheetJS baseline còn advisories | Nâng dependency có kiểm thử, backup storage riêng/restore test, cấu hình host và TLS/auth trước dữ liệu thật |

Đã thực hiện ba phần đầu: Server/VM giữ occupancy và desired/installed riêng; việc cài xác nhận đúng phiên bản; dashboard/nav/thông báo/lịch sử dùng chung dữ liệu. Các page legacy được giữ nguyên và chỉ mount khi dự án không ở chế độ PROXY_VM. Copy/import/replace và các đường ghi cũ được kiểm tra ở backend. Suite 135 tests/31 files, types/build qua; lint còn bốn cảnh báo hook cũ. Hướng dẫn thao tác ở personal-vm.md.

Thứ tự còn lại: (4) chuyển dữ liệu Sheet mới và nghiệm thu; (5) host Railway + backup độc lập; (6) business nối tài khoản, chi phí/thu nhập/lợi nhuận. Trang tạo dự án/quản trị và các module business cũ vẫn cần lượt hợp nhất sau; bản thử dùng workspace PROXY_TRIAL đã cấu hình rõ. Không xoá các module tài chính cũ để làm giao diện cá nhân.

Nâng cấp sau vận hành: backup tự động/retention và cảnh báo lỗi; đối chiếu cấu hình máy thực với desired; tìm kiếm toàn hệ thống; xuất báo cáo chi phí proxy/server; tổng hợp lợi nhuận theo dự án. Chỉ thêm khi giúp thao tác thật, tránh màn hình thừa.
