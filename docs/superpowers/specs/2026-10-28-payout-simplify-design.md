# Rút EarnApp → PayPal gọn lại, sửa được, xử lý SUS, AI chỉ xin duyệt khi rút — thiết kế 28/10/2026

Chủ duyệt trong chat ngày 28/10/2026 ("ok duyệt, làm tiếp đi"). Tài liệu này ghi lại đúng những gì chủ đã quyết; chỗ đánh dấu **[builder]** là quyết định của người viết (chủ chưa xét riêng, có thể gạch).

## Vì sao
Chủ nói (28/10): cơ chế rút tiền "khá phức tạp, không edit được nếu có sai sót"; "chưa xử lý được EarnApp bị SUS, tiền sẽ không về, lệnh đó sẽ treo"; "AI xin approved rồi anh phải nhập TOTP từng lệnh… nhập PIN nhiều lần, nhiều lệnh gây tốn thời gian"; thao tác tay "bấm rút về rồi phải đợi rồi xác nhận, quy trình quá phức tạp không cần thiết, phải qua bên Rút EarnApp thay đổi nữa".

Hiện trạng đã đọc trong code (bản đang chạy, `src/server/vm-ops/payout.ts`, `ops.ts`, `ops-api/approvals.ts`):
- Yêu cầu rút chỉ sửa được số tiền + mã tham chiếu (`CORRECT`); email / PP / VM không đổi; `SENT` không lùi; `EarnPayoutRequest.earnAppId` unique nên ghi nhầm không làm lại được.
- SUS: VM đánh SUS và ghi tạo lại được (`recreateRule` reason SUSPENDED), nhưng yêu cầu rút vẫn "chờ tiền về" mãi; chỉ có "Thất bại" kèm lý do.
- AI: 4 lệnh tiền cần duyệt (`WITHDRAWAL_PREPARE`, `WITHDRAWAL_STATUS`, `WITHDRAWAL_RECEIPT`, `WITHDRAWAL_MEMBERS`), mỗi lệnh một mã TOTP.
- Đổi trạng thái nằm ở trang Rút EarnApp (`PayoutStatusActions`), ghi tiền về nằm ở ô VM; người dùng phải chạy qua lại.

## Mục tiêu
1. Rút tay: **Rút** (giữ email ngay) → **Đã rút** → **Tiền đã về**; mọi nút ở một khung dùng chung cho ô Tiền VM, khung VM, trang Rút EarnApp, có thao tác hàng loạt.
2. Sửa được mọi sai sót cho tới khi tiền về.
3. Một thao tác "EarnApp bị SUS" đóng gọn ca SUS; VM vào danh sách **Chờ tạo lại**.
4. Tiền về đủ → VM vào **Chờ tạo lại**; tạo lại (từng VM hoặc hàng loạt) giữ proxy tốt, vòng mới lấy tài khoản EarnApp mới + email PP mới.
5. AI chỉ xin duyệt lệnh **Rút**; duyệt bằng **phiên 15 phút** mở bằng một mã TOTP chủ gõ trong chat; web có "Duyệt tất cả" và "Khóa phiên ngay".

## Không làm
- Web không tự bấm rút trên EarnApp, không tự đọc PayPal.
- Không đổi: sổ PayPal (FundTransaction / Withdrawal), luật 2 email / PP / ngày (đếm khi giữ), gợi ý PP gần 100 USD, Rút gộp, luật tạo lại hiện có ngoài phần nêu dưới đây.
- Không tự tạo lại VM trên máy thật khi tiền về hay khi SUS (chủ: "vào danh sách chờ tạo lại").

## Tuyệt đối tránh
- Mất lịch sử tiền: mọi sửa / xoá / SUS đều để lại dòng lịch sử (ai, lúc nào, trước → sau).
- Tiền SUS bị cộng là tiền về hoặc tiền chờ.
- Một khoản tiền về ghi hai lần; hai người / hai AI pick trùng một email ("phải có cấm trùng trong thao tác").

