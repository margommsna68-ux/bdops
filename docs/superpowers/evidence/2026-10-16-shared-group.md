# Nhóm chung mooon–Genjy — bằng chứng 16/10/2026

Yêu cầu: "PC chung" = proxy mooon và Genjy cùng đầu tư; hiện "Chung mooon–Genjy", tách TUT riêng và Genjy riêng; lọc nhanh có số lượng, kết hợp lọc khác, giữ URL, lọc trước khi phân trang; đối chiếu danh sách 30 proxy (preview, không nhập mới, không suy theo dải IP / user/pass); gán server/VM thủ công; không vào autofill TUT; BLOCKED/replace giữ phân loại; lịch sử, chống lưu lặp, revision, hoàn tác. Hướng dẫn: `../../runbooks/proxy-shared-group.md`.

## Đã làm

- Commit `fafa6df`. Migration `20261016200000_shared_classification_undo` chỉ thay hàm trigger, không đổi bảng.
- Server: `isShared`, nhóm lọc `SHARED` / `GENJY` (= Genjy riêng), `groupCounts` theo phạm vi đang lọc, `counts.shared`. `assignableReason` cho phép nhóm chung, Genjy riêng vẫn bị chặn. Cài và xác nhận nhận nhóm chung. `planShared` (luồng `sharedList` trong `editPreview/editCommit`), ảnh `IDENTITY` và hoàn tác, sự kiện `SHARED_CONFIRMED`. Thông điệp trùng khi nhập: "IP thuộc nhóm chung mooon–Genjy".
- UI: huy hiệu xanh ngọc, nút lọc nhanh có số, ô tổng *Chung mooon–Genjy* / *Genjy riêng*, `SharedListDialog` (Thiết lập → Xác nhận nhóm chung), lựa chọn nhập mới *Chung mooon–Genjy*, cột Server hiện *Chưa gán* cho dòng nhóm chung chưa có VM.

## Kiểm chứng

- `shared-group.integration.test.ts` (3, DB thật): nhãn; lọc SHARED / GENJY / TUT không lẫn nhau; đếm theo trạng thái và ô tìm; phân trang 2 dòng/trang đi hết 6 dòng nhóm chung. Gán VM thủ công một dòng và theo bảng dán; Genjy riêng bị `GENJY_RESERVED`; VM bận bị `CURRENT_IP`; autofill chỉ còn TUT. BLOCKED rồi replace: IP mới vẫn GENJY + PC_CHUNG. Danh sách xác nhận gồm READY / SKIP / INVALID / NOT_FOUND / DUPLICATE / sai user-pass / chỉ còn lịch sử, cộng danh sách "không có trong danh sách". Lưu 3, lưu lại là replay, dữ liệu đổi sau xem trước bị `STALE_PREVIEW`, hoàn tác trả đúng phân loại cũ. Sau đó ghi thường vẫn bị trigger chặn.
- Suite 289 tests / 72 files, tsc, lint (4 cảnh báo cũ), build qua. Hai test cũ thỉnh thoảng đỏ khi chạy song song vì dải IP ngẫu nhiên trùng IP cố định ở file khác; chạy lại thì xanh.
- Trình duyệt local (bản sao 15/10 của mooon, ảnh `local-*.png`): nút lọc *Tất cả 1261 · TUT 562 · Chung mooon–Genjy 33 · Genjy riêng 641*. Lọc nhóm chung chỉ còn 33 dòng *Chung mooon–Genjy*; trang 2 của Genjy riêng vẫn chỉ Genjy riêng. Lọc kết hợp nhóm chung với BLOCKED, moon1 và tìm `84.32.13` đều đúng. Bỏ gán `178.95.180.143` khỏi moon05/VM_078, rồi gán `84.32.136.15` (nhóm chung) vào VM đó: *moon05 VM_078 · Chờ cài*. Dán `84.32.136.45 | moon05 | VM_078` bị chặn với lý do *VM đang giữ proxy 84.32.136.15*. BLOCKED `84.32.136.45` rồi replace sang `10.88.0.7`: dòng mới hiện *Chung mooon–Genjy*.

## Railway

- Backup host `8b55df5b-7666-4fc5-9ead-97e973f8c835`, rồi deploy `6533027a-5f98-4daf-b87b-605de5eee791` SUCCESS (migration áp ở pre-deploy). Verify 10 server / 574 VM.
- Host mooon, **chỉ đọc** (ảnh `host-*.png`): nút lọc *Tất cả 1261 · TUT 562 · Chung mooon–Genjy 33 · Genjy riêng 641*. Lọc nhóm chung có 33 dòng, không lẫn nhóm khác. Genjy riêng trang 2 vẫn đúng nhóm. Nhóm chung với BLOCKED ra 0 dòng. Xem trước danh sách thử gồm 3 IP nhóm chung, 1 IP TUT, 1 IP lạ, 1 dòng sai và 1 dòng lặp ra *1 sẽ cập nhật | 3 đã ở nhóm chung | 3 cần kiểm tra*, kèm 30 proxy nhóm chung không có trong danh sách. Không lưu, nên host không đổi phân loại nào.

