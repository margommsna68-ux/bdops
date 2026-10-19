# SDK EarnApp và Kho SDK

Cập nhật 19/10/2026 theo brief của chủ dự án (Kho SDK, thao tác tại ô SDK). Bản này **thay thế** quy tắc SDK cũ của mốc 1 (15/10). Bằng chứng: `../superpowers/evidence/2026-10-19-sdk-store/`.

## Quy tắc thay thế quy tắc cũ

| Trước 19/10 | Từ 19/10 |
|---|---|
| SDK chỉ là chuỗi `VirtualMachine.sdkId` cộng lịch sử đổi mã theo VM. | Mỗi mã là một bản ghi `SdkRecord` (mã, vị trí VM hiện hành, tiền tích luỹ, ghi chú, trạng thái nối EarnApp, người / giờ). `VirtualMachine.sdkId` chỉ là bản sao do cùng một hàm ghi. |
| Mã đang ở VM khác: "xóa ở máy cũ trước, không tự dời". | Chuyển rõ nguồn → đích bằng **Chọn SDK đã lưu → Dùng cho VM này**: nguồn, đích và mã cập nhật trong một giao dịch. Gõ / dán mã đang ở VM khác vẫn không lấy ngầm. |
| Xoá SDK = ô trống; mã cũ chỉ còn trong lịch sử. | **Gỡ khỏi VM** không xoá mã: mã chưa nối về Kho SDK để dùng lại, mã đã nối giữ để tra cứu. |
| Tạo lại VM: SDK hiện hành vào lịch sử. | Tạo lại VM: mã rời vị trí; chưa nối thì về Kho SDK (giữ tiền, ghi chú), đã nối thì vào lịch sử. Web không tự sinh SDK mới. |
| Khôi phục VM bị chặn nếu SDK của máy đã thuộc VM khác. | Khôi phục VM luôn được (theo các kiểm tra khác); mã đã chuyển đi không bị lấy lại. |
| Sửa SDK bằng Enter/F2 và Tab như ô văn bản. | Bấm ô SDK (hoặc Enter/F2) mở khung SDK ngay cạnh ô; Tab chỉ còn đi qua mã VM và ghi chú. |

## Quy tắc

- **Một VM tối đa một SDK hiện hành; một SDK tối đa một vị trí VM.** DB bảo đảm bằng `SdkRecord.vmId` unique và unique (dự án, mã).
- **Kho SDK dùng chung mọi server trong một dự án.** Mã ở dự án khác bị từ chối với câu trung tính, không nêu dự án, server, VM hay tiền.
- **Trạng thái nối EarnApp**
  - *Chưa nối*: web chưa ghi mã từng nối. Chỉ mã này được dùng lại hoặc chuyển VM.
  - *Đã nối EarnApp*: lưu tài khoản, VM, lượt, người và giờ. Không bao giờ dùng lại, kể cả khi bỏ gán, xoá VM, tạo lại VM, đóng account hay hoàn tác.
  - *Chưa xác nhận*: dữ liệu cũ không đủ bằng chứng. Hiện trong Kho SDK, không có trong danh sách chọn, cho tới khi người có quyền bấm **Xác nhận chưa từng nối** hoặc **Đã từng nối (chỉ để tra cứu)** tại dòng.
- **Ghi SDK, gán tài khoản cho VM và ghi "Đã nối EarnApp" là ba sự kiện khác nhau.** Không tự đánh dấu đã nối vì ô tài khoản có dữ liệu, vì đã ghi SDK, hay vì nhãn tình trạng VM. Không tự suy ra "chưa nối" vì thiếu liên kết.
- **Tiền tích luỹ** là số gần nhất người vận hành ghi, mặc định USD, lưu chính xác tới 6 số lẻ, kèm giờ và người ghi.
  - Không phải giá mua. Không tạo chi phí, doanh thu, khoản thu PayPal hay lợi nhuận.
  - Không cộng dồn.
  - *Chưa ghi tiền* khác *0,00 USD*.
  - Nhận "12,40", "12.40", "1.234,56". Không nhận số âm.
