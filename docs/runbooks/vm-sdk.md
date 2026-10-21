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

> 22/10/2026 (rà soát): cả hai đường dán (`sdkPasteApply` và kind SDK của `bulkApply`) mang lượt VM của lần xem trước (`expectedCycle`),
> kiểm lại trong giao dịch, ghi tiền kèm theo vào đúng VM + lượt thật; bản dán cũ sau khi tạo lại VM bị từ chối từng dòng.


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

## Nhiều SDK tại một VM (yêu cầu chủ dự án 20/10/2026, thay các quy tắc cũ nếu mâu thuẫn)

- Một VM lưu **danh sách SDK** (`SdkRecord.holderVmId`, nhiều mã mỗi VM) để dùng ngay hoặc để sau. Thêm mã không ghi đè, không làm mất
  mã trước, không đổi SDK hiện hành (`SdkRecord.vmId`, vẫn chỉ một mã; hiện là nhãn "hiện hành" trong danh sách). Thay / gỡ mã hiện hành
  hoặc tạo lại VM thì mã cũ **vẫn ở danh sách của VM** (trước đây: về kho / lịch sử).
- **Đã dùng** = mã đã đưa vào một tài khoản EarnApp (`linkState LINKED`). Tick ở danh sách là ghi ngay (một lệnh, không dialog), lưu người,
  thời gian, lượt VM; không bỏ tick được, hoàn tác bị từ chối, không cấp lại cho VM / tài khoản khác. Không suy ra tài khoản từ tài khoản
  hiện tại của VM: `linkedEarnAppId` để trống nếu chưa biết. Lưu, copy, thêm vào VM hay chuyển VM không bao giờ tự đánh dấu Đã dùng.
- Ô SDK: mã chưa dùng đầu tiên + Copy, và "3 SDK · 2 chưa dùng" (mã chưa xác nhận đếm riêng, xem mục sửa 20/10 bên dưới). Bấm mở danh sách cạnh ô: Mã + Copy (+ lịch sử) | Tiền tích luỹ USD |
  Ghi chú | Đã dùng; chưa dùng trước, đã dùng sau. Tiền / ghi chú sửa tại chỗ (Enter lưu, Esc huỷ) trên cùng bản ghi với Kho SDK.
  Mã chưa dùng có nút đưa về kho. Ô thêm mã (Enter / Thêm) và "Chọn SDK đã lưu" (mã ở VM khác: chuyển rõ nguồn → đích).
- Tạo lại VM sau SUS: giữ ID / mã VM; mã chưa dùng (kể cả của lượt trước) vẫn trong danh sách và dùng được cho tài khoản mới; mã đã dùng
  giữ dấu và lịch sử; không đánh dấu hàng loạt. Bảng tài khoản chỉ hiện tài khoản hiện tại, chưa gán thì "Chưa có tài khoản".
- "Chưa có SDK" (bộ lọc, đếm, Tổng quan) = VM chưa có mã nào trong danh sách.
- Lệnh: `vmManagement.sdkListAdd` / `sdkUsed` / `sdkListRemove`, `sdkPastePreview` / `sdkPasteApply` (`src/server/vm-management/sdk-list.ts`):
  quyền ASSIGN, `expectedCycle` (lệnh lượt cũ bị từ chối), phiên bản của mã (cập nhật có điều kiện: hai người cùng lấy một mã thì chỉ một
  người được), khoá lệnh (lưu lặp = phát lại).

### Dán bảng → SDK (hai cách trong một khung)

- **Có mã VM**: `[Server |] VM | SDK | Tiền USD | Ghi chú`; ghép đúng server + VM, không theo thứ tự dòng; cột Server nhận ra theo giá trị;
  nhiều SDK cùng VM được.
- **Chỉ SDK, theo khoảng VM**: `SDK | Tiền USD | Ghi chú`; chọn server và VM bắt đầu, web hiện khoảng đích theo số dòng (10 dòng từ VM_011 →
  VM_020). Dòng n vào VM số (bắt đầu + n), không theo thứ tự bảng đang lọc / sắp xếp hay VM đang chọn; dòng trống giữa giữ vị trí; VM không
  có / đã xoá hoặc dòng lỗi báo tại dòng; không dồn dòng, không tự tạo VM.
- Web tự đoán cách dán theo ô đầu (mã VM / server → Có mã VM), người dùng đổi được. Tự kiểm tra khi dán: Dòng → VM → SDK → Kết quả; một
  nút "Áp dụng N SDK". Dán lại cùng mã cùng VM = Giữ nguyên, không bản sao / lịch sử thừa; ô tiền / ghi chú trống giữ nguyên. Mã ở VM khác
  báo vị trí (không chuyển ngầm); mã đã dùng không cấp lại; một mã chỉ ghi một lần trong đợt.
