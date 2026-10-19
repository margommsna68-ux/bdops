# Sửa bốn lỗi nghiệm thu luồng vận hành VM (19/10/2026)

Bộ tái hiện độc lập: `.runtime/review-vm-ops-20261019.test.ts` (database test riêng, tự dọn dữ liệu).
- Trước sửa: 4/4 lỗi (`repro-before.txt`).
- Sau sửa: 4/4 đạt (`repro-after.txt`).

Test hồi quy chính thức: nhóm "Rà soát nghiệm thu 19/10" (6 ca) trong `src/__tests__/proxy-management/vm-ops.integration.test.ts`. Cả 6 ca đều đỏ trước khi sửa.

| Lỗi | Nguyên nhân | Sửa ở đâu |
|---|---|---|
| 1. Lộ số tiền qua lịch sử VM | `readVmOpsHistory` che `money` nhưng vẫn trả nguyên câu lịch sử (có số tiền, sửa số, chốt thiếu, ghi chú). `readVmOps` cũng trả `stateNote` và `reference` cho mọi người. | `src/server/vm-ops/payout.ts`: mỗi dòng lịch sử lưu `kind`. Người không có quyền tiền chỉ nhận mốc trung tính; dòng cũ không có `kind` được đọc theo phần đầu cố định của câu. `stateNote` và `reference` chỉ trả cho người có quyền tiền. |
| 2. Hoàn tác tạo lại mở lại lượt đã đóng | Nhật ký `VM_RECREATE` được ghi là hoàn tác được. Khi khôi phục ảnh dữ liệu thì xoá `VmCycle`, mở lại EarnApp và xoá `consumedAt`. | `src/server/operation-history/undo-rules.ts` (mới) xét nội dung bản ghi, dùng trong `undo.ts` và `journal.ts` (danh sách, xem chi tiết). Kiểm theo nội dung nên chặn cả nhật ký cũ. `recordRecreated` ghi `reversible:false`. `operation-images.ts` chặn thêm ở bước khôi phục. |
| 3. Hoàn tác gán email xoá dấu đã dùng | Bước khôi phục chỉ từ chối khi email đã có tiền; email chưa nhận tiền thì `usedEarnAppId` / `usedAt` bị xoá và EarnApp mới tạo bị xoá theo. | Cùng `undo-rules.ts`: lần cấp đầu một email luôn bị từ chối, kèm lý do và cách dùng **Bỏ gán**. `operation-images.ts` bỏ điều kiện "chưa có tiền". Lần gán chỉ có tài khoản vẫn hoàn tác được. |
| 4. Bằng chứng cài lượt cũ áp dụng cho VM mới | `recordRecreated` để nguyên `installedConfigurationId` / `desiredConfigurationId` cũ và bản giữ `INSTALLED`. Cấu hình đang chờ hoặc đang cài của lượt cũ cũng được giữ, nên vẫn xác nhận được. | `src/server/vm-ops/ops.ts`: VM lượt mới có `installedConfigurationId = null`. Cấu hình chờ / đang cài của lượt cũ chuyển "Đã huỷ" (giữ trong lịch sử). Proxy hợp lệ của vị trí được giao lại dạng "Chờ cài" (bản giữ DESIRED, vẫn LIVE). Bản giữ khác của máy cũ, kể cả proxy BLOCKED, thành "Giữ để kiểm tra". Ô Cài proxy và chi tiết VM hiện **Cần thay proxy** (`status-actions.ts`, `VmSidePanel.tsx`). |

## Kiểm trên trình duyệt (dữ liệu thử cục bộ `opsx-pbulz`, tài khoản quản trị và `ops-staff` chỉ có quyền Server / VM)

Kết quả: 19/19 đạt.
- `browser-fixes-run1.txt`: 18 đạt, 1 lỗi. Lỗi do kịch bản kiểm sai: lần gán chỉ có tài khoản vẫn hoàn tác được, đúng quy tắc.
- `browser-fixes-step3-rerun.txt`: sửa phép kiểm rồi chạy lại riêng bước đó: 4/4.

