# Vận hành VM, rút EarnApp, tạo lại VM (19/10/2026)

Luồng: **Theo dõi VM → chọn PayPal nhận tiền → ghi yêu cầu rút EarnApp → xác nhận tiền thực về PayPal → ghi nhận tạo lại VM** (giữ mã VM, giữ proxy còn hợp lệ).

Web chỉ quản trị và ghi nhận. Web không tự gửi yêu cầu rút, không xoá máy, không cài máy thật. Người và AI dùng cùng các endpoint `vmOps.*` (router `src/server/routers/vmOps.ts`); chưa có token/API riêng.

## Quy tắc mới thay quy tắc cũ

| Mới (chủ dự án 18–19/10/2026) | Thay cho |
|---|---|
| Mỗi EarnApp chỉ có **một** yêu cầu rút (`EarnPayoutRequest.earnAppId` unique). Bấm lặp, mất phản hồi, gửi lại sau thất bại vẫn là yêu cầu đó. | Quy tắc cũ cho một EarnApp vận hành tiếp qua nhiều lượt rút (`EarnWithdrawal.round`). Bảng `EarnWithdrawal` cũ giữ nguyên, không dùng cho luồng mới. |
| "Tình trạng" trong Server/VM là **trạng thái vận hành** do người/AI ghi (`VmOperation.status`), cố định ngay sau mã VM. | "Tình trạng" cũ là tiến độ cài proxy; nay là cột riêng **Cài proxy**. Trường `VirtualMachine.status` cũ (mặc định NEW) không hiển thị và không dùng làm bằng chứng. |
| Tạo lại VM giữ id / server / mã, mở **lượt** mới (`VmOperation.cycle`), lưu lượt cũ (`VmCycle`). | Trước đây chưa có khái niệm lượt; đổi tài khoản trên cùng VM chỉ là đổi liên kết. |
| EarnApp của lượt đã đóng bị **đóng** (`EarnAppAccount.closedAt`): không gán lại, không về NEW. | Tài khoản bỏ gán trước đây vẫn gán lại được sang VM khác (chỉ không về NEW). |

## Tình trạng vận hành

| Giá trị | Nhãn | Màu |
|---|---|---|
| `OK` | OK | xanh lá |
| `NOT_LINKED` | Chưa nối | vàng |
| `OFF` | OFF VM | xám |
| `PROXY_BLOCKED` | Blocked | đỏ |
| `LINKED` | LINKED | xanh dương |
| `EARN_ERROR` | Earn/VM lỗi | cam |
| `SUSPENDED` | SUS | đỏ đậm |
| `DELETED` | VM deleted | xám |
| `NEW_VM` | New VM | xanh nhạt |
| `MAIL_LOGGED` | Đã login mail | tím |

- **Chưa ghi trạng thái:** không có dòng `VmOperation` hoặc status trống, hiện "Chưa ghi". Không suy ra từ SDK, tài khoản hay proxy.
- **Ghi trạng thái:**
  - Tại ô: chọn là lưu ngay.
  - Hàng loạt: chọn dòng → "Tình trạng…" → **Áp dụng**.
  - Chọn lại đúng giá trị cũ thì không ghi gì.
  - Mỗi lần đổi lưu người, giờ, cũ → mới (`VmOpsEvent`) và vào Lịch sử thao tác, hoàn tác được.
- **Lệnh theo lượt:** mọi lệnh gửi kèm `expectedCycle`. Lệnh soạn cho lượt cũ (ví dụ lệnh AI cũ) bị từ chối: "VM đã sang lượt N".
- **Proxy BLOCKED và tiến độ cài là thông tin riêng:** vẫn hiện ở cột Proxy / Cài proxy. Một VM có thể OFF và đồng thời có proxy BLOCKED.
- **Đổi trạng thái không kéo theo gì khác:** không xoá máy, không mở lượt, không ghi tiền, không tháo liên kết. SUS không đóng mã PP mẹ.
- **"VM deleted" khác "Xoá (khôi phục được)":** VM deleted chỉ ghi nhận máy thật đã xoá. Mã, tài khoản, proxy và lịch sử còn nguyên. Tự điền proxy bỏ qua máy này.
- **Lọc** (giữ trong URL; lọc và sort trên toàn bộ kết quả trước khi phân trang):
  - nhiều trạng thái một lúc, có số lượng (`?st=OFF,LINKED`; `NONE` = Chưa ghi);
  - cảnh báo proxy (`?warn=proxy`);
  - mốc tiền (`?money=WAITING|RECREATE|MONEY_REVIEW|FAILED`).