- Migration `20261020090000_sdk_vm_list` (thêm cột, không xoá gì): mọi mã đang ở VM vào danh sách của chính VM đó.

### Sửa sau kiểm độc lập (20/10/2026)

- **Bản dán gắn với lượt VM:** mỗi dòng xem trước mang VM và lượt VM lúc kiểm tra (`expectedCycle`); `sdkPasteApply` bắt buộc trường này và
  kiểm lại trong giao dịch lưu. VM đã được tạo lại thì dòng đó không ghi, báo "VM đã được tạo lại, kiểm tra lại dòng này", nội dung dán giữ
  nguyên; các dòng khác vẫn lưu theo từng dòng. Không bao giờ tự lấy lượt mới nhất. "Kiểm tra lại" (hiện khi có dòng lỗi) kiểm lại đúng nội
  dung đó. SDK đã lưu trước vẫn ở danh sách VM qua các lượt; chỉ yêu cầu cũ chưa lưu bị chặn.
- **Khung SDK đang mở:** nháp thêm mã giữ lượt VM lúc bắt đầu gõ và phiên bản của mã lúc người dùng thấy; dữ liệu nền tải lại không đổi chúng.
  Lượt hoặc phiên bản đã khác thì khung báo tại chỗ, nút đổi thành "Kiểm tra lại" (bấm không ghi gì), bấm Thêm sau đó mới lưu. Bị từ chối thì
  khung tải lại dữ liệu, giữ nội dung đang nhập.
- **Không ghi đè mã người khác vừa thêm:** `expectedSdkRevision = null` chỉ nghĩa là "chưa thấy mã này"; nếu mã đã xuất hiện và yêu cầu làm
  đổi tiền / ghi chú thì bị từ chối tại dòng / tại khung. Cùng mã, cùng VM và không đổi gì (giá trị như nhau hoặc ô trống) là "Giữ nguyên",
  không thêm lịch sử. Cập nhật chỉ khi đúng phiên bản đã đọc. Thử lại cùng khoá trả kết quả cũ, không ghi lại.
- **Đếm:** "chưa dùng" chỉ đếm UNLINKED; mã cũ chưa xác nhận hiện riêng ("3 SDK · 1 chưa dùng · 1 chưa xác nhận"); mã hiện ở ô / copy nhanh
  ưu tiên mã thật sự chưa dùng; danh sách xếp Chưa dùng → Chưa xác nhận → Đã dùng. Không đổi trạng thái dữ liệu cũ.
- Test: `src/__tests__/proxy-management/sdk-list-review.integration.test.ts`. Phát hành: commit e85a82f, backup host 97a9cf96, deploy 73622735, không
  migration; host chỉ đọc trước / sau giống hệt, chỉ xem trước bản dán. Evidence docs/superpowers/evidence/2026-10-20-sdk-review-fixes/.

## Ghi nhận SDK đang chạy trên máy + tiền tích luỹ (yêu cầu chủ dự án 22/10/2026)

Dùng khi khảo sát máy đang chạy (ví dụ Central đọc các VM trên vt-01): **không** phải lần cài, không cần việc (job), không cần cài lại
EarnApp hay gán tài khoản. Luồng "mỗi lần cài phải ghi SDK mới" (`POST vms/{id}/sdk` trong việc cài) giữ nguyên, riêng.

Ba loại tiền không lẫn nhau: **Tiền tích luỹ SDK** (đọc trên ứng dụng của máy đang dùng mã đó, nằm trên mã SDK) ≠ số dư tài khoản
EarnApp (cột Tiền / Rút, `balance-check`) ≠ tiền đã về PayPal (sổ PayPal). Tiền SDK không tạo chi phí, doanh thu, khoản nhận PP hay lợi
nhuận, không cộng với số dư tài khoản, không suy ra "Có thể rút".

### Hợp đồng
- `GET vms/{id}?projectId=` → `expectedCycle`, `revision` (của VM) và `sdk.items[]`: `id`, `code`, `revision`, `linkState`, `current`,
  `amount` / `observedAt` / `failedAt` (số và lần đọc lỗi **kiểm tra trên chính VM này ở lượt hiện tại**; `null` = chưa kiểm tra ở
  đây, kể cả khi mã có số từ lượt / VM khác), `moneyState` (đúng trạng thái web hiện: UNCHECKED / OK / STALE / FAILED / NO_TIME /
  HIDDEN), `stored` (số gần nhất của mã dù đọc ở đâu: `amount`, `observedAt`, `cycle`, `vmId` — lịch sử, không phải tiền lượt này),
  `recordedAt`, `source`. Lần đọc `amountRead:false` → `failedAt` mới nhất + `moneyState: FAILED`, số tốt cuối vẫn trong `amount`.