- **Tiền và ghi chú thuộc về mã SDK.** Mã mới không mang tiền / ghi chú của mã bị thay. Chọn lại một mã thì đọc đúng giá trị đang lưu của mã đó. Chuyển VM giữ nguyên.
- **Ghi SDK không đổi** tài khoản EarnApp, PayPal hay tình trạng vận hành VM. Web chỉ ghi việc dùng SDK, không nói đã di chuyển hay cài máy thật.

## Thao tác tại ô SDK

- **Ô hiển thị hai dòng:** `sdk-A123…` có nút copy, và dòng `12,40 USD · Chưa nối`. Nút copy chỉ copy.
- **Bấm phần còn lại của ô** (hoặc Enter/F2) mở khung nhỏ cạnh ô, gồm:
  - Mã SDK, Tiền tích luỹ (USD), Ghi chú SDK.
  - **Chọn SDK đã lưu**: chỉ mã chưa nối; mã trong kho xếp trước, có tìm theo mã / server / VM / ghi chú.
  - **Lịch sử** của mã.
  - **Lưu** hoặc **Dùng cho VM này**, **Gỡ khỏi VM**, **Huỷ**.
- **Bàn phím:** Enter lưu; trong ghi chú Shift+Enter xuống dòng. Esc huỷ và bỏ nháp. Đang gõ dấu tiếng Việt thì Enter không lưu.
- **Bấm ra ngoài** chỉ đóng khung. Nội dung đang sửa thành nháp, ô hiện "● Nháp chưa lưu"; nháp còn sau khi tải lại và tách theo dự án.
- **Nút Lưu:** mờ khi chưa có thay đổi, xanh khi có thay đổi hợp lệ. Đang lưu thì hiện "Đang lưu…".
- **Khi lỗi** (VM vừa đổi, mã đã nối, người khác vừa lấy mã), lý do hiện trong khung và nội dung đang nhập được giữ.
- **Ô tiền / ghi chú chưa sửa** luôn hiện giá trị đang lưu của chính mã ở ô Mã SDK và không được gửi đi. Nhờ vậy không bao giờ xoá nhầm tiền của mã khác, kể cả khi kho tải chậm. Lỗi này được tìm ra khi kiểm trình duyệt ngày 19/10 và đã sửa.
- **Thay mã hiện hành bằng mã mới:** mã cũ chưa nối tự về kho cùng tiền và ghi chú; mã cũ đã nối vào lịch sử. Không cần "backup mã cũ".
- **Mã đang ở VM khác** (gõ hoặc chọn): ngay cạnh nút hiện `moon1 / VM_001 → moon05 / VM_008`. Bấm **Dùng cho VM này** là một thao tác chuyển:
  - Máy nguồn hết mã đó; SDK cũ của máy đích giữ theo quy tắc trên.
  - Nếu nguồn, đích hoặc mã vừa bị đổi thì báo lỗi, giữ lựa chọn, không lưu nửa chừng.
- **Đã nối EarnApp:** khung hiện SDK, tài khoản EarnApp hiện hành của VM và lượt. Một lần bấm là xong.
  - Backend kiểm tra đúng SDK hiện hành (revision), đúng tài khoản hiện hành, VM chưa xoá, đúng lượt.
  - VM chưa có tài khoản: khung báo ngay.
- Khung chi tiết VM (tab Tổng quan) dùng cùng khung SDK.

## Kho SDK

Nút **Kho SDK** ở đầu trang Server / VM (không có mục ở sidebar). Kho mở trong cùng trang; bảng VM vẫn giữ vị trí cuộn bên dưới.

- **Bảng:** SDK | Tiền tích luỹ | Vị trí hiện tại | Tình trạng | Ghi chú.
  - *Trong kho* khác *Đang ở moon1 / VM_001* (có thể là VM đã xoá).
  - Bấm vị trí để mở đúng VM đó trong bảng.
