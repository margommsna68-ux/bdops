# Quản trị Server / VM

Trang: `/infrastructure/servers` (tất cả server) và `/infrastructure/servers/<id>` (một server). Triển khai 16/10/2026. Bố cục bảng, sửa ô bằng bàn phím, Dán bảng, chọn nhiều và khung chi tiết từ 17/10/2026: xem [Bảng vận hành Server / VM](server-vm-table.md); nút Xoá VM nằm trong menu ⋯ của dòng, Xoá server trong menu ⋯ đầu trang. Bằng chứng và ảnh trước/sau: `../superpowers/evidence/2026-10-16-server-vm-admin.md`.

## Cách dùng

- **Thêm VM**: bấm *Thêm VM*. Form mặc định chọn server đang xem và gợi ý mã tiếp theo, ví dụ VM_081, nếu mã hiện có theo một mẫu rõ ràng. Nhập *Từ* và *Đến*, ví dụ `VM_001 → VM_080` hay `M-001 → M-030`. Hai đầu phải cùng tiền tố, số đầu ≤ số cuối, tối đa 500 mã. Số 0 đầu lấy theo mã bắt đầu.
  - Ngay trong form hiện "12 VM mới · 3 đã tồn tại · 1 đã xoá". Bấm **Tạo 12 VM** là xong, không có hộp xác nhận.
  - Mã đã có hoặc đã xoá được bỏ qua; mã đã xoá thì khôi phục ở bộ lọc *Đã xoá*.
  - Không tự gán proxy, SDK hay tài khoản. Mã không liên tiếp: *Dán danh sách*.
- **Thêm server**: tên, IP (không bắt buộc), khoảng VM. Tạo xong mở thẳng trang server đó.
- **Sửa tại chỗ**: rê vào tên server, IP, ghi chú server, mã VM hay ghi chú VM rồi bấm bút.
  - Enter hoặc ✓ để lưu, Esc hoặc ✕ để huỷ. Không lưu khi đang gõ dở; giữ nguyên giá trị cũ thì không ghi gì.
  - Lỗi hiện ngay cạnh ô (ví dụ trùng mã) và giữ nguyên chữ đang gõ.
  - Đổi mã giữ nguyên ID, proxy, SDK, tài khoản và lịch sử. Mã trùng bị chặn trong cùng server, kể cả máy đã xoá; tên server trùng bị chặn trong dự án.
- **Xoá** (lưu trữ, khôi phục được): nút thùng rác ở dòng, hoặc tick nhiều dòng rồi bấm *Xoá N*.
  - Ô chọn tất cả chỉ chọn kết quả đang lọc. Đổi server, bộ lọc hay ô tìm thì bỏ chọn cũ.
  - VM không giữ proxy: xoá ngay, thông báo có nút **Hoàn tác**.
  - VM còn proxy (Chờ cài / Đã cài / Giữ để kiểm tra) hoặc việc cài chưa xong: bị chặn. Danh sách lý do có liên kết *Mở VM*. Web không tự bỏ gán hay thả proxy.
  - Hàng loạt: xoá các dòng hợp lệ, báo số đã xoá và từng dòng bị chặn.
- **Xoá server**: nếu còn VM giữ proxy thì báo ngay, không hỏi. Không còn thì hỏi một lần "Xoá server X cùng N VM?". Server và các VM đang hoạt động được lưu trữ trong cùng một giao dịch.
- **Khôi phục**: bộ lọc **Đã xoá** hiện máy đã xoá và dải *Server đã xoá*. Bấm *Khôi phục* ở dòng, hàng loạt, hoặc ở server.
  - Khôi phục server trả lại đúng các VM đã xoá cùng nó.
  - Bị chặn nếu server của VM còn đang xoá. SDK của máy (19/10/2026): nếu mã đã được chuyển sang VM khác thì máy khôi phục không có SDK; web không giành lại.
- Máy đã xoá không xuất hiện trong *Điền VM thiếu*, ô chọn VM (bảng proxy, tài khoản, công việc) và số đếm máy hoạt động.

## Bảng

- Xem một server: tên server chỉ ở tiêu đề, dòng ghi `VM_001`. Xem tất cả: hai cột *Server* và *VM*. *Ghi chú* là cột riêng.
- Câu ghi chú do lần nhập Sheet 15/10 tự ghi ("Recorded on Sheet…", "Imported from personal Sheet…") được ẩn khi hiển thị nhưng vẫn giữ trong dữ liệu. Hai mã đối chiếu `VM_GENJY_CONFLICT` và `VM_UNRESOLVED` hiện bằng câu tiếng Việt.
- Vẫn tách *Đã cài trên máy* và *Proxy được giao*. Không đổi nghiệp vụ LIVE, SDK, nhóm sở hữu hay cài proxy.

## Số bước trước / sau

| Thao tác | Trước | Sau |
|---|---|---|
| Tạo 80 VM liên tiếp | Thêm VM → gõ 80 dòng mã → Lưu | Thêm VM → sửa ô *Đến* → **Tạo 80 VM** (3) |
| Đổi mã / ghi chú VM | Không có trên web | Bút → gõ → Enter (3) |
| Đổi tên / ghi chú server | Thông tin server → sửa → Lưu (hộp thoại) | Bút → gõ → Enter, tại tiêu đề (3) |
| Xoá một VM | Không có trên web | 1 bấm, có Hoàn tác |
| Xoá nhiều VM | Không có | Chọn tất cả → Xoá N (2) |
| Xoá server | Thông tin server → Ẩn server → xác nhận; VM không ẩn theo | Xoá server → xác nhận (2); VM ẩn cùng |
| Khôi phục | Không có | Đã xoá → Khôi phục (2) |

## Kiểm soát

Backend luôn kiểm tra lại khi lưu: quyền MANAGE, dự án, revision (VM và server), trùng mã, proxy đang giữ, việc cài mở và xung đột SDK. Mọi thao tác ghi nhật ký, hoàn tác được ở *Lịch sử thao tác*. Tạo VM bấm lặp hay hai người tạo cùng lúc không sinh trùng: khoá duy nhất `(serverId, code)` cộng giao dịch Serializable.

## Giới hạn và việc tiếp theo

- (Đã xử lý 17/10) Bảng có cột định danh và menu ⋯ cố định; xem server-vm-table.md.
- Chưa có thao tác chuyển VM sang server khác; đây là chủ ý, đổi mã không tự di chuyển VM.
- Xoá server không xoá cứng; tên server và mã VM đã xoá vẫn giữ chỗ, muốn dùng lại thì khôi phục.
- Chỗ còn lặp ở trang khác, chưa sửa trong mốc này:
  - *Việc cài proxy*: mỗi thẻ ghi lại "server / VM" kể cả khi đang lọc một server.
  - *Kho proxy*: hai dải thông báo bản thử / nguồn Genjy ở đầu trang, và số đếm vừa ở thẻ tổng vừa ở nút lọc nhanh.
  - *Công việc* và *Chi phí*: cột server và VM lặp khi lọc theo một server.