## 1. Luồng rút tay
**Rút.** Nút "Rút" ở ô Tiền VM / khung VM, hoặc "Rút N VM" khi chọn nhiều dòng. Web chọn email gợi ý (luật gợi ý hiện có) và **giữ ngay** trong cùng lệnh (= `requestPayout` submission `PREPARING`, `holdEarnAppId`, tính slot ngày). Số tiền mặc định = Tiền VM của SDK hiện tại (sửa được). Email đang giữ biến mất khỏi kho; không ai pick trùng (ràng buộc unique `holdEarnAppId` + kiểm trong transaction như hiện có). Đổi email trong khung = một lệnh: nhả email cũ, giữ email mới.

Khung sau khi giữ: email + Copy, số tiền, nút **Đã rút** và **Bỏ**.
- **Đã rút** → `SENT` ngay (bỏ ô tick "đã thấy trong lịch sử EarnApp"; bấm nút chính là lời xác nhận).
- **Bỏ** → yêu cầu chưa từng gửi được **xoá** (mục 2, "xoá ghi nhầm"), email trả kho, slot ngày được trả.
- Đóng khung không bấm gì: email **vẫn giữ**, yêu cầu hiện "Đang rút, chưa xác nhận" (chip / bộ lọc ở Server/VM, trang Rút EarnApp, Tổng quan). **Không tự nhả theo thời gian** [builder]: có thể đã rút thật mà quên bấm.
- Hàng loạt: "Rút N VM" giữ N email khác nhau trong từng lệnh riêng (giữ cơ chế khoá lệnh / thử lại của `PayoutBulkPanel`), mỗi dòng Copy riêng, "Đã rút" từng dòng hoặc "Đã rút N dòng".

**Tiền đã về.** Nút trên dòng: số tiền mặc định = phần còn chờ, ngày mặc định = hôm nay (giờ Bangkok), mã giao dịch PayPal tuỳ chọn. Đi qua `recordPayoutReceipt` hiện có (sổ PayPal không đổi, chống trùng mã / cùng email-ngày-số tiền giữ nguyên). Về thiếu: ô **"Chốt luôn, phần thiếu là phí"** tick sẵn [builder] → cùng một lệnh ghi receipt + `SETTLE` (ghi chú tự sinh "Phí / thiếu X"). Hàng loạt: "Đã về đủ N dòng" (mỗi dòng ghi đúng phần còn chờ).

**Một khung dùng chung.** Một component (thay `PayoutStatusActions` + các form rút trong `OpsCells` / `PayoutBulkPanel` / `VmSidePanel`) dùng ở cả ô Tiền VM, khung VM và trang Rút EarnApp, có đủ: Đã rút / Bỏ / Sửa / Tiền đã về / EarnApp bị SUS / Huỷ. Trang Rút EarnApp có chọn nhiều dòng + Đã rút N / Đã về đủ N.

**Nhãn trạng thái** (hiển thị; dữ liệu giữ cột `state` / `submission`): Đang rút (chưa xác nhận) → Đã rút, chờ tiền → Đã về / Về thiếu (đã chốt) / **Mất do SUS** / Huỷ. `UNKNOWN` giữ cho AI (lỡ mất câu trả lời), hiển thị "Chưa rõ đã rút chưa".

## 2. Sửa sai
Thay `CORRECT` bằng lệnh **Sửa** (`EDIT`) cho phép đổi trước khi có khoản tiền về đã xác nhận: email nhận (kéo theo mã PP), số tiền, ngày rút, mã tham chiếu. Bắt buộc ghi lý do khi yêu cầu đã `SENT`. Quy tắc email khi sửa:
- Email mới phải còn dùng được (chưa dùng cho EarnApp khác, không giữ cho ai, PP hoạt động, không `reviewHold`, không xoá) và còn slot ngày (ngày = ngày rút của yêu cầu).
- Email cũ: nếu **chưa nhận khoản tiền nào** (không có FundTransaction không bị thu hồi gắn email đó) thì gỡ hẳn — bỏ giữ, bỏ `usedEarnAppId` / `usedAt` nếu do chính yêu cầu này đặt, `EarnAppAccount.paypalEmailId` trở về giá trị trước đó, đóng `EarnAppPayout` mở do SENT tạo, bỏ dấu slot ngày (`PayPalPayoutDayEmail`) của email cũ — email về kho. Nếu đã có tiền về email đó thì từ chối sửa email ("email đã nhận tiền, không đổi được").
- **Quyết định mới của chủ thay luật 18/10** "email đã cấp cho một EarnApp không bao giờ nhả": email chỉ nhả khi đó là **ghi nhầm** và email chưa nhận tiền. Các trường hợp khác giữ luật cũ.