- `GET sdks?projectId=&code=A&code=B` (1–20 mã) → mã đã có ở đâu (`inListOf`, `currentOf`), `revision`, `linkState`; `found:false` = web
  chưa có mã (mã của dự án khác cũng đọc là không có).
- `POST vms/{id}/sdk-observations` (Idempotency-Key + X-Ops-Pin), body: `projectId`, `expectedCycle`, `expectedVmRevision`,
  `observedAt` (giờ đọc trên máy, không ở tương lai), `source` (ví dụ "AE Mini Tool · OCR màn hình EarnApp"), `evidence` (tuỳ chọn, ≤ 300
  ký tự, không mật khẩu / 2FA / link có mã), `sdks[]`:
  - `code`; `expectedSdkRevision` (bắt buộc: revision đã đọc; `null` **chỉ** khi web chưa có mã — mã ai đó vừa tạo bị từ chối, không ghi đè);
  - `amountUsd`: chuỗi USD đã kiểm tra, tối đa 6 số lẻ, `"0"` là một giá trị; OCR lỗi như `5_17`, `5,17` bị từ chối 422, backend không đoán;
  - `amountRead:false` = lần này không đọc được (khác 0, tiền cũ giữ nguyên); không gửi tiền = chỉ ghi mã;
  - `current:true` = mã máy đang chạy.
- Trả về `{replay, recorded, current}`: `recorded` là xác nhận của lần ghi đầu (giữ nguyên khi gửi lại cùng key), mỗi mã có `placed`
  (CREATED / TAKEN / IN_LIST), `linkState`, `current`, `revisionAfter`, `amount.outcome`; `current` là VM bây giờ.

### Quy tắc
- Quyền (một quy tắc cho API và web, rà soát độc lập 22/10/2026 — `src/server/vm-management/sdk-money-rights.ts`): ghi mã cần `VM_OPS`
  (+ quyền SDK của Server / VM); có tiền thì token cần thêm `BALANCE_WRITE` và user cần `EARN_BALANCE` (hoặc ADMIN / MODERATOR), như ghi
  số dư EarnApp. Cùng quyền ghi tiền đó áp cho mọi lệnh web có tiền: sửa tại ô SDK, Kho SDK, Dán bảng → SDK, Dán SDK vào kho, bulk; thiếu
  quyền thì lệnh bị từ chối rõ (xem trước đánh dấu từng dòng có tiền), không âm thầm bỏ tiền; mã / ghi chú vẫn ghi được không kèm tiền.
  Đọc tiền SDK cần quyền đọc số dư (quyền tiền, hoặc EARN_BALANCE + BALANCE_WRITE trên token); thiếu quyền thì máy chủ không trả số tiền,
  giờ kiểm tra, nguồn, ghi chú bằng chứng, lịch sử trước / sau (`moneyHidden`, ô hiện "Ẩn") ở `GET sdks`, `GET vms/{id}`, Kho SDK, khung SDK,
  bảng VM và Nhật ký thao tác. Token, user còn hoạt động, PIN, quyền, lượt, revision và chống lưu lặp kiểm lại **trong giao dịch**. Không
  nâng ai-ops lên ADMIN.
- Một lệnh = một giao dịch; một mã bị từ chối thì **cả lệnh** không ghi gì:
  - mã ở danh sách VM khác, mã Đã dùng / Chưa xác nhận ngoài VM này, mã của dự án khác → `409 DUPLICATE` (không chuyển ngầm);
  - `current:true` mà VM đang có mã hiện hành khác → `409 SDK_CONFLICT` `kind: CURRENT_DIFFERS` (`currentCode`, `currentSdkId`,
    `currentRevision`): web không tự thay mã, đối chiếu trên máy;
  - cùng mã, cùng `observedAt` nhưng khác tiền → `409 SDK_CONFLICT` `kind: SAME_TIME_OTHER_AMOUNT` (`storedAmountUsd`);
  - sai lượt → `CYCLE_CHANGED`; sai revision VM / SDK hoặc người khác vừa ghi cùng lúc → `REVISION_CONFLICT` (`details.sdk`, `details.current`).
- Mã: VM chưa có mã hiện hành → mã `current` vào danh sách và thành hiện hành; mã đã trong danh sách VM → giữ trạng thái (Đã dùng vẫn Đã dùng),
  cập nhật quan sát; mã mới → **Chưa xác nhận** (không tự là "Chưa dùng" vì web chưa có tài khoản hay ứng dụng hiện Sign in / Sign up),
  không được cấp lại cho đến khi người xác nhận ở Kho SDK; mã chưa dùng trong kho → vào danh sách VM. Hai file cùng mã = một SDK.
