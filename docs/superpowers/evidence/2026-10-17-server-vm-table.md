# Bảng vận hành Server / VM — bằng chứng 17/10/2026

Brief chủ dự án 17/10: Server/VM thành bảng vận hành như Sheet: thấy đúng máy, sửa nhanh, dán nhiều dòng, chọn nhiều đúng việc, không phải kéo tìm nút hay chuyển trang. Hướng dẫn: `../../runbooks/server-vm-table.md`.

## Đã làm

- **Backend**
  - `vm-management/bulk.ts` (Dán bảng và thanh hàng loạt):
    - `previewVmBulk` / `applyVmBulk` cho SDK, Proxy (TUT và Chung, chỉ VM trống), Gmail hiện có và Ghi chú.
    - Ghép theo server + mã VM; báo lặp VM và lặp giá trị trên mọi dòng liên quan; ô trống giữ nguyên, `-` để xoá.
    - Khi áp dụng, kiểm tra lại từng dòng theo revision và xung đột: lưu phần hợp lệ, báo riêng phần còn lại.
    - Idempotency, nhật ký và hoàn tác qua `runBusinessCommand`.
  - `edits.ts`: tách `placeOnVm` để bảng proxy và Dán bảng dùng chung một cách tạo cấu hình, giữ chỗ và việc cài.
  - `installation.ts` `copyVmConfigurations`: copy thường không gọi `begin()`. `copyConfiguration` (Copy để cài) giữ nguyên nghĩa cũ.
  - `allocation.ts`
    - AUTO bắt buộc có `vmIds`.
    - MANUAL nhận Chung mooon–Genjy qua `getManualInventory`; autofill vẫn dùng `getEligibleInventory` (chỉ TUT).
  - `metadata.ts`
    - Dòng bị chặn mang `cause` (HOLD, TASK, INSTALLED, SDK, SERVER).
    - `archiveManagedResource` (API cũ) đi qua `archiveVMs` / `archiveServer`.
  - `detail.ts` `readVMDetail`: mọi phiên bản cấu hình (người/ngày giao, bắt đầu, xác nhận) và các việc của máy, không trả credentials.
  - Router thêm `detail`, `copyProxies`, `bulkPreview`, `bulkApply`. `eligible` trả thêm proxy Chung để chọn tay.
- **Giao diện**
  - `ServerWorkspace` viết lại.
  - Thư mục `vm-grid/` gồm:
    - `grid-model.ts`: cột, độ rộng, thứ tự, ô kế tiếp cho Tab, trạng thái URL, chia trang.
    - `VmGrid.tsx`: cột dính, kéo độ rộng, ô sửa bằng bàn phím, nháp lưu trong localStorage, menu ⋯.
    - `VmSidePanel.tsx`: 6 tab, dùng lại `AllocationForm`, phần Cài/xác nhận của `InstallDialog` và `SdkHistoryTable`.
    - `BulkPanels.tsx`, `GridControls.tsx` (ô chọn server, Cột, Pager) và `vm-grid.css`.
  - Layout: thanh bên dính và cuộn riêng trên màn hình lớn, để trang không dài theo menu.
- **Test**
  - `vm-table.integration.test.ts` (7, DB thật):
    - Dán SDK: lặp VM, lặp SDK, ô trống, VM bị đổi sau xem trước, thử lại không ghi lần hai, `-` để xoá.
    - Ghi chú dài; Gmail cho nhiều VM, không tự tạo.
    - Proxy: TUT, Chung, IP:port; Genjy riêng, VM có người và proxy ở máy khác bị chặn.
    - Autofill bắt buộc `vmIds` và loại Chung/Genjy; đổi proxy chọn tay Chung.
    - Copy thường không đụng startedAt/task/status, Copy để cài vẫn bắt đầu cài.
    - API archive cũ dùng chung kiểm tra.
  - `vm-grid-model.test.ts` (7).
  - `vm-sdk-ui.test.tsx` cập nhật theo bố cục mới.
  - Kết quả: 316 tests / 77 files, tsc, lint (4 cảnh báo cũ), build đều qua.

## Nghiệm thu trên trình duyệt (dữ liệu thử riêng)

