# Thiết kế kho proxy cá nhân trên nền BDOps

## Phạm vi

Triển khai nền thử và kho proxy: nguồn/ownership, gói credentials, nhập mua mới, blocked hàng loạt, replace theo cặp, tìm lịch sử, đối chiếu Sheet và quyền thao tác. Đây là phần đầu của chương trình tích hợp proxy/VM/business; gán VM mới và xác nhận cài là subsystem tiếp theo.

Căn cứ: `../../../../docs/01-HIEU_DU_AN.md`, `../../../../docs/03-KE_HOACH_TRIEN_KHAI.md` và source Sheet trong `../../../../proxy-sheet/`. Nhân viên thao tác toàn bộ VM của dự án đã cấp quyền, theo xác nhận 14/10/2026.

## Kiến trúc

Dùng Next.js/tRPC/Prisma hiện tại; server-side domain module `src/server/proxy-management/` chứa parser, policy, truy vết nguồn, preview/commit và kho. Client không tự quyết định điều kiện cấp hay đổi owner. PostgreSQL giữ dữ liệu chính của web; các snapshot Sheet giữ provenance và phục vụ nhập/đối chiếu. Không bê nguyên Apps Script 679 KB vào frontend.

Mỗi IP có định danh chuẩn toàn hệ thống nội bộ của anh. ProxyIP hiện tại được mở rộng theo endpoint, gói và credentials mã hoá; owner nằm trên định danh IP, không nằm trong status hay tên VM. Không bổ sung mô hình khách hàng SaaS/multi-organization trong bản đầu.

## Quy tắc định danh và dữ liệu

- IPv4 nhận ở dạng bare hoặc `IP:port:user:pass`. Chuỗi cũ lưu riêng để đối chiếu; dữ liệu nhập mới tách trường. Port 1–65535. Các dạng không hỗ trợ phải có lỗi, không đoán.
- Định danh chống hàng gửi lại mặc định theo IP, không theo nguyên chuỗi credentials. Ngoại lệ port stream dùng allocation policy được quản lý duyệt, gắn bằng chứng; không cho người nhập đổi policy để né kiểm tra.
- `ProxyIdentity`: ip String @unique @db.Inet; owner SELF/GENJY/UNKNOWN; subgroup PC_CHUNG hoặc null; allocationMode SINGLE_IP/APPROVED_PORT_STREAM; revision; thời điểm đã thấy.
- `ProxyIP`: endpoint trong dự án; identityId, port, encrypted credentials, packageCode, inventoryState NEW/LIVE/BLOCKED/REPLACED/DIE/QUARANTINED, revision. Status AVAILABLE/IN_USE/… cũ chỉ còn projection tương thích, không được dùng làm tiêu chí cấp.
- `ProxyProviderAccount`: project, code/label và credentials mã hoá; catalog được đọc/decrypt trên server khi nhận diện gói.
- `ProxySourceReference`: nguồn workbook/tab/row/cell, bare/full, snapshotId, resolved identity/endpoint; Genjy bare không được tự phát minh credentials.
- `ProxyStatusEvent`: loại trạng thái, occurredAt, recordedAt, actor, lý do và nguồn. Ngày cũ không rõ giữ null; không lấy ngày nhập làm ngày nhận từ nhà cung cấp.
- `ProxyReplacement`: old/new endpoint, owner snapshot, receivedDate (ngày địa phương hoặc null), recordedAt UTC, batch/actor; không xoá cạnh khi huỷ, dùng trạng thái VOID.
- `ProxyBatch`: project, kind, idempotencyKey, payloadHash, preview/source revision, trạng thái, kết quả từng dòng và thời điểm ghi. Cùng key khác payload bị từ chối.
- `ProxySourceSnapshot`: nguồn, hash, fetchedAt, scanSucceeded, metadata; toàn bộ source refs và kết quả giải quyết ownership được giữ.
- Dùng encryption AES-256-GCM hiện có; raw credentials trong history/source snapshot cũng phải mã hoá. DTO và audit không đưa password/token ra mặc định.

Trong chuyển đổi, endpoint chưa đủ thông tin nằm QUARANTINED hoặc nguồn bare-only; dòng lịch sử không tính là hàng đang có để cấp. `final` trở thành projection của inventory hiện hành, không phải bản dữ liệu thứ hai được sửa độc lập.

## Sở hữu và điều kiện cấp

GENJY không tự chuyển về SELF dù nguồn sau không còn IP; proxy thay thế thừa kế Genjy. PC_CHUNG là subgroup Genjy. UNKNOWN không được dùng. Quét Genjy gồm mọi tab/ô có IP, kể cả sheet ẩn và IP viết tắt, đồng thời nạp các quyết định truy vết đã được xác nhận trong state Sheet; không suy owner từ ghi chú Total cũ đã được giải quyết.

Autofill ở subsystem VM chỉ dùng SELF + NEW, không current VM/reservation, không history/risk conflict. Ngoại lệ PC/moon đã xác nhận được giữ như assignment lịch sử/ngoại lệ nhập; không mở quyền autofill Genjy mới.

Khi nguồn Genjy không quét được: vẫn xem kho, báo BLOCKED và copy danh sách blocked được; chặn NEW/REPLACE nhận vào nguồn khả dụng và autofill đến khi quét thành công. Không coi lỗi fetch là list rỗng.

## Các luồng

### Nhập mới

Dán full proxy; chọn nguồn/owner; parser + catalog + current/history + source Genjy đưa từng dòng vào READY/SKIP/ERROR. READY mới được commit. IP viết tắt chưa đủ credentials không được nhập mua mới bằng cách đoán gói.

