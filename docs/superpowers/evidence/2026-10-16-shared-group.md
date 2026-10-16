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

1. **Danh sách 30 proxy chưa được gửi kèm**, nên chưa ghi phân loại thật. Host đang có 33 proxy nhóm chung (lấy từ tab PC của Sheet). Khi có danh sách: dán vào Xác nhận nhóm chung, đọc phần xem trước, rồi lưu.
2. Nếu danh sách ít hơn 33, phần dư hiện ở mục "không có trong danh sách". Bỏ phân loại chung cho các IP đó cần anh chốt từng IP, vì luật DB giữ phân loại vĩnh viễn.
3. Không tính tỷ lệ góp vốn hay chia chi phí.
