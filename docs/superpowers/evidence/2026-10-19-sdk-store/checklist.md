# Kho SDK, ô SDK, ô Proxy gộp Cài proxy, nút Lưu / Áp dụng (19/10/2026)

Hướng dẫn dùng: [SDK và Kho SDK](../../../runbooks/vm-sdk.md), [bảng Server / VM](../../../runbooks/server-vm-table.md). Không quay video; chỉ chụp ảnh cần thiết.

Dữ liệu thử chỉ có trên database cục bộ (`proxy_app_trial`, dự án PROXY_TRIAL):
- Fixture `.runtime/sdk-local-setup.ts` tạo server `sdkx-<tag>` / `sdky-<tag>`, IP 198.51.100.x, email `@example.invalid`, và các tài khoản `ops-staff` (Server / VM), `sdk-viewer` (chỉ xem), `sdk-outsider` (chỉ dự án khác).
- Đọc lại dữ liệu bằng `.runtime/sdk-local-probe.ts`.
- Kịch bản trình duyệt: `pw/sdk-accept.js` trong scratchpad (không đưa vào Git).

## Kiểm trên trình duyệt (`browser-result.txt`, lần cuối 91/91, fixture `uelnl`)

| # | Yêu cầu | Kết quả thật (đọc lại DB sau thao tác) |
|---|---|---|
| 1 | A = 12,40 USD + ghi chú tại VM1, tải lại | Nút Lưu mờ khi chưa đổi, xanh khi đổi. Enter lưu. Sau tải lại ô hiện `12,40 USD · Chưa nối`. DB: A ở VM_001, 12.4, ghi chú (ảnh `s1`). |
| 2 | VM1 ghi mã mới B | Ô tiền / ghi chú trống ngay khi gõ B. Khung báo A giữ trong kho. DB: A không ở VM, giữ 12.4 + ghi chú; B không có tiền / ghi chú; ô hiện "Chưa ghi tiền". |
| 3 | Chọn A cho VM server khác | Chọn SDK đã lưu → đọc đúng 12,40 và ghi chú → nút "Dùng cho VM này" (ảnh `s3`). DB: A ở sdky/VM_001, tiền giữ, lịch sử 4 sự kiện. |
| 4 | Chuyển SDK chưa nối VM1 → VM khác | Gõ mã đang ở VM khác không lấy ngầm: hiện `sdkx / VM_001 → sdkx / VM_004` cạnh nút (ảnh `s4`). Một lần bấm: VM1 hết B, VM4 có B. Dán bảng cùng mã: lỗi tại dòng, Áp dụng 0 dòng. |
| 5 | Đã nối EarnApp | VM chưa có tài khoản: báo ngay trong khung. Có tài khoản: khung nêu SDK + email + lượt (ảnh `s5`); chỉ có tài khoản + SDK chưa tự đánh dấu. Một lần bấm: LINKED. Sau đó: gõ lại ở VM khác bị báo, nút mờ; không có trong danh sách chọn; gọi thẳng `sdkSave` bị từ chối; nhật ký SDK_LINK chỉ để xem. |
| 6 | Hai người cùng lấy một SDK; VM vừa đổi | Admin và ops-staff cùng lấy F: một người thành công, người kia thấy lý do trong khung, lựa chọn giữ nguyên (ảnh `s6`). Khung mở trước khi người khác sửa VM: bị từ chối, nháp giữ, không lưu nửa chừng. |
| 7 | Dán vào kho | Tự kiểm tra không cần Xem trước. Thêm mới / Cập nhật (12,40 → 13,00) / lỗi / mã lặp báo ở cả hai dòng / ô trống giữ nguyên. Một nút "Lưu 2 SDK" xanh, cuộn chuột tới được (ảnh `s7b`). Mất phản hồi giả lập: báo lỗi, giữ nội dung; bấm lại không ghi thêm (một bản ghi G, một lần sửa tiền A). Ô dán chỉ còn dòng lỗi. Dán lại cùng dữ liệu: "Lưu 0 SDK" mờ, không có lịch sử giả. |
| 8 | Sửa tiền 13 → 15 | DB 15. Số dòng sổ thu / chi / rút / nhận về team / yêu cầu rút không đổi. |
| 9 | Dữ liệu migrate chưa rõ | Mã "Chưa xác nhận" không có trong danh sách chọn. Gõ mã: báo chưa xác nhận, nút mờ. Kho hiện "Chưa xác nhận", "Chưa ghi tiền" (ảnh `s9`). Bấm "Xác nhận chưa từng nối" tại dòng → Chưa nối. |
| 10 | Xoá / khôi phục / tạo lại VM | Xoá VM: SDK giữ tại vị trí "(đã xoá)". Lấy mã chưa nối ra từ VM đã xoá. Khôi phục VM không giành lại. Tạo lại (SUS) qua ô Rút tiền: khung nói "về Kho SDK"; DB: F về kho, vẫn Chưa nối, giữ 3,5. Mã đã nối khi tạo lại: vào lịch sử, vẫn LINKED. |
| 11 | Ô Proxy | Không còn cột Cài proxy. Giao khác đã cài: hai dòng Giao / Cài. Copy thường: clipboard có proxy, cấu hình vẫn PLANNED, không mở popover. Bấm nội dung ô: "Bắt đầu cài" → IN_PROGRESS; xác nhận nêu đúng VM, IP:port, cấu hình #1 → CONFIRMED; Tình trạng VM không đổi (ảnh `s11`). Lọc Chờ cài và link `?tab=install` còn chạy. Cuộn ngang, bấm sát cột cố định mở đúng khung Proxy; phần nằm dưới cột cố định không nhận click. |
| 12 | Nút Áp dụng | Tình trạng hàng loạt: "Áp dụng 3 VM" xanh → lưu → "Áp dụng 0 VM" mờ; bỏ tick → 2; chọn lại giá trị cũ → mờ (ảnh `s12`). Sửa ghi chú "Áp dụng 2 VM"; lỗi mạng giả lập: báo lỗi, giữ nháp; thử lại → 0 VM mờ. Ô SDK lỗi: giữ nội dung; bấm ra ngoài → "● Nháp chưa lưu", còn sau tải lại; Huỷ bỏ nháp. |
| 13 | Kho SDK: URL, Back / Forward, đổi server, nháp | `sdk=1&sf=ALL&ss=AMOUNT_DESC` trong URL; tiền cao → thấp, "Chưa ghi tiền" xếp sau. Back / Forward mở / đóng đúng; đổi server giữ kho mở. Nháp dán còn khi đóng / mở kho, có dấu "nháp", khoá localStorage theo dự án. |
| 14 | Quyền | Chỉ xem: khung không có Lưu, kho không có Dán; gọi thẳng `sdkSave` / `sdkStoreApply`: FORBIDDEN. Người ngoài: `sdkStore` / `sdkSave` FORBIDDEN. Mã của dự án khác: từ chối, không lộ server / VM / tiền. Nhân viên Server / VM ghi tiền 0 được (khác chưa ghi). |
| 15 | Màn 1280 và màn hẹp 390 | Nút lưu luôn trong màn hình; khung không bị cắt (ảnh `s15`). Bảng cuộn ngang, cột VM cố định. Kho SDK không tràn ngang. |

