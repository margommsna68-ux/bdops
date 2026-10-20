# MoneyToHome (nền BDOps) — source và kết quả đã làm

Ngày cập nhật: **15/10/2026**. Source chính: **C:\Users\TUNTUN\Desktop\project web new\bdops-proxy-app**. Branch: `feat/proxy-inventory`. Đây là source mới đã kết hợp kho proxy, VM và business; thư mục `../bdops` là baseline cũ dùng đối chiếu.

## Mở và sử dụng

- **Bản Railway đã chạy:** https://moneytohome.up.railway.app (tên miền mới từ tối 15/10; service `moneytohome`, cùng database thử). Bản local vẫn ở http://localhost:3010. Tài khoản và cách test trong [hướng dẫn Railway](docs/runbooks/railway-trial.md).
- Dự án dữ liệu thật: **Proxy cá nhân — Sheet 15/10**. Dự án mẫu được tách riêng. Web chưa tự cài proxy lên VM và chưa tự ghi ngược Google Sheet.
- **Kho proxy**: nhập proxy mới, báo BLOCKED hàng loạt, nhận replace bằng hai ô IP cũ/mới, tra IP và lịch sử, copy danh sách BLOCKED đủ thông tin.
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
11. **16/10 — Gói proxy, thanh toán, sắp xếp:** gói proxy có site, giá, chu kỳ, ngày đến hạn (Kho proxy → Thiết lập → Gói proxy); Nhập mới chọn gói sẵn có hoặc **Gói mới…**; nút **Đã thanh toán** ghi khoản chi USDT và dời hạn trong một lệnh; Tổng quan và trang proxy nhắc **Gói sắp đến hạn** (≤ 7 ngày / quá hạn); sắp xếp theo gói → server → VM → IP như Sheet, lọc theo gói, giữ trên URL; Server/VM sắp theo mã VM / chưa có SDK / thiếu proxy. Dự án trên host đổi tên **mooon**, thêm **AE** trống, xóa dự án mẫu; ADMIN xóa được dự án proxy/VM. Xem `docs/runbooks/proxy-packages.md`.

12. **16/10 — Bảng proxy như bảng tính:** lọc nhiều server (+ *Chưa gán server*) kết hợp gói/sở hữu/trạng thái, lọc và sort trên toàn bộ kết quả rồi mới phân trang, giữ trên URL; cột **Server / VM / Ghi chú vận hành** tách riêng và hiện đủ mọi vị trí; biểu tượng Copy copy ngay proxy đầy đủ một bấm; tick nhiều dòng → **Copy proxy**; **Copy toàn bộ kết quả lọc**; dòng thiếu user/pass hoặc chỉ có IP genjy được báo bỏ qua kèm lý do. Gắn `<Toaster/>` nên các thông báo ngắn giờ hiện thật. Xem `docs/runbooks/proxy-registry.md`.

13. **16/10 — Logo C + slogan:** biểu tượng M xanh (phương án C đã duyệt, `public/brand/moneytohome-mark.png`, nền trong suốt, không kéo méo) thay ô chữ B ở trang đăng nhập (căn giữa trên tên) và đầu sidebar (thu gọn chỉ còn biểu tượng); slogan chữ thật **Forward, Together.** dưới tên; icon tab `src/app/icon.png`; middleware cho phép `/brand/*` không cần đăng nhập. Thành phần `src/components/BrandMark.tsx`.

14. **16/10 — Nhóm proxy và sửa nhóm / server / VM trong bảng:** cột **Gói proxy** trước IP; *Thuộc về* → **Từ nhóm** (TUT = kho của anh, genjy, nhóm tự đặt); nhập mới chọn hoặc tạo nhóm ngay trong form (tên chuẩn hóa, chặn trùng hoa/thường/khoảng trắng); lọc theo nhóm kết hợp gói/server/trạng thái (`?group=`); nút bút mở dải chỉnh ngay dưới dòng (nhóm, server, VM trống, Bỏ gán); tick nhiều dòng → **Đổi nhóm / Chuyển server / Gán VM** (dán `Proxy | Server | VM`) với xem trước rồi lưu một lần; chỉ bản giao *Chờ cài* chưa bắt đầu mới chuyển/bỏ gán được, VM đích phải trống, genjy không đổi, nhóm tự đặt không autofill; mọi lần lưu qua `ProxyBatch` (idempotency + revision), nhật ký `PROXY_EDIT` và hoàn tác. Migration `20261016120000_proxy_groups` (chỉ thêm). Xem `docs/runbooks/proxy-groups-edit.md`.

