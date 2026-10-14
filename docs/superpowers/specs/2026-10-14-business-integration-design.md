# Hợp nhất Proxy/VM với vận hành business BDOps

## Ý định đã xác nhận

Anh yêu cầu tiếp tục kết hợp phần proxy với web BDOps đã có thành một business đầy đủ, thao tác ít bước, theme đơn giản và có thể quản trị lâu dài. Quyền quản lý/thao tác/xem theo dự án; nhân viên được thao tác toàn bộ VM trong dự án đã cấp quyền. Ngày 14/10/2026 anh chốt lợi nhuận mặc định **tiền đã rút − chi phí**, như BDOps cũ. Tiền nhận và tiền rút phải hiển thị riêng, không cộng thành hai lần doanh thu.

Mốc này mở rộng chương trình đã được anh duyệt và phương thức triển khai tuần tự đã chọn. Tiếp tục build local trên cùng branch/worktree; không chuyển dữ liệu Sheet cũ hoặc deploy Railway trong lúc chưa đối chiếu. Không tạo ERP khách hàng/lương/thuế mới ngoài các luồng có trong source BDOps.

## Phạm vi và cấu trúc dùng chung

Giữ project/membership/auth hiện tại; giữ `businessMode=PROXY_VM` để các bảo vệ managed infrastructure luôn có hiệu lực. Các trang quản lý tài khoản, tài chính và công việc có child mới cho mode này, child legacy giữ nguyên cho dự án cũ. Không ghép VM cá nhân với Bright Data theo tên; không xoá dự án/dữ liệu cũ.

Tái dùng canonical GmailAccount, PayPalAccount/PayPalEmail, FundTransaction, Withdrawal, CostRecord và ProfitSplit/SplitAllocation. Additive revision/archivedAt hoặc voidedAt và currency trên các bảng cần dùng. Thêm BusinessWorkItem để công việc cấp dự án không phụ thuộc phải có một VM; việc cài proxy vẫn dùng VMConfiguration/VMTask và không bị nhiệm vụ chung thay thế.

CostRecord liên kết tùy chọn Server và ProxyProviderAccount. Chi phí thực tế ghi tại CostRecord; monthlyCost server là thông tin dự kiến, không tự cộng lần nữa. Tiền nhận gắn PayPal, Server/VM tùy chọn; tiền rút/chuyển là ghi nhận thủ công, web không gửi lệnh tới ngân hàng/PayPal. Thu/chi và lợi nhuận tách theo USD/VND, không cộng hai tiền tệ hoặc tự lấy tỷ giá.

## Tài khoản và công việc

Tài khoản Gmail/PayPal có metadata, status, archivedAt, revision. Password/2FA/token chỉ lưu cipher; list và nhật ký chi tiết không trả raw/cipher. Copy là hành động explicit có capability COPY_CREDENTIALS, audit, PIN hiện hành kiểm tra qua cơ chế khóa sẵn có khi cần đọc secret. PayPalEmail giữ credentials email chính, tránh kho mật khẩu thứ hai.

Gán Gmail vào VM ghi metadata trên web, không tự coi là đã đăng nhập máy. VM_BINDING là ảnh trước/sau riêng để không đổi cấu trúc snapshot VM v2 cũ; bump VM và account revision khi liên kết để undo thấy dependency. Gán tài khoản/PayPal/assignee phải cùng project và chưa archive. Một Gmail có thể ghi trên nhiều VM theo schema cũ; không tự chuyển khỏi máy khác.

Công việc có project, title/note, optional Server/VM, assignee là thành viên dự án, status PENDING/IN_PROGRESS/COMPLETED/CANCELLED, revision, archivedAt, người/ngày tạo/cập nhật/hoàn thành. USER có module INFRASTRUCTURE thao tác toàn dự án; assignee chỉ dùng phân công, không giảm quyền VM đã được anh chốt. Expected revision chống nhân viên sửa đè. Việc cài proxy chỉ hoàn thành qua exact configuration API, không qua công việc chung.

## Tài chính và lợi nhuận

FundTransaction là tiền dự kiến/đã nhận/không về; confirmed và failed không cùng true. Withdrawal EXCHANGE là tiền rút, MIXING là chuyển nội bộ, không tính MIXING thành lợi nhuận. `paidToTeam` là ghi đã nhận về; báo cáo tách tiền rút ghi nhận và đã nhận về khi chưa xác nhận. Lợi nhuận giữ cách BDOps cũ: tổng EXCHANGE trong kỳ − chi phí, hiển thị rõ nguồn và ghi nhận chưa xác nhận. Không lấy tổng Fund + Withdrawal để tính lợi nhuận.

Số tiền nhận dạng chuỗi thập phân, dùng Prisma.Decimal hoặc cents nguyên, không cộng JavaScript float. USD/VND lưu chính xác 2 chữ số thập phân như schema cũ; yêu cầu số dương, giới hạn Decimal(12,2), không nhận NaN/Infinity/scientific input. Ngày theo Asia/Bangkok; kỳ [00:00 ngày đầu, 00:00 sau ngày cuối), tránh rơi cuối ngày. Bản ghi USD cũ giữ USD, currency thêm default USD không quy đổi dữ liệu.

