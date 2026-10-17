# Bảng vận hành Server / VM

Trang `/infrastructure/servers` (tất cả server) và `/infrastructure/servers/<id>` (một server). Triển khai 17/10/2026, nối tiếp phần [quản trị Server / VM](server-vm-admin.md) (tạo theo khoảng, sửa tại chỗ, xoá có khôi phục). Bằng chứng: `../superpowers/evidence/2026-10-17-server-vm-table.md`.

## Bố cục

- **Đầu trang**
  - *Ô chọn server*: có ở mọi trang Server/VM, kể cả `/servers/<id>`. Gõ tên hoặc IP để lọc, ↑↓ rồi Enter để chọn; chọn xong chuyển thẳng sang server đó.
  - Tên server sửa tại chỗ; IP và ghi chú server nằm ngay dưới tên.
  - Các nút: **Thêm VM**, **Dán bảng**, Tải lại, menu **⋯** (Thêm server, Việc cài proxy, Quản lý proxy, **Xoá server**).
- **Dải đếm**: Tất cả · Thiếu proxy · Chờ cài · Đã cài · Cần kiểm tra · Chưa SDK · Đã xoá. Bấm vào số để lọc, bấm lần nữa để bỏ lọc.
- **Thanh công cụ**: ô tìm (VM, IP, SDK, Gmail, ghi chú), sắp xếp (mã VM, cần xử lý trước, thiếu proxy trước, chưa SDK trước) và mục **Cột**.
- **Bảng** có vùng cuộn riêng, cao vừa màn hình nên trang không phải cuộn.
  - Tiêu đề cột dính trên.
  - Bên trái luôn thấy ô chọn + Server (chỉ khi xem tất cả) + VM; bên phải luôn thấy **⋯**.
  - Thanh cuộn ngang nằm ngay đáy vùng bảng.
  - Số dòng và nút trang có ở cả đầu và cuối bảng; chọn 50/100/200 dòng mỗi trang.
- **Cột mặc định**: VM · Proxy · SDK · Gmail của VM · Tình trạng · Ghi chú · ⋯.
  - *Proxy*:
    - Giao và đã cài cùng một cấu hình thì hiện một dòng có nhãn *Đã cài*.
    - Khác nhau thì hiện hai dòng *Giao* / *Cài*, có vạch vàng bên trái.
    - Proxy giữ để kiểm tra hiện thêm một dòng nhỏ.
    - Mỗi dòng có nút copy riêng.
  - *SDK*: rút gọn kiểu `sdk-1234…cdef`. Rê chuột xem đủ, có nút copy mã đầy đủ.
  - *Gmail của VM*: Gmail đang liên kết với máy, không phải tài khoản EarnApp. Bấm vào để đổi.
  - *Tình trạng*: chỉ có nhãn; *Cần kiểm tra* kèm lý do một dòng.
  - *Ghi chú*: tối đa 2 dòng; xem đủ khi rê chuột hoặc trong khung chi tiết.
  - Hàng cao khoảng 44–46 px, kể cả khi ghi chú 950 ký tự hay SDK 124 ký tự.