- **Sort "Cần xử lý trước" (`?sort=PRIORITY`):** SUS → proxy BLOCKED → Earn/VM lỗi / tiền cần đối chiếu → cần tạo lại → OFF / VM deleted → chờ tiền → New VM → Đã login mail → Chưa nối → LINKED → Chưa ghi → OK. Cùng mức thì theo mã tự nhiên (VM_009 trước VM_010).

## PayPal: sức khoẻ và nhãn gom tiền

- **Sức khoẻ PP giữ như cũ:** Dùng được, Chờ xác minh, Bị limit, Bị suspend, Đã đóng. Đổi tại ô hoặc hàng loạt ở Kho tài khoản.
- **Nhãn gom tiền** (chỉ tính USD; dưới cột "Còn lại theo sổ"):
  - "Đạt mức gom $100,00": số dư thực ≥ $100,00.
  - "Dự kiến đủ $100,00": số dư thực chưa đủ, nhưng cộng tiền còn chờ ("Chờ về $18,00") thì đủ.
  - "Đang gom · thiếu $100,00": cộng cả tiền chờ vẫn dưới $100,00.
  - Có đơn vị từ 19/10/2026: USD ghi "$0,00"; USDT ghi USDT, VND ghi ₫; các đồng tiền không cộng với nhau. Đang tải, lỗi hoặc thiếu quyền không bao giờ hiện thành 0. Áp dụng cả ở khung chọn PP khi yêu cầu rút.
  - Số dư thực là số dư theo sổ (mở đầu + vào − ra) đến hôm nay, không phải doanh thu tháng. Rút/chuyển ra thì nhãn tính lại.
  - Nhãn chỉ hiện cho người xem được cả tiền vào và tiền ra.
- **100 USD** là mục tiêu gom tối thiểu của một mã PP, không phải mức tối đa, cũng không phải số mỗi EarnApp phải rút.
- **Tiền còn chờ** = phần còn thiếu của các yêu cầu rút đang chờ + khoản "Chờ nhận" chưa gắn yêu cầu. Khoản chờ đã gắn yêu cầu nằm trong phần còn thiếu, không cộng thêm lần nữa. Không cộng USD, USDT, VND với nhau.
- Code: `src/server/vm-ops/payout.ts` (`pendingByPaypal`, `readPaypalGather`); quy tắc chung ở `src/lib/vm-ops.ts` (`gatherOf`).

## Yêu cầu rút (cột Rút tiền ở Server/VM)

1. **Ghi yêu cầu rút:** chọn mã PP, rồi email, rồi nhập số tiền, ngày, mã tham chiếu.
   - Mỗi PP hiện: tình trạng, số dư USD, còn chờ, còn thiếu đến 100, dự kiến sau khoản này, số email chưa dùng.
   - Lọc "PP dùng được, còn email"; sort gần đạt 100 / đã đạt 100 / số dư.
   - Người dùng tự chọn PP và email; web không chọn thay.
   - Email đang giữ cho chính EarnApp này được dùng lại.
   - Email mới phải chưa từng cấp. Nó được giữ riêng cho EarnApp trong cùng lệnh, qua cùng kiểm tra gán email ở Server/VM.
   - PP bị limit / suspend / đóng không được đề xuất email mới.
2. **Chờ tiền về → "Ghi tiền về PP":** ghi vào cùng sổ Tiền vào PayPal, đánh dấu Đã nhận hoặc Chờ nhận.
   - Khoản ghi ở Kho tài khoản → Ghi tiền vào cũng tự gắn vào yêu cầu nếu cùng EarnApp, cùng email và từ ngày yêu cầu trở đi. Ngoài trường hợp đó không ghép.
   - Trạng thái PAID bên EarnApp hay giờ trong ngày không phải bằng chứng tiền vào PP.
3. **Nhận đủ:** tổng khoản Đã nhận gắn yêu cầu đúng bằng số yêu cầu.
   - Nhận thiếu: còn chờ phần thiếu (ví dụ 24 nhận 10: sổ +10, còn chờ 14).
   - Chỉ coi là đủ khi người dùng bấm **Chốt nhận thiếu** và ghi rõ phí / chênh lệch.
   - Nhận thừa hoặc khác đồng tiền: **Cần đối chiếu tiền**.
4. **Thất bại / Huỷ:** phải ghi căn cứ. **Gửi lại** dùng chính yêu cầu đó. Email của yêu cầu đã gửi không đổi.

