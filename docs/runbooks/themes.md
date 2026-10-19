# Giao diện (theme)

## Chọn theme

Thiết lập → **Giao diện**: Sáng, Tối, Vàng kim, **Đồng ấm**. Bấm một thẻ là áp dụng ngay (không có nút Lưu, không hỏi lại). Lựa
chọn lưu trong trình duyệt của từng người (khoá `bdops-settings` ở localStorage, `src/lib/settings-store.ts`), nên tải lại, chuyển
trang hay mở lại trình duyệt vẫn giữ; máy hoặc trình duyệt khác có lựa chọn riêng. Mặc định vẫn là Tối; không ai bị chuyển sang theme
mới. Đổi theme chỉ đổi thuộc tính `data-theme` trên `<html>`: không tải lại trang, không mất nháp, bộ lọc, lựa chọn hàng loạt hay
trạng thái bảng, không ghi gì vào máy chủ.

## Cách hoạt động trong source

- `src/components/ThemeProvider.tsx` đặt `data-theme` (Sáng = không có thuộc tính; `dark`, `golden`, `bronze`).
- `src/app/layout.tsx` có một đoạn script nhỏ chạy trước khi vẽ trang: giữ mặc định cũ (Tối, kể cả trang đăng nhập) và chỉ áp sớm
  "Đồng ấm" đã lưu, để đăng nhập / PIN mở đúng Đồng ấm mà Sáng / Tối / Vàng kim vẫn y như trước.
- Màu dùng chung: biến `--ds-*` (các trang riêng của app) và biến HSL của shadcn/ui (`--background`, `--primary`…), khai báo cho mỗi
  theme. Theme cũ nằm trong `src/app/globals.css`.
- **Đồng ấm** (`bronze`), yêu cầu chủ dự án 19/10/2026: nền kem `#FAF6EF`, bề mặt `#FFFDF9`, tiêu đề bảng `#F3E8D7`, chữ `#3A2A1C`,
  chữ phụ `#7A6450` (đậm hơn `#8A735C` đề xuất để chữ nhỏ đạt 5,5:1 trên bề mặt và 4,6:1 trên tiêu đề bảng), viền `#EAD9C2` /
  `#C9A87E`, nút chính `#8C5A2B` (chữ `#FFFAF2`, 5,6:1), điểm nhấn / biểu đồ `#A9713F`, mục đang chọn `#F3E4CF`; trạng thái olive
  (thành công), hổ phách (cảnh báo), đỏ gạch (lỗi), nâu xám (trung tính). Teal (Chung mooon–Genjy), tím, chàm, xanh trời giữ màu
  riêng vì mang nghĩa nghiệp vụ. Logo M xanh và slogan giữ nguyên.
  - `src/app/theme-bronze.css`: biến màu, sidebar kem (mục đang chọn có nền đồng nhạt và vạch trái), đăng nhập, PIN, nút chính
    (mờ khi bị khoá, đồng đậm khi có thay đổi hợp lệ), menu thả, dialog, toast (`mth-toast`), biểu đồ.
  - `src/app/theme-bronze.generated.css`: **sinh tự động** bởi `node scripts/build-bronze-theme.cjs` (thêm `--contrast` để in độ
    tương phản). Script quét các lớp màu Tailwind thật sự dùng trong `src` và các màu viết cứng trong `globals.css`,
    `proxy-management.css`, `vm-grid.css`, `dashboard.css`, rồi ghi bản tương ứng chỉ dưới `[data-theme="bronze"]`. Chữ được làm đậm
    dần đến 4,5:1.
  - Tự đồng bộ (19/10/2026): script là bước đầu của `npm run build` và của Dockerfile (bản phát hành Railway), nên màu mới luôn có
    quy tắc Đồng ấm khi build. Script chỉ ghi khi nội dung đổi; chạy lại trên cùng source không đổi gì (file và lớp được sắp xếp).
    `npm run theme:check` (và test `theme-bronze-sync.test.ts` trong `npm test`) báo lỗi nếu bản trong source chưa được sinh lại,
    và kiểm mọi quy tắc sinh ra đều nằm dưới `[data-theme="bronze"]`.
  - Móc lớp không có kiểu riêng ở theme khác: `mth-sidebar`, `mth-nav-link`, `mth-nav-active`, `mth-nav-icon`, `mth-login`,
    `mth-pin-backdrop`, `mth-toast`.
- Thêm theme khác: thêm mã vào `AppTheme`, thẻ trong `THEMES` của `src/app/(dashboard)/settings/page.tsx` (có màu xem trước nền,
  sidebar, bảng, nút), khối biến màu, và mọi quy tắc đặt dưới `[data-theme="<mã>"]` để theme cũ không đổi.

## Giữ lựa chọn khi rời trang

Server / VM và Kho proxy giữ dòng đang chọn trong bộ nhớ phiên của tab (`src/lib/session-selection.ts`, `sessionStorage`, không vào
URL, mất khi đóng tab), theo người dùng, dự án và phạm vi bộ lọc (Server / VM: server, bộ lọc, tìm kiếm, tình trạng; Kho proxy: bộ lọc
và trang). Rời trang (ví dụ Thiết lập → đổi theme) rồi Back về cùng phạm vi thì đúng các dòng đó được chọn lại, trừ dòng đã xoá hoặc
không còn trong danh sách. Chỉ tích lại ô chọn: không tự chạy thao tác hàng loạt, không hỏi lại. Quy tắc cũ giữ nguyên: đổi server, tìm
kiếm, bộ lọc hoặc dự án thì bỏ chọn (Back về bộ lọc cũ cũng không hiện lại). Đổi dự án (bộ chọn dự án, kể cả khi đang ở Thiết lập) xoá
lựa chọn đã giữ của dự án vừa rời ở cả Server / VM và Kho proxy, nên quay lại dự án đó không tích lại (20/10/2026); Server / VM giữ lựa chọn qua các trang, Kho proxy bỏ chọn
khi sang trang khác như trước.

## Kiểm khi sửa theme

So ảnh từng điểm ảnh của theme cũ trước / sau trên cùng dữ liệu (chỉ được khác ở chỗ có giờ hiện tại và khu chọn giao diện); kiểm
Đồng ấm ở 1280px và 390px: Tổng quan, Kho tài khoản (form nhập, lỗi tại ô, nút khoá / bật), Kho proxy (chọn nhiều), Server / VM (cuộn
ngang / dọc, cột cố định, ô Proxy / SDK, chọn nhiều), tài chính, lịch sử, quản trị, đăng nhập, PIN. Bằng chứng lần đầu:
`docs/superpowers/evidence/2026-10-19-theme-bronze/`.