- **Cột** cho bật thêm *Cấu hình* (Giao #n / Cài #m), *SDK ghi bởi* và *Tiến độ cài*. Kéo để đổi thứ tự (hoặc dùng ↑↓), kéo mép tiêu đề cột để đổi độ rộng, có *Khôi phục mặc định*. Lựa chọn lưu theo tài khoản trên trình duyệt đang dùng.
- **Khung bên phải** (không phải hộp thoại chồng lên nhau)
  - Chi tiết VM gồm 6 tab:
    - *Tổng quan*: proxy giao/đã cài, người và ngày, copy; SDK đầy đủ, Xoá SDK; Gmail; ghi chú đầy đủ.
    - *Proxy*: gán / đổi.
    - *Việc cài*: dùng đúng phần Cài / xác nhận của trang Việc cài.
    - *Công việc*.
    - *Gmail*.
    - *Lịch sử*: mọi phiên bản cấu hình kèm người/ngày giao, bắt đầu, xác nhận, và lịch sử SDK.
  - Khung cũng dùng cho Dán bảng và các thao tác hàng loạt.
  - Đóng bằng ✕, Esc hoặc nút Back. Khi đóng, bảng giữ nguyên vị trí cuộn và focus trở về dòng đang làm.
- **URL** giữ server (đường dẫn), ô tìm `q`, bộ lọc `view`, sắp xếp `sort`, trang `page`, số dòng `size`, VM đang mở `vm` và tab `tab`. Tải lại hoặc Back/Forward đều về đúng chỗ.

## Sửa ô bằng bàn phím

- Ô sửa được: **mã VM**, **SDK**, **ghi chú**.
  - Mở sửa: Enter, F2 hoặc bấm đúp.
  - **Enter** lưu; với ghi chú, Shift+Enter xuống dòng.
  - **Tab / Shift+Tab** lưu rồi mở ô sửa được kế tiếp, hết hàng thì sang hàng sau.
  - **Esc** huỷ.
- Chỉ chuyển ô khi lưu thành công. Lỗi (trùng mã, VM vừa bị sửa ở nơi khác…) hiện ngay dưới ô, chữ và focus giữ nguyên.
- Đang gõ dấu tiếng Việt (bộ gõ chưa chốt chữ) thì Enter không lưu. Rời ô cũng không tự lưu.
- Giới hạn: mã VM 64 ký tự, SDK 8–128 ký tự, ghi chú 1000 ký tự.
- Giữ nguyên giá trị cũ thì không ghi gì, không có lịch sử.
- **Bản nháp** còn sau khi tải lại trang, đổi bộ lọc hay đóng khung. Ô còn nháp vẫn mở sẵn ở chế độ sửa, chỉ mất khi lưu hoặc huỷ.
- Xoá SDK là thao tác riêng: nút *Xoá SDK* trong chi tiết VM, hoặc gõ `-` trong Dán bảng. Để trống ô SDK không bao giờ xoá SDK.

## Dán bảng

1. Bấm **Dán bảng**, chọn một loại: **SDK**, **Proxy**, **Gmail hiện có** hoặc **Ghi chú**. Mỗi đợt chỉ một loại.
2. Chọn server rồi dán `VM | giá trị`, hoặc chọn *Nhiều server* rồi dán `Server | VM | giá trị`. Cột phân cách bằng tab (dán từ Sheet) hoặc `|`.
3. Bấm **Xem trước**. Ngay trong khung hiện từng dòng gồm VM, *cũ → mới* và kết quả *Hợp lệ / Giữ nguyên / Lỗi*.
4. Bấm **Áp dụng N dòng hợp lệ**. Không có hộp xác nhận thêm.

Quy tắc:
- **Cách ghép dòng**
  - Ghép theo server + mã VM, không theo thứ tự dòng.
  - VM lặp trong danh sách: mọi dòng lặp đều báo lỗi, không lấy dòng cuối.
  - Máy đã xoá không nhận cập nhật.
- **Ô trống và xoá**: ô trống giữ nguyên. Gõ `-` để xoá giá trị (SDK, Gmail, ghi chú).
- **Từng loại**
  - **SDK**: mỗi SDK một VM. Không lấy SDK đang thuộc máy khác.
  - **Proxy**
    - Dán IP, IP:port hoặc đủ IP:port:user:pass.
    - Chỉ TUT hoặc Chung mooon–Genjy, chỉ vào VM đang trống.
    - Proxy đang ở VM khác thì báo chỗ đó, không tự chuyển.
    - VM đang có proxy thì dùng *Đổi proxy* ở ⋯. Dán bảng không bỏ gán.
  - **Gmail**: chỉ Gmail đã có trong dự án, không tự tạo. Một Gmail dùng cho nhiều VM được, không tháo khỏi VM khác.
  - **Ghi chú**: phần sau cột VM là ghi chú, được chứa ký tự `|`.
- **Khi áp dụng và thử lại**
  - Khi áp dụng, máy chủ kiểm tra lại từng dòng (revision, quyền, xung đột). Dòng hợp lệ được lưu; dòng bị đổi sau xem trước hoặc xung đột giữ nguyên và báo riêng.
  - Ô dán chỉ còn lại các dòng lỗi để sửa. Thử lại thì dòng đã lưu thành *Giữ nguyên*, không ghi lịch sử lần hai.
  - Mỗi lần áp dụng là một thao tác trong *Lịch sử thao tác*, hoàn tác được.

## Chọn nhiều và thanh hàng loạt

- **Cách chọn**
  - Ô chọn ở đầu bảng chọn **các dòng trên trang hiện tại**.
  - Khi cả trang đã được chọn, thanh hiện thêm *Chọn tất cả N kết quả đang lọc*.
  - Lựa chọn lưu theo ID nên đổi trang hay sắp xếp vẫn giữ. Thanh ghi *Đã chọn N VM (M không ở trang này)*.
  - Đổi server, bộ lọc, ô tìm hoặc dự án thì bỏ chọn.
  - Dòng mới xuất hiện không tự vào lựa chọn. Dòng rời bộ lọc sau một thao tác (ví dụ Thiếu proxy → Chờ cài) vẫn được chọn.
- **Copy proxy**
  - *Copy được giao* hoặc *Copy đã cài*, theo thứ tự bảng, mỗi dòng một proxy.
  - Báo số dòng đã copy và số bỏ qua kèm lý do.
  - Không trộn hai loại.
- **Gán proxy**
  - *Tự điền TUT NEW* nhận **đúng các VM đã chọn**; chưa chọn VM thì không có nút.
    - Chỉ dùng TUT NEW chưa dùng, vào ô trống thật.
    - VM không đủ điều kiện được giữ nguyên và nêu lý do.
    - Chung mooon–Genjy và Genjy riêng không bao giờ được tự điền.
  - *Chọn tay*: chọn proxy cho từng VM từ danh sách NEW chưa dùng gồm TUT và Chung, rồi Xem trước → Áp dụng.
- **Gán Gmail**: chọn một Gmail hiện có cho các VM đã chọn.
- **Sửa ghi chú**: một ghi chú cho các VM đã chọn, hoặc *Xoá ghi chú*.
- **Xoá / Khôi phục**: như mốc trước.
  - Máy còn proxy, việc cài mở hoặc liên kết proxy đã cài bị chặn và nêu lý do.
  - *Mở VM* mở đúng máy, đúng tab, kèm dòng **Lý do bị chặn**, kể cả máy đã xoá hoặc máy không có cấu hình chờ cài.
- Không có thao tác ghi cùng một SDK cho nhiều VM.

## Copy

- **Copy thường**: nút copy trong ô Proxy, mục *Copy proxy được giao / đã cài* trong ⋯, hoặc thanh hàng loạt.
  - Bấm là chép thẳng vào clipboard, không mở hộp hiện mật khẩu.
  - Không bắt đầu cài, không đổi trạng thái, revision hay việc cài, và không làm mất khả năng hoàn tác.
  - Nhật ký chỉ ghi số lượng.
- **Copy để cài** (trong ⋯ hoặc tab Việc cài) giữ nghĩa cũ: chép và đánh dấu bắt đầu cài.
- Nếu trình duyệt chặn clipboard, nội dung hiện trong khung bên phải để tự chọn và copy.

## Số bước thực tế (đo trên giao diện)

| Việc | Trước | Sau |
|---|---|---|
| Tạo 20 VM, gán proxy cho đúng nhóm mới, ghi 20 SDK | 20 lần *Gán proxy* (hộp thoại) + Dán SDK; *Điền VM thiếu* chạy cho cả server | 14 thao tác, không mở VM nào: tạo theo khoảng → lọc *Thiếu proxy* → chọn trang → Gán proxy → Điền VM thiếu → Dán bảng → Xem trước → Áp dụng |
| Sửa ghi chú 3 VM liên tiếp | 3 × (bút → gõ → Enter) bằng chuột | Enter + 7 phím Tab/Enter, không dùng chuột |
| Ghi Gmail cho N VM | N × (Tài khoản → chọn → Lưu) | Chọn N → Gán Gmail → chọn → Xem trước → Áp dụng |
| Ghi chú giống nhau cho 2 VM ở 2 trang | Không có | 7 thao tác (chọn, sang trang, chọn, Sửa ghi chú, gõ, Xem trước, Áp dụng) |
| Copy proxy 1 VM | *Copy đã cài* mở hộp và **bắt đầu cài** | 1 bấm, không đổi gì |
| Mở chi tiết / đóng | Chuyển sang trang khác | 1 bấm / Esc, giữ chỗ |

## Kiểm soát (backend)

- **Như trước**: quyền, dự án, revision, chống bấm lặp (idempotency key), lịch sử và hoàn tác vẫn do backend kiểm tra.
- **Phân việc**: giao proxy, xác nhận cài và ghi SDK vẫn là ba việc riêng. Không thả proxy đã cài hoặc đang cài.
- **Quyền theo loại**: Dán bảng SDK/Proxy/Gmail cần quyền giao (ASSIGN), ghi chú cần quyền quản lý (MANAGE).
- **Autofill**
  - `vmManagement.preview` chế độ AUTO **bắt buộc có `vmIds`**. Thiếu thì báo *Chọn VM cần điền proxy trước*, không ngầm chạy cho cả server.
  - Trang Quản lý proxy không còn nút *Điền VM thiếu* cho cả dự án; thay bằng liên kết tới Server/VM đã lọc *Thiếu proxy*.
- **Chọn tay**: chế độ MANUAL nhận thêm proxy Chung mooon–Genjy NEW chưa dùng (cùng điều kiện như TUT). Autofill vẫn chỉ TUT.
- **API cũ** `vmManagement.archive` dùng chung kiểm tra và nhật ký với Xoá mới.

## Giới hạn

- **Lựa chọn cột** lưu theo tài khoản trong trình duyệt đang dùng (localStorage), không đồng bộ sang máy khác.
- **Dán bảng**
  - Proxy chỉ giao vào VM trống; đổi proxy của máy đang có proxy vẫn làm từng máy qua ⋯ → Đổi proxy, vì phải giữ proxy đã cài tới khi xác nhận.
  - Không có loại Dán bảng cho tài khoản EarnApp, vì entity này thuộc mốc sau.
- **Chọn tay** hiện tối đa 100 VM đầu của lựa chọn. Lựa chọn lớn hơn dùng Dán bảng loại Proxy.
- **Màn hình nhỏ**
  - Khi khung chi tiết mở ở 1366 px, bảng hẹp lại và có cuộn ngang; cột định danh và ⋯ vẫn dính.
  - Dưới 1180 px, khung chi tiết nổi lên che phần phải của bảng.
- **Bộ gõ tiếng Việt** được kiểm bằng sự kiện composition của Chrome (CDP), chưa thử trực tiếp với Unikey/EVKey trên máy anh.