**Quyền:**
- Ghi yêu cầu và tiền cần quyền ghi Tiền vào PayPal (quản lý).
- Chọn email mới cần thêm quyền gán ở Server/VM.
- Người không có quyền tiền chỉ thấy mốc ("Chờ tiền về", "Cần tạo lại VM"), không thấy số tiền. Gọi thẳng endpoint tiền cũng bị chặn.
- Lịch sử yêu cầu rút được lọc ở backend (sửa 19/10): người không có quyền tiền chỉ nhận mốc trung tính (Ghi yêu cầu rút, Sửa yêu cầu rút, Đánh dấu thất bại / huỷ, Gửi lại, Chốt nhận thiếu, Dùng để ghi tạo lại VM). Số tiền, số cũ → mới, phần thiếu, ghi chú thất bại / huỷ / chốt và mã tham chiếu chỉ trả cho người có quyền tiền. Dòng lịch sử ghi trước bản sửa được đọc theo phần đầu cố định của câu, không theo số.

## Ghi nhận đã tạo lại VM

> **19/10/2026 (sau đó):** không còn bước cài. Proxy hợp lệ được giữ cho vị trí ở lượt mới và là proxy đang dùng ngay; proxy BLOCKED vẫn ở vị trí, ô Proxy báo Blocked và phải thay. Các ý "cần cài và xác nhận lại", "Giữ để kiểm tra" cho proxy BLOCKED dưới đây đã được thay; xem [proxy-change.md](proxy-change.md). Tình trạng Blocked nay gắn với proxy: thay proxy đưa VM về tình trạng trước Blocked.

Chỉ bấm khi máy thật **đã được tạo lại**.

**Điều kiện:**
- Yêu cầu rút của lượt hiện tại đã nhận đủ và chưa dùng; hoặc
- Tình trạng là SUS (EarnApp bị suspend vĩnh viễn).

**Web làm gì:**
- Giữ id, server và mã VM. Mở lượt N+1 với tình trạng **New VM** (không tự LINKED/OK). Ghi lại lượt N (`VmCycle`): EarnApp, tài khoản, email, SDK, tình trạng cuối, cấu hình.
- Đóng EarnApp cũ: rời VM, đặt `closedAt`. Tài khoản Gmail/Apple ID thành Đã dùng, không về NEW. Email vẫn "đã dùng".
- SDK hiện hành rời vị trí (Kho SDK, 19/10/2026): mã chưa nối về kho với tiền / ghi chú để dùng lại, mã đã nối EarnApp vào lịch sử. Máy mới có SDK mới; chỉ ghi mã thật người / AI cung cấp sau khi cài. Xem [SDK và Kho SDK](vm-sdk.md).
- **Proxy:**
  - Bằng chứng cài thuộc đúng lượt (sửa 19/10): VM lượt mới không còn trỏ tới cấu hình đã cài hay đang chờ của lượt cũ (`installedConfigurationId` = trống). Các cấu hình cũ giữ nguyên trong lịch sử (Đã xác nhận / Đã huỷ) và `VmCycle` ghi lại id. VM lượt mới không bao giờ hiện "Đã cài" từ lượt trước.
  - Proxy của vị trí (cấu hình đang chờ nếu có, nếu không thì proxy đã cài) còn hợp lệ (TUT hoặc Chung mooon–Genjy; NEW/LIVE; chưa replace, ngừng quản lý hay BLOCKED) được giữ: web tạo cấu hình mới "Chờ cài" cho lượt mới; phải cài và xác nhận lại. Proxy vẫn LIVE, không thả ra kho NEW.
  - Cấu hình đang chờ / đang cài của lượt cũ bị huỷ (giữ trong lịch sử): bắt đầu cài hay xác nhận gửi theo cấu hình cũ bị từ chối, không hoàn tất việc của lượt mới.
  - Proxy BLOCKED hoặc không đủ điều kiện vẫn ở trên VM dạng "Giữ để kiểm tra"; ô Cài proxy hiện **Cần thay proxy**. Thay ở Kho proxy → Thay proxy, rồi Đổi proxy cho VM; xác nhận cài mới sẽ gỡ bản giữ cũ.
  - Proxy khác đã cài / đã bắt đầu trên máy cũ cũng thành "Giữ để kiểm tra", không về NEW.
- Không phát sinh chi phí mua tài khoản.
- Đánh dấu yêu cầu rút đã dùng (`consumedAt`; `VmCycle.payoutRequestId` unique), nên một khoản nhận chỉ mở được một lượt.

