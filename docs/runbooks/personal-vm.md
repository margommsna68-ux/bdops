# Vận hành proxy và VM trên bản web thử

Ngày kiểm tra: 14/10/2026. Nền BDOps, branch `feat/proxy-inventory`. Bản thử local tại http://localhost:3010/dashboard dùng database `proxy_app_trial` riêng và dữ liệu mẫu. Chưa nhập Sheet thật, chưa triển khai Railway.

## Thao tác hằng ngày

1. **Quản lý proxy:** nhập mới, báo BLOCKED hoặc nhận replace. Nhập replace theo hai ô cũ/mới; dòng N ghép dòng N. IP mới viết tắt lấy port/user/pass của cặp cũ. Kiểm tra IP hiện hành/lịch sử và nguồn Genjy trước khi lưu.
2. **Server / VM:** thêm server cùng mã VM rõ ràng. Bấm **Điền VM thiếu** để giao NEW chưa dùng của anh vào ô trống thật sự; Genjy, công thức, placeholder và dữ liệu chưa rõ được giữ nguyên. Nếu thiếu proxy, xem danh sách rồi bấm lưu phần đủ điều kiện; những VM còn thiếu vẫn được báo.
3. **Việc cài proxy:** mở VM, bấm **Copy để cài**, cài trên máy thật rồi đánh dấu đã cài đúng proxy và bấm **Xác nhận đã cài**. Nếu vướng mắc, bấm **Cài chưa xong** và ghi lỗi. Proxy vẫn được giữ cho VM.
4. **Đổi proxy:** tại dòng VM, chọn NEW chưa dùng. Web giữ proxy đã cài và proxy mới được giao cùng lúc, đến khi xác nhận đã thay xong. Khi cần quay lại cấu hình đang cài, giao lại cấu hình ấy thành phiên bản mới và xác nhận mới.
5. **Lịch sử thao tác:** xem người/ngày giờ và dữ liệu trước/sau. Quản lý chỉ hoàn tác kế hoạch chưa bắt đầu khi chưa có thao tác sau thay đổi dữ liệu. Đã copy/bắt đầu/cài thì dùng một cấu hình mới, không xoá lịch sử vật lý.

Xanh đậm đánh dấu VM đã giao proxy và đang chờ cài; đỏ là proxy BLOCKED. LIVE là tình trạng được ghi nhận, không phải kiểm tra kết nối tự động. Owner Genjy/PC chung giữ nguyên qua toàn bộ vòng đời.

Copy từ dòng kho bị chặn với proxy đang giữ cho managed VM. Copy cấu hình đúng phiên bản tại Việc cài; copy proxy đã xác nhận cài tại Server/VM. Proxy từng bắt đầu cài rồi bị thay sang proxy khác được đưa vào Cần kiểm tra, không quay lại pool NEW chưa dùng.

## Phạm vi quyền và bảo vệ

Nhân viên được thao tác toàn bộ VM trong dự án đã cấp quyền; quyền copy/import/replace tách riêng. Viewer chỉ xem. API kiểm tra quyền từ database và tài nguyên thuộc dự án, không tin nút trên giao diện.

Managed markers bảo vệ cả khi settings dự án bị đổi: đường đọc server cũ không trả ciphertext/VM thô; các writer server/VM/task/deletion cũ không được bỏ qua cấu hình và lịch sử. DB giữ unique active allocationKey, desired/installed độc lập và snapshot cấu hình bất biến.

## Bằng chứng kiểm tra

- Suite 135 tests / 31 files, types và production build; lint còn 4 cảnh báo hook có sẵn ở agent-pp.
- Concurrency, rollback, fresh owner/source/capability, foreign IDs, phiên bản/hash, safe undo và các đường bypass cũ có integration tests.
- Browser: chỉ 3 ô BLANK được fill, 3 ô formula/placeholder/unresolved được giữ; copy/start/confirm đúng phiên bản; đổi proxy giữ cấu hình đã cài; hoàn tác kế hoạch chưa bắt đầu; thêm server và 3 VM qua UI; shortage preview 2 đủ/1 thiếu, lưu phần đủ vẫn báo thiếu 1.
- Một lượt review độc lập toàn mốc. Bốn lỗi Important và lỗi chọn endpoint theo IP đã sửa với regression RED→GREEN, không review lặp lại.
- Bản sao dự phòng mã hoá và khôi phục database thử riêng được kiểm tra lại sau schema VM; bằng chứng chi tiết ở operation-history-backup runbook/log riêng.

## Trước khi vận hành dữ liệu thật

Lấy Sheet/Genjy hiện hành, nhập thử có provenance, đối chiếu kho–VM–final và ngoại lệ. Chốt web là nơi sửa chính để tránh hai nguồn cùng ghi. Railway cần target mới/đúng dự án, phiên CLI, biến môi trường riêng, migration deploy và backup trên nơi lưu độc lập; không dùng URL host cũ chưa xác minh. Các cảnh báo bảo mật dependency có sẵn cần xử lý trước public release.

## Phần business tiếp theo

Nền project, thành viên, server, VM và nhật ký đã dùng chung. Các module finance/PayPal/Gmail cũ giữ nguyên trong LegacyPage, không tự map dữ liệu cá nhân theo tên server. Bước tiếp theo là liên kết gói proxy/server với chi phí, tài khoản thực sự chạy VM và doanh thu/lợi nhuận; cần dùng cùng định danh và lịch sử, không tạo thêm kho độc lập. Chưa coi những module cũ là quy trình business proxy đã hoàn thiện.
