# Gán / thay proxy không có bước cài, Blocked và tình trạng VM (19/10/2026)

Quyết định của chủ dự án ngày 19/10/2026. **Thay thế** quy trình xác nhận cài trước đây (Chờ cài → Bắt đầu cài / Copy để cài → Đang cài → Xác nhận đã cài, trang Việc cài proxy, việc cài bị bỏ lại). Không dựng lại quy trình cũ.

## Quy tắc mới thay quy tắc cũ

| Mới | Thay cho |
|---|---|
| Gán proxy vào VM là ghi nhận proxy VM đang dùng trên web. Gán xong là xong; proxy chuyển LIVE. | Gán = "Chờ cài"; phải Bắt đầu cài rồi Xác nhận đã cài. |
| Ô Proxy: IP:port, nút copy, chỉ cảnh báo **Blocked** hoặc **Cần kiểm tra**. Bấm ô mở khung **Thay proxy** ngay cạnh ô. | Ô Proxy có dòng Chờ cài / Đang cài / Đã cài / Cần thay proxy; bấm ô mở các thao tác cài. |
| Dải lọc: Tất cả · Thiếu proxy · **Có proxy** · **Proxy Blocked** · Cần kiểm tra · … | Thiếu proxy · Chờ cài · Đã cài · Cần kiểm tra · Việc cài bị bỏ lại. |
| Nhận replace ở Kho proxy đổi luôn VM đang dùng proxy cũ trong cùng giao dịch. | Replace chỉ đổi kho; VM vẫn giữ proxy cũ cho tới khi gán lại và xác nhận. |
| Báo BLOCKED ở Kho proxy chuyển VM đang dùng sang Blocked; chọn Blocked tại VM ghi BLOCKED cho proxy hiện hành (cần quyền Báo BLOCKED). | Hai trang độc lập; chọn Blocked tại VM không chạm proxy. |
| Thay proxy đưa VM về tình trạng trước Blocked của đúng VM, lượt và proxy đó. | Thay proxy không đổi tình trạng. |
| `/vm-tasks` và link cũ mở Server / VM; menu, thông báo, Tổng quan không còn Chờ cài / Việc cài. | Trang Việc cài proxy (ẩn hoặc bật bằng biến môi trường), cảnh báo "N VM chờ cài". |
| `vmManagement.start / copy / confirm / reportFailure` trả lỗi rõ ("không còn bước cài"). | Các lệnh cài. |

## Dữ liệu cũ

- Dữ liệu cài cũ (cấu hình CONFIRMED, việc cài, sự kiện INSTALL_STARTED / INSTALLED) giữ nguyên làm lịch sử. Không tạo bản ghi "đã cài" hay "đã kiểm tra mạng" để thay.
- Proxy hiện hành của một VM: cấu hình được gán (desired), hoặc nếu chỉ có một cấu hình đã xác nhận cũ thì dùng nó. Hàm `currentProxyOf` (server) và `currentOf` (`src/server/vm-management/state.ts`, giao diện).
- VM vừa có "đã giao B" vừa có "đã cài A" khác nhau, hoặc còn bản "Giữ để kiểm tra": **Cần kiểm tra**, hiện mọi proxy liên quan; web không đoán. Trong khung Thay proxy bấm "Dùng <IP>" cho proxy đang dùng thật rồi Áp dụng; các proxy kia rời VM.
- Proxy từng bắt đầu cài ở máy khác (sự kiện cũ) vẫn không vào kho tự điền (như trước).
- Việc cài cũ còn mở không chặn xoá VM nữa và không hiện ở đâu; vẫn có trong dữ liệu.
- Host 19/10/2026: 576 VM trước đây đều "Chờ cài" (cấu hình giao, chưa xác nhận) nay hiện **Có proxy** với đúng proxy đó; không ghi dữ liệu nào để chuyển.

## Thay proxy tại Server / VM

- Bấm nội dung ô Proxy (không phải nút copy) → khung **Thay proxy · server / VM**: proxy đang dùng (và cảnh báo), danh sách proxy NEW đủ điều kiện (TUT, Chung mooon–Genjy; có gói; không Genjy riêng; chưa từng cài ở máy khác) có ô tìm / dán IP, IP:port hoặc IP:port:user:pass.
- Chọn hoặc dán là tự kiểm tra (`vmManagement.proxyCheck`, không ghi): báo lỗi tại chỗ (đang dùng ở VM khác — không lấy ngầm; BLOCKED; LIVE; không đủ điều kiện), báo tình trạng VM sẽ trở về nếu có.
- **Áp dụng** (`vmManagement.changeProxy`) một lần: mờ khi chưa chọn / chọn lại proxy hiện tại (không đổi, không lịch sử), xanh khi hợp lệ. Kiểm tra quyền ASSIGN, dự án, revision VM, lượt VM (`expectedCycle`). Mỗi nội dung một khoá: mất phản hồi bấm lại gửi đúng yêu cầu đó (không đổi hai lần).
- Proxy hiện tại đang BLOCKED: thêm tab **Nhận replace** — dán proxy mới nhà cung cấp gửi (IP viết tắt lấy port / user / pass của proxy cũ). Dùng đúng luồng Nhận replace của Kho proxy (cần quyền REPLACE).
- Tab **Thay proxy** trong panel chi tiết VM dùng cùng khung.

## Thay / replace ở Kho proxy