| Kiểm | Kết quả thật |
|---|---|
| Proxy tốt, tạo lại qua UI | Ô hiện "Chờ cài", không "Đã cài". Bản ghi: `installed = null`, cấu hình mới PLANNED, bản giữ DESIRED, proxy LIVE, cấu hình #1 vẫn CONFIRMED. |
| Proxy BLOCKED, tạo lại qua UI | Ô và chi tiết VM hiện "Cần thay proxy" (ảnh `f1`, `f2`). Không còn cấu hình hiện hành; bản giữ còn trên VM (Giữ để kiểm tra, BLOCKED). Lọc "Đã cài" không còn hai VM này. |
| Lịch sử tiền, người có quyền | Thấy đủ: 24.00 USD, ghi chú thất bại, chốt nhận 20 thiếu 4, phí. |
| Lịch sử tiền, `ops-staff` | Chỉ thấy Ghi yêu cầu rút / Đánh dấu thất bại / Gửi lại / Chốt nhận thiếu (ảnh `f4`). Phản hồi API `vmOps.*` thu được trong trình duyệt không có số tiền, ghi chú tiền hay mã tham chiếu. |
| Lịch sử thao tác | Ghi nhận tạo lại VM chỉ có "Xem"; mở ra có lý do, không có nút Hoàn tác (ảnh `f3`). Bản ghi giữ lượt 2, lượt đã đóng, khoản nhận đã dùng, EarnApp cũ đóng. |
| Lịch sử thao tác, gán email | Lần gán có cấp email chỉ có "Xem", lý do chỉ cách Bỏ gán. Lần gán chỉ tài khoản vẫn "Xem / hoàn tác". Email đã cấp vẫn "đã dùng". |
| Đổi tình trạng | Vẫn hoàn tác được; VM về "Chưa ghi". |
| Lỗi JavaScript | Không có. |

## Hồi quy

- Trình duyệt (`regression-browser.txt`):
  - Luồng vận hành: 50/50. Hai kỳ vọng cũ đổi theo lỗi 4.
  - PayPal email / sổ: 30/30.
- Test tự động:
  - Toàn bộ: 411/411.
  - Đổi kỳ vọng cũ trái quyết định: tạo lại trở về lượt 1 sau hoàn tác; VM lượt mới vẫn trỏ bản cài cũ; proxy BLOCKED giữ cấu hình cũ là cấu hình đang giao; hoàn tác lần gán email đầu khi chưa có tiền.
- Typecheck và build: qua.
- Lint: chỉ còn cảnh báo cũ ở `agent-pp`.

## Phát hành

- **Commit:** `a3be877`.
- **Backup host trước deploy:** `51e28aeb`.
- **Deploy:** `a95c6714`, SUCCESS. Không có migration.
- **Host verify chỉ đọc:** 10 server / 576 VM.
- **Host xem đọc** (`host-result.txt`):
  - Cột và lọc đúng.
  - Chủ dự án đã tự ghi "Chưa nối" cho 70 VM; 506 VM còn "Chưa ghi". Không đụng vào.
  - Chưa có EarnApp.
  - Chỉ có `user.verifyPin` và `user.heartbeat`, không ghi dữ liệu.

## Chưa kiểm / giới hạn

- Host không có PayPal, EarnApp hay lượt tạo lại nào, nên không có dữ liệu cũ cần chuyển. Bốn lỗi chỉ kiểm trên database test và dữ liệu thử cục bộ. Trên host chỉ xem đọc.
- VM đã tạo lại bằng bản trước khi sửa (chỉ có ở dữ liệu thử cục bộ) vẫn trỏ bản cài cũ. Không có lệnh chuyển dữ liệu cho trường hợp này, vì host không có.
- Yêu cầu rút ghi kèm email mới cũng không hoàn tác được (lần cấp đầu email). Nếu ghi nhầm, dùng **Huỷ yêu cầu** có lý do.
- `sdk-ui-check.js` (15/10) đã lỗi thời so với giao diện hiện tại nên không chạy được. Hoàn tác SDK được kiểm bằng test tự động.
