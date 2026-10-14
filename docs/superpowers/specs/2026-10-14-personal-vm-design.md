# Server/VM cá nhân và xác nhận cài

## Phạm vi đã được anh duyệt

Tiếp tục bản local, toàn bộ VM trong dự án được cấp quyền. Gán trên web là giao cấu hình; người vận hành cài thật rồi xác nhận. Chỉ NEW chưa dùng của anh được tự điền ô VM trống; không Genjy/PC chung, không công thức/placeholder/giá trị chưa rõ. Không ghép theo tên với Bright Data cũ. Giao diện ít màu/ít bước, lịch sử và khả năng sửa sai rõ ràng.

## Dữ liệu và sự thật vận hành

Tái dùng Server/VirtualMachine/VMTask, thêm marker managed, archivedAt, revision và classification ô proxy. Legacy mặc định UNRESOLVED, tạo VM trống trên web ghi BLANK có nguồn MANUAL. Giữ sourceRef/original cipher cho dữ liệu Sheet về sau.

VMConfiguration là phiên bản có project/VM/version, endpoint, snapshot credentials mã hoá bất biến, hash, người/giờ giao, PLANNED/IN_PROGRESS/FAILED/CONFIRMED/CANCELLED và người/giờ xác nhận. VM giữ desiredConfigurationId và installedConfigurationId riêng; VirtualMachine.proxyId chỉ là projection proxy đã xác nhận cài. configurationSequence/revision chỉ tăng.

VMProxyAllocation giữ occupancy toàn hệ thống theo allocationKey, VM/endpoint/config nguồn, vai trò DESIRED/INSTALLED/UNCERTAIN, ngày/người giữ và releasedAt/lý do. Unique active allocationKey toàn hệ thống, một DESIRED và một INSTALLED mỗi VM; UNCERTAIN có thể nhiều. Không unique mọi active vmId vì đổi A→B cần giữ A đã cài đồng thời đặt B chờ cài. FKs Restrict lịch sử; chỉ archive, không delete. DB trigger đảm bảo project/VM/endpoint và các config pointer cùng tài nguyên.

## Giao proxy

Router vmManagement riêng, writer vm/proxy cũ vẫn bị chặn. Create server + danh sách mã VM trống rõ ràng; thêm VM vào server đã chọn; sửa metadata/archive có nhật ký. Xem/list DTO chỉ fields cần thiết, không trả ciphertext hay raw credentials.

previewAllocation(scope, input) cho AUTO hoặc MANUAL, bind actor/project/payload/source hash/revisions/token 10 phút/idempotency. AUTO chỉ slot BLANK, chưa có desired/installed/active hold, server/VM không archive. MANUAL chọn endpoint NEW đủ điều kiện, được đổi cả VM đã cài. Cho phép giao lại endpoint đang INSTALLED đúng VM đó để tạo việc quay lại cấu hình đã biết; không lấy LIVE của VM khác. Refresh Genjy ngoài SQL; commit replan trong Serializable, bounded retries như kho. Lỗi nguồn chặn giao, không coi list rỗng.

Giao B tạo occupancy DESIRED, config phiên bản mới và VMTask; giữ installed A/proxyId. Bump endpoint revision khi giữ/thả để stock undo nhìn thấy dependency. Giao cấu hình mới sau khi một cấu hình trước đã bắt đầu/FAILED chuyển hold trước thành UNCERTAIN, không thả proxy có thể đang dùng thực tế. Cấu hình trước còn PLANNED có thể cancel/thả khi giao cấu hình mới. UI nêu rõ các proxy vẫn được giữ.

## Cài thật và xác nhận

Copy để cài dùng capability COPY_CREDENTIALS, snapshot đúng config hiện hành, audit và đánh dấu đã bắt đầu; có Bắt đầu cài riêng nếu nhận cấu hình qua người quản lý. Sau khi bắt đầu, thường không thể undo kế hoạch vì trạng thái máy có thể đã thay đổi. Báo lỗi giữ mọi hold.

confirmInstalled(scope,{configurationId,configurationHash,expectedVmRevision}) cần CONFIRM, config đúng desired hiện hành/hash, startedAt, project/VM khớp và nguồn/owner đủ điều kiện. Không cho phiên bản cũ hoàn thành phiên bản mới. Atomically chuyển installed pointer/proxyId sang B, role INSTALLED và LIVE chỉ nếu health hiện tại NEW; không xoá BLOCKED/DIE để giả mạng tốt. Giải phóng A và các hold không còn dùng trên cùng VM sau xác nhận. Giữ thông tin cài/nhận trong lịch sử; proxy đã cài không quay về pool NEW. Owner conflict Genjy báo kiểm tra và giữ hold, không âm thầm cấp.

## Nhật ký/hoàn tác

Mở rộng encrypted OperationSnapshot, đọc được version 1 cũ. VM_PLAN mới chưa bắt đầu được undo khi mọi VM/config/allocation/task/endpoint còn đúng ảnh sau: cancel task/config mới, release pending hold, khôi phục desired trước; installed không đổi, sequence/revision không giảm. Nếu đã copy/bắt đầu/báo lỗi/xác nhận thì chặn ordinary undo. INSTALL_START/FAILED/CONFIRMED ghi read-only operation; quay cấu hình đã cài là giao một phiên bản mới và xác nhận mới, không sửa lịch sử vật lý. Metadata mới có before/after; tạo VM/server undo archive tài nguyên nếu chưa có dependency. Hiển thị lý do không undo được.

## Hợp nhất site

Màn managed riêng dưới route servers/servers[id], dashboard, vm-tasks; wrapper chỉ mount legacy child khi businessMode khác PROXY_VM. /infrastructure/vms là EarnApp cũ, managed đưa về danh sách VM. Sidebar: Tổng quan, Proxy, Server/VM, Việc cài, Lịch sử, Thiết lập/quản trị. Header history và thông báo managed đưa đúng màn. Không xoá finance/PayPal/Gmail/business cũ.

Kho proxy/timeline nhận vị trí từ allocation: Chờ cài, Đã cài, Đang giữ; không hiển thị B chưa gán trong lúc đã reserve, hoặc A chưa dùng chỉ vì đã replace. VM/server có chỉ số thiếu/chờ cài/đã xác nhận/lỗi, blue chỉ vị trí vừa được giao; đỏ health BLOCKED. Không tự gọi VM OK chỉ vì có proxy.

Đóng bypass vmTask hoàn thành/deletion trực tiếp cho managed install task; editHistory.revert cũ không được sửa Server/VirtualMachine/Project managed. MANAGE fresh scope cho tạo/metadata/archive; ASSIGN/CONFIRM operator toàn dự án. Không giới hạn assignee; module/copy capability vẫn kiểm tra.

## Nghiệm thu

TDD integration: literal blank; source failure; Genjy/unknown không cấp; competing holds; switch giữ A trước confirm; old-version/hash/revision và foreign IDs không ghi; operator toàn dự án; copy quyền; fail giữ holds; plan undo trước/không sau start; stock undo thấy reservation; all-or-none rollback/replay. Browser: tạo máy/VM mẫu, autofill, copy/cài/confirm, blocked/replace không tự đổi máy, lịch sử, dashboard/nav phù hợp. Build/types/lint/suite và một lượt review toàn mốc. Không real Sheet migration/Railway/public deploy trong mốc này.