- **Nhận replace** (một hay nhiều dòng; dòng N cũ ghép dòng N mới; dòng thiếu một bên báo tại dòng, không làm lệch cặp): mỗi cặp áp dụng → proxy cũ **Đã replace** (rời danh sách Blocked), chuỗi cũ → mới lưu trong `ProxyReplacement`, proxy mới tạo trong kho và **VM đang dùng proxy cũ đổi sang proxy mới trong cùng giao dịch**, tình trạng VM trở về mốc trước Blocked.
- Cặp mà proxy cũ đang ở VM nhưng proxy mới chưa xác định được gói / user-pass bị chặn tại dòng (để không có trường hợp kho đã đổi mà VM vẫn giữ proxy cũ).
- Đổi sang một proxy dự phòng sẵn có (ô Proxy) **không** phải replace: proxy cũ BLOCKED vẫn BLOCKED (vẫn copy được để yêu cầu nhà cung cấp xử lý).
- Bỏ gán proxy tốt ở Kho xử lý theo quy tắc NEW / LIVE hiện hành, không tự đánh dấu Blocked. Vị trí "đã cài" cũ nay bỏ gán / chuyển như vị trí thường; chỉ bản "Giữ để kiểm tra" có dấu hiệu cài cũ chưa rõ là phải đối chiếu ở ô Proxy trước.
- Mọi đường gán / đổi proxy (ô Proxy, Dán bảng, Kho proxy, nhận replace, tạo lại VM) đi qua một hàm lõi `assignProxyToVm` (`src/server/vm-management/proxy-change.ts`).

## Blocked và tình trạng VM

- Mốc trước Blocked lưu trên `VmOperation` (`blockedFrom`, `blockedFromKnown`, `blockedEndpointId`, `blockedCycle`, `blockedAt`; migration `20261019210000_vm_blocked_from`, chỉ thêm cột).
- Báo BLOCKED (Kho: Báo BLOCKED, sửa trạng thái BLOCKED; hoặc chọn **Blocked** ở cột Tình trạng của VM) → VM đang dùng proxy đó chuyển Blocked, nhớ tình trạng trước đó, đúng VM, lượt, proxy.
  - Báo lặp lại không ghi đè mốc ban đầu.
  - VM đang SUS / OFF VM / Earn-VM lỗi / VM deleted giữ tình trạng đó; ô Proxy vẫn báo Blocked.
  - Chọn Blocked tại VM khi VM chưa có proxy rõ ràng bị từ chối tại dòng; không có quyền Báo BLOCKED cũng bị từ chối.
  - Dữ liệu cũ đang Blocked mà thiếu mốc: tìm sự kiện chuyển sang Blocked trong lịch sử lượt hiện tại; không thấy thì khi thay proxy để **Chưa ghi** và ghi rõ trong lịch sử. Không đoán thành OK.
- Thay proxy (ô Proxy hoặc replace ở Kho) → nếu VM **vẫn** đang Blocked của đúng proxy và lượt đó thì trở về tình trạng đã nhớ (OK → OK, Chưa nối → Chưa nối, LINKED → LINKED, Chưa ghi → Chưa ghi). Người vận hành đã đổi sang tình trạng khác trong lúc chờ (SUS, OFF…) thì giữ quyết định mới hơn. Mốc của lượt cũ không dùng cho lượt mới.
- Ghi nhận tạo lại VM: proxy hợp lệ được giữ cho vị trí ở lượt mới (gán là xong); proxy BLOCKED vẫn ở vị trí, ô Proxy báo Blocked và vẫn phải thay; mốc Blocked bị xoá vì sang lượt mới.

## Copy proxy Blocked

- Server / VM: nút **Copy proxy Blocked (N)** cạnh dải đếm (và trong thanh chọn nhiều dòng). Có chọn dòng: proxy Blocked hiện hành của các dòng đó. Không chọn: trong toàn bộ bộ lọc hiện tại (mọi trang), không âm thầm lấy cả dự án.
- Kho proxy: nút **Copy proxy Blocked (N)** thay khung "Copy BLOCKED" cũ. Có chọn dòng: các dòng đã chọn; không chọn: mọi trang của bộ lọc (`proxyManagement.copyBlockedEndpoints / copyBlockedFiltered`).
- Một lần bấm copy ngay (trình duyệt chặn thì hiện khung để copy tay). Mỗi dòng `IP:port:user:pass`, không thêm server, nhãn hay ghi chú; giữ thứ tự hiển thị; mỗi endpoint một lần; các cổng của IP nhiều cổng là các dòng riêng. Chỉ proxy hiện hành đang BLOCKED (trạng thái có cấu trúc, không đọc ghi chú), không lấy proxy đã replace.
- Thông báo "Đã copy N proxy Blocked"; dòng thiếu user/pass được đếm và nêu lý do. Backend kiểm quyền copy credentials; nhật ký chỉ ghi số lượng.

## Lịch sử, hoàn tác, đồng thời

- Lịch sử thao tác: "Thay proxy của VM" (ảnh VM, cấu hình, vị trí, proxy, tình trạng VM); sự kiện proxy "Dùng cho VM" / "Rời VM"; sự kiện tình trạng VM ghi trước / sau và lý do.
- Hoàn tác (ADMIN) khi chưa có thay đổi phụ thuộc: trả proxy cũ, vị trí, trạng thái kho và tình trạng VM. Không hồi sinh SDK / tài khoản / email đã dùng, không mở lại lượt VM đã đóng.
- Hai người cùng thay một VM: người sau bị từ chối (revision VM), không cập nhật nửa chừng. Đổi proxy không thay giá gói, hạn thanh toán hay chi phí; không đổi SDK, EarnApp, PayPal hay lượt VM.

## Kiểm tra

- Test: `proxy-change.integration.test.ts` (7 ca) cùng các test cũ đã cập nhật (`vm-management`, `vm-ops` 4a / 4b, `proxy-edit`, `vm-admin`, `vm-workflow`, `links`, `menu-modules`, `dashboard-overview`).
- Nghiệm thu trình duyệt: `docs/superpowers/evidence/2026-10-19-money-proxy/`.