- **Mặc định** hiện *Chưa nối*. Các bộ lọc khác: *Chưa xác nhận*, *Đã nối (lịch sử)*, *Tất cả*.
- **Tìm, lọc, sắp xếp:** tìm theo SDK / server / VM / ghi chú. Lọc *Mọi vị trí / Trong kho / Đang ở VM*. Sắp xếp *Cập nhật gần nhất / Tiền cao → thấp / Tiền thấp → cao / Theo mã*; mã chưa ghi tiền luôn xếp sau, không coi là 0.
  - Lọc và sắp xếp trên toàn bộ kết quả rồi mới chia trang (50 mã / trang).
  - Trạng thái kho, ô tìm, bộ lọc, sắp xếp và trang nằm trong URL (`sdk=1&sq=&sf=&sl=&ss=&sp=`), nên Back / Forward, tải lại và đổi server giữ đúng chỗ.
- **Mở một dòng:**
  - Lịch sử của mã: VM từng dùng, các lần chuyển, tiền / ghi chú cũ → mới, tài khoản đã nối, xác nhận, hoàn tác.
  - Sửa tiền / ghi chú.
  - Với dữ liệu cũ: hai nút xác nhận.
- **Dán SDK vào kho:** mỗi dòng `SDK | Tiền tích luỹ USD | Ghi chú`, phân cách bằng tab hoặc `|`. Có thể lưu mã vào kho trước, chưa gán VM.
  - Dán là tự kiểm tra từng dòng, chưa ghi gì; không có nút Xem trước.
  - Một nút **Lưu N SDK** cho các dòng sẽ thay đổi.
  - Mã đã có là *Cập nhật* (hiện cũ → mới), không tạo mã thứ hai.
  - Mã lặp trong danh sách bị báo ở mọi dòng lặp.
  - Ô trống giữ nguyên; gõ `-` để xoá tiền / ghi chú.
  - Dán lại đúng dữ liệu thì mọi dòng *Giữ nguyên*, không tạo lịch sử.
  - Mất phản hồi khi lưu: nội dung giữ nguyên và giữ cùng khoá lệnh, nên bấm lại không ghi thêm.
  - Sau khi lưu, ô dán chỉ còn các dòng lỗi. Nháp dán lưu theo dự án.

## Dán SDK theo VM (Dán bảng → SDK)

- **Một server:** `VM | SDK | Tiền tích luỹ USD | Ghi chú SDK`. **Nhiều server:** `Server | VM | SDK | …`. Hai cột cuối là tuỳ chọn.
- **Ghép dòng:** theo đúng server + mã VM; không ghép theo thứ tự, không tự tạo VM.
- **Tiền / ghi chú** là của mã SDK đích, không lấy từ mã bị thay.
- **Kết quả từng dòng:** *Ghi SDK mới*, *Dùng SDK trong kho*, *Đổi SDK (mã cũ giữ lại)*, *Cập nhật tiền / ghi chú SDK*, *Giữ nguyên*, hoặc lỗi.
  - Lỗi có thể là: mã đang ở VM khác (kèm chỉ dẫn chuyển), mã đã nối, mã chưa xác nhận, mã của dự án khác, mã lặp, tiền sai.
- **Gỡ SDK:** gõ `-` ở ô SDK. Mã vẫn giữ trong kho hoặc lịch sử.
- **Kiểm tra chung:** Dán bảng, endpoint cũ `vmManagement.sdkPreview` / `sdkApply`, ô SDK và Kho SDK đi qua cùng `planPlacement` / `applyPlacement` trong `src/server/vm-management/sdk-store.ts`.

## Quyền, đồng thời, hoàn tác

- **Quyền** như giao proxy:
  - Ghi (ô SDK, dán, kho, xác nhận, đã nối) cần quyền ASSIGN của Server / VM.
  - Chỉ xem (VIEWER) đọc được kho, không ghi.
  - Người ngoài dự án bị FORBIDDEN, kể cả khi gọi endpoint trực tiếp.
  - Người và AI dùng chung endpoint `vmManagement.sdkSave / sdkLink / sdkConfirm / sdkInfo / sdkStore / sdkDetail / sdkStorePreview / sdkStoreApply`.
