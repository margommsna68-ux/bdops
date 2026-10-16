# MoneyToHome (nền BDOps) — source và kết quả đã làm

Ngày cập nhật: **15/10/2026**. Source chính: **C:\Users\TUNTUN\Desktop\project web new\bdops-proxy-app**. Branch: `feat/proxy-inventory`. Đây là source mới đã kết hợp kho proxy, VM và business; thư mục `../bdops` là baseline cũ dùng đối chiếu.

## Mở và sử dụng

- **Bản Railway đã chạy:** https://moneytohome.up.railway.app (tên miền mới từ tối 15/10; service `moneytohome`, cùng database thử). Bản local vẫn ở http://localhost:3010. Tài khoản và cách test trong [hướng dẫn Railway](docs/runbooks/railway-trial.md).
- Dự án dữ liệu thật: **Proxy cá nhân — Sheet 15/10**. Dự án mẫu được tách riêng. Web chưa tự cài proxy lên VM và chưa tự ghi ngược Google Sheet.
- **Quản lý proxy**: nhập proxy mới, báo BLOCKED hàng loạt, nhận replace bằng hai ô IP cũ/mới, tra IP và lịch sử, copy danh sách BLOCKED đủ thông tin.
- **Server/VM**: xem proxy được giao và proxy đã xác nhận cài. Nhân viên cài thật rồi mới xác nhận. **Điền VM thiếu** chỉ dùng NEW của anh, chưa dùng, vào chỗ trống thật sự. Cột **SDK EarnApp**: ghi tại dòng hoặc **Dán SDK** nhiều dòng (Server → VM → SDK), xem trước, lịch sử từng VM, hoàn tác; bộ lọc **Chưa có SDK**. Xem [hướng dẫn SDK](docs/runbooks/vm-sdk.md).
- **Business**: công việc, Gmail/PayPal, chi phí, tiền về team, đối soát collector và kỳ lợi nhuận. Lợi nhuận = **USDT thực nhận về team − chi phí quy về USDT**.
- **Lịch sử**: xem người/thời gian/nội dung trước–sau; hoàn tác khi dữ liệu chưa bị bước sau thay đổi. **Sao lưu** chỉ chủ hệ thống được tạo.

## Đã xây và kiểm chứng

1. Kho proxy chuẩn hóa theo IP, credentials, gói, sở hữu và trạng thái; kiểm tra hàng mới trùng kho/lịch sử/VM. Gói nhận diện bằng đúng user và pass, không theo dải IP.
2. BLOCKED hàng loạt tự tìm IP, lưu ngày giờ/người báo. Replace ghép dòng tương ứng; IP viết tắt kế thừa port/user/pass của proxy cũ; thông tin đầy đủ được giữ theo input.
3. Sở hữu **Genjy/PC chung bất biến**, theo cả IP cũ và chuỗi replace. Nguồn Genjy quét toàn workbook; lỗi nguồn chặn thao tác có nguy cơ lấy nhầm.
4. Giao proxy/điền VM thiếu, khóa chống hai người cấp trùng, mã đợt chống lưu lặp. Phân biệt cấu hình chờ cài với xác nhận cài thực tế; cấu hình mới không được xác nhận bằng kết quả cũ.
5. Phân quyền quản lý/thao tác/xem ở backend. Nhân viên thao tác toàn bộ VM trong dự án được cấp, theo quyền tính năng; không tự có quyền dữ liệu dự án khác.
6. Lịch sử trước–sau mã hóa, hoàn tác có kiểm tra xung đột và sao lưu toàn database mã hóa; đã thử khôi phục vào database riêng.
7. Business hợp nhất cùng dự án: tài khoản, công việc, thu/chi, rút tiền, collector, nhận tiền về team và khóa kỳ. Giữ số tiền gốc/tỷ giá riêng từng khoản. VND mặc định tham chiếu Binance P2P mua USDT; có ghi nguồn/thời gian và điều chỉnh thủ công rõ ràng.
8. Đọc source và sao dữ liệu Railway cũ để kiểm chứng. Giữ baseline cũ, không tự ghép server cá nhân với Bright Data theo tên; không tự coi tiền collector là USDT team đã nhận.
9. Đưa dữ liệu thật lên Railway riêng, khóa login demo, tạo tài khoản chủ riêng, đọc Genjy trực tiếp, backup trên volume và tải bản mã hóa ngoài host. 217 tests/58 files, build/types qua; 11 nhóm kiểm tra API host qua. Restore host vào database riêng đủ 39 bảng và 1.362 cặp credentials thật; Railway cũ vẫn nguyên 26 bảng/1.120 dòng.

