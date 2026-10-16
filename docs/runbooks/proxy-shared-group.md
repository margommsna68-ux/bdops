# Nhóm chung mooon–Genjy

Quyết định của anh ngày 16/10/2026: "PC chung" là proxy do mooon và Genjy **cùng đầu tư**, không còn hiểu là của riêng Genjy. Danh sách 30 proxy anh cung cấp là danh sách xác nhận. Bằng chứng: `../superpowers/evidence/2026-10-16-shared-group.md`.

## Hiển thị và lọc

- Cột **Từ nhóm** có ba loại tách rõ: **TUT** (kho riêng của anh), huy hiệu xanh ngọc nhạt **Chung mooon–Genjy**, và **Genjy riêng**.
- Dải nút lọc nhanh ngay trên bảng: *Tất cả · TUT · Chung mooon–Genjy · Genjy riêng*. Mỗi nút kèm số lượng tính theo các bộ lọc đang bật (tab, trạng thái, gói, server, ô tìm IP), không tính bộ lọc nhóm.
- Ô chọn *Từ nhóm* có cùng các lựa chọn và các nhóm tự đặt. Bộ lọc giữ trên URL `?group=TUT|SHARED|GENJY|UNKNOWN|<id nhóm>`. Hệ thống lọc toàn bộ kết quả rồi mới chia trang.
- Ô tổng ở đầu trang có thêm **Chung mooon–Genjy**, chỉ đếm dòng đang quản lý. Ô **Genjy riêng** thay cho ô *Giữ cho genjy* cũ.

## Thao tác

- **Gán server / VM thủ công**: một dòng (nút bút) hoặc hàng loạt (*Chuyển server*, *Gán VM* theo bảng dán), theo quyền gán VM. Vẫn kiểm tra VM trống, chặn hai proxy cùng một VM và chặn bản đã bắt đầu cài. Proxy nhóm chung cài và xác nhận được ở *Việc cài proxy*.
- **Không vào autofill**: *Điền VM thiếu* và kho cấp tự động vẫn chỉ dùng TUT.
- **Genjy riêng** vẫn không gán vào VM của anh. Đổi nhóm cho dòng genjy hay nhóm chung bị từ chối.
- **BLOCKED / replace** giữ phân loại: IP mới thay cho proxy nhóm chung cũng thuộc nhóm chung, chuỗi A→B→C giữ nguyên.
- Nhập mới có lựa chọn *Chung mooon–Genjy* ở ô *Từ nhóm*, dành cho lần mua chung sau này.

## Xác nhận danh sách nhóm chung

Đường vào: **Thiết lập → Xác nhận nhóm chung**. Dán danh sách (IP hoặc `IP:port:user:pass`, mỗi dòng một proxy) rồi bấm **Xem trước**.

| Kết quả | Khi nào |
|---|---|
| Sẽ cập nhật | IP có trong kho hoặc nguồn Genjy của dự án, đang là TUT / Genjy riêng / nhóm tự đặt / chưa xác định |
| Giữ nguyên | Đã ở nhóm chung |
| Cần kiểm tra | Dòng sai định dạng; trùng dòng trước; IP không có trong dự án (không nhập mới); port hoặc user/pass không khớp proxy đang có; IP chỉ còn trong lịch sử |

- Phần cuối liệt kê proxy **đang ở nhóm chung nhưng không có trong danh sách**. Các proxy này giữ nguyên, hệ thống không tự bỏ phân loại.
- **Lưu N dòng hợp lệ** ghi một lần qua `editPreview/editCommit` (`sharedList`). Mỗi lần lưu có khoá chống lưu lặp và kiểm tra revision của từng IP.
- Mỗi IP được ghi sự kiện `SHARED_CONFIRMED` kèm phân loại trước. Proxy đang ở nhóm tự đặt sẽ rời nhóm đó. Nguồn Sheet, lịch sử và vị trí VM giữ nguyên. Không suy nhóm theo dải IP hay user/pass, không tính tỷ lệ góp vốn hay chia chi phí.
- **Hoàn tác** ở Lịch sử thao tác trả từng IP về phân loại trước, nếu chưa bị sửa tiếp. Luật DB "Genjy / PC chung là vĩnh viễn" vẫn áp cho mọi lần ghi khác. Chỉ giao dịch hoàn tác của đúng thao tác này được bật ngoại lệ (migration `20261016200000_shared_classification_undo`).

## Lưu trữ

Nhóm chung lưu là `ProxyIdentity.owner = GENJY` cộng `subgroup = PC_CHUNG`, nên không cần đổi bảng. Cách này giữ mọi bảo vệ Genjy: không nhập lại thành NEW, lần quét Genjy không làm mất phân loại, replace giữ nhóm.

## Giới hạn

- Bỏ một IP khỏi nhóm chung (ngoài hoàn tác) chưa có thao tác riêng, vì phân loại là vĩnh viễn. Nếu danh sách xác nhận ít hơn số đang ghi, cần anh chốt từng IP.
- Lần quét Genjy vẫn tự gắn PC chung cho IP nằm ở tab "PC / pc chung" của Sheet Genjy, như trước.