15. **16/10 — Ngừng quản lý, nhóm/gói, hạn thanh toán và nhắc gia hạn:** trạng thái **Ngừng quản lý** (giữ IP, user/pass, nhóm, lịch sử; ẩn khỏi Đang quản lý; không nhập lại được; **Khôi phục** ở tab Lịch sử IP) cho một dòng/hàng loạt với lý do nhanh, bắt tick *Huỷ giao* khi đang chờ cài, từ chối khi đã cài/đang cài/genjy; Thiết lập → **Nhóm proxy** đổi tên / lưu trữ; gói có **Tắt/Bật** (chỉ chặn nhập mới), **Ngừng gia hạn / Nhắc lại**, **nhắc trước N ngày**, lọc theo hạn, nút **Ghi thanh toán** tại dòng; chuông thông báo + Việc cần làm nhắc mỗi gói một thông báo tăng mức ở 3 / 1 / 0 ngày và quá hạn, bấm mở đúng form thanh toán (hiện *Hạn: cũ → mới*); số tiền chỉ hiện cho người có module Chi phí. Migration `20261016150000_proxy_retire_reminders` (chỉ thêm). Xem `docs/runbooks/proxy-retire-reminders.md`.

16. **16/10 — Kiểm tra trùng khi mua mới và nhận replace:** mọi dòng dán có kết quả riêng (không bỏ dòng, không lệch cặp); cùng IP là trùng dù khác port/user/pass/gói; đối chiếu kho, VM, Genjy, lịch sử replace / ngừng quản lý / hoàn tác, các lần nhận trước và dự án khác (chỉ báo "thuộc dự án khác"); dòng trùng nêu trạng thái, server/VM và có nút **Lịch sử**; tóm tắt **N hợp lệ | N trùng | N cần kiểm tra**, **Lưu N dòng hợp lệ** một lần, **Copy dòng bị từ chối** (IP + lý do, không user/pass); replace ghép dòng N với dòng N kể cả khi có dòng trống / lỗi / trùng, báo từng cặp; ngoại lệ nhiều cổng chỉ với danh tính đã duyệt (cùng chủ, khác cổng, khoá `identity:port`). Backend kiểm tra lại quyền / revision / nguồn Genjy khi lưu; hai người cùng nhập một IP chỉ một thành công; bấm lại không tạo thêm. Không đổi schema. Xem `docs/runbooks/proxy-duplicate-check.md`.

17. **16/10 — Sửa dòng genjy và cập nhật moon1/M-029 theo Sheet:** dòng genjy có nút bút (Bỏ gán, Ngừng quản lý / Khôi phục; nhóm genjy cố định, không gán vào VM của anh); bản *Giữ để kiểm tra* chưa ai bắt đầu cài được Bỏ gán từ bảng. Theo Sheet hiện tại: `84.32.137.52` (genjy / PC chung) rời moon1/M-029; `178.95.180.143` (Account VietPhe) chuyển từ moon05/VM_078 sang moon1/M-029 (Chờ cài); moon05/VM_078 trống vì tab moon05 không còn dòng này. Sau cập nhật 573/573 ô VM trên Sheet khớp web.

18. **16/10 — Nhóm chung mooon–Genjy:** "PC chung" = proxy mooon và Genjy cùng đầu tư, hiện **Chung mooon–Genjy** (màu xanh ngọc nhạt), tách khỏi TUT và **Genjy riêng**; nút lọc nhanh có số lượng theo bộ lọc đang xem, kết hợp gói/server/trạng thái/tìm IP, giữ trên URL, lọc trước khi phân trang; gán server/VM thủ công (một dòng hoặc hàng loạt) và cài được, không vào autofill TUT; BLOCKED/replace giữ nhóm; Thiết lập → **Xác nhận nhóm chung** dán danh sách, xem trước từng dòng, lưu một lần, có hoàn tác. Xem `docs/runbooks/proxy-shared-group.md`.

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

19. **16/10 tối — Theo Sheet mới và chia trang:** moon05 thêm VM_079, VM_080; 3 IP nhóm chung `84.32.136.45`, `84.32.136.144`, `84.32.137.32` ở moon05/VM_078–080 (Chờ cài), web khớp 576/576 ô VM. Bảng proxy 100 dòng mỗi trang, dòng tổng và nút trang ở cả trên và dưới.