Lỗi tìm ra khi kiểm và đã sửa trước khi phát hành:
1. **Mất tiền SDK khi kho tải chậm.** Gõ mã của một SDK đã có tiền trước khi Kho SDK tải xong: khung tưởng là mã mới, ô tiền / ghi chú trống, và lưu sẽ xoá tiền / ghi chú của mã đó (sự kiện `AMOUNT 3.5 → null`). Sửa: ô chưa sửa luôn hiện giá trị đang lưu của chính mã và không được gửi (`vm-grid/sdk-form.ts`, test `sdk-money.test.ts`).
2. **Ô bị che trên điện thoại.** Ba cột cố định (chọn, VM, Tình trạng) chiếm gần hết 390 px nên ô Proxy / SDK không bấm được. Sửa: dưới 640 px chỉ cố định ô chọn và VM.
3. **Không cuộn tới nút lưu trong Kho SDK.** Khung kho cắt nội dung (overflow hidden) nên khi mở phần dán, người dùng không cuộn tới "Lưu N SDK" (script vẫn bấm được). Sửa: cả khung kho cuộn được. Thêm phép kiểm cuộn chuột (7b2).

Lỗi của kịch bản, không phải sản phẩm, đã sửa kịch bản:
- Bộ chọn trùng tên một phần: Kho SDK / Đóng Kho SDK, Bắt đầu cài / Copy proxy để cài (bắt đầu cài), Sửa ghi chú.
- Hàng của VM đã xoá không có nút mã VM.
- Bấm trúng nút copy khi thử vùng bấm cạnh cột cố định. Nút copy chỉ copy, đúng thiết kế.
- Đọc nhãn "nháp" trước khi hiệu ứng chạy.
- Kiểm tra bị nhiễu bởi dữ liệu thử của lần chạy trước.