10. **15/10 tối — SDK EarnApp (mốc 1):** cột SDK trong bảng Server/VM, ghi một VM tại dòng, dán hàng loạt có xem trước (ghép theo server + mã VM, không theo thứ tự dòng, không tạo VM), chặn mã trùng VM khác (ứng dụng + unique index), dán lại không tạo lịch sử thừa, chống bấm lặp, lịch sử mã cũ/mới/người/giờ, hoàn tác. Đổi tên hiển thị thành **MoneyToHome**, nút tải lại đổi thành **Tải lại** để phân biệt với nhập dữ liệu. Bằng chứng: [SDK](docs/superpowers/evidence/2026-10-15-vm-sdk.md).
11. **16/10 — Gói proxy, thanh toán, sắp xếp:** gói proxy có site, giá, chu kỳ, ngày đến hạn (Quản lý proxy → Thiết lập → Gói proxy); Nhập mới chọn gói sẵn có hoặc **Gói mới…**; nút **Đã thanh toán** ghi khoản chi USDT và dời hạn trong một lệnh; Tổng quan và trang proxy nhắc **Gói sắp đến hạn** (≤ 7 ngày / quá hạn); sắp xếp theo gói → server → VM → IP như Sheet, lọc theo gói, giữ trên URL; Server/VM sắp theo mã VM / chưa có SDK / thiếu proxy. Dự án trên host đổi tên **mooon**, thêm **AE** trống, xóa dự án mẫu; ADMIN xóa được dự án proxy/VM. Xem `docs/runbooks/proxy-packages.md`.

12. **16/10 — Bảng proxy như bảng tính:** lọc nhiều server (+ *Chưa gán server*) kết hợp gói/sở hữu/trạng thái, lọc và sort trên toàn bộ kết quả rồi mới phân trang, giữ trên URL; cột **Server / VM / Ghi chú vận hành** tách riêng và hiện đủ mọi vị trí; biểu tượng Copy copy ngay proxy đầy đủ một bấm; tick nhiều dòng → **Copy proxy**; **Copy toàn bộ kết quả lọc**; dòng thiếu user/pass hoặc chỉ có IP genjy được báo bỏ qua kèm lý do. Gắn `<Toaster/>` nên các thông báo ngắn giờ hiện thật. Xem `docs/runbooks/proxy-registry.md`.

## Dữ liệu thật đã nhập

Snapshot Sheet/Genjy ngày 15/10/2026: **10 server, 574 dòng VM, 1.362 endpoint, 101 liên kết replace, 1.172 IP khác nhau trong final**. Đã giữ **724 danh tính Genjy**, trong đó 33 có bằng chứng PC chung (bao gồm lịch sử).

- Chưa có ô VM trống đủ điều kiện; chưa có NEW của anh chưa dùng đủ điều kiện.
- 550 cấu hình chờ cài; 24 dòng cần kiểm tra. Không tự đánh dấu đã cài từ dữ liệu Sheet.
- 17 dòng chưa rõ nhóm sở hữu; 5 proxy khác gói được anh xác nhận là **Proxiware** và đang dùng; 1 trùng Genjy tại **moon1/M-029 — 84.32.137.52**; 1 dòng placeholder “ko có VM”. Năm Proxiware đã có note trên web, chưa tự đổi catalog/sở hữu.
- Ngoại lệ IP `23.142.16.73` nhiều port đã được anh xác nhận là luồng ngoài; kiểm soát theo từng port được duyệt.
- Note Proxiware trên Google Sheet gốc **chưa lưu được** do editor mất kết nối; không báo nhầm là đã lưu. Vị trí phải đọc lại trước khi ghi tiếp.

