NHIỆM VỤ: Hoàn thiện giám sát và điều khiển fleet qua GEN2 → Central → MoneyToHome/Telegram, dùng API của AE. Làm canary trước, chưa phát hành toàn fleet.

Mục tiêu của chủ hệ thống:
- Biết VM nào đang chạy tốt, VM nào lỗi và lỗi ở đâu.
- Phát hiện mất mạng/proxy, EarnApp hoặc SDK ngừng hoạt động.
- Ra lệnh từ web hoặc Telegram, hệ thống gọi AE thực hiện và báo kết quả thật.
- Nhẹ, ổn định lâu dài, không tích tụ tài nguyên, không báo xanh sai.
- Dùng lệnh cố định của sản phẩm; không thao tác GUI hay viết script vận hành rời mỗi lần.

Đây là yêu cầu triển khai có kiểm chứng. Không dừng ở việc viết đặc tả hoặc đề xuất thêm.

1. PHẠM VI VÀ QUYỀN ĐÃ DUYỆT

Được phép:
- Đọc source, tài liệu, phiên bản cài thật và cấu hình triển khai hiện hành.
- Sửa code, test, build và triển khai canary trên Central cùng một máy con phù hợp.
- Cập nhật phần liên quan trên website MoneyToHome cá nhân, có sao lưu và cờ canary.
- Thu thập chỉ đọc trên các VM sản xuất để đo tải.
- Thử lệnh nguồn trên đúng VM canary cách ly được khai báo.
- Gửi cảnh báo Telegram canary có nhãn CANARY, số lượng giới hạn.

Chưa được phép:
- Phát hành worker mới toàn fleet.
- Bật/tắt/reset, đổi RAM/Balloon, NAT/DNS/proxy hoặc sửa EarnApp trên VM sản xuất.
- Mở Auto-FIX hay thay khóa quản trị đang có.
- Rút tiền hoặc bật công tắc tài chính.
- Thay đổi worker Check Apple ID.

Không dùng Railway nữa. Xác định repository, máy chủ, runtime và cách triển khai của website cá nhân đang dùng; không dùng Railway CLI, token hoặc quy trình cũ.

Không hỏi lại quyền cho các bước đã được duyệt ở trên. Chỉ hỏi khi thực sự cần quyết định ngoài phạm vi hoặc thiếu dữ liệu không tìm được trong hệ thống.

2. ĐỌC ĐÚNG PHẦN ĐÃ CÓ, SAU ĐÓ LÀM

Đọc các tài liệu hiện hành:
- Hướng dẫn Claude Fleet và sổ tay quản trị.
- LOI-CHO-BUILD.md, INCIDENTS và nhật ký liên quan.
- Đặc tả VM Guard, engine-session.
- NET-PROXY-WATCH-SPEC.txt và tài liệu API AE.
- Source GEN2, bridge và API MoneyToHome đang triển khai.

Kiểm phiên bản thực tế, không suy ra từ tên shortcut hay thư mục.

Lập một bảng ngắn:
“Đã có / Tái sử dụng / Cần bổ sung / Bằng chứng kiểm chứng”.

Không kiểm toán lại toàn bộ lịch sử và không mở thêm yêu cầu ngoài nhiệm vụ này.

3. KIẾN TRÚC PHẢI DÙNG

- GEN2 trên từng server: thu thập và điều phối tại máy.
- Bridge: chuyển quan sát và kết quả về Central/web.
- Central: điều phối, tổng hợp và quản lý giao nhận.
- AE: thực hiện thao tác quản trị qua API/CLI cố định.
- Web và Telegram: dùng chung command service, quyền, hàng đợi và lịch sử.

Tái sử dụng collector, GenProbe, cache, incident, outbox, guard và API đang có. Không tạo thêm một vòng thu thập trùng hoặc tiến trình thường trú trong từng VM.

Worker Apple giữ riêng. Không dùng trình duyệt của worker Apple để giám sát VM.

Không thêm script PowerShell tùy ý hoặc một vòng thu thập thứ hai. Nếu collector hiện hành dùng probe cố định qua guestcontrol thì đo chi phí, timeout và dùng lại khi phù hợp.

4. GIÁM SÁT NHỮNG GÌ

A. Trạng thái VM — mục tiêu 60 giây
- Running, paused, aborted, powered off, starting/stopping.
- Phân biệt VM tắt có chủ đích với VM lỗi.
- Kiểm toàn bộ danh sách được quản lý, không chỉ các VM Running.

B. Guest, mạng, EarnApp/SDK — mục tiêu mỗi VM 600 giây
- Guest Additions và khả năng phản hồi.
- Mạng trong VM theo bằng chứng hiện có.
- EarnApp/SDK có chạy và có bằng chứng kết nối hay không.

