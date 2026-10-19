# Theme "Đồng ấm" (19/10/2026)

## Đã thêm

- Mã theme `bronze`, thẻ **Đồng ấm** trong Thiết lập → Giao diện (hình xem trước: nền, sidebar, bảng, nút); bấm là áp dụng, dùng cơ chế
  lưu sẵn có. Không đổi cơ sở dữ liệu, API hay nghiệp vụ. Hướng dẫn: `docs/runbooks/themes.md`.
- Sidebar có móc lớp (`mth-*`) chỉ Đồng ấm dùng; đăng nhập / PIN / toast có móc lớp tương tự.

## Theme cũ không đổi (so điểm ảnh, cùng dữ liệu cục bộ)

11 trang × Sáng / Tối / Vàng kim chụp bằng bản build cũ rồi bản mới (`old-themes-pixel-diff.txt`): đăng nhập, Kho tài khoản, Lịch sử
nhập kho, Kho proxy, Server / VM, Chi phí, Tiền vào PayPal, Nhận USDT, Lịch sử thao tác: **0 điểm ảnh khác**. Tổng quan và Nhân viên chỉ
khác ở dòng giờ "cập nhật hh:mm" / "hoạt động lúc" (hai lần chụp bản cũ cũng khác đúng chỗ đó: `old-themes-pixel-noise.txt`). Thiết
lập khác ở khu chọn giao diện (thêm thẻ thứ tư; hình xem trước có thêm bảng nhỏ). Lượt đầu, trang đăng nhập của Sáng / Vàng kim đổi vì
đăng nhập theo theme đã lưu; đã sửa để đăng nhập giữ như cũ (Tối), chỉ Đồng ấm đã lưu mới áp ở đăng nhập. Ảnh `old-*-servers-before/after.png`.

## Trình duyệt, Đồng ấm (dữ liệu thử cục bộ): 21/21 PASS (`browser-result.txt`)

Chọn ở Thiết lập áp dụng ngay, không gửi lệnh ghi; tải lại, mở lại trình duyệt (phiên mới) vẫn Đồng ấm, cả đăng nhập và PIN; nháp
Nhập PayPal (dòng, 10 USDT / 3) còn nguyên sau khi sang Thiết lập đổi theme rồi quay lại; lỗi tại ô ("25,820" ở VND) và nút khoá mờ, nội
dung hợp lệ thì nút Nhập đồng đậm `#8C5A2B`; Server / VM cuộn ngang + dọc: tiêu đề và cột cố định nền kín; chọn 3 dòng (đổi theme trên
trang vẫn giữ 3 dòng chọn); khung Thay proxy (Áp dụng mờ khi chưa chọn), khung SDK; Kho proxy chọn 2 dòng, menu thả chọn dự án; toast;
chuyển lần lượt 4 theme; biểu đồ đổi màu, vẫn bấm được, tooltip; điện thoại 390px không tràn ngang, menu kem. Chỉ có POST verifyPin /
heartbeat / importPreview (xem trước, không ghi). Không lỗi JS. Không quay video.

Độ tương phản (`node scripts/build-bronze-theme.cjs --contrast`): chữ chính 13,5:1; chữ phụ 5,5:1 (bề mặt), 4,6:1 (tiêu đề bảng); chữ
trên nút chính 5,6:1; liên kết 5,7:1; olive / hổ phách / đỏ gạch 5,9 / 6,9 / 6,8:1; sidebar 9,3:1, mục chọn 8,0:1.

## Phát hành và host

Commit edb8f94, backup host 2aa822cc-46ee-4d64-a8b3-af2dcc4104ab (40.438.879 byte) trước khi deploy, deploy 12c7760d SUCCESS, không
migration. Host chỉ xem giao diện, không nhập gì: trình duyệt mới vẫn mở đăng nhập Tối như trước; với Đồng ấm lưu trong trình duyệt
kiểm, đăng nhập, PIN, Tổng quan, Server / VM (cuộn ngang + dọc, tiêu đề / cột cố định nền kín), Kho proxy, Kho tài khoản PayPal, Lịch
sử nhập kho, Chi phí, Thiết lập, điện thoại 390px (không tràn ngang) đều Đồng ấm; chỉ có POST user.verifyPin / user.heartbeat, không
lỗi JS (`host-browser-result.txt`, ảnh `host-*.png`). Số liệu host trước / sau giống hệt (10 server / 576 VM; 553 Có proxy, 23 Cần kiểm
tra).

## Chưa kiểm / giới hạn

- Không kiểm trình duyệt khác ngoài Chrome. Tooltip dạng `title` của trình duyệt không đổi màu (do trình duyệt vẽ).
- Trang Giao việc / Việc cài (đang ẩn) và trang cũ của dự án không phải Proxy / VM chỉ được phủ bằng ánh xạ lớp màu chung, không xem
  từng trang.
- Theme Sáng có sẵn lỗi nhỏ: số trên chip SUS chữ tối trên nền đỏ đậm; Đồng ấm đã sửa riêng, Sáng giữ nguyên theo yêu cầu không đổi theme cũ.
