# Server / VM — phân bố theo server, một quy tắc lọc, copy danh sách VM (23/10/2026 tối)

Brief chủ: "CẢI THIỆN LỌC VÀ THỐNG KÊ SERVER / VM CHO TOÀN BỘ TRƯỜNG HỢP". Thiết kế `docs/superpowers/specs/2026-10-23-vm-filter-distribution-design.md`; runbook `docs/runbooks/server-vm-table.md` (mục 23/10/2026). Commit `43c3c51`.

## Thay đổi
- `src/components/vm-management/vm-grid/filter-model.ts` (mới, thuần): `matchVm` (true / false / `null` = thiếu dữ liệu), `applyFilters`, `countWith`, `serverDistribution`, `vmIdLines`, nhãn điều kiện.
- `ServerWorkspace.tsx`: dựng `VmFacts` một lần; bảng / chip / phân bố / copy cùng một quy tắc; vùng `ScopeStrip` (phân bố, Đang xem, thẻ điều kiện + ×, Xoá bộ lọc, Không còn VM phù hợp, Copy danh sách VM); đổi server giữ q / view / st / money / sort; nhãn "Theo server → mã VM"; chip tiền VM chỉ với quyền đọc tiền.
- `vm-grid.css`: `.vm-scope*`, `.vm-chip-sm`, `.vm-filter-tag`.
- Không đổi backend, không migration, không đổi quy tắc nghiệp vụ ("Chưa SDK" vẫn = danh sách SDK rỗng).

## Kiểm thử
| Kiểm | Kết quả |
|---|---|
| Đơn vị `src/__tests__/proxy-management/vm-filter-model.test.ts` (VÀ / HOẶC, Đã xoá, phân bố bỏ server + sắp, đếm theo nhóm khác, `null` khi thiếu dữ liệu, copy) | 6/6 |
| Render tĩnh `vm-sdk-ui.test.tsx`, `vm-grid-model.test.ts` | 15/15 |
| `tsc --noEmit`, `next lint` (hai file sửa) | sạch |
| Trình duyệt bản thử cục bộ (`next dev :3010`, DB `proxy_app_trial`, dữ liệu thử `.runtime/p45-local-filter.ts`: 2 server P45A / P45B với Chưa cài / OFF / OK / Chưa nối, SDK $3 mới / $7,5 cũ 25 h / $2 rồi đọc lỗi / mã không số, 1 VM đã xoá, ghi chú để tìm; 2 user: ADMIN + USER không quyền tiền; kịch bản `.runtime/p45-ui.js`) | `local-browser.txt` **44/44** |

Các trường hợp trình duyệt (ảnh trong `shots/`): T1 tổng phân bố = bảng = tổng các server (1135 Chưa SDK / 120 server), sắp giảm dần; T2 bấm server trong phân bố giữ view, "Đang xem P45A · 2 VM", server khác vẫn hiện; T3 Chưa SDK + OFF → VM_002, chip "Tất cả" đếm OFF trên server, chip OFF đếm Chưa SDK, chip 0 ẩn; T4 OFF hoặc Chưa cài (HOẶC); T5 Số cũ / Kiểm tra lỗi / Chưa kiểm tra ra đúng VM; T6 tìm ghi chú → 1 VM 1 server, + OK → 0 VM · 0 server, server hết kết quả → "Không còn VM phù hợp ở P45B; các server khác còn N VM" + "Về Tất cả server" giữ money=; T7 Đã xoá; T8 ba thẻ điều kiện, bỏ riêng OFF, Xoá bộ lọc vẫn ở server; T9 Back / Forward / tải lại; T10 Copy danh sách VM (mọi trang rồi dòng đã chọn, `Server | VM`, không "$" / mã SDK); T11 bộ chọn server giữ q + st; T12 tự tải lại sau ghi API (2 → 1 VM, dòng chọn và URL giữ); T13 "+115 server" thu gọn / mở, nhãn sắp xếp, bảng 1663 = phân bố 1663, trang 2 từ dòng 101, VM_002 trước VM_010, server lạ → "Server không thuộc dự án này"; T14 bốn theme chọn ở Thiết lập (`data-theme` xác nhận), 390 px; T15 USER không quyền tiền: không chip tiền, không "$", `money=STALE` → 0; T16 không lỗi JS.

Sửa trong lúc kiểm: vùng phân bố hiện "Đang tải…" khi chưa tải xong workspace (lần chạy đầu đọc "0 VM phù hợp" trước khi dữ liệu về); chip tiền VM ẩn khi không có quyền đọc tiền.

## Deploy
Self-hosted https://wow.lalamail.sbs (không Railway): backup `moneytohome-20261023-224813.dump` + bản mã hoá offsite OK (22:48); stage `D:\MoneyToHome\app-filter-next-20261023` build `GqFGl1SeYfNv_8zKTXRSw`; đổi thư mục bằng `D:\MoneyToHome\tools\deploy-vm-filter.ps1` (cần UAC); kết quả ở `D:\MoneyToHome\logs\deploy-vm-filter-result.json` và `deploy.txt` tại đây. Không ghi dữ liệu nghiệp vụ nào trên host.