Không kết luận:
- Sai mật khẩu hoặc guestcontrol timeout = mất Guest Additions.
- SDK không có TCP tại một thời điểm = SDK chết.
- Có tiến trình và HTTPS chung hoạt động = đang kiếm tiền.
- Biểu tượng quả địa cầu của Windows = proxy hỏng.

C. Proxy — mục tiêu 600 giây
- Kiểm đúng proxy đang được gán cho VM, không lấy proxy ngẫu nhiên.
- Phân biệt kết nối TCP, xác thực và HTTPS qua proxy.
- Ghi rõ phép kiểm thực hiện từ HOST hay GUEST.
- Host đi qua proxy thành công chưa chứng minh mạng trong VM tốt.
- Chỉ báo guest/proxy tốt khi bằng chứng khớp đường mạng đang áp dụng cho đúng VM đó.
- Dùng lại bằng chứng đủ mới; không mở thêm guest probe nếu không cần.

Timeout, HTTP 403/429 hoặc endpoint kiểm tra lỗi không được tự ghi proxy BLOCKED.
Mất mạng cả host phải được nhận diện ở cấp host, tránh báo hàng loạt proxy hỏng.

D. Tiền
- Job đọc tiền chủ động một lần mỗi 24 giờ.
- Tiếp tục nhận quan sát tiền sẵn có từ GEN2.
- Không OCR/quét tiền trong từng vòng sức khỏe.
- Thiếu dữ liệu hoặc không đọc được không được ghi thành $0.
- Chênh lệch hai lần đọc không tự gọi là “tiền hôm nay”.
- Hiển thị thời gian, độ phủ và khoảng đo; tính đến rút tiền, thưởng và tài khoản dùng chung.
- Không thay đổi chức năng tài chính trong nhiệm vụ này.

5. NGÂN SÁCH TÀI NGUYÊN VÀ LỊCH

Ban đầu:
- Tối đa 1 guest probe đang chạy trên mỗi host.
- Tối đa 2 kết nối kiểm proxy đồng thời, tách khỏi slot guest.
- Rải đều lịch theo số VM: 100 VM trong 600 giây tương đương khoảng 6 giây/VM.
- Các host chạy độc lập; không quét tuần tự toàn fleet qua một hàng đợi duy nhất.

Bắt buộc:
- Không chồng vòng quét.
- Timeout từng bước, retry có giới hạn, hàng đợi/log/dung lượng đĩa có giới hạn.
- Lệnh đã timeout nhưng còn chạy nền vẫn phải được theo dõi; không mở thêm lệnh làm vượt concurrency.
- Ưu tiên hoàn thành lượt đầu trước khi thử lại hàng loạt.
- Khi quá tải hoặc không kịp lịch: báo MONITORING_GAP/STALE và độ phủ thực tế; không giữ xanh.
- Không dùng ngưỡng bật VM “RAM 8 GB, CPU 75%” để ngừng toàn bộ giám sát nhẹ.
- Không chạy song song vòng guest cũ và vòng guest mới.

Tạo bảng cấu hình có phiên bản, dùng chung cho agent/web:
- Chu kỳ kiểm.
- Startup grace.
- Timeout từng bước.
- Thời gian xác nhận lại lỗi/phục hồi.
- Ngưỡng dữ liệu cũ và mất heartbeat.
- Retry/backoff, flush telemetry, giới hạn hàng đợi và lưu log.

Đặt mặc định bảo thủ trước canary, sau đó điều chỉnh theo số đo; không hỏi chủ từng con số. Nếu agent chưa hỗ trợ phiên bản cấu hình thì báo rõ, không mặc định khỏe.

Đo riêng:
- CPU và RAM tăng thêm.
- Thời gian probe và thời gian phủ đủ host.
- Số lệnh guest/VBox, số socket.
- Độ trễ phát hiện, gửi web và Telegram.
- Queue, log, handle, tiến trình con có tăng dần không.

RAM tăng thêm dưới 20 MiB là mục tiêu để đo, không phải kết quả được phép tự công bố. Không hứa đủ 10 phút trong mọi tình huống lỗi hoặc host quá tải.

6. TELEMETRY THEO LÔ VÀ DASHBOARD

Kiểm giới hạn ghi thực tế của bridge/backend. Bổ sung API telemetry theo lô nếu đường hiện tại không đủ; không nới hạn mức tài chính để giải quyết telemetry.

