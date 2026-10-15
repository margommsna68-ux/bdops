# Business hợp nhất — bản local

## Thu chi USDT — luồng hiện tại từ 15/10/2026

Trong dự án đã bật thu chi USDT, dùng ba mục: **Chi phí**, **Nhận về team**, **Lợi nhuận USDT**. Quyền quản lý/thao tác/xem và module của từng dự án vẫn giữ nguyên. Dự án chỉ có PayPal không cần tạo server/VM. Phần hướng dẫn USD/VND phía dưới là luồng lịch sử trước khi bật USDT.

- Chi phí: nhập số tiền gốc, đồng tiền, ngày chi và loại chi phí. USDT dùng tỷ giá 1. Với VND, mặc định lấy chiều **mua USDT bằng VND từ Binance P2P** qua nút lấy giá. Màn hình ghi nguồn, chiều và thời điểm; giá chỉ là tham khảo, có thể sửa theo giao dịch thực tế. Đồng khác cũng phải có tỷ giá xác nhận; USD không tự bằng USDT. Có thể dùng lại tỷ giá của khoản gần nhất bằng nút riêng, không tự ghi đè khi tải lại form.
- Quy ước: **1 USDT = … đơn vị tiền gốc**. Số USDT = tiền gốc / tỷ giá. Tỷ giá và tiền quy đổi giữ riêng cho từng khoản; giá mới không đổi các khoản đã lưu. Lưu tối đa 8 số lẻ tiền gốc, 12 số lẻ tỷ giá, 6 số lẻ USDT.
- Nhận về team: nhập **USDT thực nhận**, ngày nhận và mã giao dịch. Chọn collector/TEAM_PAYMENT gốc khi biết nguồn. Chưa biết số USDT thì lưu Nháp; không lấy số USD điền sang USDT. Có thể nhận gộp hoặc một phần. Có USD gốc nhưng chưa có nguồn thì web tạo một khoản ra collector cùng phiếu; chưa biết USD thì để trống và đối soát sau.
- Mã giao dịch được kiểm tra toàn hệ thống, giữ nguyên khi thu hồi và không thể dùng lại. Lưu lặp cùng yêu cầu không tạo hai phiếu. ADMIN có thể khôi phục phiếu thu hồi kèm lý do.
- Đối soát collector: TEAM_PAYMENT cũ chưa có USDT là khoản cần xác minh. BILL/OTHER cần được phân loại thành chi phí đúng USD gốc; COMMISSION_WITHDRAW không tự nhập thành chi phí. Phí đã trừ trước khi team nhận phải chọn **Chỉ đối soát**, liên kết phiếu nhận đã xác nhận, để không trừ hai lần.
- Lợi nhuận = **USDT thực nhận về team − CASH_COST đã quy đổi**. MIXING, tiền vào PayPal và số USD còn ở collector không làm tăng số USDT này. Thiếu tỷ giá/nguồn chưa xác minh sẽ hiện cần xử lý và chặn chốt kỳ. Phiếu đã xác minh USDT nhưng chưa đối soát USD chỉ hiện cảnh báo.
- Tạo kỳ → nhập người nhận/tỷ lệ tổng 100% → Tính lại nếu nguồn đổi → Chốt kỳ. Kỳ USDT khóa cả chi phí VND/USD trong khoảng ngày. Sửa/thu hồi/hoàn tác và chốt kỳ dùng cùng khóa giao dịch. Kỳ cũ WITHDRAWN/USD/VND, snapshot và ghi trả vẫn giữ nguyên cơ sở cũ.
- Sửa nhầm: dùng **Lịch sử** để xem trước/sau và hoàn tác từng thao tác nếu dữ liệu chưa sửa tiếp, hoặc Thu hồi/Khôi phục với lý do. Không dùng lịch sử sửa từng ô cũ để vượt khóa kỳ. Các thao tác này không chuyển hoặc hoàn tiền ngoài thực tế.