## Lỗi quyền tiền phát hiện thêm (file kiểm độc lập `.runtime/review-vm-journal-money-20261019.test.ts`)

- **Lỗi:** chi tiết nhật ký "Ghi nhận tạo lại VM" vẫn hiện "24.00 USD · REQUESTED" (ảnh yêu cầu rút) cho nhân viên chỉ có quyền Server / VM. Lỗi có từ đợt trước, không do đợt này.
- **Sửa:** `inspectOperation` chỉ hiện số tiền yêu cầu rút cho người có quyền tiền PayPal; người khác thấy "Yêu cầu rút · trạng thái".
- **Test:** test chính thức "1b" trong `vm-ops.integration.test.ts`. File kiểm độc lập đỏ trước khi sửa (`full-test-1`), xanh sau khi sửa.

## Migration `20261019150000_sdk_store` (chỉ thêm)

- **Chạy thử** trên bản sao riêng `proxy_mig_sdk`, khôi phục từ backup local trial `proxy_app_trial-before-sdk-store-20261019.dump`:
  - 365 VM có SDK, trong đó 6 mã nằm ở hai VM. Kết quả: 359 mã ở VM và 20 mã chỉ có trong lịch sử, tất cả "Chưa xác nhận".
  - 379 sự kiện MIGRATE. Không có bản ghi nào có tiền.
  - Bản sao trên VM khớp bản ghi 100%.
- **Local trial** sau migrate: cùng số liệu.
- **Host** (đọc 19/10 trước deploy): 0 VM có SDK, 0 thao tác SDK.

## Test tự động

- **Mới:**
  - `sdk-store.integration.test.ts` (11 ca: quy tắc 1–11, 14).
  - `sdk-money.test.ts` (5 ca, gồm ca lỗi kho tải chậm).
  - `vm-grid-model.test.ts` thêm 2 ca: cấu hình cột cũ bỏ "Cài proxy", URL Kho SDK.
  - `vm-ops` "1b".
- **Đổi kỳ vọng cũ trái quy tắc mới:**
  - `vm-sdk` (mã ở VM khác → chỉ dẫn chuyển; gỡ rồi dùng lại từ kho).
  - `vm-admin` (khôi phục VM không còn bị chặn vì SDK; mã đã chuyển không bị lấy lại).
  - `vm-ops` (tạo lại: mã chưa nối về kho).
  - `vm-grid-model` (không còn cột Cài proxy, SDK không trong vòng Tab).
- **Test chập chờn đã xác định nguyên nhân:**
  - `vm-table` lỗi trùng IP. Nguyên nhân: các fixture bị bỏ lại khi những lần chạy đầu của đợt này dọn dữ liệu thất bại (khoá ngoại SDK mới), cộng với dải IP ngẫu nhiên /24 của fixture.
  - Đã dọn 23 dự án fixture bỏ lại bằng `.runtime/cleanup-test-db.ts`, chỉ trên DB test. Chạy lại thì qua.