**Sau khi tạo lại:**
- Lượt mới gán tài khoản mới và email PP chưa dùng (có thể cùng mã PP cũ).
- Cài lỗi rồi thử lại vẫn thuộc lượt đó.
- Bấm lại lệnh tạo lại thì bị từ chối (đã sang lượt mới); cùng khoá thì trả lại kết quả cũ.

**SUS:**
- Tạo lại không cần tiền về; không tạo khoản PAID giả.
- Yêu cầu rút và tiền chờ của lượt cũ giữ nguyên để đối chiếu. Tiền về muộn gắn vào yêu cầu cũ và không làm lượt mới thành "Cần tạo lại".
- Mã PP mẹ không bị đóng.

**Sau khi tạo lại, khoản thu bị sửa hoặc thu hồi:**
- Yêu cầu hiện "cần đối chiếu (khoản nhận đổi sau khi tạo lại)".
- VM giữ lượt mới, không bị quay lại.

**Hoàn tác** (Lịch sử thao tác) chỉ huỷ ghi nhận trên web: không đảo ngược việc rút tiền, không xoá hay cài lại máy. Chỉ hoàn tác được khi chưa có gì sửa tiếp.
- **Ghi nhận tạo lại VM chỉ để xem, không hoàn tác** (sửa 19/10). Hoàn tác sẽ lùi lượt, mở lại EarnApp đã đóng và cho dùng lại cùng khoản nhận. Backend từ chối theo nội dung bản ghi, nên cả nhật ký `VM_RECREATE` ghi trước bản sửa cũng bị chặn; thao tác nào khác có đóng lượt, đóng EarnApp hay đánh dấu khoản nhận đã dùng cũng vậy.
- **Lần cấp đầu một email PayPal không hoàn tác được** (gán ở Server/VM, dán liên kết, hay ghi yêu cầu rút với email mới), kể cả khi email chưa có tiền. Email giữ dấu đã dùng vĩnh viễn; muốn gỡ khỏi VM thì dùng **Bỏ gán**. Liên kết không cấp email mới (chỉ tài khoản) vẫn hoàn tác được.
- Đổi tình trạng vẫn hoàn tác được khi chưa có gì sửa tiếp (trong cùng lượt).

## Tiền VM tại dòng (chủ dự án 22/10/2026)