## Chưa làm / giới hạn

1. **Đối chiếu danh sách 30 proxy của anh (16/10, sau deploy)**: xem trước trên host qua *Xác nhận nhóm chung* cho kết quả *0 sẽ cập nhật | 30 đã ở nhóm chung | 0 cần kiểm tra*. Cả 30 IP đều đã là Chung mooon–Genjy, port/user/pass khớp đúng proxy đang có. Không cần ghi, nên host không đổi gì.
2. Có 3 IP host đang ghi nhóm chung nhưng không có trong danh sách: `84.32.136.45`, `84.32.136.144`, `84.32.137.32`. Cả ba thuộc gói 231243, LIVE, chưa gán VM. Sheet ghi "pc chung" (Proxy Server B12/B34/B79) và "PC GEN +MOON" (final A3/A25/A70). Giữ nguyên chờ anh chốt; bỏ phân loại chung cần quyết định từng IP vì luật DB giữ phân loại vĩnh viễn.
3. Không tính tỷ lệ góp vốn hay chia chi phí.

## Cập nhật theo Sheet và bộ chia trang (16/10, tối)

- Anh cập nhật Sheet: tab moon05 dùng lại VM_078 và thêm VM_079, VM_080 với `84.32.136.45`, `84.32.136.144`, `84.32.137.32` (3 IP nhóm chung ngoài danh sách 30). Tab Proxy Server đổi trạng thái 3 IP này LIVE → NEW. Tab Total vẫn để chúng trong khối "EARN MOON - PC GEN +MOON"; tab PCchung của Genjy có đúng 30 IP. Ngoài ra Proxy Server không đổi gì (1.310 IP).
- Host: backup `b7075be8-6c1f-4440-b147-14bb59827b08`, thêm VM_079 / VM_080 vào moon05 (Thêm VM), gán 3 IP qua bảng dán `Proxy | Server | VM` (xem trước 3 hợp lệ → lưu 3). Sau đó 576/576 ô VM của Sheet khớp web; 3 VM ở trạng thái *Chờ cài*. Phân loại nhóm chung của 3 IP giữ nguyên.
- Bảng proxy: dòng tổng *Dòng a–b / tổng · Trang x/y* và nút trang ở cả trên và dưới bảng; 100 dòng mỗi trang; bấm trang ở dưới thì cuộn về dòng tổng phía trên. Commit `ea7fe1c`, backup `981c4c3c-39e3-4def-a54f-1ea8aa53a08e`, deploy `5d83d763-24d1-4988-9d23-31a151118bdb` SUCCESS, verify 10 server / 576 VM. Host: trang 1 *Dòng 1–100 / 1261 · Trang 1/13*, trang 2 *101–200*, lọc nhóm chung *1–33 / 33* (ảnh `host-10-pager-top.png`, `host-11-pager-bottom.png`).
- Trạng thái web của 3 IP vẫn là LIVE (Sheet ghi NEW); chưa có thao tác đổi trạng thái LIVE ↔ NEW trên web.

## Đổi nhóm mọi dòng, đổi trạng thái và 3 IP moon05 (16/10, khuya)

- Yêu cầu: ghi trạng thái theo Sheet, đưa 3 IP ở moon05 (anh lỡ bỏ gán) sang nhóm TUT, và cho dòng genjy / đã có nhóm đổi nhóm từng dòng và hàng loạt.
- Commit `26a54da`, migration `20261016220000_owner_decision` (thêm `ownerDecidedAt/By`, cờ trigger `moneytohome.owner_change`). Test mới trong `shared-group.integration.test.ts` (đổi nhóm từng dòng / hàng loạt, luật VM, NEW ↔ LIVE, quét Genjy giữ quyết định, hoàn tác, ghi thẳng DB vẫn bị chặn); 2 test cũ sửa theo luật mới. Suite 290 / 72, tsc, lint (4 cảnh báo cũ), build qua.
- Local (bản sao): đổi nhóm hàng loạt 2 dòng chung → TUT (dòng ở VM giữ VM), đổi trạng thái hàng loạt LIVE → NEW.
- Host: backup `d7dca48c-799b-472c-997e-02a432d3d4f8`, deploy `a4256298-5a1d-462b-8a53-35be791818d0` SUCCESS, verify 10 / 576. Gán lại `84.32.136.144` → moon05/VM_079 (lần bỏ gán lúc 11:24). Qua giao diện: tick 3 IP → Đổi nhóm → TUT (xem trước 3 hợp lệ, giữ vị trí VM) → lưu; Đổi trạng thái → NEW → lưu. Kết quả: 3 dòng *NEW · TUT · moon05 VM_078/079/080 · Chờ cài*. Đếm host: TUT 565, Chung 30, Genjy riêng 641; 576/576 ô VM khớp Sheet. Ảnh `host-20…23-*.png`.

