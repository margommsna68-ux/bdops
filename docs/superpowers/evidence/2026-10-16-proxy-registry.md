# Bảng proxy: lọc server, cột tách, copy một bấm / hàng loạt — bằng chứng 16/10/2026

Yêu cầu của anh (16/10): bảng proxy dễ tìm, dễ lọc, copy nhanh như bảng tính; lọc nhiều server; tách "An-01/VM_001 · Chờ cài" thành Server / VM / Ghi chú vận hành; copy một bấm; copy hàng loạt và copy toàn bộ kết quả lọc; không đưa SDK vào trang proxy; không đổi proxy/phân bổ/trạng thái cài/tài chính. Hướng dẫn: `../../runbooks/proxy-registry.md`.

## Đã làm

- Commit `8a2d009` trên `feat/proxy-inventory` (không có migration).
- Server: `types.ts` (`RegistryLocation`, `locations[]` thay `vmRefs`, `servers` trong bộ lọc, `total`/`servers` trong trang kết quả, `CopyResult`, sentinel `__NONE__`), `package-terms.ts` (so sánh vị trí tự nhiên, dòng xếp theo vị trí nhỏ nhất), `history.ts` (`loadRegistryRows` lọc + sort toàn bộ rồi mới phân trang; vị trí = mọi hold đang hiệu lực + liên kết VM từ Sheet; `copyProxyRows` theo id hoặc theo bộ lọc, báo dòng bỏ qua, nhật ký chỉ số lượng; `copyProxyEndpoint` không còn chặn proxy đang giữ cho VM), router `list` thêm `servers`, mới `copyEndpoints` / `copyFiltered`.
- UI: `RegistryCells.tsx` (ba ô Server/VM/Ghi chú, `ServerFilter` nhiều lựa chọn + Chưa gán, `copySummary`), `clipboard.ts` (`copyWhenReady`: ClipboardItem hứa trước → writeText → hộp thoại thủ công), `RegistryTable.tsx` (checkbox dòng + cả trang, thanh *Đã chọn N proxy*, nút *Copy toàn bộ kết quả lọc (N)*, URL `servers/sort/package/owner/state`, chân bảng `hiện / tổng`), CSS, `ProxyCopy` thành hộp thoại dự phòng; `src/app/providers.tsx` gắn `<Toaster/>` (trước đây thiếu nên không toast nào hiện).

## Kiểm chứng

- TDD RED→GREEN: `registry-copy.integration.test.ts` (3: vị trí có cấu trúc + facet + lọc server kết hợp gói + tìm + phân trang; copy theo id đúng thứ tự, bỏ qua thiếu user/pass, quyền, id ngoài dự án NOT_FOUND, copy theo bộ lọc, nhật ký chỉ số lượng; tRPC `servers`/`copyEndpoints`/`copyFiltered`), `registry-ui.test.tsx` (6: tách ô, nhãn ghi chú, nhãn bộ lọc server, tóm tắt copy, clipboard hai đường), `package-terms.test.ts` cập nhật (moon2 < moon10, VM_002 < VM_010, nhiều vị trí), `vm-management.integration.test.ts` đổi: copy từ bảng proxy đang giữ không tạo INSTALL_STARTED. Suite **255 tests / 67 files** qua; tsc, lint (4 cảnh báo cũ), production build qua.
- Trình duyệt local (Chrome 155 headless, quyền clipboard, dự án mẫu, `scratchpad/pw/registry-ui-check.js`, ảnh `shots-registry/`): tiêu đề IP / Trạng thái / Thuộc về / Server / VM / Ghi chú vận hành; không còn ô ghép "/", "·"; menu server lấy từ dữ liệu (demo-server, demo-shortage, Chưa gán server); chọn 1 server → URL `?servers=demo-server`, 3/3 dòng đúng; 2 server → 5 dòng đúng thứ tự; Chưa gán → 726 dòng (Chưa gán / genjy); tải lại link giữ bộ lọc; copy một bấm → toast *Đã copy 192.0.2.101*, clipboard đúng `ip:port:user:pass`, không mở hộp thoại; tick 3 dòng → *Đã chọn 3 proxy* → Copy → 3 dòng đúng thứ tự; chọn cả trang; *Copy toàn bộ kết quả lọc (3)* → toast *Đã copy 3 proxy*.

## Railway

- Backup host trước deploy: `e744a26a-54a9-4337-bb51-27856aba38aa` (33.558.525 bytes, SHA-256 `134d8181…`).
- Deploy `3ed8ac87-de48-4703-ab4b-bf52fd273420` SUCCESS (01:40 UTC), không migration.
- API trên dự án thật (`.runtime/registry-host.ts` → `.runtime/registry-host-verify.json`): 1.261 dòng đang quản lý; facet server `An-01, anhlong, moon1, moon2, moon04, moon05, vt-01…vt-04` (thứ tự tự nhiên); dòng đầu `231243 · An-01/VM_001 · Chờ cài · 84.32.138.211`; trang đầu 97 vị trí Chờ cài + 3 Giữ để kiểm tra; lọc An-01+anhlong = 105 dòng đều khớp, trang 2 không trùng; Chưa gán = 688 dòng đều trống vị trí; An-01 + gói 231243 = 37; tìm `An-01/VM_001` = 1 dòng; copy 1 dòng và copy 3 dòng Chờ cài đúng thứ tự, đủ user/pass; id ngoài dự án bị từ chối; 10 server / 574 VM và tổng dòng không đổi; danh sách 1,4 s.
- Trình duyệt host với tài khoản chủ (ảnh `shots-host-registry/`): lọc moon1 → 70 dòng, URL `?servers=moon1`; moon1+moon2; Chưa gán server → 688 dòng (genjy); tải lại giữ bộ lọc; copy một bấm đúng IP; tick 3 dòng → *Đã copy 3 proxy* đúng thứ tự; chọn cả trang 50; *Copy toàn bộ kết quả lọc (70)* → *Đã copy 70 proxy*.
- Ghi trên host: chỉ 5 dòng nhật ký `COPY_PROXY_CREDENTIALS` (số lượng), không đổi proxy/phân bổ/trạng thái/tài chính. `vm-sdk-host.ts` MODE=verify vẫn qua. Railway production cũ và Sheet gốc không bị đụng.

## Chưa đạt / giới hạn

1. Copy proxy *Chờ cài* từ bảng này không đánh dấu bắt đầu cài; cài thật vẫn dùng *Copy để cài* ở Việc cài để ghi phiên bản.
2. Lựa chọn dòng không giữ khi sang trang hoặc đổi bộ lọc (dùng *Copy toàn bộ kết quả lọc* cho nhiều trang).
3. Danh sách vẫn tải cả kho rồi lọc/sort trong bộ nhớ (~1,4 s trên host); menu server trống trong lúc tải.
4. Trình duyệt không cho ghi clipboard sẽ mở hộp thoại để Ctrl+C; chưa thử trên Safari thật.
