# Logo C + slogan "Forward, Together." — bằng chứng 16/10/2026

Yêu cầu: áp logo phương án C đã duyệt (ảnh `MoneyToHome-logo-C.png`), slogan chính thức **Forward, Together.**; login: logo căn giữa trên tên, slogan nhỏ dưới; sidebar: logo + tên + slogan, thu gọn chỉ còn biểu tượng; bỏ ô chữ B; không kéo méo, không nền trắng; slogan chữ thật; không đổi nghiệp vụ.

## Đã làm (commit `56855c9`)

- Tách biểu tượng M xanh (#185ceb) từ ảnh C bằng mặt nạ màu, nền trong suốt, làm mịn mép: `public/brand/moneytohome-mark.png` (369×352) và `moneytohome-icon-512.png`; icon tab `src/app/icon.png` + `apple-icon.png` thay `favicon.ico` cũ. Hình dáng giữ nguyên, chỉ cắt và xóa nền.
- `src/components/BrandMark.tsx`: thẻ `<img>` giữ đúng tỉ lệ (không stretch), hằng `BRAND_NAME`, `BRAND_SLOGAN`.
- Login: logo 56 px căn giữa → tên → slogan `text-sm` xám nhạt. Sidebar: logo 30 px + tên trắng + slogan 10 px; thu gọn: chỉ logo 28 px kèm tooltip. Màu chữ theo nền (trắng trên sidebar tối, navy/xám trên thẻ sáng).
- `src/middleware.ts`: cho phép `/brand/*`, `icon.png`, `apple-icon.png` không cần đăng nhập (trước đó ảnh logo ở trang login bị chuyển hướng sang đăng nhập nên không hiện).

## Kiểm chứng

- tsc, lint (4 cảnh báo cũ), production build qua; không đổi test (255/67 vẫn như mốc trước).
- Ảnh thật trên host https://moneytohome.up.railway.app (Chrome headless, tài khoản chủ, dự án mooon) trong thư mục `2026-10-16-brand/`: `01-login-desktop` (1400×900), `02-login-mobile` (390×844), `03-dashboard-dark`, `04-dashboard-collapsed` (sidebar 64 px chỉ còn logo), `05-dashboard-light` (theme sáng), `07-dashboard-mobile-drawer`. Kiểm tra tự động: logo hiện ở login (59×56 px) và sidebar, slogan có mặt, không còn ô "B", sidebar thu gọn ẩn tên.
- `/brand/moneytohome-mark.png` và `/icon.png` trả 200 không cần đăng nhập; trang login có chuỗi "Forward, Together.".

## Railway

- Backup trước deploy `f65766a7-9d67-47fe-8595-d191decc6105` (33.558.845 bytes). Deploy `eae61ab7-af14-4383-9387-284dde1f784b` SUCCESS, không migration. `vm-sdk-host.ts` MODE=verify: 10 server / 574 VM giữ nguyên. Railway production cũ và Sheet không bị đụng.

## Giới hạn

- Logo là PNG tách từ ảnh gốc (mép đã làm mịn), chưa có bản vector; nếu anh có file SVG/AI gốc thì thay vào cùng đường dẫn là xong.
- Theme "golden" vẫn dùng logo xanh (không đổi màu logo theo theme).