20. **16/10 khuya — Đổi nhóm mọi dòng và trạng thái:** mọi proxy (kể cả genjy, nhóm chung, nhóm tự đặt) đổi *Từ nhóm* từng dòng hoặc hàng loạt; TUT/nhóm chung giữ VM, Genjy riêng/nhóm tự đặt phải bỏ gán trước; quét Genjy không tự trả lại; hoàn tác được. Đổi trạng thái NEW ↔ LIVE từng dòng hoặc hàng loạt. 3 IP moon05/VM_078–080 nay là TUT, NEW, Chờ cài.

21. **16/10 — NEW / LIVE theo phân bổ VM thật:** NEW = trong kho chưa gán, LIVE = đã gán VM trên web (Chờ cài/Đã cài, chưa phải đã cài thật). Mọi đường gán/bỏ gán/huỷ giao/autofill/xác nhận cài/hoàn tác tự đồng bộ; nút *Trạng thái* tại dòng và hàng loạt (LIVE dẫn tới chọn VM, NEW bỏ gán cùng lần lưu, BLOCKED có kiểm soát); bộ lọc trạng thái có số lượng; Thiết lập → *Đồng bộ NEW / LIVE*. Host đã đồng bộ 42 dòng. Xem `docs/runbooks/proxy-state.md`.

22. **16/10 — Ít bước nhất:** LIVE = đang dùng, không cần VM; ô trạng thái trong bảng chọn là lưu; hàng loạt chọn trạng thái → Áp dụng; gán VM: bút → Server → VM (lưu ngay); sửa hàng loạt một nút Áp dụng; gán lại đúng chỗ không lỗi; hoàn tác không cần lý do. Chỉ hỏi lại khi chọn NEW trên dòng đang giữ VM.

23. **16/10 — Quản trị Server / VM:** Thêm VM theo khoảng Từ → Đến (đếm trước mới / đã có / đã xoá, nút *Tạo N VM*), sửa tên server, IP, ghi chú, mã VM, ghi chú VM tại chỗ (Enter lưu, Esc huỷ), Xoá (khôi phục được) từng dòng hoặc hàng loạt có Hoàn tác, chặn rõ khi VM còn proxy / việc cài, Xoá server cùng VM trong một lần, bộ lọc *Đã xoá* + Khôi phục; bảng một server không lặp tên server. Xem `docs/runbooks/server-vm-admin.md`.

24. **17/10 — Bảng vận hành Server / VM:** ô chọn server tìm theo tên trên mọi trang Server/VM; dải đếm bấm để lọc; bảng có vùng cuộn riêng vừa màn hình (tiêu đề dính, cột chọn + Server/VM dính trái, ⋯ dính phải), 50/100/200 dòng, mục *Cột* (bật/tắt, kéo độ rộng, đổi thứ tự, lưu theo người dùng); ô Proxy gọn tách *Giao* / *Cài* khi khác nhau, SDK rút gọn có copy, Gmail của VM, ghi chú 2 dòng; khung chi tiết bên phải (Tổng quan, Proxy, Việc cài, Công việc, Gmail, Lịch sử) thay cho dãy nút từng dòng; sửa mã VM/SDK/ghi chú bằng Enter/F2, Tab sang ô kế, nháp còn sau tải lại; **Dán bảng** SDK / Proxy / Gmail / Ghi chú (`VM | giá trị` hoặc `Server | VM | giá trị`, xem trước, Áp dụng lưu phần hợp lệ, kiểm tra lại từng dòng); chọn nhiều theo ID qua các trang; Copy proxy được giao/đã cài không bắt đầu cài; tự điền chỉ đúng các VM đã chọn (TUT NEW), chọn tay nhận cả nhóm chung. Cả 9 ca nghiệm thu đạt trên trình duyệt với dữ liệu thử riêng. Xem [bảng vận hành](docs/runbooks/server-vm-table.md) và [bằng chứng](docs/superpowers/evidence/2026-10-17-server-vm-table.md).