Giá tham khảo sử dụng API public Binance P2P, không cần tài khoản giao dịch/API key và không thực hiện giao dịch Binance. Nếu Binance không trả giá, lỗi hiện rõ; không tự điền một tỷ giá phỏng đoán. Giá Binance đã lấy phải được lưu trong 10 phút hoặc lấy lại. Hướng mua/bán theo [tài liệu chính thức Binance](https://www.binance.com/en/skills/detail/binance/p2p).

Kiểm chứng và giới hạn: [bằng chứng USDT](../superpowers/evidence/2026-10-15-team-cash-usdt.md). Bản này vẫn ở local; chưa migration/cutover Railway, chưa nhập Sheet thật.

Mở `http://localhost:3010/dashboard`, chọn đúng dự án. Bản `PROXY_TRIAL` chỉ có dữ liệu mẫu; chưa kết nối Sheet thật hoặc Railway. Không dùng số liệu mẫu làm báo cáo kinh doanh.

## Việc hàng ngày

1. **Proxy:** nhập mới, báo BLOCKED, nhận replace như quy trình đã có. Genjy/PC chung giữ nguyên sở hữu, không vào nguồn điền VM.
2. **Server / VM:** giao proxy → người vận hành cài → xác nhận đúng cấu hình tại Việc cài proxy. “Được giao” khác “đã cài”. Bấm Tài khoản tại dòng VM để ghi Gmail; bấm Công việc để giao việc. Ghi Gmail không tự đăng nhập máy. Bấm Chi phí để xem khoản chi liên quan server.
3. **Tài khoản VM / PayPal:** thêm email, mã và trạng thái. Để trống password/2FA/token khi sửa sẽ giữ thông tin đang có. Copy yêu cầu PIN và quyền copy; danh sách không hiện secrets. Ẩn tài khoản giữ lịch sử và giao dịch; bỏ liên kết VM/Gmail trước khi ẩn.
4. **Công việc:** ghi việc, VM, người làm và kết quả. Nhân viên được thao tác toàn bộ VM trong dự án có quyền, người nhận việc chỉ là phân công. Hoàn thành việc chung không thay bước xác nhận cấu hình proxy.
5. **Tài chính:** Tiền nhận → Rút/chuyển tiền → Chi phí. Chọn tháng và USD/VND; hai tiền tệ không cộng hoặc quy đổi tự động. Mã giao dịch giúp tránh nhập hai lần; thu hồi vẫn giữ mã và dấu vết.

## Lợi nhuận và sửa nhầm

Lợi nhuận = **tổng tiền rút EXCHANGE − chi phí thực tế**, như BDOps cũ. Tiền nhận vào PayPal và chuyển nội bộ MIXING hiển thị riêng, không cộng thêm vào lợi nhuận. Báo cáo tách tiền rút đã ghi và tiền rút xác nhận về; khoản chờ về cần kiểm tra trước khi chốt. MonthlyCost của server là dự kiến, không tự cộng lần nữa vào chi phí.

Tạo kỳ → nhập người nhận/tỷ lệ tổng100% → Tính lại nếu thu/chi đổi → Chốt kỳ. Chốt yêu cầu nguồn không đổi và các khoản rút xác nhận về; khóa thu/chi trong kỳ theo từng tiền tệ. Ghi đã trả chỉ lưu sự kiện đã xảy ra bên ngoài, không chuyển tiền. Chỉ quản trị mở lại kỳ, có lý do. Nếu lỡ ghi đã trả khi chưa trả thật, dùng Sửa ghi trả nhầm; việc này không hoàn tiền ngoài thực tế. Nếu tiền đã trả thật, kiểm tra nghiệp vụ điều chỉnh trước khi sửa.

**Lịch sử thao tác:** xem Trước/Sau → ghi lý do → Hoàn tác. Chỉ ADMIN hoàn tác, chỉ khi dữ liệu chưa bị sửa tiếp hoặc có liên kết phụ thuộc. Bản ghi mới được ẩn/thu hồi, không xóa lịch sử. Kỳ đã chốt/đã ghi trả dùng thao tác điều chỉnh riêng. Đây không phải Ctrl+Z nhiều bước liên tiếp; revision luôn tăng để chống sửa đè.

## Quyền và dữ liệu

ADMIN quản trị dự án. MODERATOR có module tương ứng mới ghi tài khoản/tài chính. USER có INFRASTRUCTURE làm công việc/gán/xác nhận trên toàn VM trong dự án; nhập/replace/copy vẫn theo capability. VIEWER chỉ xem. Các module PAYPALS, FUNDS, WITHDRAWALS, COSTS, PROFIT tách riêng; không tự cấp quyền khi thêm menu. Nhật ký cũng lọc theo module, không lộ số tiền cho nhân viên chỉ có hạ tầng.

Tạo dự án mới: chọn **Business Proxy / VM**. Dự án BDOps cũ vẫn có trang legacy; không ghép máy cá nhân với Bright Data theo tên. Không đổi mode để mở đường ghi cũ: backend giữ bảo vệ từ dữ liệu/lịch sử đã quản lý.

Backup mã hóa chứa cả proxy/VM/tài khoản/công việc/thu-chi/kỳ và nhật ký. Restore thử chỉ vào database trống riêng, không ghi đè nơi đang dùng. Khóa giải mã lưu riêng cấu hình server. Cần backup storage độc lập, nâng dependencies và thử restore trên host trước đưa dữ liệu thật lên Railway.

## Những câu hỏi phải chốt theo vận hành thật

- Một Gmail được phép chạy nhiều VM hay cần chặn dùng chung? Hiện giữ khả năng nhiều VM của BDOps, chưa suy đoán quy tắc mới.
- Ai chịu trách nhiệm xác nhận proxy đã cài/tiền đã về, có cần quản lý kiểm tra lần hai hay bằng chứng? Hiện người có quyền ghi xác nhận và nhật ký, chưa tự kiểm chứng máy/ngân hàng.
- Chi phí server/proxy cần phân bổ cho kỳ sử dụng hay ghi ở ngày thực trả? Hiện ghi ngày khoản chi; chưa tự phân bổ tiền trả trước.
- Ngoài Gmail/PayPal, business thực tế có nền tảng và tài khoản nào cần nối doanh thu? Không tự tạo thêm module khách hàng/lương/thuế khi chưa rõ công việc.

## Dữ liệu thử đã kiểm chứng

Gmail `vm-demo@example.invalid` ghi trên demo-server/VM_001, proxy192.0.2.101:5432 không đổi. PP-DEMO nhận100USD, rút80USD xác nhận về, chi phíserver30USD → lợi nhuận50USD. Tỷ lệ mẫu100% chỉ phục vụ QA, không phải thỏa thuận thật. Kỳ mẫu đã chốt, thử sửa bị chặn, rồi mở lại có lý do để tiếp tục dùng thử. Công việc mẫu đã thử hoàn tác; dấu vết còn trong Lịch sử. Các tài khoản operator/viewer mẫu chỉ có INFRASTRUCTURE, không cấp quyền cho người thật.

155 tests/38 files, types/lint/production build đã qua trước lượt rà cuối; bốn cảnh báo hook agent-pp có sẵn. Encrypted backup3deacbf2-63d3-43f5-97b6-7a5e22eba51d khôi phục38 bảng, decrypt được proxy và business history v3, database đang chạy không đổi. Kết quả rà cuối/build cuối được bổ sung khi hoàn tất.

Lượt rà cuối đã xử lý5 lỗi quan trọng và bổ sung nguồn IDs/revisions cho kỳ lợi nhuận. Kiểm chứng cuối:162 tests/39 files, types/lint và production build thành công; chỉ còn4 cảnh báo hook cũ. Tài khoản chỉ xem không thấy menu tiền, truy cập trực tiếp /profit bị chặn. Preview cuối chạy trên127.0.0.1:3010. Không nhập dữ liệu thật, không push/merge/Railway.

Bản sao cuối sau kiểm thử vai trò và tính lại kỳ:92fdf4d7-16dc-41c6-aacb-8e99149e3f53,237167bytes, SHA256565da21207625fdacd5ad0b232bd9637be93532077b445d9288d5d1ee8e84853. Restore riêngproxy_restore_1791991278902:38bảng, giải mã proxy/lịch sử business, DB đang dùng không đổi. Bản tính nguồn đã lưu IDs/revisions để tra sau; giao diện quản lý đã mở lại.