- **Dữ liệu thử**: dự án mẫu local *Proxy & VM — Bản thử*.
  - Proxy dải `198.18.x` (dải dành cho thử nghiệm), nhập qua lệnh nhập có kiểm tra.
  - Vài proxy đổi sang Chung / Genjy riêng qua lệnh sửa bảng proxy; 2 Gmail mẫu.
  - Mỗi lần chạy tạo một server thử mới (`ug-xxxx`).
- **Môi trường chạy**: Chrome headless 1366×768 (Ca 8 thêm 1920×1080), clipboard thật.
- **Bằng chứng**: video `bdops-proxy-app/.runtime/evidence/2026-10-17-server-vm-table-local.webm` (ngoài Git), ảnh trong thư mục `2026-10-17-server-vm-table/`.
- **Kết quả**: lần chạy cuối, cả 9 ca liên tục trong một phiên, đều đạt. 0 hộp thoại `confirm`, 0 lỗi trang.

| Ca | Kết quả |
|---|---|
| 1. 20 VM theo khoảng → chọn nhóm mới → gán proxy → dán 20 SDK | Đạt. 14 thao tác, không mở VM nào. *Thiếu proxy* 20 → chọn trang → Gán proxy → "Đã giao 20 proxy"; Dán bảng "20 hợp lệ" → "Đã lưu 20 dòng"; dải đếm *Chờ cài 20 · Chưa SDK 0*. |
| 2. Sửa 3 VM liên tiếp bằng bàn phím; trùng mã; revision cũ; gõ tiếng Việt | Đạt. Ghi chú 3 VM bằng Enter + 7 Tab/Enter. Đổi mã sang VM_004 báo "Mã VM_004 đã có…", giữ chữ và focus. Enter khi bộ gõ đang soạn "ệ" không lưu, chốt chữ rồi Enter lưu "Việt". Tab khác lưu trước: báo "VM vừa được sửa; tải lại…", nháp còn sau tải lại, Enter lưu được. |
| 3. Chọn 2 VM trên 2 trang, đổi trang/sort, áp dụng | Đạt. 50 dòng/trang, VM_002 (trang 1) + VM_055 (trang 2), "Đã chọn 2 VM (1 không ở trang này)"; đổi sắp xếp vẫn 2; *Sửa ghi chú* chỉ ghi đúng 2 máy. |
| 4. Dán có dòng đúng, sai, trùng, bị sửa sau xem trước; thử lại | Đạt. Xem trước "2 hợp lệ · 0 giữ nguyên · 4 lỗi". Áp dụng: VM_021 lưu, VM_024 (bị sửa sau xem trước) "Lỗi · VM vừa được thay đổi…", ô dán còn đúng 5 dòng lỗi. Thử lại: "1 hợp lệ · 1 giữ nguyên"; lịch sử SDK VM_021 chỉ 1 dòng. |
| 5. Gán tay proxy Chung; autofill loại Chung và Genjy riêng | Đạt. Chọn tay proxy *Chung* cho VM_025; danh sách chọn tay không có Genjy riêng. Tự điền 6 VM đã chọn: VM_025 (đã có proxy) "Giữ nguyên: không phải ô proxy trống", 5 VM nhận TUT NEW, không proxy Chung/Genjy nào bị giữ. |
| 6. Copy thường không đổi startedAt/task/status; Copy để cài vẫn bắt đầu cài | Đạt. Copy 1 dòng: clipboard đúng proxy, trạng thái PLANNED → PLANNED, startedAt null, revision giữ nguyên. Copy 3 dòng theo thứ tự bảng. *Copy đã cài* báo "Chưa có cấu hình đã cài". *Copy để cài* VM_002 có startedAt. |
| 7. Lọc → mở công việc/lịch sử → đóng hoặc Back | Đạt. Lọc *Chờ cài* + tìm `VM_0`, cuộn bảng, mở ⋯ → Công việc → Lịch sử. Đóng ✕ thì URL như trước, vị trí cuộn không đổi, focus về VM_014. Back thì khung đóng, bộ lọc giữ. Tải lại giữ chip *Chờ cài* và ô tìm. |
| 8. Cuộn ngang/dọc ở 1366×768 và 1920×1080 | Đạt. Bật thêm 3 cột, cuộn ngang tới cuối và cuộn dọc: tiêu đề dính trên, Server+VM dính trái, ⋯ dính phải. Đáy vùng bảng 683/768 px (thấy thanh cuộn ngang ngay), trang không cuộn. Hàng cao nhất 46 px với ghi chú 950 ký tự và SDK 124 ký tự. |
| 9. Xoá hỗn hợp; khôi phục xung đột SDK; máy đã xoá ngoài autofill/ô chọn | Đạt. Xoá VM_001 (còn proxy) + VM_060: "Đã xoá 1 VM", VM_001 bị chặn. *Mở VM* mở `?vm=…&tab=install&cause=HOLD` với "Lý do bị chặn". Khôi phục VM_059 bị chặn vì SDK đã thuộc VM_058; *Mở VM* mở được máy đã xoá, không có cấu hình, kèm lý do. Danh sách VM của bảng proxy không có VM_059/VM_060; autofill VM_060 trả "Máy đã xoá". |

