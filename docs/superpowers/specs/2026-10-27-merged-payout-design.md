# Rút gộp nhiều VM vào một tài khoản EarnApp — thiết kế (27/10/2026)

## Vì sao

Chủ vận hành đôi khi nối SDK của nhiều VM vào **một** tài khoản EarnApp (tài khoản của một VM chính) để đủ mức rút, rồi rút một
lần về email PayPal của VM chính. Ví dụ thật 27/10: An-01/VM_001 (tài khoản `inahmarkonah770@…`, email nhận `oblong-trap4g@…`,
SDK …23f5 $8,71) và An-01/VM_003 (không có tài khoản, SDK …64bc $11,83). Sau khi gộp, tiền trên cả hai máy về 0 và cả hai cùng chờ
một khoản về PayPal.

Web hiện coi "1 tài khoản EarnApp = 1 VM", và lệnh rút (`EarnPayoutRequest`) gắn một VM / một vòng. VM phụ (VM_003) trông như chưa
làm gì: không tài khoản, không lệnh rút, không được "Ghi nhận đã tạo lại VM". Chủ không quản trị được.

Sau khi tiền về, chủ **tạo lại mọi VM trong lệnh gộp** (vòng mới, SDK mới). Gộp là **một lần để rút**, không phải dùng chung tài khoản
lâu dài. Số VM gộp tuỳ tình hình (2 hoặc nhiều hơn). Cả chủ (web) lẫn AI vận hành (ops API, Codex trên moon-01) đều làm việc này.

## Mục tiêu

1. Một lệnh rút gộp: một VM chính (có tài khoản EarnApp + email nhận hiện tại) và một hoặc nhiều VM phụ, mỗi VM ở vòng hiện tại của nó.
2. Mọi VM trong lệnh gộp hiện rõ trạng thái lệnh rút đó (Chuẩn bị / Chờ tiền về / Đã về PP / Cần đối chiếu…) ở cột "Tiền VM" và trong
   khung chi tiết; VM phụ ghi "Đã gộp vào <VM chính>".
3. Tiền về PayPal ghi **một lần** vào sổ, gắn lệnh gộp. Không nhân đôi trong tổng, báo cáo, Tổng quan.
4. Khi lệnh gộp đã về đủ PP, **từng** VM trong lệnh (chính và phụ) được "Ghi nhận đã tạo lại VM" đúng một lần cho vòng đã gộp.
5. Cùng một dịch vụ cho web và ops API (quyền, idempotency, revision, vòng, phê duyệt như rút thường).

## Không làm

- Không dùng chung tài khoản EarnApp lâu dài giữa các VM; quy tắc "1 tài khoản = 1 VM" giữ nguyên cho gán tài khoản.
- Không tự suy ra gộp từ việc tiền VM về 0 hay từ SDK. Gộp chỉ khi người / AI ghi rõ.
- Không chia tiền về PP cho từng VM như một khoản thu riêng; phần đóng góp từng VM chỉ để tham khảo.
- Không thao tác máy thật / EarnApp từ web.

## Điều không được xảy ra (anti-goals)

- Tiền về bị đếm hai lần (theo VM chính và VM phụ).
- Một VM nằm trong hai lệnh rút đang mở cùng lúc (gộp + thường, hoặc hai lệnh gộp) ở cùng vòng.
- Một khoản về dùng để tạo lại cùng VM hai lần, hoặc VM phụ được tạo lại khi tiền chưa về đủ.
- Phá dữ liệu / luồng rút thường đã có (một VM, một tài khoản).

## Quy tắc nghiệp vụ

- **Thành viên**: lệnh gộp có danh sách VM (gồm VM chính). Mỗi thành viên lưu VM, vòng tại lúc gộp, SDK hiện tại lúc gộp (nếu có),
  số đóng góp tham khảo (lần quét cuối của SDK hiện tại tại đúng VM + vòng, hoặc người nhập; có thể trống), và thời điểm đã dùng để tạo
  lại (`consumedAt` riêng từng thành viên).
- **VM chính** phải có tài khoản EarnApp hiện tại (chưa đóng) ở vòng hiện tại; email nhận và PP chọn như rút thường (quy tắc 2 email /
  PP / ngày, giữ email khi PREPARING, SENT dùng email vĩnh viễn — giữ nguyên).
- **VM phụ**: cùng dự án, đang hoạt động (chưa xoá), không có lệnh rút đang mở ở vòng hiện tại (của chính nó hoặc làm thành viên lệnh
  gộp khác). VM phụ có thể có hoặc không có tài khoản EarnApp riêng; nếu có, tài khoản đó không bị đổi gì (chỉ cảnh báo trong xem trước).
- **Số tiền lệnh** = tổng thực tế rút trên EarnApp do người / AI nhập (gợi ý = tổng đóng góp tham khảo). Tiền về, thiếu, phí, đối chiếu
  theo đúng luồng lệnh rút hiện có.
- **SDK**: khi lệnh gộp chuyển SENT (thấy trong lịch sử EarnApp), SDK hiện tại của mỗi thành viên được ghi *Đã dùng* (LINKED) với
  `linkedEarnAppId` = tài khoản VM chính, `linkedVmId` = VM của thành viên. Nếu SDK đã LINKED thì giữ nguyên. *(Lựa chọn của người
  thiết kế: ghi ở SENT, không ở PREPARING, để huỷ khi chuẩn bị không phải gỡ trạng thái Đã dùng vốn là vĩnh viễn.)*