Cột **Tiền VM** (vị trí của cột Tiền / Rút cũ, ngay sau Tình trạng, trước Proxy; khoá cấu hình cột vẫn là `payout` nên bố cục đã lưu
giữ nguyên, mục Cột ghi "Tiền VM") hiện **tiền quan sát trên máy của SDK hiện hành** (`src/lib/vm-money.ts`, dữ liệu `sdk-observations`),
không cần tài khoản EarnApp: dòng chính `$0,21`, dòng phụ "Kiểm tra 10 phút trước" (rê chuột: ngày giờ đầy đủ theo múi giờ ứng dụng);
trạng thái rút ngắn bên dưới khi có yêu cầu. Trạng thái: **Chưa kiểm tra** (không có SDK hiện hành hoặc chưa đọc được tiền; không
phải $0), `$0,00` khi đọc được 0, **Kiểm tra lỗi** (lần đọc mới nhất không đọc được: giữ số tốt cuối cùng với giờ cũ, `amountFailedAt`),
**Số cũ** (quá 24 giờ), **Chưa rõ giờ** (tiền cũ không có giờ quan sát), **Ẩn** (thiếu quyền xem tiền). Mỗi số tiền / lần đọc lỗi gắn
với **VM + lượt** nơi nó được kiểm tra (`SdkRecord.amountVmId/amountCycle`, `amountFailedVmId/amountFailedCycle`, migration
`20261022230000_sdk_money_binding`): dòng chỉ hiện số của đúng VM đó ở đúng lượt hiện tại. Dữ liệu cũ (trước khi có bốn cột) chỉ được
gắn khi có bằng chứng: thời điểm lệnh ghi số (sự kiện AMOUNT / OBSERVE có `observedAt` = `amountObservedAt` — lần đọc cùng số chỉ dời
`amountObservedAt`, không dời `amountAt`; sửa tay trên web thì là `amountAt`) sau khi lượt trước của VM đóng (`VmCycle.closedAt`) và không
có SdkEvent MOVE / HOLD / PLACE / REMOVE / RECREATE **sau** thời điểm đó (sự kiện cùng lệnh cùng mốc giờ không tính); lần đọc lỗi chỉ gắn
qua chính sự kiện OBSERVE `readable:false` của nó. Không đủ bằng chứng thì giữ nguyên tiền + lịch sử trên mã, liên kết để trống → "Chưa
kiểm tra". DB đã chạy bản gắn theo vị trí được sửa bằng `20261023000000_sdk_money_binding_evidence` (gỡ liên kết không bằng chứng) và
`20261023010000_sdk_money_binding_rebind` (trả lại liên kết mà lệnh quan sát đã ghi đúng); host chưa chạy bản nào nên chỉ chạy bản đã sửa.
Tiền nhập kèm lệnh chuyển SDK gắn vào VM đích + lượt đích trong cùng giao dịch; chỉ chuyển không nhập tiền thì số cũ vẫn là lịch sử của
nơi đã kiểm tra. Dán bảng → SDK (kind SDK của Dán bảng) ghi đúng lượt thật của VM và mang `expectedCycle` của lần xem trước: bản dán
trước khi tạo lại VM bị từ chối từng dòng ("VM đã được tạo lại, kiểm tra lại dòng này").
VM tạo lại rồi chọn lại SDK, hoặc chuyển SDK sang VM khác: dòng mới "Chưa kiểm tra" cho tới khi AI kiểm tra lại đúng VM + lượt + mã;
số cũ của mã vẫn giữ nguyên (khung ghi "mã này có $… đọc ở lượt N / trên VM khác, giữ làm lịch sử"), không xoá, không bịa giờ mới. Chỉ lấy mã hiện hành, không cộng các SDK dự phòng, không lấy số dư
EarnApp thay. Bấm ô mở khung: Tiền VM (mã, số, giờ, nguồn, Lịch sử kiểm tra) → Số dư EarnApp (nếu có tài khoản) → Rút về PayPal (luồng
cũ, quyền cũ; chưa có tài khoản thì chỉ giải thích). Lọc Chưa kiểm tra / Số cũ / Kiểm tra lỗi (`money=UNCHECKED|STALE|VM_FAILED`) và
sắp xếp Tiền VM cao → thấp / kiểm tra lâu nhất (`sort=BALANCE|CHECKED_OLD`) chạy trên toàn bộ kết quả trước phân trang, trong URL. Dòng
tổng: "Tổng tiền VM đã kiểm tra" + đếm Chưa kiểm tra / Số cũ / Kiểm tra lỗi / Chưa rõ giờ riêng, không cộng với số dư EarnApp hay tiền
chờ về PP. Bảng tự tải lại dữ liệu mỗi 30 giây khi tab đang mở (và khi quay lại tab) để thấy AI vừa ghi; bộ lọc, trang, lựa chọn và
nháp giữ nguyên.

## Tiền / Rút tại VM (chủ dự án 20/10/2026 — phần số dư EarnApp và rút nay nằm trong khung của cột Tiền VM)

Cột **Tiền / Rút** thay cột "Rút tiền". Dòng trên là số dư đọc trên EarnApp, dòng dưới là yêu cầu rút về PayPal. Hai số hiện cùng lúc, không trừ nhau.

**Hiển thị:**
- Chưa kiểm tra lần nào: "Chưa kiểm tra". $0 là một lần kiểm tra thật, không phải "chưa biết".
- Đã xem điều kiện: "$12,40 · Có thể rút" / "Kiểm tra 15:16" (xanh). Chưa xem: "$10,00" / "Chưa kiểm tra điều kiện rút · Kiểm tra 09:15". Số tiền không bao giờ tự suy ra "có thể rút".
- Kiểm tra lỗi: "Kiểm tra lỗi 15:11" / "gần nhất $8,00 · 10:31" (đỏ), giữ số cuối và lý do. Số cũ hơn 24 giờ: "số cũ, kiểm tra lại" (vàng).
- Yêu cầu: "Đang chuẩn bị rút", "Chưa xác định kết quả rút", "Chờ về PP $10,00", "Đã về $6,00 · còn chờ $4,00", "Đã về PP $10,00", cùng mã PP và email.
- Tình trạng VM (OK / OFF / SUS…) không đổi vì tiền.