**Bỏ "Đã rút"** (`UNSEND`): `SENT` / `UNKNOWN` → `PREPARING`, email vẫn giữ, gỡ binding / slot như trên nếu chưa có tiền về.

**Xoá ghi nhầm** (`VOID`): khi không có receipt nào (kể cả đã thu hồi), không có thành viên gộp còn hiệu lực, chưa dùng để tạo lại. Lưu ảnh chụp đầy đủ vào bảng mới `EarnPayoutRequestVoid` (id cũ, toàn bộ cột, history, người xoá, lúc xoá, lý do) rồi xoá dòng `EarnPayoutRequest` (giữ quan hệ 1–1 `EarnAppAccount.payoutRequest`, không phải đổi `@unique`) [builder]. Email gỡ như trên. VM có thể tạo yêu cầu mới. Lịch sử VM và trang Rút EarnApp vẫn hiện dòng "Đã xoá do ghi nhầm" từ bảng mới.

Sau khi có tiền về: chỉ sửa được số tiền receipt qua luồng thu hồi / ghi lại receipt hiện có; yêu cầu không đổi email / xoá được.

Mọi sửa / bỏ / xoá: kiểm revision, kiểm VM / lượt / EarnApp như `updatePayoutRequest` hiện có, ghi journal + history; hoàn tác (undo) được khi chưa có thay đổi nào sau đó [builder].

## 3. EarnApp bị SUS
Nút **"EarnApp bị SUS"** ở khung tiền / khung VM (và lệnh AI tương ứng, không cần duyệt). Một lệnh, một transaction:
- `VmOperation.status = SUSPENDED` (qua đường ghi trạng thái hiện có, có `VmOpsEvent`).
- Yêu cầu rút của lượt hiện tại:
  - Đã `SENT` / `UNKNOWN`, chưa về đủ → `state = 'LOST_SUS'` ("Mất do SUS"), lưu `lostAmount` = phần còn chờ, history ghi. Không còn tính vào "chờ về" ở Tổng quan, trang Rút EarnApp, báo cáo tiền, dashboard; có cột / bộ lọc "Mất do SUS" với tổng số tiền mất.
  - Còn `PREPARING` (chưa gửi) → xoá ghi nhầm (mục 2), email trả kho [builder].
  - Không có yêu cầu → chỉ đánh SUS.
- Email PayPal nhận của EarnApp đó (`EarnAppAccount.paypalEmailId`, và email của yêu cầu nếu đã SENT) → **xoá khỏi kho** (`PayPalEmail.archivedAt`, lý do "EarnApp SUS"); không bao giờ cấp lại. Sổ PayPal không đổi.
- Tài khoản EarnApp: đóng khi ghi tạo lại (như hiện có, `closedReason SUSPENDED`), login không bao giờ cấp lại (đã đúng). Không xoá login khỏi Kho tài khoản [builder].
- Proxy: không đụng; khi tạo lại, `keepable` giữ proxy còn tốt, BLOCKED đi luồng thay proxy (như hiện có).
- Rút gộp: VM chính SUS → khoản gộp mất theo (logic `primarySus` hiện có), các VM thành viên vào Chờ tạo lại.
- Tiền vẫn về muộn: ghi "Tiền đã về" trên yêu cầu `LOST_SUS` được → ghi receipt bình thường, yêu cầu thành Đã về (history "về muộn sau SUS") [builder].
- Lỡ bấm SUS: hoàn tác qua journal khi VM chưa được ghi tạo lại [builder].
- Yêu cầu cũ đang "Thất bại" vì SUS: không tự chuyển; người dùng bấm "EarnApp bị SUS" nếu muốn.