Mỗi dòng quan sát phải có:
- eventID bền vững.
- project/server/UUID/configuration tương ứng.
- observedAt và thứ tự/epoch phù hợp.
- Nội dung cố định sau khi tạo.

Lô chỉ là phương tiện vận chuyển:
- Trả kết quả riêng từng dòng.
- Mất ACK thì gửi lại đúng dòng chưa xác định với ID cũ.
- Chia/gộp lại lô không tạo ID mới.
- Không đánh dấu cả lô thành công vì một phần đã ghi.

Không cho quan sát cũ đến muộn ghi đè trạng thái mới.
Dữ liệu của cấu hình cũ hoặc VM đã tạo lại chỉ được lưu lịch sử, không áp lên VM hiện tại.

Quan sát bình thường được gộp có giới hạn thời gian chờ; lỗi đã xác nhận gửi ưu tiên.
Không coalescing làm mất lịch sử tiền hoặc giao dịch.

Dashboard phải tách:
1. VM đang chạy.
2. EarnApp/SDK và kết nối đã xác minh.
3. Tiền tăng có bằng chứng.

Chưa có bằng chứng tiền tăng thì ghi “Chưa xác minh kiếm tiền”.
Tách observedAt, receivedAt và thời điểm đồng bộ; không làm dữ liệu cũ thành mới.

Theo dõi riêng:
- Central còn liên lạc.
- Agent từng server còn liên lạc.
- Lần quan sát và độ phủ từng VM.

Central còn sống không có nghĩa mọi server còn sống.

7. ĐƯỜNG ĐIỀU KHIỂN QUA AE

Phạm vi ban đầu:
- START_VM.
- SHUTDOWN_VM: tắt êm.
- POWER_OFF_VM: Power Off chuẩn.
- CHECK_HEALTH: kiểm sức khỏe, mặc định không sửa và không đọc tiền.
- Tra tiến độ/kết quả và yêu cầu hủy.

Không dùng status=OFF trên web để thay cho lệnh tắt VM thật.
Không dùng full scan có tác động giao diện làm phép kiểm nhẹ.

Lệnh đi:
Web/Telegram → command service → Central/agent → API AE → xác minh → lưu kết quả → trả web/Telegram.

Dùng đúng API AE hiện có. Thiếu binding thì bổ sung vào sản phẩm; không tạo script thao tác thay thế mỗi lần.

Phân biệt tắt êm, Power Off và cưỡng tắt. Không tự chuyển sang reset/kill/hard-off khi người dùng chỉ yêu cầu tắt êm.

Bật VM phải giữ đúng chế độ RAM đã chọn, headless và phiên Windows theo quy trình hiện hành.
VM đang chạy không được bật trùng.
VM tắt có chủ đích phải được bảo vệ khỏi Auto-FIX bật lại.

8. CANARY, QUYỀN VÀ CHỐNG CHẠY LẶP

Cờ canary được kiểm ở backend và trước khi AE tác động:
- Khớp project, server và UUID được phép.
- Telegram cũng qua cùng chốt.
- Thiếu cấu hình thì từ chối điều khiển nguồn.
- Telemetry có thể đọc khoảng 100 VM sản xuất; quyền điều khiển nguồn chỉ dành cho UUID canary.
- Chốt canary không được vô tình chặn heartbeat, tra kết quả hoặc đối soát hợp lệ.

Kiểm lại quyền ngay trước tác động:
- User bị disable, token bị thu hồi hoặc quyền server bị gỡ trong lúc chờ thì không được phát sinh tác động mới.
- Nếu AE đã thực hiện thì vẫn đối soát và ghi kết quả thật; không đổi thành “chưa chạy”.

Chống lặp:
- Một operationID bền vững xuyên suốt web → worker → AE.
- Cùng ID, cùng nội dung: tra lại kết quả, không làm lại.
- Cùng ID, khác nội dung: từ chối.
- Lease/fencing epoch được quản lý riêng, không làm đổi danh tính nghiệp vụ.
- Worker mất lease không được phát thêm bước tác động.
- Kiểm TTL khi nhận, lấy việc và trước tác động; lệnh cũ không bất ngờ chạy khi server nối lại.
- Auto-FIX, lệnh chủ và job định kỳ phải dùng cùng guard theo đúng UUID.

Không hứa “tác động đúng một lần” khi chưa đối soát được.
Nếu AE đã tác động nhưng chết trước khi ghi kết quả:
- Giữ UNKNOWN.
- Không tự phát lại tác động.
- Tra journal, tiến trình engine và trạng thái thật để kết luận.

Phải có test đúng điểm chết này, không chỉ test gửi trùng request.
Chỉ gây lỗi trong harness hoặc tiến trình canary cách ly; tuyệt đối không kill AE/GEN2 sản xuất để thử.

