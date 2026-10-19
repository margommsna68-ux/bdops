# Ghi chú Kho tài khoản, nhiều SDK tại VM, dán SDK theo khoảng (20/10/2026)

## Đã làm

- Ghi chú Gmail / Apple ID sửa tại ô (`NoteCell.tsx`, `accountStore.setNote`).
- Danh sách SDK của VM (`sdk-list.ts`, migration `20261020090000_sdk_vm_list` chỉ thêm cột): thêm không ghi đè, Đã dùng vĩnh viễn không
  tạo liên kết giả, chuyển VM rõ nguồn → đích, đưa mã chưa dùng về kho; ô "N SDK · M chưa dùng"; khung danh sách; Kho SDK cùng bản ghi.
- Dán bảng → SDK: Có mã VM / Chỉ SDK theo khoảng VM.
- Tạo lại VM: mã hiện hành thôi hiện hành nhưng ở lại danh sách; ô tài khoản trống hiện "Chưa có tài khoản".

## Test tự động

- Mới: `account-note.integration.test.ts` (1), `sdk-list.integration.test.ts` (6: nhiều mã / Đã dùng / không cấp lại / dán lại không bản
  sao; chuyển rõ nguồn, hai người cùng lấy một mã chỉ một người được, lượt cũ bị từ chối, tiền sửa ở Kho SDK cùng bản ghi; SUS → tạo lại;
  hoàn tác; dán A; dán B).
- Đổi kỳ vọng cũ theo nghiệp vụ mới (mã bị thay / gỡ / tạo lại ở lại danh sách VM thay vì về kho; chuyển tiếp mã đó cần nêu nguồn):
  `sdk-store.integration.test.ts` (4 ca), `vm-sdk.integration.test.ts` (1 ca), dữ liệu mẫu `vm-sdk-ui.test.tsx`.
- Toàn bộ 107 file / 523 test qua; typecheck, lint (không lỗi), build qua. Migration áp trên DB thử cục bộ (backup trước): 401 mã đang ở VM
  đều vào danh sách đúng VM, 0 lệch.

## Trình duyệt (dữ liệu thử cục bộ `.runtime/p27-local-setup.ts`, đọc lại dữ liệu sau mỗi thao tác): 23/23 PASS

Ghi chú: ô trống bấm sửa, Esc huỷ, Enter khi đang gõ dấu không lưu, Shift+Enter xuống dòng, lỗi lưu báo tại ô giữ nội dung, lưu thật mới
"Đã lưu", 3 dòng khi xem / đọc hết khi sửa, cột 280 → kéo 400px. Dán theo khoảng khi bảng sắp xếp Ưu tiên: VM_004 → VM_009, dòng trống
giữ VM_006, VM_007 đã xoá và VM_009 không có báo tại dòng, ghép đúng số VM. Dán có mã VM không theo thứ tự + cột Server, 2 SDK cùng VM_012,
mã đang ở VM khác báo vị trí; dán lại = Áp dụng 0, Giữ nguyên. VM_010 thêm 3 mã trong khung, tick 1: "3 SDK · 2 chưa dùng", đã dùng xếp
sau, ghi người + giờ, không account giả; Kho SDK hiện Đã dùng; cấp lại cho VM khác bị backend chặn. SUS → Ghi nhận đã tạo lại → VM_010 lượt
2, "Chưa có tài khoản", 2 chưa dùng + 1 đã dùng còn nguyên → gán tài khoản mới (một tài khoản hiện tại) → tick mã chưa dùng của lượt trước
được ghi lượt 2. Bốn theme ở 1280px và điện thoại 390px (khung SDK, Dán bảng, ô ghi chú): không tràn ngang, không lỗi JS. Không quay video.

Lượt đầu có lỗi kịch bản (nút "Thêm" trùng tên "Thêm ghi chú"; ô tick chỉ đổi sau khi server lưu nên `check()` báo không đổi), dữ liệu
đúng; sửa kịch bản, chạy lại trên dữ liệu mới. Thấy và sửa một chỗ lệch yêu cầu: ô tài khoản trống hiện "Chọn tài khoản" → "Chưa có tài
khoản".

## Phát hành và host

Commit 91c38a3, backup host 7d0261a8-f662-485e-812f-467abd6d62d8 trước khi deploy, deploy 22b505d1 SUCCESS; pre-deploy áp migration
`20261020090000_sdk_vm_list` ("All migrations have been successfully applied"). Host chỉ đọc: số liệu trước / sau giống hệt (10 server /
576 VM, 553 Có proxy, 23 Cần kiểm tra); 5 SDK của host (moon1 / M-001 … M-005) đều nằm trong danh sách đúng VM và đánh dấu hiện hành,
"Chưa có SDK" vẫn 571. Trình duyệt: ô "1 SDK · 1 chưa dùng", khung danh sách, Dán bảng → SDK (hai cách), cột Ghi chú 280px; chỉ POST
verifyPin / heartbeat, không lỗi JS; không nhập ví dụ nào.

## Chưa kiểm / giới hạn

- Hai người cùng thao tác chỉ kiểm bằng test tích hợp (lấy cùng một mã, sửa tiền cùng phiên bản), không kiểm hai trình duyệt song song.
- Quyền: dùng lại quyền ASSIGN / quyền ghi kho sẵn có; không kiểm riêng bằng tài khoản thiếu quyền trên trình duyệt.
- Kho SDK chỉ hiện trạng thái; tick Đã dùng chỉ có ở danh sách của VM (cần biết VM).
- Ô ghi chú trên màn hẹp nằm ở cột phải của bảng cuộn ngang như các cột khác.