### Báo BLOCKED

Bare IP tìm một endpoint hợp lệ; nếu nhiều endpoint port stream thì yêu cầu full proxy để xác định, không đánh đồng cả IP. Proxy không tìm thấy/mơ hồ báo ERROR. Dòng đã BLOCKED giữ timestamp cũ và SKIP. Ghi trạng thái/nhật ký cùng transaction; blocked mới tô đỏ ngay sau cập nhật.

### Nhận replace

Hai ô cũ/mới; hỗ trợ provider message có Removed/Added, chữ hoa, Markdown, Updated. Check please, backslash do trình bày. Nếu token full hợp lệ thì giữ password nguyên trạng trước khi bỏ markup. Dòng N ghép dòng N. Count mismatch/heading lặp giữa list lỗi toàn đợt.

IP cũ phải tìm đúng một full endpoint, đang BLOCKED; IP mới bare lấy credentials của cặp cũ, full giữ nguyên. Lặp lại chính xác một receipt cũ là SKIP. IP mới đã có full/current VM/blocked/replace/history/received-before bị chặn, kể cả thay credentials.

Ngoại lệ cùng Genjy bare-only: old/new cùng một owner/subgroup, mọi bằng chứng new là bare, không current VM, full inventory, lịch sử xấu/replace/nhận trước, ghi chú/manual status/date chưa hợp nhất hoặc owner mơ hồ. Chỉ hoàn thiện và giữ Genjy; không mở ngoại lệ các cảnh báo khác.

Commit tạo endpoint mới, retire endpoint cũ, cạnh replace + health events + owner propagation và inventory projection trong cùng transaction. Không tự cài máy hoặc đổi cấu hình VM. VM đang dùng endpoint cũ vẫn cần việc xử lý ở subsystem VM.

### Lịch sử và copy

Tìm cả IP hiện hành/lịch sử. Panel hiển thị A→B→C, nguồn, ngày nhận/ngày ghi, status và vị trí VM đã ghi nhận. Copy blocked xuất ba cột Gói/Full proxy/BLOCKED cho người có quyền copy; không gửi tới nhà cung cấp tự động.

## Giao dịch và API

Preview trả token gắn với payload hash, actor/project, endpoint/identity revision và hash nội dung source snapshot. Quét lại nội dung giống nhau cập nhật scan time, không làm preview stale chỉ vì fetchedAt/snapshot ID đổi. Commit kiểm tra lại quyền, current/history và nguồn, không tin READY của client. Nguồn được fetch trước SQL transaction; không gọi Google hay nhà cung cấp bên trong transaction.

Serializable transaction và unique keys xử lý concurrent writes. Chỉ retry P2034 tối đa 3 lần; retry vẫn kiểm tra cùng batch key. P2002 hoặc stale revisions trả CONFLICT với kết quả cần preview lại. Không retry vô hạn hoặc chuyển mọi lỗi thành duplicate.

API mới là `proxyManagement`; các endpoint writer cũ update/assign/unassign/autoAssign/bulkImport/delete/bulkDelete và writer proxy trong vm.ts phải đi qua policy chung hoặc bị chặn PRECONDITION_FAILED trong workspace PROXY_VM cho đến subsystem VM hoàn tất. Không để nút cũ bypass owner/status/history.

## Quyền

Giữ ADMIN/MODERATOR/USER; thêm VIEWER. ADMIN/MODERATOR quản lý kho khi có module; USER được xem/toàn dự án, báo blocked và làm việc VM, import/replace theo capability được quản lý bật; VIEWER chỉ query. Credentials copy là capability riêng. Backend kiểm tra module + operation + resource project; giới hạn query list/history theo dự án. Không trả locations/credentials của dự án ngoài quyền khi phát hiện IP đã có.

Project.settings.businessMode = PROXY_VM điều khiển navigation bản đầu; không cần xoá module tài chính. Sidebar tập trung Tổng quan/Proxy/Server-VM/Việc cài/Quản trị. Chưa ánh xạ tự động dữ liệu cá nhân vào các dự án BD cũ.

## Nghiệm thu

1. Cùng IP khác credentials bị nhận ra; nguồn Genjy và UNKNOWN không vào nguồn cấp.
2. Ví dụ của anh chỉ nằm trong test, không thành đợt ghi dữ liệu thật.
3. Bare/full, cặp sai, replay, Genjy bare completion và manual metadata có kết quả đúng.
4. Hai commit cạnh tranh không tạo hai proxy hiện hành cho cùng receipt/IP; lỗi giữa transaction không để dữ liệu dở dang.
5. Người chỉ xem gọi trực tiếp mutation bị chặn; IDs từ dự án khác không gây thay đổi.
6. UI thấy rõ hiện hành/lịch sử/Genjy; không dùng một status để thể hiện đồng thời sở hữu, allocation và mạng.
7. Migrations chạy lại an toàn trên database thử mới; cấu hình production không có db push --accept-data-loss.

## Điểm nối subsystem VM/business

Subsystem VM tiêu thụ `getEligibleInventory(projectId)` và tạo reservation bằng allocationKey được cấp từ identity policy, không tự lọc AVAILABLE. Thêm bảng Allocation + các partial unique indexes cho active allocationKey/active vmId; ghi desired version và confirmed version, liên kết VMTask. Nhân viên có quyền thao tác toàn bộ VM trong dự án. Business tái sử dụng project/server/account/cost của BDOps sau khi vận hành proxy/VM ổn.

