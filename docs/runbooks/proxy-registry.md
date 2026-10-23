# Bảng proxy: lọc server, cột Server/VM tách riêng, copy một bấm và copy hàng loạt

Triển khai 16/10/2026 (commit `8a2d009`, deploy Railway `3ed8ac87`, backup trước `e744a26a`) theo yêu cầu của anh ("bảng proxy dễ tìm, dễ lọc và copy nhanh như bảng tính"). Bằng chứng: `../superpowers/evidence/2026-10-16-proxy-registry.md`. Gói proxy, thanh toán và sắp xếp theo gói xem `proxy-packages.md`.

## Cột vị trí

Trang **Kho proxy** tách vị trí thành ba cột:

| Cột | Nội dung |
|---|---|
| Server | mã server (`An-01`, `moon1`…) |
| VM | mã VM (`VM_001`) |
| Ghi chú vận hành | *Chờ cài* (đã giao cấu hình, chưa xác nhận cài), *Đã cài*, *Giữ để kiểm tra*; trống khi vị trí chỉ là liên kết VM ghi từ Sheet |

Một proxy có nhiều vị trí hợp lệ (ví dụ đang giữ cho một VM và vẫn ghi ở VM khác theo Sheet) hiện đủ từng dòng trong cùng ô. Dòng chưa có vị trí hiện **Chưa gán**; dòng của genjy hiện *genjy*. API `proxyManagement.list` trả `locations[] {serverId, serverCode, vmId, vmCode, role}`; không còn chuỗi `server/VM · ghi chú`.

## Lọc và sắp xếp theo server

- Ô **Lọc server** (trước ô sở hữu): chọn nhiều server, lấy từ dữ liệu thực của dự án, thêm **Chưa gán server**. Kết hợp với sở hữu, trạng thái, gói, tìm kiếm và tab.
- Lọc và sắp xếp chạy trên toàn bộ kết quả rồi mới phân trang 50 dòng; chân bảng hiện `đang hiện / tổng`. Đổi bộ lọc luôn về trang đầu.
- **Theo server / VM**: server → VM → gói → IP, so sánh số tự nhiên (`moon2` trước `moon10`, `VM_002` trước `VM_010`); dòng chưa gán xếp cuối. Dòng nhiều vị trí xếp theo vị trí nhỏ nhất.
- URL giữ `?servers=moon1,moon2,none` (`none` = chưa gán), `?sort=`, `?package=`, `?owner=`, `?state=`; mở lại link vẫn đúng bộ lọc.
- Ô tìm kiếm khớp cả mã server, mã VM và `server/VM`.

## Copy proxy

- **Biểu tượng Copy** ở cuối dòng: một bấm là copy ngay `IP:port:user:pass`, báo ngắn *Đã copy …*. Không mở hộp thoại. Thông tin lấy qua endpoint có kiểm tra quyền COPY_CREDENTIALS ngay lúc bấm, không tải sẵn user/pass của cả bảng.
- **Copy nhiều dòng**: tick ô đầu dòng (hoặc ô tiêu đề = cả trang) → thanh *Đã chọn N proxy* → **Copy proxy** → mỗi dòng một proxy đầy đủ theo thứ tự đang hiển thị → **Bỏ chọn**. Đổi bộ lọc hoặc sang trang khác thì bỏ chọn.
- **Copy toàn bộ kết quả lọc (N)** (cạnh Copy BLOCKED): copy mọi dòng khớp bộ lọc hiện tại, không chỉ trang này.
- Dòng không có user/pass (chỉ IP) hoặc không có endpoint (IP giữ cho genjy) không bao giờ được copy như proxy đầy đủ; thông báo nêu số dòng bỏ qua và lý do (*thiếu user/pass*, *chỉ có IP từ Genjy*). Không copy được dòng nào thì báo lỗi.
- Proxy đang giữ cho VM (*Chờ cài*) copy được từ bảng này; thao tác đó **không** đánh dấu bắt đầu cài và không chặn hoàn tác kế hoạch VM. Khi cài thật vẫn dùng **Copy để cài** ở Việc cài / Server-VM để ghi phiên bản cấu hình.
- Trình duyệt chặn ghi clipboard (Safari cũ, không có quyền) thì hiện hộp thoại chứa nội dung để chọn và Ctrl+C.

## Quyền, nhật ký, giới hạn

- `proxyManagement.copyEndpoint` (một dòng), `copyEndpoints` (danh sách id, tối đa 2.000, mọi id phải thuộc dự án, sai một id là từ chối cả lệnh) và `copyFiltered` (cùng bộ lọc với `list`). Tất cả yêu cầu COPY_CREDENTIALS và kiểm tra lại thành viên lúc gọi.
- Nhật ký `COPY_PROXY_CREDENTIALS` chỉ ghi số dòng copy / tổng / số bỏ qua, không ghi user/pass; không có credentials trong URL, log hay thông báo.
- Thông báo toast dùng `react-hot-toast`; `<Toaster/>` được gắn trong `src/app/providers.tsx` (trước đây thiếu nên mọi toast không hiện).
- Chưa làm: nhớ lựa chọn qua nhiều trang, xuất file, lọc theo VM riêng, phân trang phía server (danh sách vẫn tải cả kho rồi lọc trong bộ nhớ, ~1 s với 1.362 proxy).

## Page in the URL (18 October 2026)

- `?page=N` (1 is the default) is part of the registry URL. Next / previous page are history entries.
- Back from another page, reload or a direct URL open the same page with the same filters.
- Any change of search, servers, group, state, package, sort or tab goes back to page 1.
- `proxyManagement.list` accepts `page` (cursor still works). A page past the end (rows changed since the link) is served as the
  last page and reported back (`page` in the result). The URL is corrected without a history entry, with the note
  *Trang N không còn (danh sách đã thay đổi)*.

## Thanh công cụ Kho proxy — 23/10/2026

- Nhập mới / Báo BLOCKED / Nhận replace nằm cùng hàng. Menu Copy có hai mục: kết quả đang lọc (mọi trang), và proxy BLOCKED (trong lựa chọn nếu đã tick, nếu không thì theo bộ lọc trên mọi trang).
- Nút BLOCKED nhỏ cạnh ô tìm kiếm chỉ bật/tắt lọc, giữ nguyên cách sắp xếp; màu đỏ nhẹ là đang bật. Báo BLOCKED ở hàng thao tác mới là lệnh ghi.
- Gói, server, nhóm, trạng thái và sắp xếp nằm trong một bộ lọc có nhãn. Số lượng nhóm chuyển vào danh sách nhóm, không còn hàng nút nhóm trùng lặp.
- Bỏ lọc xoá điều kiện tìm/nhóm/trạng thái/gói/server/đợt; giữ tab hiện tại và cách sắp xếp. Bộ lọc vẫn giữ trên URL.