**Vị trí và cách đọc (chủ dự án 20/10/2026, sau kiểm trên host 1274 px):**
- Thứ tự mặc định: Chọn → Server (khi xem tất cả) → VM → Tình trạng → **Tiền / Rút** → Proxy → SDK → Tài khoản EarnApp → PayPal nhận → Ghi chú. Ở 1280 px, sidebar mở, cột Tiền / Rút nằm ở 667–887 px (tất cả server) / 571–791 px (một server), trước đây 1467 px / 1371 px.
- Cấu hình cột đã lưu (`mth.vm-grid.v1.<user>`, có `v`): bản cũ còn đúng thứ tự mặc định cũ (Proxy, SDK, Tài khoản, PayPal, Tiền / Rút, Ghi chú; cột phụ ở đâu cũng được) được chuyển sang thứ tự mới một lần; thứ tự người dùng tự đổi giữ nguyên; chiều rộng và cột ẩn giữ nguyên. Sau khi chuyển, `v: 2` được lưu cùng lần đổi kế tiếp, nên đặt lại Tiền / Rút ở chỗ khác bằng menu Cột thì không bị chuyển lại. Không xoá localStorage.
- Chưa gán tài khoản: "Chưa gán tài khoản"; người có quyền gán bấm để mở đúng bộ chọn tài khoản của ô Tài khoản EarnApp; người xem chỉ thấy chữ.
- Đã gán, chưa kiểm tra: "Chưa kiểm tra" (+ "Bấm để ghi số dư" với người có quyền ghi) → mở phần ghi số dư.
- Đã ghi: số tiền lớn, có $ ("$12,40"), cạnh nhãn điều kiện, dòng dưới "Kiểm tra 18:36". Khoản rút chờ về PP là dòng riêng. Người không có quyền đọc số dư thấy "Đã kiểm tra", không số.
- Dòng tổng hợp theo bộ lọc (mọi trang): số dư đã ghi, chờ về PP (chỉ với quyền tiền), "Chưa kiểm tra: N VM", "Chưa gán tài khoản: N VM" — mục bằng 0 không hiện. Toàn bộ VM trong bộ lọc chưa gán: một câu "Chưa VM nào trong bộ lọc có tài khoản EarnApp (N VM chưa gán tài khoản)". Thay dòng cũ "Chưa có dữ liệu: 0 VM".
- Mép cột cố định: không bóng đổ; một đường mảnh chỉ hiện khi đang có ô trượt dưới cột cố định (`data-x-left` / `data-x-right` trên khung cuộn). Đường phân hàng nhạt hơn.

**Ghi kiểm tra** (`vmOps.balanceRecord`, `src/server/vm-ops/balance.ts`; người, dán bảng và AI dùng chung):
- Mỗi dòng gồm VM, lượt (`expectedCycle`), EarnApp đã thấy, số tiền, đồng tiền, giờ thật đã xem, kết quả OK / FAILED, điều kiện YES / NO / UNKNOWN, ghi chú điều kiện, căn cứ (không mật khẩu, mã 2FA hay link chứa mã).
- Lượt sai hoặc EarnApp đã đổi bị từ chối ở dòng đó. Giờ ở tương lai (quá 5 phút) bị từ chối. Bản kiểm tra cũ đến muộn được lưu vào lịch sử nhưng không thay số mới hơn.
- Cùng khoá gửi lại thì không ghi trùng. Lần kiểm tra mới cùng số tiền là một dòng lịch sử mới.
- Số dư không phải thu nhập, chi phí hay tiền PayPal. Không cộng tiền ghi chú SDK. Không đổi USD sang USDT.
- Tại ô: Enter hoặc "Lưu kiểm tra". Nút mờ khi chưa có thay đổi hợp lệ; lỗi hiện tại ô; nháp giữ khi lưu lỗi.
- Dán bảng → **Số dư EarnApp**: "VM | Số dư" (đã chọn server) hoặc "Server | VM | Số dư", kèm một "Thời điểm kiểm tra". Tự kiểm tra khi dán, một nút "Cập nhật N VM". Ô trống giữ nguyên; 0 hợp lệ; không tạo VM hay tài khoản; dán không xác nhận điều kiện rút. Sau khi lưu, ô dán chỉ còn dòng lỗi.

**Lọc, sắp, tóm tắt** (chạy trên toàn bộ kết quả trước khi chia trang, giữ trong URL `money=` / `sort=`, Back / Forward đúng):
- Lọc: Chưa kiểm tra / Có thể rút / Chờ tiền về / Đã về PP / Cần kiểm tra (lỗi, số cũ, chưa xác định kết quả, cần đối chiếu).
- Sắp: số dư cao → thấp (chưa biết xếp cuối), lâu chưa kiểm tra trước, chờ tiền lâu nhất trước.
- Dải tóm tắt: số dư đã ghi (số gần nhất của tài khoản hiện tại, theo từng đồng tiền), tiền đang chờ về PP (chỉ người có quyền tiền), số VM chưa có dữ liệu. Hai số không cộng với nhau.

