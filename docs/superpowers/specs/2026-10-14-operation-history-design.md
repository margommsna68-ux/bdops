# Lịch sử thao tác, hoàn tác và sao lưu

## Quyết định đã chốt

Anh chọn hoàn tác từng thao tác và thêm bản sao dự phòng toàn hệ thống. Tiếp tục triển khai tuần tự trong worktree hiện tại, dữ liệu mẫu trước. Giao diện ít màu, ba thao tác chính Nhập mới / Báo BLOCKED / Nhận replace; thao tác bình thường dán rồi Kiểm tra và lưu, có lỗi phải dừng để xem.

## Nhật ký và hoàn tác

Mỗi lần commit proxy, thay gói hoặc quyền nhân viên lưu một OperationJournal trong cùng Serializable transaction: dự án, người, giờ ghi, mô tả không chứa secrets, ảnh trước/sau mã hoá, tham chiếu thao tác bị hoàn tác. Bản ghi cũ không có ảnh trước chỉ xem được. Copy và quét nguồn có audit nhưng không hoàn tác sự kiện thực tế.

Quản lý ADMIN của đúng dự án được hoàn tác. Trước khi ghi, đọc lại quyền, so toàn bộ trường đã ghi và revision/updatedAt với ảnh sau; kiểm tra VM đang liên kết. Một thay đổi tiếp theo ở bất kỳ dòng nào làm toàn bộ hoàn tác thất bại. Hai yêu cầu cùng lúc chỉ tạo một bản hoàn tác; gửi lại trả cùng kết quả. Không lấy dữ liệu ảnh trước từ client.

BLOCKED khôi phục trạng thái/ngày trước và đánh dấu event đó đã hoàn tác. NEW/SHEET không xoá định danh IP hay credentials lịch sử: endpoint mới được thu hồi, retire và QUARANTINED; lịch sử tiếp tục phát hiện IP nhà cung cấp gửi lại. REPLACE khôi phục endpoint cũ, thu hồi endpoint mới và ghi receipt VOID; cạnh replace, RECEIVED và owner Genjy luôn còn. Không tự thay cấu hình VM. Event blocked đã hoàn tác không cản cấp, nhưng RECEIVED và IP đã thấy vẫn cản nhập lại. Gói/quyền hoàn tác ảnh trước nếu tài nguyên liên quan chưa đổi; gói mới tạo được disable, không xoá. Không đảo owner/subgroup, revision chỉ tăng.

## Sao lưu toàn hệ thống

Sao lưu database ứng dụng đầy đủ (mọi module, user, lịch sử, migration), không phải cả PostgreSQL cluster/server. Chỉ tài khoản chủ hệ thống cấu hình bằng SYSTEM_OWNER_USER_ID trên server được tạo/xem thông tin backup; ADMIN một dự án không có quyền này mặc định. Không trả database dump qua API web.

pg_dump custom format đọc snapshot nhất quán, đưa stdout qua AES-256-GCM bằng BACKUP_ENCRYPTION_KEY riêng; không ghi dump plaintext, password không nằm trong process args/log. File ghi độc quyền tên UUID, metadata checksum/schema/app version, file thành công mới xuất hiện trong danh sách. Lưu thư mục BACKUP_DIRECTORY trên server; local dùng D. Khóa mã hoá ứng dụng ENCRYPTION_KEY và khóa backup phải được giữ riêng an toàn, không kèm backup/DTO. Chưa coi backup trên cùng ổ là bảo vệ mất máy; bản Railway cần storage độc lập trước vận hành thật.

Khôi phục thử qua CLI vào database mới, local riêng, trống và tên proxy_restore_*; từ chối database đang phục vụ app/test và không có --clean/--create. Xác thực GCM/checksum trước khi gửi dữ liệu vào pg_restore. Không có nút ghi đè database đang chạy. Kiểm tra số bảng/rows và giải mã một credentials mẫu từ bản phục hồi. Không đặt lịch tự động trong mốc này.

## Giao diện và nghiệm thu

Nút Lịch sử thao tác mở một danh sách ai/lúc nào/làm gì và Hoàn tác kèm lý do. Trước khi xác nhận hiển thị ảnh trước/sau rút gọn không chứa credentials. Kho mới và LIVE màu trung tính; đỏ dành cho BLOCKED, tím nhỏ cho chưa gán; Gói và Quyền nằm trong Thiết lập.

Tests phải chứng minh quyền/dự án, atomic rollback, conflict sau edit/VM bind, replay, Genjy bất biến, recycled IP vẫn bị chặn, undo BLOCKED tái dùng được NEW, catalog/member guards, backup privilege/authentication/failure cleanup và một vòng backup/restore thực. Sau đó kiểm tra trình duyệt và build. VM/gán/cài là mốc riêng; modules tài chính chưa có undo không được quảng cáo là đã hoàn tác được.