## 4. Chờ tạo lại
- Bộ lọc tiền **"Chờ tạo lại"** ở Server/VM (đổi tên mốc `RECREATE` "Cần tạo lại VM") = mọi VM mà `recreateRule` cho phép: tiền lượt này về đủ và chưa dùng, hoặc VM SUS (kể cả thành viên gộp). Tổng quan có số đếm, bấm vào ra đúng danh sách.
- Chọn dòng → **"Tạo lại N VM"**:
  - VM thuộc server đã nối điều khiển (`FLEET_CONTROL_SERVERS`) → tạo lệnh `RECREATE_VM` của dịch vụ lệnh fleet hiện có (từng VM một lệnh, cùng quyền MANAGE, cùng điều kiện).
  - Chủ 28/10: "nút tạo lại cho chạy hàng loạt VM, hàng loạt server khi xác nhận" → không giới hạn số VM / server; luôn có một hộp xác nhận (số VM theo từng server) trước khi gửi.
  - VM chưa nối → không gửi lệnh; nhắc "Tạo lại trên máy rồi bấm Ghi nhận đã tạo lại".
  - **"Ghi nhận đã tạo lại N VM"** (hàng loạt `recordRecreated`, từng VM một lệnh riêng, kết quả từng dòng).
- Sau tạo lại: lượt mới, trạng thái Chưa cài (NEW_VM), proxy tốt giữ lại, EarnApp cũ đóng, SDK cũ rời vị trí (như hiện có). Tài khoản EarnApp mới và email PP mới lấy theo luồng hiện có khi làm VM; lúc tạo lại không tự gán [builder].

## 5. AI xin duyệt
- `approval:true` chỉ còn `WITHDRAWAL_PREPARE`. `WITHDRAWAL_STATUS`, `WITHDRAWAL_RECEIPT`, `WITHDRAWAL_MEMBERS` [builder] và các lệnh mới (sửa, bỏ đã rút, xoá ghi nhầm, SUS, tạo lại hàng loạt) chạy thẳng, vẫn kiểm token / scope / quyền / revision và ghi `OpsAudit`. Lệnh cũ đang chờ duyệt của các route này: lần gửi lại cùng key chạy thẳng.
- **Phiên duyệt 15 phút** — bảng mới `OpsApprovalSession` (projectId, tokenId, approvedById, openedAt, expiresAt = openedAt + 15 phút, closedAt?, closedById?, via `CLI` | `WEB`).
  - Mở từ AI: `POST /api/ops/v1/approval-sessions {admin, totp}`; cùng kiểm tra như `confirmApprovalByToken` (ADMIN của dự án, 2FA bật, `checkTotp` chống dùng lại cùng bước, 3 sai → khoá 30 phút của ADMIN). Chủ gõ mã trong chat Claude, AI chuyển mã qua lệnh `ops-client session-open --admin tut --totp <mã>`; client không ghi mã vào journal / log / màn hình. **Quyết định mới của chủ thay phản mục tiêu 23/10** "mã TOTP đi qua chat".
  - Mở từ web: trang Phê duyệt, nút "Mở phiên 15 phút" cho một token, nhập mã TOTP của ADMIN.
  - Trong phiên: lệnh `WITHDRAWAL_PREPARE` của đúng token + dự án được duyệt ngay — vẫn tạo dòng `OpsApproval` (status APPROVED → CONSUMED, `decidedById` = ADMIN mở phiên, `sessionId`, ghi chú "Duyệt theo phiên hh:mm") để nhật ký giữ nguyên dạng. Mở phiên cũng duyệt luôn các yêu cầu PENDING còn hạn của token đó.
  - Mở phiên mới khi đang có phiên: phiên cũ đóng, phiên mới tính 15 phút từ lúc mở [builder]. Không giới hạn số VM / số tiền trong phiên [builder; chủ chưa trả lời câu hỏi giới hạn].
  - "Khóa phiên ngay" trên trang Phê duyệt (ADMIN), và `ops-client session-close`. Phiên tự hết hạn; người duyệt bị khoá / mất quyền ADMIN / token bị thu hồi → phiên vô hiệu ngay (kiểm lại trong transaction mỗi lần dùng).
  - `GET me` trả `approvalSession {open, expiresAt}`.