- Tiền: giá trị gần nhất (không cộng dồn) trên chính mã; `amountObservedAt` riêng với `amountAt`; quan sát cũ đến muộn → `OLDER`, giữ số mới;
  quan sát mới cùng số → `SAME`, chỉ cập nhật giờ kiểm tra; gửi lại cùng key không thêm lịch sử. Hoàn tác một lần sửa tiền trên web khôi
  phục cả số tiền, giờ quan sát, giờ ghi, người ghi và nguồn (snapshot SDK có `amountObservedAt`, `amountSource`); nhật ký cũ thiếu trường
  thì giờ quan sát về "chưa biết" (null), không bịa; sự kiện đã chốt (Đã dùng) vẫn không hoàn tác được.
- Không đổi tài khoản EarnApp, tình trạng VM hay dấu cài đặt.

### Ví dụ (ops-client)
Định danh web (lượt, revision VM, revision từng mã) được **chụp trước khi đọc máy** và đi cùng bản khảo sát; lúc gửi client không đọc
web (rà soát độc lập 22/10/2026: bản khảo sát cũ không bao giờ bị gắn sang lượt / revision mới).
```
# 1. Chụp định danh web TRƯỚC khi đọc máy (theo vmId hoặc server/vm; --code cho mã trong kho cần kèm revision)
node scripts/ops-client.mjs sdk-prepare <projectId> vt-01/VM_01 vt-01/VM_02 --out capture.json
#    → mỗi VM: {projectId, vmId, serverCode, vmCode, capturedAt, expectedCycle, expectedVmRevision, knownSdks:{mã: revision}, sdks:[]}
# 2. Đọc máy SAU lúc chụp, điền vào đúng mục VM đó: observedAt, source, evidence?, sdks:[{code, amountUsd, amountRead?, current?}]
#    (không điền expectedSdkRevision: client lấy từ knownSdks; mã web chưa có → null)
# 3. Kiểm cả bảng trên máy (không gửi): thiếu capturedAt / lượt / revision, đọc máy trước lúc chụp, mã trùng VM, tiền sai dạng…
node scripts/ops-client.mjs sdk-check survey.json
# 4. Ghi một VM (hoặc cả bảng), rồi đọc lại
node scripts/ops-client.mjs sdk-observe one-vm.json
node scripts/ops-client.mjs vm <projectId> <vmId>
node scripts/ops-client.mjs sdk-survey survey.json
```
- Mục VM thiếu `capturedAt` / `expectedCycle` / `expectedVmRevision` / `knownSdks`, hoặc `observedAt` trước `capturedAt` → client dừng,
  báo "đối chiếu / khảo sát lại", không gửi. Lượt / revision đã đổi sau lúc chụp → web từ chối (`CYCLE_CHANGED` / `REVISION_CONFLICT`):
  chụp lại bằng `sdk-prepare` rồi **đọc máy lại**; không sửa tay revision, không dùng lại quan sát cũ.
- `sdk-survey` lưu key + nội dung từng VM vào `survey.json.run.json` **trước** khi gửi. Chạy lại: VM đã ghi (DONE) không gửi lại; VM chưa rõ
  kết quả (UNKNOWN, mất phản hồi) gửi lại đúng key và toàn bộ nội dung cũ; VM bị từ chối (ANSWERED, ví dụ SDK_CONFLICT) giữ nguyên chờ người
  kiểm, sau khi kiểm mới chạy `--redo <vmId>`: gửi lại **đúng mục đã chụp + khảo sát** với key mới (không tự cập nhật lượt / revision). Dòng
  lỗi không làm mất danh sách. Exit 0 tất cả xong / 1 có dòng bị từ chối / 3 có dòng chưa rõ.
- Một lệnh lẻ mất phản hồi: `retry <key>` (không tạo key mới, không tự sang lượt mới, không tự thay revision để né lỗi).
- Bảng Server / VM: ô SDK có dòng "Tích luỹ 12,345678 USD · 15:56" của **mã hiện hành** ("chưa kiểm tra" khi chưa có số, "chưa rõ giờ" với
  tiền cũ); khung SDK và Kho SDK ghi giờ kiểm tra từng mã. Cột **Tiền VM** (22/10/2026, vm-ops-cycle.md) hiện cùng số này của mã
  hiện hành ngay tại dòng, không cần tài khoản EarnApp. Số dư EarnApp và yêu cầu rút giữ nghĩa số dư tài khoản EarnApp và yêu cầu rút.
- Migration `20261022150000_sdk_observed` (chỉ thêm cột `SdkRecord.amountObservedAt`, `amountSource`; tiền cũ giữ `null` = chưa biết giờ).
- Trước khi nhập bảng thật: kiểm lại các dòng OCR nghi sai, `sdk-check` cả bảng, ghi đúng **một** VM chủ giao, đọc lại xác nhận rồi mới
  mở rộng. Việc khảo sát và ghi dữ liệu thật do Claude vận hành làm theo phạm vi chủ giao.
