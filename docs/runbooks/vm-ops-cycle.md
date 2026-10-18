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
  - Đạt mức gom: số dư thực ≥ 100.
  - Dự kiến đủ 100 USD: số dư thực chưa đủ, nhưng cộng tiền còn chờ thì đủ.
  - Đang gom: cộng cả tiền chờ vẫn dưới 100.
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

## Ghi nhận đã tạo lại VM

Chỉ bấm khi máy thật **đã được tạo lại**.

**Điều kiện:**
- Yêu cầu rút của lượt hiện tại đã nhận đủ và chưa dùng; hoặc
- Tình trạng là SUS (EarnApp bị suspend vĩnh viễn).

**Web làm gì:**
- Giữ id, server và mã VM. Mở lượt N+1 với tình trạng **New VM** (không tự LINKED/OK). Ghi lại lượt N (`VmCycle`): EarnApp, tài khoản, email, SDK, tình trạng cuối, cấu hình.
- Đóng EarnApp cũ: rời VM, đặt `closedAt`. Tài khoản Gmail/Apple ID thành Đã dùng, không về NEW. Email vẫn "đã dùng".
- Chuyển SDK hiện hành vào lịch sử. SDK mới chỉ ghi khi có mã thật sau khi cài.
- **Proxy:**
  - Proxy đã cài còn hợp lệ (TUT hoặc Chung mooon–Genjy; NEW/LIVE; chưa replace, ngừng quản lý hay BLOCKED) được giữ cho vị trí. Web tạo cấu hình mới chờ cài, nên phải cài và xác nhận lại; bằng chứng cài cũ thuộc lượt cũ.
  - Proxy không bị thả ra kho.
  - Proxy BLOCKED hoặc không đủ điều kiện để nguyên cho luồng thay proxy.
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

**Hoàn tác** (Lịch sử thao tác) chỉ huỷ ghi nhận trên web: không đảo ngược việc rút tiền, không xoá hay cài lại máy. Chỉ hoàn tác được khi chưa có gì sửa tiếp. Email đã dùng vẫn là đã dùng.

## Dữ liệu và kiểm tra

- **Migration** `20261019090000_vm_cycle_payout`, chỉ thêm:
  - bảng `VmOperation`, `VmOpsEvent`, `VmCycle`, `EarnPayoutRequest`;
  - cột `FundTransaction.payoutRequestId`, `EarnAppAccount.closedAt` / `closedReason`.
  - Dữ liệu cũ không bị đổi; mọi VM bắt đầu ở lượt 1, "Chưa ghi". Không ghép khoản thu cũ vào EarnApp.
- **Test:**
  - `src/__tests__/proxy-management/vm-ops.integration.test.ts` (13): trạng thái, 24 + 10 + 12, 82 + 18, nhận từng phần, một lượt rút, email, quyền, tạo lại, BLOCKED, SUS, đồng thời, hoàn tác, autofill.
  - `vm-ops-rules.test.ts` (5).
  - `vm-grid-model.test.ts`: URL.
- **Bằng chứng:** `docs/superpowers/evidence/2026-10-19-vm-ops-cycle/`.