Hủy:
- Chưa gửi: có thể xác nhận đã hủy.
- Đã gửi AE: báo đang yêu cầu hủy/chưa rõ kết quả cho tới khi xác minh.
- Không báo “Đã hủy” chỉ vì xóa hàng đợi.
- Hủy không tự hoàn nguyên hoặc bật lại VM vừa tắt.

9. CẢNH BÁO VÀ GIAO NHẬN

Dùng incident/outbox hiện có, tránh hai bộ gửi trùng:
- Cảnh báo lỗi đã xác nhận.
- Báo phục hồi sau xác nhận.
- Gom lỗi chung theo server khi có bằng chứng.
- Không gửi lại cảnh báo không đổi mỗi vòng.

Tách trạng thái:
- Đã thu thập.
- Central đã nhận.
- Web đã lưu.
- Telegram đã nhận.

ACK nội bộ hoặc “đã xếp hàng” không được coi là Telegram đã nhận; Telegram nhận cũng không có nghĩa chủ đã đọc.

Mất mạng/restart phải gửi bù có giới hạn, không làm phình RAM hoặc đĩa.
Nếu chưa có đường độc lập phát hiện Central chết thì nêu đúng giới hạn đó, không hứa Telegram vẫn báo được mọi trường hợp.

Không in mật khẩu, token, OTP, cookie hoặc proxy user/pass vào log, argv, Telegram và báo cáo.

10. TRIỂN KHAI THEO BA MỐC

Mốc 1 — làm trước ngay:
- Hợp nhất collector, lịch kiểm và bảng cấu hình.
- Telemetry theo lô.
- Web hiển thị đúng trạng thái, độ phủ và dữ liệu cũ.
- Canary chỉ đọc trên Central và một host đủ đại diện.
- Đo tải thật, timeout, lỗi và độ trễ.

Mốc 2 — chỉ chuyển khi mốc 1 đạt:
- Hoàn thiện một đường Web → Central → AE → xác minh.
- Chỉ bật/tắt VM canary cách ly.
- Kiểm replay, ID conflict, mất ACK, restart, lease hết hạn, thu hồi quyền, TTL, hủy và UNKNOWN.
- Dùng VM không proxy/tài khoản sản xuất; không nối mạng làm trùng proxy.

Mốc 3 — chỉ chuyển khi mốc 2 đạt:
- Telegram dùng lại chính command service.
- Kiểm cảnh báo, phục hồi và giao nhận.
- Theo dõi 24–48 giờ bằng tác vụ nền/telemetry có sẵn; không giữ phiên Claude chạy vòng kiểm tra vô hạn.

Chưa phát hành toàn fleet. Không mở rộng tính năng trước khi có kết quả canary.

11. CÁCH LÀM ĐỂ CHỐT VIỆC

- Chốt danh sách việc ngay đầu lượt, không liên tục thêm tiêu chí.
- Có test đạt thì giữ bằng chứng; chỉ chạy lại phần bị ảnh hưởng bởi sửa đổi.
- Canary lỗi: lấy bằng chứng, sửa đúng nguyên nhân, chạy lại đúng ca lỗi và regression liên quan.
- Không build lại khi code không đổi.
- Không lặp cùng phép kiểm khi điều kiện chưa đổi.
- Nếu gặp blocker ngoài phạm vi: ghi chính xác dependency và hoàn thành phần độc lập còn lại.
- Không tự dừng chỉ để xin lại quyền đã được duyệt.
- Không báo “xong” khi mới có test giả lập hoặc mới gửi được lệnh.

Lưu source, test, cấu hình, lệnh cố định, hướng dẫn vận hành và rollback để phiên Claude sau tiếp quản mà không phải dựng lại script.

12. BÁO CÁO NGẮN GỌN

Mỗi mốc báo:
- Đã làm gì.
- Test thật ở đâu, kết quả.
- Tải tăng thêm và độ trễ đo được.
- Còn thiếu gì, bước tiếp theo.

Báo cáo cuối:
1. Phiên bản và nơi đã cài.
2. Số VM được giám sát/độ phủ thực tế.
3. CPU, RAM và thời gian một lượt.
4. Web/Telegram đã kiểm chứng tới đâu.
5. Điều khiển AE đã kiểm chứng những lệnh nào.
6. Bằng chứng VM sản xuất không đổi.
7. Giới hạn còn lại.
8. Đạt canary hay chưa; có đủ điều kiện xin phát hành fleet hay không.

Bắt đầu mốc 1 ngay. Giữ tài chính tắt và không tác động nguồn VM sản xuất.