25. **17/10 — Tình trạng thao tác tại ô:** bấm nhãn Tình trạng mở popover cạnh ô với đúng hành động backend cho phép: Thiếu proxy → tự điền 1 proxy / chọn proxy (mở thẳng tab Proxy); Chờ cài → Bắt đầu cài (lưu ngay) / Copy để cài; Đang cài → Xác nhận đã cài (ghi rõ VM, IP, cấu hình #n) / Cài chưa xong (nhập vướng mắc tại chỗ); Cần kiểm tra → nguyên nhân + Xem ở bảng proxy / Việc cài / Đổi proxy. Lỗi giữ trạng thái cũ và hiện tại chỗ; Escape chỉ đóng; bấm lặp chỉ một lệnh; không đổi thì không ghi lịch sử. Xem mục *Tình trạng* trong [bảng vận hành](docs/runbooks/server-vm-table.md).

26. **17/10 — Kho tài khoản:** mục *Kho tài khoản* (trước là Tài khoản VM) có Gmail / Apple ID, PayPal, Lô nhập, Cần kiểm tra.
    - Nhập hàng loạt hoặc một tài khoản; chọn rõ loại Gmail / Apple ID.
    - Xem trước từng dòng (hợp lệ / đã có / lỗi), rồi một nút *Nhập N dòng hợp lệ*.
    - Không ghi đè tài khoản cũ. Mật khẩu / 2FA được mã hoá, không lộ trong log.
    - Tiền mua của lô ghi một lần vào Chi phí USDT; lô chưa có giá thì là *Chưa ghi chi phí*.
    - Ở Server / VM: cột *Tài khoản EarnApp* và *PayPal nhận*, bấm tại ô để chọn (lưu cả hai một lần); gán nhiều VM đã chọn;
      Dán bảng *Server | VM | Tài khoản | Mã PP*.
    - Tài khoản / PayPal đang giữ cho VM khác bị chặn và nêu vị trí. Bỏ gán không trả về NEW. Đăng ký EarnApp là thông tin
      riêng.
    - *Giao việc* tách việc nhân viên với 24 dòng đối chiếu Sheet cũ.
    - Commit 57f4bae, backup 5034ed1d, deploy f2298e2c, migration 20261017120000_account_inventory.
    - Xem `docs/runbooks/account-store.md`.

27. **19/10 — Kho SDK, ô SDK, ô Proxy gộp Cài proxy:** mỗi mã SDK là bản ghi riêng dùng chung mọi server (tiền tích luỹ USD do người vận hành ghi, ghi chú, trạng thái Chưa nối / Đã nối EarnApp / Chưa xác nhận); ô SDK hai dòng mở khung sửa ngay cạnh ô; nút **Kho SDK** trên trang Server / VM (dán SDK | tiền | ghi chú tự kiểm tra); chỉ mã chưa nối mới dùng lại hoặc chuyển VM (nguồn → đích rõ ràng). Cột Cài proxy nằm trong ô Proxy. Nút Lưu / Áp dụng mờ khi không có gì đổi, xanh khi có, ghi đúng số VM sẽ đổi. Xem [SDK và Kho SDK](docs/runbooks/vm-sdk.md). Commit d331cb5, backup 64463ab5, deploy e6abf1bc, migration 20261019150000_sdk_store.
28. **19/10 — Tiền VND → USDT, nhãn $, chống ghi đè SDK:** ô tiền dùng quy ước tiếng Việt (70.000, 16,27), API chỉ nhận số chuẩn; Kho tài khoản mặc định Tổng tiền thực trả, có Tính theo giá mỗi PP / tài khoản (cần số lượng thực mua), tự lấy tỷ giá Binance P2P BUY cho VND (nguồn, giờ lấy, hết hạn, lỗi → Thử lại); PayPal hiện $0,00 / Chờ về $18,00 / Dự kiến đủ $100,00 / Đạt mức gom $100,00; mọi đường sửa SDK kiểm phiên bản của chính mã. Xem [Kho tài khoản](docs/runbooks/account-store.md), [SDK](docs/runbooks/vm-sdk.md). Commit c038edd.
29. **19/10 — Proxy không có bước cài:** gán proxy là xong; bấm ô Proxy để Thay proxy (kho hoặc Nhận replace); replace ở Kho đổi luôn VM; Blocked ở Kho / VM đồng bộ và thay proxy đưa VM về tình trạng trước Blocked; nút Copy proxy Blocked (N). Thay quy trình Chờ cài / Xác nhận đã cài / Việc cài. Xem [Thay proxy](docs/runbooks/proxy-change.md). Commit 48b090e, migration 20261019210000_vm_blocked_from.
30. **19/10 — Sửa sau kiểm tra độc lập:** ô tiền nhận số lẻ chính xác (0,424; 16,125 USDT; tỷ giá 25.820,5), cảnh báo dấu phẩy hàng nghìn chỉ ở ô VND; thay proxy cho VM Blocked kiểu cũ (chưa có mốc) đưa về tình trạng trước Blocked theo lịch sử lượt này, không xác định thì Chưa ghi kèm lý do; chọn proxy "Giữ để kiểm tra" duy nhất (nút Dùng) thành liên kết rõ ràng. Không đổi schema. Xem [Thay proxy](docs/runbooks/proxy-change.md), evidence docs/superpowers/evidence/2026-10-19-review-fixes/.
31. **19/10 — Đổi Tổng tiền ↔ giá mỗi tài khoản không bỏ sót chi phí:** tổng thực trả là căn cứ ghi sổ; chia không hết (10 USDT / 3, 100.000 VND / 3) hoặc chưa có số lượng thì form giữ Tổng tiền thực trả cùng số tiền và tỷ giá, ghi chú tại chỗ, chỉ hiện giá phân bổ tham khảo; "Chưa ghi chi phí" chỉ khi chưa nhập hoặc chủ động xoá tiền. Gmail / Apple ID, PayPal và Ghi chi phí của lô. Không đổi schema. Xem [Kho tài khoản](docs/runbooks/account-store.md), evidence docs/superpowers/evidence/2026-10-19-purchase-inexact/.
32. **19/10 — Chiều Đơn giá → Tổng:** chỉ chuyển khi đơn giá và số lượng đều hợp lệ (tích chính xác); thiếu / 0 số lượng hoặc đơn giá sai định dạng thì ở lại Đơn giá, giữ nội dung, báo tại ô; không lấy lại tổng cũ, không thành Chưa ghi chi phí. Kiểm ma trận cả hai chiều. Không đổi schema. Evidence docs/superpowers/evidence/2026-10-19-purchase-mode-matrix/.
33. **19/10 — Theme "Đồng ấm":** Thiết lập → Giao diện có thêm Đồng ấm (nền kem, chữ nâu, nút đồng, trạng thái olive / hổ phách / đỏ gạch); bấm là áp dụng, lưu trong trình duyệt; Sáng / Tối / Vàng kim không đổi (so điểm ảnh). Không đổi schema. Xem [Giao diện](docs/runbooks/themes.md), evidence docs/superpowers/evidence/2026-10-19-theme-bronze/.
34. **19/10 — Theme, ba điểm còn lại:** Server / VM và Kho proxy giữ dòng đang chọn khi rời trang rồi Back (bộ nhớ phiên, theo người dùng / dự án / bộ lọc, bỏ dòng không còn hợp lệ); bảng màu Đồng ấm tự sinh trong `npm run build` và Dockerfile, test báo nếu lệch; số trên chip SUS ở theme Sáng đọc rõ. Không đổi schema. Evidence docs/superpowers/evidence/2026-10-19-theme-followups/.
35. **20/10 — Ghi chú Kho tài khoản, nhiều SDK tại VM, dán SDK theo khoảng:** ghi chú Gmail / Apple ID sửa ngay tại ô; một VM giữ danh sách nhiều SDK (thêm không ghi đè, tick Đã dùng vĩnh viễn), Dán bảng → SDK có hai cách (có mã VM / theo khoảng VM). Migration chỉ thêm cột `20261020090000_sdk_vm_list`. Xem [SDK](docs/runbooks/vm-sdk.md), evidence docs/superpowers/evidence/2026-10-20-sdk-list-notes/.
36. **20/10 — Sửa sau kiểm độc lập (SDK):** bản dán SDK gắn với lượt VM lúc kiểm tra (VM tạo lại thì dòng đó báo "VM đã được tạo lại, kiểm tra lại dòng này", không ghi vào lượt mới); thêm / dán không ghi đè tiền / ghi chú của mã người khác vừa lưu; "chưa dùng" chỉ đếm mã UNLINKED, mã chưa xác nhận hiện riêng. Không đổi schema. Commit e85a82f, backup 97a9cf96, deploy 73622735. Xem [SDK](docs/runbooks/vm-sdk.md), evidence docs/superpowers/evidence/2026-10-20-sdk-review-fixes/.
37. **20/10 — Nhập Apple ID theo mẫu mua + Xoá khỏi kho:** Apple ID dán `Email | Mật khẩu | Link lấy 2FA | Link SMS | Số điện thoại` (link mã hoá, mở sau PIN bằng Lấy 2FA / SMS); ADMIN xoá / khôi phục Gmail / Apple ID, PayPal (archivedAt) và proxy (RETIRED = Đã xoá) ngay tại dòng hoặc hàng loạt, có Hoàn tác; dòng đang gán VM / còn tiền bị chặn tại dòng; Kho tài khoản phân trang 100 dòng. **Tiếp 20/10:** khung chi tiết Gmail / Apple ID (bấm email: xem sau PIN, sửa từng trường), một thanh thao tác chung cho ba bảng, nhập xong tự đóng và về bảng (Xem vừa nhập), đường Ẩn tài khoản cũ chặn như Xoá, lịch sử nhập kho đếm đủ email (commit fe2bf5f, backup 0211ccb1, deploy d859efc0). Migration chỉ thêm cột `20261020150000_apple_id_fields`. Commit ce29911, backup 7587897d, deploy 65b78f18. Xem [Kho tài khoản](docs/runbooks/account-store.md), [Xoá proxy](docs/runbooks/proxy-retire-reminders.md), evidence docs/superpowers/evidence/2026-10-20-stock-delete-apple-id/.
38. **20/10 — Tiền / Rút tại VM:** cột "Tiền / Rút" ở Server / VM hiện số dư EarnApp đã kiểm tra (giờ thật, điều kiện rút chỉ khi đã thấy trên EarnApp, lỗi giữ số cuối) cùng yêu cầu rút về PP; ghi tại ô hoặc Dán bảng → Số dư EarnApp ("Cập nhật N VM"); lọc Chưa kiểm tra / Có thể rút / Chờ tiền về / Đã về PP / Cần kiểm tra, sắp theo số dư / lâu chưa kiểm tra / chờ lâu nhất, dải tóm tắt không cộng số dư với tiền chờ; gợi ý PP gần $100 không vượt; rút có bước Chuẩn bị (giữ email) → Đã gửi trên EarnApp / Chưa xác định kết quả; quyền riêng EARN_BALANCE. Chưa có kết nối web → VM, chưa tạo tài khoản AI. Commit 563c642, backup 5bcf8d20, deploy 66f4c1ba, migration 20261020200000_earn_balance_checks (chỉ thêm); host chỉ đọc trước / sau giống hệt. Xem `docs/runbooks/vm-ops-cycle.md` và `docs/superpowers/evidence/2026-10-20-earn-money/`.
39. **20/10 — Sửa 4 lỗi kiểm độc lập Tiền / Rút:** yêu cầu rút gắn đúng VM + lượt + EarnApp (lệnh từ ô mang `vmId` / `expectedCycle` / `earnAppId`, kiểm lại trong giao dịch; tài khoản đã rời VM hoặc VM đã tạo lại → từ chối, không gán / đánh dấu email cho tài khoản mới; đối chiếu tài khoản cũ ở Lịch sử của VM với `history: true`, RETRY bị từ chối); nháp số dư / form yêu cầu / form thao tác giữ định danh lúc bắt đầu, đổi nền → giữ nháp, báo tại chỗ, khoá Lưu, "Ghi lần mới"; điều kiện / lý do / căn cứ chỉ trả cho người có quyền đọc số dư (`noteHidden` cho người khác); "Đã về PP" là tiền thực nhận + "Đã chốt thiếu". Commit 5f61827, backup 29096b34, deploy f3819255, không migration; host chỉ đọc trước / sau giống hệt. Xem `docs/superpowers/evidence/2026-10-20-earn-money-review/`.
40. **20/10 — Cột Tiền / Rút nhìn thấy ngay:** thứ tự mặc định VM → Tình trạng → Tiền / Rút → Proxy → SDK → Tài khoản → PayPal → Ghi chú (1280 px, sidebar mở: Tiền / Rút 667–887 px, trước 1467 px); cấu hình cột cũ còn đúng thứ tự mặc định cũ được chuyển một lần (`v: 2`), thứ tự tự đổi / độ rộng / cột ẩn giữ nguyên; ô hiện "Chưa gán tài khoản" (bấm mở bộ chọn tài khoản nếu có quyền gán) / "Chưa kiểm tra" (bấm mở phần ghi số dư) / số tiền lớn có $ + "Kiểm tra hh:mm"; dòng tổng hợp đếm VM chưa gán và chưa kiểm tra (thay "Chưa có dữ liệu: 0 VM"); bỏ bóng mép cột cố định, đường mảnh chỉ khi cuộn ngang. Commit 640d6f0, backup 7c13d9f7, deploy 887756ba, không migration; host chỉ xem, trước / sau giống hệt. Xem `docs/superpowers/evidence/2026-10-20-money-column/`.