- **Huỷ / thất bại** lệnh gộp: mọi thành viên được thả (có thể vào lệnh khác), như rút thường thả email.
- **Thêm / bớt thành viên** chỉ khi lệnh còn PREPARING. Sau SENT danh sách cố định.
- **Tạo lại VM** (`recordRecreated`): VM đủ điều kiện nếu (a) như cũ, hoặc (b) là thành viên của lệnh gộp ở đúng vòng đang đóng, lệnh đã
  về đủ PP (phase RECEIVED) và `consumedAt` của thành viên đó còn trống. Ghi `consumedAt` của thành viên; với VM chính đóng tài khoản
  EarnApp như cũ. VM phụ không có tài khoản thì không có gì để đóng. Lệnh được coi là "đã dùng hết" khi mọi thành viên đã dùng.
  SUS giữ quy tắc cũ cho VM chính.
- **Lệnh rút có sẵn** *(lựa chọn của người thiết kế)*: mỗi tài khoản EarnApp chỉ có một lệnh rút (`earnAppId` unique). Lệnh gộp =
  lệnh rút của tài khoản VM chính + danh sách thành viên. Nếu tài khoản đó đã có lệnh (PREPARING / SENT / UNKNOWN, chưa về đủ, chưa
  dùng), được **gắn thêm thành viên** để đối chiếu thực tế đã gộp trên EarnApp, mỗi lần gắn ghi lịch sử. Gỡ thành viên chỉ khi PREPARING.
  Lệnh đã về đủ / đã dùng / huỷ / thất bại thì không gắn thêm.
- **VM phụ có tài khoản riêng** (chủ 27/10): SDK của VM phụ đã nối vào tài khoản VM chính, nên tài khoản riêng của VM phụ chưa thực
  sự dùng. Khi tạo lại VM phụ qua lệnh gộp, tài khoản riêng **không đóng** và **ở lại đúng VM đó sang vòng mới** (chủ đăng nhập lại
  trên máy mới). Không trả về kho, không gán VM khác, PayPal / email nhận / lệnh rút (chưa có) của nó giữ nguyên. Nếu Gmail / Apple ID
  đó đã ghi lỗi đăng nhập (Locked / Verify / Disabled) thì vẫn giữ trên VM và xử lý bằng luồng báo lỗi đăng nhập hiện có (thay tài khoản
  mới), không tự thay khi tạo lại. Chỉ áp dụng cho thành viên phụ; VM chính đóng tài khoản như tạo lại thường.
- **Tài khoản VM chính bị SUS** (chủ 27/10: "không nhận được tiền và xem như chưa về"): tiền của lệnh gộp không bao giờ tính là đã về /
  thu nhập, lệnh giữ nguyên lịch sử. Giống SUS thường, VM chính được tạo lại lý do SUSPENDED; **mọi thành viên** của lệnh gộp đó cũng
  được tạo lại lý do SUSPENDED (thành viên ghi `consumedAt`, vòng đóng ghi lý do SUSPENDED). Không cần huỷ lệnh trước.
- **Vòng**: mọi lệnh mang `expectedCycle` + revision cho từng VM; VM đổi vòng trong lúc làm → từ chối dòng đó.

## Giao diện (web)

- Server / VM: chọn ≥ 2 VM → thanh thao tác thêm **"Rút gộp về PayPal"**. Khung: chọn VM chính (chỉ VM có tài khoản), bảng thành viên
  (VM, SDK hiện tại, đóng góp tham khảo + giờ quét, cảnh báo), tổng gợi ý, ô số tiền thực rút, PP / email như rút thường, mặc định
  PREPARING. Các bước sau (Đã gửi trên EarnApp → Ghi tiền về PP) dùng các nút đã có của VM chính / trang Rút EarnApp.
- Cột "Tiền VM" của thành viên phụ: "Đã gộp vào VM_001 · Chờ tiền về $20,54"; VM chính: "Chờ tiền về $20,54 · gộp N VM". Bấm mở cùng
  lệnh. Lọc "Chờ tiền về" / "Đã về PP" tính cả thành viên phụ.
- Trang Rút EarnApp + Tổng quan: một dòng cho lệnh gộp, hiện danh sách VM; đếm VM phân biệt gồm cả thành viên; tiền chỉ một lần. Lọc
  theo server: lệnh hiện nếu có thành viên thuộc server đó.
- Quyền đọc / ghi tiền như luồng rút hiện có; người bị giới hạn server chỉ tạo lệnh gộp khi **mọi** thành viên thuộc server được giao.

## Ops API (AI)

- Tạo lệnh gộp qua cùng dịch vụ, chung phạm vi PAYOUT và phê duyệt WITHDRAWAL_PREPARE như rút thường. Body: VM chính + vòng + revision +
  earnAppId, danh sách thành viên (vmId, expectedCycle, expectedVmRevision, đóng góp tuỳ chọn), số tiền, PP / email. Idempotency-Key như cũ.
- Đọc VM / lệnh rút trả danh sách thành viên và vai trò (`PRIMARY` / `MEMBER`). OpenAPI tăng phiên bản; cập nhật hướng dẫn vận hành trên
  Central.

## Dữ liệu hiện có hôm nay

27/10 chủ cho biết VM_001 + VM_003 chưa bấm rút được trên EarnApp (chưa có lệnh rút trên web). Chủ tự xử lý sau khi bản này phát hành,
qua giao diện / API; người xây dựng không ghi dữ liệu thật và không sửa DB trực tiếp.

## Để người xây dựng quyết định

Tên bảng / cột (gợi ý bảng thành viên riêng, VM chính cũng là một dòng thành viên để truy vấn thống nhất), migration chỉ thêm (lệnh cũ
không có thành viên = lệnh thường), cách trình bày chi tiết, cách hiển thị lịch sử. Giữ nguyên chạy test từ PowerShell; quy trình phát
hành như các bản trước (backup + bản sao mã hoá moon-01, deploy không UAC, kiểm host chỉ đọc).