- **Kiểm tra khi ghi:** mọi lệnh kiểm revision của VM (và VM nguồn khi chuyển), revision của mã khi có, và lượt VM hiện hành (`expectedCycle`). Lệnh soạn cho lượt cũ bị từ chối.
  - Giao dịch serializable: hai người cùng lấy một mã thì chỉ một người thành công; người kia thấy lý do trong khung.
  - Mỗi lệnh có khoá: bấm lặp hoặc gửi lại sau khi mất phản hồi không ghi thêm.
- **Phiên bản SDK (review độc lập 19/10/2026):** sửa tiền / ghi chú tăng revision của mã, không tăng revision VM. Vì vậy mọi đường ghi kiểm thêm revision của chính mã đó: `sdkSave` (bắt buộc `expectedSdkRevision`; `null` = "tôi không thấy mã này trong kho", bị từ chối nếu mã đã có), Dán bảng (`bulkPreview` trả `expectedSdkRevision` theo dòng, `bulkApply` từ chối dòng khi mã đổi), Kho SDK (`sdkInfo`, `sdkStoreApply`). Mã đổi sau khi kiểm tra thì giá trị mới trên server được giữ, dòng / khung báo lỗi, nội dung đang nhập được giữ. Test chính thức `sdk-stale.integration.test.ts` (chuyển từ hai ca tái hiện `.runtime/review-sdk-stale-20261019.test.ts`).
- **Nháp khung SDK** ghi người, dự án, VM, lượt, revision VM, revision SDK hiện tại và revision của mã đang đặt lúc bắt đầu sửa. Sau khi VM tạo lại, mã chuyển máy hoặc người khác sửa, khung báo ngay và chờ "Kiểm tra lại" (lấy phiên bản mới, giữ chữ đang nhập); không tự lấy revision / lượt mới. Lưu mất phản hồi giữ khoá yêu cầu trong nháp; lưu lại cùng nội dung dùng lại khoá đó.
- **Kiểm tra bản dán** (Kho SDK, Dán bảng): kết quả chỉ dùng cho đúng nội dung đã kiểm; đổi / xoá nội dung khi đang kiểm tra thì kết quả cũ về muộn bị bỏ, nút Lưu / Áp dụng không bật cho danh sách cũ.
- **Hoàn tác** (Lịch sử thao tác):
  - Sửa tiền / ghi chú, ghi mã mới, thay mã và chuyển mã hoàn tác được khi các mã và vị trí VM liên quan chưa bị đổi tiếp.
  - Hoàn tác lần ghi một mã mới thì gỡ mã đó.
  - Không hoàn tác được: "Đã nối EarnApp", "Đã từng nối", và các lần ghi SDK trước khi có Kho SDK (chỉ để xem).
  - Hoàn tác không bao giờ biến mã đã nối thành chưa nối, không mở lại lượt cũ hay tài khoản đã đóng.
- **Xoá / khôi phục VM:**
  - Xoá VM giữ SDK tại vị trí đã xoá (kho ghi "(đã xoá)"). Mã chưa nối vẫn chuyển ra được.
  - Khôi phục VM không giành lại mã đã chuyển đi.

## Dữ liệu và migration

Migration `20261019150000_sdk_store` (chỉ thêm), đã chạy thử trên bản sao database cục bộ riêng trước:
- **Bảng mới:** `SdkRecord`, `SdkEvent`, enum `SdkLinkState`.
- **SDK hiện hành của VM managed:** mỗi mã một bản ghi ở đúng VM, trạng thái **Chưa xác nhận**, không ghi tiền.
  - Một mã nằm ở nhiều VM (VM hoạt động và VM đã xoá) thì VM hoạt động giữ mã; VM kia chỉ mất bản sao, có dòng lịch sử.
- **Mã chỉ còn trong lịch sử SDK hoặc lượt đã đóng:** vào kho, **Chưa xác nhận**.
- **Mỗi mã** có một sự kiện MIGRATE. Không dùng tình trạng VM hay việc thiếu account làm bằng chứng chưa nối.
- **Số trên host trước migration** (đọc 19/10): 0 VM có SDK, 0 thao tác ghi SDK, nên host không có mã nào để chuyển.