**Rút về PayPal** (cùng sổ PayPal, không có sổ thứ hai):
- Chọn tay mã PP → email vẫn như cũ. Gợi ý tự động chỉ xét PP dùng được, còn email trống, biết số dư: PP gần $100 nhất mà vẫn không vượt sau khoản này (tính cả tiền đã có, đang chờ và đang giữ). PP đã hoặc dự kiến đạt $100 không được ưu tiên. Lý do hiện ngắn; "Dùng gợi ý" chỉ chọn sẵn.
- Email EarnApp đang dùng luôn thắng; web không tự đổi email.
- "Chỉ chuẩn bị" (`submission PREPARING`): giữ email (`PayPalEmail.holdEarnAppId`, giữ có điều kiện nên hai người không lấy cùng email), chưa đánh dấu đã dùng, không cộng vào tiền chờ.
- "Đã gửi trên EarnApp (xác nhận)" (SENT): chỉ khi thấy trong lịch sử rút EarnApp. Email thành đã dùng vĩnh viễn, hết giữ, yêu cầu thành "Chờ về PP". Khoản nhận chỉ tự gắn vào yêu cầu đã SENT.
- "Chưa xác định kết quả" (UNKNOWN): đã bấm nhưng mất kết nối. Email vẫn giữ, VM vào lọc Cần kiểm tra. Kiểm tra lịch sử EarnApp trước; không bấm rút thêm, không đổi email.
- Huỷ / thất bại khi chưa gửi thì nhả email giữ. Yêu cầu đã gửi rồi huỷ thì email vẫn đã dùng.
- Mỗi EarnApp một lượt rút, không chia nhỏ. Tiền về chỉ ghi với giao dịch PayPal khớp. Tiền PP không phải USDT của team.

**Quyền:**
- Xem số dư: quyền đọc Server / VM và (quyền tiền PayPal hoặc quyền ghi số dư). Người xem khác chỉ thấy "Đã kiểm tra" và điều kiện, không thấy số.
- Ghi số dư: quyền ghi Server / VM, dự án Proxy / VM, không phải VIEWER, và (ADMIN / MODERATOR hoặc quyền riêng **Ghi kiểm tra tiền EarnApp** `EARN_BALANCE`). Quyền này không cho ghi yêu cầu rút, gán email, xoá kho, sửa chi phí hay sửa khoản nhận.
- Yêu cầu rút và gán email vẫn cần quyền tiền / gán như trước.

**Sửa sau kiểm độc lập (20/10/2026):**
- Một yêu cầu rút thuộc đúng một VM, một lượt và một EarnApp. Lệnh từ ô (`vmOps.updatePayout`, `requestPayout`) mang `vmId`, `expectedCycle`, `earnAppId` đã thấy; kiểm lại trong giao dịch. Khi tài khoản đã rời VM (đổi A → B cùng lượt) hoặc VM đã tạo lại, lệnh vận hành bị từ chối ("yêu cầu này thuộc tài khoản cũ"): không gán email, không đổi liên kết, không đánh dấu đã dùng cho tài khoản hiện hành, với cả SENT, UNKNOWN, RETRY, FAILED / CANCELLED, CORRECT, SETTLE.
- Đối chiếu lịch sử tài khoản cũ (`history: true`, ở Lịch sử của VM → "Đã gửi trên EarnApp (theo lịch sử EarnApp)" / "Chưa gửi — trả email"): SENT làm email thành email nhận của tài khoản cũ, đã dùng vĩnh viễn, để tiền về muộn gắn đúng yêu cầu cũ; UNKNOWN giữ email; FAILED / CANCELLED nhả email đang giữ; CORRECT / SETTLE chỉ sửa tiền. RETRY bị từ chối (gửi lại là thao tác trên máy mà tài khoản đã rời). Tài khoản mới trên VM không bị đụng tới.
- Nháp gắn định danh: số dư tại ô gắn dự án + VM + lượt + EarnApp từ lúc bắt đầu nhập; form yêu cầu rút gắn lượt + EarnApp lúc mở; form thao tác gắn đúng yêu cầu lúc mở. Dữ liệu nền đổi → nháp giữ, báo tại chỗ, Lưu khoá; muốn ghi cho tài khoản mới bấm "Ghi lần mới" (form trống) sau khi kiểm tra lại. Mất phản hồi thì bấm lại cùng nội dung, định danh và khoá. Dán bảng đã gắn VM / lượt / EarnApp từng dòng từ lúc kiểm tra (giữ như trước).
- Nội dung tự do (điều kiện quan sát, lý do lỗi, căn cứ) chỉ trả cho người có quyền đọc số dư; người khác nhận trạng thái trung tính (kết quả, điều kiện YES / NO / UNKNOWN, giờ, `noteHidden`), không có bản chép lại. `EARN_BALANCE` đọc được số dư và ghi chú kiểm tra, không mở tiền PayPal hay quyền rút.
- "Đã về PP" là tiền thực nhận: yêu cầu $10, nhận $6, chốt thiếu $4 → "Đã về PP $6,00" / "Đã chốt thiếu $4,00 · Cần tạo lại VM". Sổ tiền, tổng hợp và điều kiện tạo lại VM không đổi.