- Trang Phê duyệt có **"Duyệt tất cả đang chờ"** với một mã TOTP.
- AI có endpoint mới tương ứng mục 1–4 (sửa, bỏ đã rút, xoá ghi nhầm, SUS, ghi tiền về có chốt thiếu, tạo lại hàng loạt / ghi nhận tạo lại); OpenAPI bump minor; prompt vận hành Central cập nhật.

## Ràng buộc
- **Nguồn build**: bản đang chạy là bản ghép (fleet WIP chưa commit + Rút gộp `codex/merged-payout` + các bản vá sau). Checkout `bdops-proxy-app` (feat/proxy-inventory) **không** có Rút gộp. Phát triển trong worktree mới tạo từ `feat/proxy-inventory`, commit đầu tiên = phủ `src/`, `prisma/`, `scripts/`, `docs/ops-api/` của `D:/MoneyToHome/app` (bản live, BUILD `DA1lGJ8RFpsq0u7O2EFoM` lúc viết) làm mốc; mọi thay đổi là commit sau mốc đó. Release = copy bản live + diff các commit này (như các release 28/10).
- Migration chỉ cộng thêm: `state` thêm giá trị `LOST_SUS` (cột String), `lostAmount Decimal?`, bảng `EarnPayoutRequestVoid`, bảng `OpsApprovalSession`, `OpsApproval.sessionId String?`.
- Quyền giữ nguyên: ai làm được gì hôm nay (writeMoney / EARN_PAYOUT / PAYPAL_RECEIPT_RECORD / ASSIGN / MANAGE) vẫn vậy; SUS cần quyền ghi trạng thái VM; sửa / xoá ghi nhầm theo quyền như `CORRECT` hiện có cho người, `EARN_PAYOUT` cho AI. Người dùng giới hạn server chỉ thấy / làm VM trong phạm vi.
- Chạy test bằng PowerShell (Git Bash làm hỏng 10 test CLI). Không quay video.

## Bổ sung sau khi soát độc lập (28/10) — quyết định của người viết [builder]
1. **SUS là một sự kiện, mọi đường đều đóng như nhau**: chọn SUS ở ô Tình trạng, ghi hàng loạt, hay AI `POST vms/{id}/status` SUSPENDED đều chạy cùng lệnh đóng SUS của mục 3 (cùng quyền ghi trạng thái VM). VM đã SUS từ trước bản này mà lệnh rút còn chờ: không tự chuyển; hiện ở bộ lọc "SUS còn chờ tiền" để bấm "EarnApp bị SUS" một lần.
2. **Thất bại / Gửi lại giữ như hiện có** (EarnApp trả lệnh về / từ chối mà không SUS): khung có "Thất bại" và "Gửi lại" cho người có quyền ghi tiền; "Huỷ" trên lệnh chưa gửi = "Bỏ" (xoá ghi nhầm). Email / slot ngày khi Thất bại một lệnh đã gửi: giữ như hiện có.
3. **Gỡ email khi sửa / bỏ / xoá không phân biệt ai đã gán**: email của yêu cầu được trả kho nếu chưa từng có khoản tiền nào về email đó cho EarnApp này, kể cả khi email đã gán qua "PayPal nhận" từ trước.
4. **Số tiền yêu cầu vẫn sửa được sau khi đã có tiền về một phần** (như `CORRECT` hiện có, bắt buộc lý do); email / PP thì không.
5. **Chốt thiếu giữ quyền như cũ**: chỉ người có quyền ghi tiền (writeMoney) thấy ô "Chốt luôn, phần thiếu là phí" (tick sẵn); AI và người chỉ có quyền ghi khoản nhận không chốt; API mặc định `settleRemainder=false`.
6. **Ngày tính hạn mức 2 email khi sửa email**: ngày của lần ghi "Đã rút" (`submittedAt`, giờ server), không phải ngày rút người dùng sửa; sửa "ngày rút" chỉ đổi `requestedAt`.

## Để builder quyết
Tên endpoint / action, bố cục khung, cách tách component, thứ tự migration, cách hiển thị số tiền mất do SUS trên Tổng quan, cách kiểm thử trình duyệt (dữ liệu giả, không đụng dữ liệu thật).