Các lỗi tìm ra khi tự chạy các ca, đều đã sửa trước khi đóng mốc:

- Sau *Điền VM thiếu*, máy rời bộ lọc *Thiếu proxy* khiến khung tính "0 VM" và mất kết quả. Giờ lựa chọn tính theo ID trên toàn phạm vi.
- Tab lưu xong làm bản nháp cũ sống lại, chuỗi Tab bị đứt. Đã chuyển sang cập nhật nháp theo trạng thái mới nhất.
- Ô bị `disabled` trong lúc lưu làm mất focus nên phím Tab rơi ra ngoài bảng. Giờ ô dùng `readOnly` và chặn phím khi đang lưu.
- Đổi sắp xếp rồi đổi số dòng nhanh thì lần ghi URL sau đè mất lần trước. Giờ mỗi lần ghi dựa trên URL vừa yêu cầu.
- Chọn tay proxy dạng `IP:port` bị báo "Proxy không hợp lệ". Giờ nhận IP, IP:port và proxy đầy đủ.
- Bấm *Gán proxy* khi khung đang mở lại đóng khung. Giờ nút trên thanh hàng loạt luôn mở khung; khung hàng loạt tự đóng khi bỏ hết lựa chọn.
- Đóng chi tiết thì focus kéo bảng cuộn đi. Giờ focus không cuộn.
- Trang dài theo menu thanh bên nên cả trang cuộn, che mất đầu trang. Giờ thanh bên cuộn riêng.

## Railway

- **Lần 1**: commit `d3a3337`, backup host `bb7fcfa9-9ee4-4f47-9fd2-4b3c0e64a4be` trước, deploy `6e866758-4df3-4540-9ff1-88a0f9f412c0` SUCCESS.
- **Lần 2**: sửa nhãn nhóm "UNKNOWN" → "Chưa xác định" và trạng thái việc trong tab Lịch sử. Commit `d7d6bef`, backup `20f0229a-ba53-41af-bc07-aacfd08dd0cc`, deploy `de2a70bc-00f8-4f6b-83d8-776d9b23a571` SUCCESS.
- Sau mỗi lần deploy, kiểm tra host vẫn 10 server / 576 VM. Không có migration.
- **Kiểm tra trên host mooon**, chỉ đọc và xem trước:
  - 0 request ghi; không bấm Áp dụng, Lưu hay Xoá.
  - Ảnh `h1`–`h8`.
- **Kết quả trên host**:
  - Tất cả server: 576 VM; dải đếm *Chờ cài 553 · Cần kiểm tra 23 · Chưa SDK 576*.
  - Ô chọn server gõ `moon05` → Enter chuyển thẳng tới moon05: 80 VM, mỗi dòng chỉ `VM_001`.
  - Tìm `VM_071` ra 1 dòng. ⋯ → *Công việc* hiện việc Proxiware; *Lịch sử* hiện cấu hình #1 122.8.67.87:11000, nhóm *Chưa xác định*, *Cài chưa xong*.
  - Đóng ✕ và Back đều về đúng `?q=VM_071`.
  - Dán bảng SDK chỉ xem trước: "0 hợp lệ · 2 giữ nguyên · 1 lỗi" (VM_999 không có).
  - 1366×768: trang vừa màn hình (768/768), cột VM dính trái, hàng 46 px. 1920×1080: 1080/1080.
- **Lượt ghi**: các ca có ghi chỉ chạy trên dữ liệu thử local. Host không có server thử nên không ghi gì lên dữ liệu thật.

## Giới hạn

Xem mục *Giới hạn* trong runbook.