**AI (chuẩn bị, chưa nối máy):**
- Chưa có kết nối nào từ web tới VM hay EarnApp (không SSH, RDP, agent hay API EarnApp). Web không điều khiển VM và không tự rút tiền.
- Chưa tạo user, mật khẩu hay token cho AI. Khi chủ dự án yêu cầu: tạo một thành viên USER với module INFRASTRUCTURE và `EARN_BALANCE` (thêm quyền tiền chỉ khi muốn AI ghi yêu cầu rút).
- "Kiểm tra tiền các VM trên An-01": đọc `vmOps.board` lấy VM, `cycle`, `earnAppId`; đọc EarnApp từng máy; gửi `vmOps.balanceRecord` với `source AI`, giờ thật đã đọc, một khoá cho mỗi lô (gửi lại cùng khoá khi mất trả lời). Dòng bị từ chối vì lượt / tài khoản thì đọc lại bảng, không ép ghi.
- "Rút tiền các VM đủ điều kiện trên An-01": chỉ VM có điều kiện YES vừa kiểm tra; `vmOps.payoutPick` (có `amount`) lấy gợi ý; `requestPayout` với `submission PREPARING` trước khi bấm; bấm rút trên EarnApp; thấy trong lịch sử → `updatePayout SENT`; mất kết nối → `updatePayout UNKNOWN`, đối chiếu lịch sử EarnApp trước khi làm tiếp. Mọi lệnh mang `expectedCycle`, nên lệnh cũ không chạm VM đã tạo lại hay tài khoản đã đổi. Tiến độ nằm ở trạng thái yêu cầu, nên AI dừng giữa chừng có thể đọc lại và làm tiếp.
- Còn thiếu để AI thật làm được trên máy: cách vào từng VM (địa chỉ, giao thức, tài khoản, hoặc agent cài sẵn), cách AI đăng nhập EarnApp trên máy đó, nơi giữ bí mật cho AI, và quyết định của chủ dự án về tài khoản AI.

## Dữ liệu và kiểm tra

- **Migration** `20261019090000_vm_cycle_payout`, chỉ thêm:
  - bảng `VmOperation`, `VmOpsEvent`, `VmCycle`, `EarnPayoutRequest`;
  - cột `FundTransaction.payoutRequestId`, `EarnAppAccount.closedAt` / `closedReason`.
  - Dữ liệu cũ không bị đổi; mọi VM bắt đầu ở lượt 1, "Chưa ghi". Không ghép khoản thu cũ vào EarnApp.
- **Test:**
  - `src/__tests__/proxy-management/vm-ops.integration.test.ts` (19): trạng thái, 24 + 10 + 12, 82 + 18, nhận từng phần, một lượt rút, email, quyền, tạo lại, BLOCKED, SUS, đồng thời, hoàn tác, autofill; nhóm "Rà soát nghiệm thu 19/10" (6) cho bốn lỗi đã sửa.
  - `vm-ops-rules.test.ts` (5).
  - `vm-grid-model.test.ts`: URL.
- **Bằng chứng:** `docs/superpowers/evidence/2026-10-19-vm-ops-cycle/`; bản sửa sau rà soát: `docs/superpowers/evidence/2026-10-19-vm-ops-fixes/`.
- **Migration** `20261020200000_earn_balance_checks`, chỉ thêm: bảng `EarnBalanceCheck`; cột `EarnPayoutRequest.submission` (mặc định SENT cho mọi yêu cầu cũ) / `submittedAt`; `PayPalEmail.holdEarnAppId` / `holdAt`.
- **Test tiền tại VM:** `earn-money-rules.test.ts` (7), `earn-money.integration.test.ts` (8). Bằng chứng: `docs/superpowers/evidence/2026-10-20-earn-money/`.
- **Phát hành tiền tại VM:** commit 563c642, backup 5bcf8d20, deploy 66f4c1ba; host chỉ đọc trước / sau giống hệt (host chưa có EarnApp).