Mỗi mutation tài chính có request key và payload hash: replay cùng key trả kết quả cũ, cùng key khác input bị chặn. Update/void dùng expected revision; void không delete và không xóa mã giao dịch. Khóa period/currency đã settle để không sửa/ghi thêm khiến báo cáo đã chốt lệch. ProfitSplit lưu basis WITHDRAWN, currency, snapshot nguồn/các revision và checksum; phần trăm tổng đúng 100; làm tròn cents, phân bổ phần dư để tổng allocations bằng đúng netProfit. Không tự ghi đã thanh toán cho đối tác. Settle kiểm tra nguồn còn đúng; paid mark là nhật ký read-only. Hoàn tác ghi nhận không thực hiện hoàn tiền hoặc đảo giao dịch bên ngoài.

Finance READ theo FUNDS/COSTS/PROFIT; WRITE chỉ ADMIN/MODERATOR có module tương ứng. Nhân viên INFRASTRUCTURE không tự thấy tiền hoặc raw financial history. Báo cáo PROFIT được xem tổng hợp; nguồn chi tiết vẫn theo FUNDS/COSTS. Giữ nguyên quyền hiện hành, không tự cấp module cho nhân viên khi thêm navigation.

## Nhật ký chung và bảo vệ đường cũ

OperationSnapshot v3 thêm GMAIL/PAYPAL/PAYPAL_EMAIL/VM_BINDING/WORK/COST/FUND/WITHDRAWAL/PROFIT/SPLIT_PAYMENT. Snapshot mã hoá, describe masked, revision monotonic. Tạo mới undo archive/void; update restore trước nếu chưa có dependency; account undo chặn khi đã được bind hoặc có receipt. Snapshot v1/v2 vẫn đọc và hoạt động như trước.

OperationJournal thêm accessModule để list/inspect/undo kiểm tra module từng thao tác (bản cũ mặc định INFRASTRUCTURE). Admin mới được undo. Ghi request key/hash/result cipher trên journal để chống replay từng mutation; không chứa raw mật khẩu trong summary/audit. Khi đối tác đã được ghi trả tiền hoặc kỳ đã settle, ordinary undo bị chặn; cần nghiệp vụ mở lại/chỉnh ghi nhận có lý do.

Legacy writers Gmail/PayPal/PayPalEmail/fund/withdrawal/cost/profit/partner/EarnWithdrawal không được sửa dữ liệu managed ngoài domain mới; quản trị/deleteRequest/editHistory cũ không delete/restore các resources managed. Query legacy có raw credential fields bị chặn trong managed workspace. Guards dựa project mode hoặc managed markers/data hiện có, không mất khi settings bị đổi.

## Giao diện

Sidebar một hệ thống: Tổng quan; Proxy; Server/VM; Tài khoản; Công việc (việc cài + nhiệm vụ chung); Thu/chi; Lợi nhuận; Lịch sử; Quản trị. Các section tiền theo quyền. Không tạo nhiều dashboard rời; tổng quan có việc cần xử lý và tiền theo kỳ cho người có quyền, link đi thẳng vào màn tương ứng.

Tài khoản: hai tab Gmail/PayPal, tìm nhanh, thêm/sửa/status, link VM, credentials chỉ khi bấm copy. Server/VM có tài khoản ghi nhận và mở gán ngay tại dòng. Công việc có việc cài proxy hiện tại và nhiệm vụ chung, bộ lọc người/tình trạng.

Thu/chi: tiền nhận, tiền rút/chuyển, chi phí trong một màn với kỳ/currency chung; form ít trường bắt buộc, link Server/VM/gói optional, có thể mở từ dòng máy/gói. Lợi nhuận: withdrawn − costs, breakdown theo nguồn, tạo/chốt kỳ và allocations từ thông tin thực tế, không chạy lệnh chuyển tiền.

Tạo workspace mới có lựa chọn Business Proxy/VM rõ ràng. Các phần legacy vẫn mở được theo dự án và quyền đã có; không mount hook server cũ trong managed UI. Backup toàn hệ thống bao gồm bảng/phần mới; thử restore riêng lại trước chốt mốc.

## Nghiệm thu

Integration tests: IDs khác dự án và viewer/worker finance writes bị chặn; account DTO không secrets; account bind/history/undo; tasks stale revision và assignee scope; cost/server/package cùng project; confirmed/failed conflict; replay và rollback; cash receipt/withdraw/internal transfer/void; currency và timezone boundaries; period settle source change; percentage/cents rounding; snapshot v1/v2 compatibility; financial history không lộ cho INFRA-only; legacy/delete bypasses; original proxy/Genjy/VM occupancy regression nguyên vẹn.

Browser dữ liệu mẫu: account → VM metadata → task; tiền nhận/rút/chi phí → report withdrawn-cost → history/undo; navigation chuyển dự án giữ legacy; các số liệu pool/Genjy không bị business mutation thay đổi. Full suite/types/lint/build, một fresh review toàn mốc và một fix pass. Không claim dữ liệu thật hay business đang live trước migration/Railway.
