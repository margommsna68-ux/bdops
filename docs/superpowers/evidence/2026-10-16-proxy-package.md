# Gói proxy: site, giá, thanh toán, nhập gắn gói, sắp xếp — bằng chứng 16/10/2026

Yêu cầu của anh (tối 15/10): sort thông minh (server nào, gói nào), nhập proxy ghi tên gói và site để sau gia hạn, nhập tiền và nhắc gần tới lúc thanh toán; quy cách sort theo Sheet proxy (Gói → Server → VM → IP); SDK chỉ ở Server/VM. Thiết kế: `../specs/2026-10-15-proxy-package-design.md`. Hướng dẫn: `../../runbooks/proxy-packages.md`.

## Đã làm

- Commit `b5f23cd` (chức năng) + `4a7ed56` (trạng thái đang tải của bảng gói) trên `feat/proxy-inventory`.
- Migration `20261016000000_proxy_package_terms`: thêm `site`, `note`, `price`, `priceCurrency`, `cycleMonths`, `nextDueDate`, `lastPaidAt`, `updatedAt` + index vào `ProxyProviderAccount`. Chỉ thêm.
- Server: `package-terms.ts` (trạng thái hạn theo ngày Asia/Bangkok, ngày đến hạn sau thanh toán, so sánh mã tự nhiên, 4 chế độ sort), `catalog-management.ts` (`saveProviderAccount` nhận điều khoản gói, user/pass tùy chọn khi sửa; `listPackages` trả số proxy và trạng thái hạn), `batches.ts` (Nhập mới với `packageCode` hoặc `newPackage`; gói mới tạo cùng giao dịch, ảnh ACCOUNT trong đợt), `history.ts` (sort + lọc `due`), `usdt-costs.ts` (`packageDue` dời hạn trong cùng lệnh chi phí; ảnh `PACKAGE` mới trong business operation-images), router cập nhật input/output tương ứng.
- UI: `PackageDialog.tsx` (bảng gói, form gói, Đã thanh toán mở `CostForm` điền sẵn), `BatchDialog` (ô Gói proxy: tự nhận / gói sẵn có / Gói mới…), `RegistryTable` (lọc Gói, Sắp xếp, URL `?sort=&package=`, thẻ Gói sắp đến hạn, tiêu đề nhóm gói có site · giá · đến hạn + huy hiệu), `ProxyDashboard` (mục Gói proxy sắp đến hạn), `ServerWorkspace` (Sắp xếp VM/SDK/proxy, `?sort=`), `CostForm` (ô dời hạn khi loại Proxy + gói).

## Kiểm chứng

- TDD: unit `package-terms.test.ts` (7), integration `proxy-package.integration.test.ts` (4: điều khoản gói + hoàn tác; nhập gắn gói sẵn có/gói mới/lỗi + hoàn tác tắt gói; sort/lọc/due; thanh toán dời hạn + hoàn tác), UI `proxy-package-ui.test.tsx` (3). Mỗi file chạy RED trước. Suite đầy đủ **245 tests / 65 files** qua; tsc, lint (4 cảnh báo cũ), production build qua.
- Trình duyệt local (Chrome, dự án mẫu PROXY_TRIAL, http://localhost:3010, kịch bản `scratchpad/pw/package-ui-check.js`): Tổng quan hiện mục Gói proxy sắp đến hạn; trang proxy có lọc Gói + Sắp xếp, đổi sort ghi `?sort=SERVER`, nhóm gói chỉ hiện khi sort theo gói; thêm gói UITEST với site/giá/chu kỳ/đến hạn → hàng gói hiện "120 USD / 1 tháng · còn N ngày"; Đã thanh toán → form "Thanh toán gói proxy" điền sẵn 120 USD, ngày đến hạn mới đề xuất 18/11/2026 → lưu → hàng gói hiện 18/11/2026 và "Trả gần nhất 16/10/2026"; Nhập mới với Gói mới (2 dòng cùng user/pass + 1 dòng user/pass của gói khác) → "Đã lưu 2 proxy · 1 cần kiểm tra"; tiêu đề nhóm gói mới hiện site vietphe.net; lọc Sắp đến hạn → URL `?package=due`, chỉ gói đến hạn; Server/VM đổi Sắp xếp ghi `?sort=SDK`; Lịch sử hiện "Sửa gói proxy" và đợt nhập. Ảnh trong `shots-package/`.
- Local trial DB backup `D:\CodexRuntime\bdops-proxy-trial\backups\pre-package-terms-20261016-000155.dump` trước `prisma migrate deploy`; dữ liệu gói mẫu UITEST/UINEW còn trong dự án mẫu local (không ảnh hưởng host).

## Railway

- Backup host trước deploy: `7a16cfee-1116-4ad1-a146-7018b32d480f` (33.556.933 bytes).
- Deploy `e71cf9a4-36a3-4b2d-b5c8-e438e80ee996` SUCCESS (pre-deploy chạy migration), rồi `727f27f8-93d4-4dc0-94e4-0d361901e2df` SUCCESS (trạng thái đang tải).
- Kiểm tra host chỉ đọc (`.runtime/package-host.ts`, kết quả `.runtime/package-host-verify.json`): 2 dự án (mooon, AE); 6 gói trên mooon với số proxy đang quản lý: 231243 = 200, 232180 = 400, 236273 = 22, 240292 = 350, Account VietPhe = 180, LUONG_NGOAI = 53 (khớp bảng tổng kết tab *final* của Sheet, trừ VietPhe 200 trong Sheet gồm 44 dòng chưa có dữ liệu); chưa gói nào có site/giá/hạn; sort theo gói và theo server trả đúng (An-01/VM_001 đứng đầu); lọc due = 0 dòng; `newPackage` trùng tên bị từ chối DUPLICATE_INPUT, không ghi; 10 server / 574 VM giữ nguyên; 0 thao tác CATALOG/TEAM_CASH_COST. Thời gian trên host: danh sách proxy 1,1 s, gói 0,1 s, workspace VM 0,5 s.
- Trình duyệt host chỉ đọc với tài khoản chủ: đăng nhập, PIN, trang proxy có lọc Gói/Sắp xếp, URL sort, hộp Gói proxy hiện 6 gói. Không ghi gì lên host.
- Railway production cũ và Sheet gốc không bị đụng.

## Chưa đạt / cần anh làm

1. 6 gói trên host chưa có site, giá, chu kỳ, ngày đến hạn: anh vào Quản lý proxy → Thiết lập → Gói proxy → Sửa từng gói (user/pass để trống là giữ nguyên).
2. Chưa ghi thanh toán thật nào; nút Đã thanh toán cần module Chi phí (team cash) bật cho dự án mooon.
3. Nhắc đến hạn chỉ hiện trên web (Tổng quan + trang proxy), chưa có email/thông báo.
4. Danh sách proxy trên host tải cả kho rồi sort trong bộ nhớ (~1 s); chấp nhận được ở 1.362 proxy, cần phân trang server-side nếu kho lớn gấp nhiều lần.
