# Ba điểm còn lại của theme (19/10/2026)

## 1. Giữ lựa chọn khi đổi theme

Lỗi do chủ dự án tái hiện trên host (theo brief; em không tái hiện lại): Server / VM chọn An-01/VM_001–003 → Thiết lập → đổi theme → Back: mất 3 dấu chọn (lựa chọn chỉ nằm
trong trạng thái của trang). Sửa: `src/lib/session-selection.ts` (sessionStorage của tab, khoá theo người dùng + dự án, kèm phạm vi bộ lọc),
dùng ở `ServerWorkspace.tsx` và `RegistryTable.tsx`; khôi phục một lần khi đã tải đủ danh sách (VM, tài khoản, tình trạng / trang proxy),
chỉ các id còn trong danh sách. Test `session-selection.test.ts` (4 ca).

Trình duyệt, dữ liệu thử cục bộ (`.runtime/p25-local-setup.ts`), thao tác thật Thiết lập → bấm thẻ theme → Back: **12/12 PASS**
(`browser-result.txt`): chọn VM_001–003 → Đồng ấm → Back còn đúng 3, không lệnh ghi; VM_003 bị xoá ở tab khác → Back còn 2; đổi bộ lọc bỏ
chọn và Back không hiện lại; VM_005 được gán proxy ở tab khác (rời Thiếu proxy) → Back chỉ còn VM_004; chọn qua 2 trang với tìm "VM_00"
→ Back vẫn 2, ô tìm và trang giữ; sang dự án khác không có dòng chọn sẵn; Kho proxy chọn 2 → Tối → Back còn 2, đổi nhóm bỏ chọn; nháp Nhập
PayPal còn nguyên; không lỗi JS.

## 2. Tự đồng bộ màu Đồng ấm

`scripts/build-bronze-theme.cjs` là bước đầu của `npm run build` và của Dockerfile (Railway). Chỉ ghi khi nội dung đổi; chạy lại cùng
source: "unchanged". `npm run theme:check` / test `theme-bronze-sync.test.ts`: bản trong source phải đúng như source sinh ra (thêm một
dòng thừa → test đỏ, sinh lại → xanh), hai lần sinh giống hệt, mọi quy tắc nằm dưới `[data-theme="bronze"]`.

## 3. Chip SUS ở theme Sáng

Số trên chip SUS dùng màu chữ trang (gần đen) trên nền đỏ đậm. Thêm một quy tắc chỉ cho Sáng (`html:not([data-theme])`, vm-grid.css):
số trắng. Đo trên trình duyệt: thường nền rgb(153,27,27) / số trắng; đang chọn nền rgb(29,78,216) / số trắng. Tối, Vàng kim, Đồng ấm
không đổi (quy tắc không áp cho chúng). Ảnh `s9-sus-light.png`, `s9-sus-light-active.png`.

## Kiểm tự động

104 file / 513 test qua; typecheck, lint (không cảnh báo mới), build qua.

## Phát hành và host

Commit 52e43fc, backup host 7e031704-8d9b-4d57-bf1d-38623d7d3418 trước khi deploy, deploy 06fcde66 SUCCESS, không migration. Log build
Railway có bước `RUN node scripts/build-bronze-theme.cjs` → "unchanged (utilities 254, component rules 119)": bản sinh trên Linux giống
hệt bản trong source. Host, chỉ thao tác trình duyệt (không ghi): chọn An-01/VM_001–003 → Thiết lập → Đồng ấm → Back: còn đúng 3, "Đã chọn
3 VM"; Kho proxy chọn 2 → Thiết lập → Sáng → Back: còn 2; sau đó Bỏ chọn. Chỉ POST user.verifyPin / user.heartbeat, không lỗi JS. Host
không có VM SUS nên chip SUS không hiện ở đó. Số liệu host trước / sau giống hệt.

## Chưa kiểm / giới hạn

- Không chạy lại so điểm ảnh toàn trang theme cũ: dữ liệu cục bộ đã đổi do chính lượt kiểm (server, VM xoá, lịch sử), nên ảnh khác ở mọi
  theme như nhau. Thay đổi CSS của theme cũ chỉ là đúng một quy tắc chip SUS cho Sáng (git diff).
- Lựa chọn giữ trong tab: mở tab mới hoặc đóng tab thì không giữ (đúng yêu cầu bộ nhớ phiên).
- Chip SUS chưa xem trên host (host chưa có VM SUS); đã kiểm ở dữ liệu thử cục bộ.