- **Kết quả cuối:**
  - Toàn bộ test: 96 file / 431 ca qua, gồm file kiểm độc lập trong `.runtime`.
  - Typecheck qua; build qua.
  - Lint: chỉ còn 4 cảnh báo cũ ở `agent-pp`.

## Hồi quy trình duyệt (`regression-browser.txt`)

- **Luồng vận hành VM** (`ops-accept.js`): 50/50.
  - Đổi một kỳ vọng cũ: cột "Cài proxy" nay nằm trong ô Proxy.
  - Fixture `ops-local-setup.ts` nay tạo bản ghi SDK như migration.
- **Bốn lỗi 19/10** (`ops-fix-accept.js`): lần chạy đầu 18/19.
  - Ca còn lại: kịch bản mở dòng "gán tài khoản" cũ nhất của dự án. Dòng đó là lần gán chỉ tài khoản (hoàn tác được, đúng) từ fixture SDK mới.
  - Sửa kịch bản để mở dòng chỉ xem, chạy lại bước đó: 4/4.
- **PayPal / Kho tài khoản:** không chạy lại; đợt này không sửa các trang đó.

## Phát hành

- **Commit:** `d331cb5`.
- **Backup host trước deploy:** `64463ab5-342f-4eb6-a51f-16b56e3b70d0` (40.413.083 byte, SHA-256 `b0a4d000…6ef54`).
- **Deploy:** `e6abf1bc-006e-46b7-af87-02d013028046`, SUCCESS. Service `moneytohome`, environment `proxy-trial-20261015`. Migration `20261019150000_sdk_store` chạy ở bước pre-deploy.
- **Số liệu host, đọc lại từ dữ liệu hiện hành, chỉ đọc:**
  - Trước deploy: 10 server / 576 VM, 0 VM có SDK, 0 thao tác SDK.
  - Sau deploy: 10 server / 576 VM, 0 VM có SDK, Kho SDK 0 mã, 0 thao tác SDK.
  - Migration không có mã nào để chuyển trên host.
- **Host xem đọc** (`host-result.txt`, ảnh `h1`, `h4`):
  - Cột: Server | VM | Tình trạng | Proxy | SDK | Tài khoản EarnApp | PayPal nhận | Rút tiền | Ghi chú; không còn "Cài proxy".
  - Ô Proxy dòng đầu: "Giao 84.32.138.211:5432 · Chờ cài"; ô SDK: "Chưa có SDK".
  - Khung SDK mở rồi Huỷ, nút Lưu mờ. Khung Proxy hiện đúng hành động. Kho SDK mở / lọc / đóng.
  - Chỉ có `user.verifyPin` và `user.heartbeat`, không có POST ghi. Không có lỗi JavaScript.
  - Xem trước qua API (không ghi): `sdkStorePreview` → "Thêm vào kho"; Dán bảng SDK → "Ghi SDK mới" kèm tiền / ghi chú; dự án lạ → FORBIDDEN.

## Chưa kiểm / giới hạn

- **Host:** chưa có SDK, tài khoản EarnApp hay PayPal, nên mọi thao tác ghi (ghi / chuyển / nối / dán / hoàn tác) chỉ kiểm trên dữ liệu thử cục bộ và DB test. Trên host chỉ xem đọc.
- **Bộ gõ tiếng Việt:** chặn Enter khi `isComposing`, giống ô sửa cũ; chưa thử trực tiếp với Unikey / EVKey.
- **"Lệnh soạn cho lượt cũ" trên trình duyệt:** kiểm bằng trường hợp VM vừa bị người khác đổi (revision). Lệnh `expectedCycle` cũ sau khi tạo lại VM được kiểm bằng test tự động (`sdk-store` ca 6, ca 5b).
- **Tiền tích luỹ:** chỉ USD (mặc định của brief); chưa có chọn tiền tệ khác.
- **Kho SDK:** đọc toàn bộ mã của dự án một lần rồi lọc / sắp xếp trên trình duyệt. Hợp với vài nghìn mã; nhiều hơn nữa thì cần chia trang ở máy chủ.
- **PayPal / Kho tài khoản:** không chạy lại hồi quy trình duyệt, vì đợt này không sửa các trang đó.