Báo cáo chi tiết: [nhập Sheet](docs/superpowers/evidence/2026-10-15-personal-sheet-import.md), [tiền về team/USDT](docs/superpowers/evidence/2026-10-15-team-cash-usdt.md), [kiểm chứng proxy](docs/runbooks/proxy-verification.md).

## Cấu trúc source

| Thư mục | Nội dung |
|---|---|
| `src/app` | Trang web và API |
| `src/components/proxy-management` | Kho, nhập/BLOCKED/replace, lịch sử |
| `src/components/vm-management` | Server/VM, giao proxy, xác nhận cài |
| `src/components/business-management` | Tổng quan, công việc và tài chính |
| `src/server/proxy-management` | Parser, chống trùng, Genjy, đợt nhập và replace |
| `src/server/vm-management` | Cấp phát, phiên bản cấu hình và cài máy |
| `src/server/business-management` | Thu/chi, tiền về team, tỷ giá, đối soát và lợi nhuận |
| `src/server/operation-history` | Nhật ký và hoàn tác |
| `src/server/system-backups` | Sao lưu mã hóa |
| `prisma` | Model database và migration có kiểm soát |
| `src/__tests__` | Kiểm thử quy tắc và tích hợp |
| `scripts` | Công cụ vận hành/kiểm chứng, parser Genjy cách ly |
| `docs/runbooks` | Hướng dẫn thao tác, triển khai và khôi phục |
| `docs/superpowers` | Thiết kế, kế hoạch, bằng chứng từng mốc |

## Chạy và kiểm tra

Node 22, PostgreSQL 17 và npm. Cấu hình riêng trong `.env` theo `.env.example`. **Không dùng db:reset/db:push trên dữ liệu thật.**

```sh
npm ci --legacy-peer-deps
npm run db:migrate
npm run build
npm start
```

Kiểm thử dùng `.env.test` trỏ database thử riêng: `npm test`, `npx tsc --noEmit`, `npm run lint`. Các script `bootstrap-*-trial` chỉ dành cho database local mẫu, không chạy lên host.

## Bảo vệ và việc tiếp theo

- Mật khẩu/PIN/khóa và bản raw dữ liệu không nằm trong Git. Cấu hình Railway riêng được lưu ở `../private-config/railway-trial-2026-10-15`, chỉ user Windows hiện tại có quyền.
- Đừng xóa/đổi `ENCRYPTION_KEY`: dữ liệu credentials/lịch sử sẽ không đọc được. Backup có khóa riêng; cần giữ cả hai khóa ở nơi an toàn.
- Anh test thực tế: tìm IP → báo BLOCKED → nhận replace → giao VM → xác nhận cài → hoàn tác thử một thao tác hợp lệ. Xem [hướng dẫn bản thử](docs/runbooks/railway-trial.md).
- Sau nghiệm thu mới chốt web là nơi sửa chính, bật backup tự động/retention và theo dõi lỗi; tránh sửa cùng một phân bổ ở cả Sheet và web.
- Chưa có agent tự cài/kiểm tra mạng VM, billing, payroll hay tự lấy số USDT thực nhận từ collector. Những phần này cần dữ liệu và quy trình thực tế tiếp theo.
- Mốc tiếp theo theo brief 15/10: tài khoản EarnApp (Gmail/Apple ID, nhiều SDK một tài khoản), dán hàng loạt Gmail/PayPal theo cùng mẫu Dán bảng, token API cho AI ghi dữ liệu, trạng thái máy/app theo ngày.
