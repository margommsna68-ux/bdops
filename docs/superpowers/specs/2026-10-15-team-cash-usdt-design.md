# Tiền về team và báo cáo USDT

## Mục tiêu và quyết định đã chốt

Anh muốn dùng một web cho vận hành PayPal hiện có và proxy/VM, giữ dữ liệu cũ làm mẫu kiểm chứng. Hai phần dùng chung source BDOps. Ngày 15/10/2026 anh chốt lợi nhuận theo **tiền thực tế đã chuyển về team − chi phí**, team nhận USDT; chi phí lúc VND, lúc USDT và cần nhập đồng tiền khác rồi quy về USDT.

Đây là thay đổi thiết kế tài chính, gồm số tiền, báo cáo, khóa kỳ và hoàn tác. Tài liệu này thay thế cách tổng EXCHANGE trừ chi phí trong thiết kế ngày 14/10 cho phần business mới. Trạng thái: chờ duyệt thiết kế; code hiện tại vẫn dùng công thức cũ. Railway tiếp tục chạy bản cũ với dữ liệu nguyên trạng.

## Cách làm được đề xuất

Chọn **tỷ giá lưu theo từng khoản**, gợi ý lại tỷ giá đã dùng gần nhất để nhập nhanh. Người nhập nhìn thấy và có thể sửa tỷ giá trước khi lưu; tỷ giá gợi ý không phải dữ liệu thị trường hay tỷ giá đã được xác minh cho giao dịch mới.

Hai lựa chọn khác là dùng một tỷ giá chung cho cả kỳ, hoặc lấy tỷ giá tham khảo tự động. Tỷ giá chung không phản ánh các lần thanh toán khác nhau; tỷ giá tham khảo vẫn cần đối chiếu với giao dịch thực tế. Giai đoạn này dùng tỷ giá từng khoản, không thêm nhà cung cấp tỷ giá tự động.

## Thao tác hằng ngày

**Chi phí:** nhập số tiền, chọn đồng tiền, ngày chi và nội dung. USDT dùng tỷ giá 1; VND hoặc đồng khác hiện thêm ô **1 USDT = bao nhiêu đơn vị tiền gốc**. Web hiện ngay số USDT tương ứng rồi lưu trong một lần bấm. Danh sách hiện cả tiền gốc và USDT; chi phí có thể liên kết server/gói proxy nhưng không bắt buộc có VM.

Ví dụ minh họa, không phải tỷ giá thực tế hoặc dữ liệu để nhập: 2.500.000 VND với 1 USDT = 25.000 VND được ghi 100 USDT. Sửa tỷ giá gợi ý sau đó không đổi khoản đã lưu.

**Nhận tiền về team:** ghi số USDT thực nhận, ngày nhận và mã giao dịch; chọn collector/nguồn đối chiếu khi có. Có thể nhận một phần hoặc nhận gộp, không ép một lần nhận phải bằng một lượt EXCHANGE. Tiền gốc trên PayPal, phí và hoa hồng vẫn được giữ để đối soát.

**Tổng quan và lợi nhuận:** hiển thị riêng tiền vào PayPal, tiền chuyển nội bộ, tiền đang ở collector, USDT đã về team và chi phí USDT. Lợi nhuận chỉ lấy USDT thực nhận về team trừ chi phí đã quy đổi trong kỳ. Phí đã trừ trước khi team nhận tiền không được ghi thêm lần nữa thành chi phí của cùng khoản.

Phí PayPal/hoa hồng lấy từ sổ collector để hiển thị đối soát, không tự nhân bản thành CostRecord. Form chi phí phân biệt khoản trả riêng với khoản đã được trừ trong tiền thực nhận; khoản đã trừ chỉ ghi đối soát và liên kết nguồn, không được trừ lần nữa vào lợi nhuận. Không suy ý nghĩa phí từ tên hoặc ghi chú tự do.

Các dự án chỉ dùng PayPal tiếp tục hoạt động không cần tạo server/VM. Màn thu/chi chung bổ sung tab Nhận về team; không mở thêm một ứng dụng quản lý khác.

## Dữ liệu tiền và tỷ giá

CostRecord tiếp tục là nguồn chi phí. Giữ currency và số tiền gốc; mở rộng độ chính xác của amount/total theo migration bảo toàn giá trị. Bổ sung tỷ giá của khoản, số USDT đã quy đổi, thời điểm và cách ghi tỷ giá. Tỷ giá quy ước nhất quán: **đơn vị tiền gốc trên 1 USDT**; USDT = tiền gốc chia tỷ giá.

Nhận mã tiền 3–8 chữ cái viết hoa, có lựa chọn nhanh VND, USDT, USD. Ngoài USDT phải có tỷ giá dương, không tự coi USD bằng USDT. Mã chưa biết vẫn cần tỷ giá do người nhập xác nhận; không suy đơn vị từ số tiền hoặc ghi chú.

Dùng Decimal từ chuỗi, không tính qua JavaScript float. Số tiền gốc tối đa 8 chữ số lẻ, tỷ giá tối đa 12 chữ số lẻ; giá trị quy đổi USDT và phép chia lợi nhuận dùng 6 chữ số lẻ. Chặn số quá miền lưu trữ, tỷ giá 0/âm, NaN, Infinity và ký hiệu khoa học. Chỉ làm tròn HALF_UP tại đầu ra USDT của khoản; tổng và phân bổ dùng các giá trị đã lưu. Phần dư khi chia được phân bổ xác định để tổng các phần bằng đúng lợi nhuận.

Ngày báo cáo dùng Asia/Bangkok. Nhận team lấy ngày thực nhận; chi phí lấy ngày chi đã ghi. Chưa tự phân bổ chi phí trả trước theo kỳ sử dụng. Thay tỷ giá của một khoản là sửa nghiệp vụ có revision và lịch sử; thay gợi ý tỷ giá không sửa các khoản khác.

## Phiếu nhận team và liên kết collector

Thêm TeamReceipt trong cùng project, gồm số USDT thực nhận, ngày nhận, mã tham chiếu, người ghi, collector tùy chọn, liên kết nguồn CollectorExpense tùy chọn, trạng thái xác nhận/thu hồi và revision. Chỉ phiếu xác nhận, chưa thu hồi được cộng vào lợi nhuận. Một CollectorExpense lịch sử chỉ được liên kết một phiếu; mã giao dịch đã ghi được kiểm tra để không nhập lại.

CollectorExpense vẫn giữ số tiền gốc của sổ collector. Không đổi đơn vị USD hiện có thành USDT. Khi có khoản trả về team mới, việc ghi nhận khoản ra ở sổ collector và phiếu USDT phải được đối chiếu rõ; các dữ liệu đã biết được lưu cùng transaction, không tạo hai lần khoản ra. Nếu chưa biết số USD đối chiếu, phiếu USDT thực nhận vẫn giữ được nhưng nguồn phải hiện Chưa đối soát, không tự giảm ví collector bằng số USDT.

Phiếu thuộc dự án đã xác định. Khoản gộp chưa xác định được phần của từng dự án giữ ở danh sách cần đối soát, chưa tự chia theo tỷ lệ, ngày hoặc tên. Phân bổ qua nhiều dự án là bước sau nếu dữ liệu thực tế yêu cầu, không tự nhân bản một mã giao dịch thành nhiều doanh thu.

Không dùng Withdrawal.paidToTeam để suy số USDT nhận về. Các lượt EXCHANGE và MIXING chỉ cung cấp luồng/nguồn đối chiếu; MIXING không tạo doanh thu mới. Không yêu cầu liên kết một lượt EXCHANGE duy nhất để ghi được phiếu nhận gộp.

## Báo cáo, lịch sử và khóa kỳ

Báo cáo mới có basis TEAM_RECEIVED và currency USDT. Nguồn gồm IDs/revisions phiếu nhận team, chi phí, số gốc, tỷ giá và số USDT đã lưu. Các khoản thiếu tỷ giá hoặc chưa xác định được tiền nhận phải được đếm và dẫn tới dòng cần xử lý; không hiển thị số liệu chưa đủ như một báo cáo hoàn chỉnh. Chặn chốt kỳ khi còn nguồn thiếu cần thiết để xác định lợi nhuận.

Kỳ đã chốt khóa các khoản ảnh hưởng báo cáo USDT bất kể tiền gốc là VND, USD hay USDT. Kiểm tra cả ngày cũ/ngày mới và tỷ giá khi sửa hoặc hoàn tác. Việc ghi/sửa nguồn và chốt kỳ dùng cùng khóa giao dịch theo project để tránh hai người vượt qua kiểm tra đồng thời.

Giữ các kỳ WITHDRAWN/USD/VND cũ cùng snapshot và trạng thái thanh toán, không tự tính lại thành công thức mới. Hiển thị rõ cơ sở tính cũ; kỳ mới dùng TEAM_RECEIVED/USDT. Không cộng các kỳ khác cơ sở/tiền tệ vào một tổng lợi nhuận.

Quyền xem/ghi theo FUNDS, WITHDRAWALS, COSTS và PROFIT hiện có; phiếu nhận team thuộc quyền WITHDRAWALS. Giữ PIN/capability khi copy credentials. Thay tỷ giá, sửa/thu hồi phiếu nhận và sửa nguồn phải có journal mã hóa, request key, expected revision và lý do theo nghiệp vụ. Snapshot mới giữ đầy đủ số gốc/tỷ giá/USDT; không làm hỏng khả năng đọc snapshot v1/v2/v3. Hoàn tác không thực hiện hoàn tiền ngoài thực tế.

Đường legacy không được sửa hoặc xóa nguồn đã được nhận vào báo cáo mới để vượt khóa kỳ/lịch sử. Áp dụng bảo vệ theo bản ghi đã quản lý, không chỉ theo loại project hay ẩn nút.

## Kiểm chứng bằng dữ liệu cũ

Nguồn Railway đã đọc có 2 dự án PAYPAL_ONLY, 220 PayPal, 13 MIXING, 18 EXCHANGE và 8 CollectorExpense; 4 khoản TEAM_PAYMENT chưa có liên kết vào Withdrawal. Không suy 4 giá trị gốc đó là USDT hoặc tự đánh dấu toàn bộ lượt rút đã về team.

Dùng database sao chép riêng. Giữ nguyên ID, dữ liệu gốc, quan hệ, phí và lịch sử; đối chiếu số lượng và giá trị trước/sau migration. Các TEAM_PAYMENT cũ được đưa vào danh sách xem trước để bổ sung USDT thực nhận và ngày nhận khi xác minh được. Chi phí thiếu tỷ giá giữ nguyên gốc và hiện cần bổ sung. Không ghi dữ liệu kiểm thử hay migration vào Railway trong mốc này.

## Phạm vi triển khai và nghiệm thu

Làm tuần tự: chuẩn hóa chi phí và tỷ giá → phiếu nhận team/đối chiếu collector → báo cáo và khóa kỳ → giao diện, lịch sử, backup và thử dữ liệu sao chép. Sau duyệt thiết kế sẽ viết kế hoạch triển khai cụ thể theo các mốc này.

Kiểm chứng bắt buộc: VND/USDT/đồng khác và chiều tỷ giá; độ chính xác 6 số lẻ; sửa gợi ý không đổi quá khứ; số tiền/miền dữ liệu sai bị chặn; chặn lưu lặp và sửa đè; nhận gộp/nhận một phần; chuyển nội bộ không tăng lợi nhuận; phí đã trừ không bị trừ hai lần; thiếu tỷ giá và nguồn chưa đối soát; khóa kỳ USDT chặn chi phí VND; quyền khác project; nhật ký/hoàn tác tương thích; giữ kỳ cũ; đối chiếu dữ liệu sao chép và thử khôi phục backup vào database riêng. Các quy tắc Genjy và cấp proxy/VM giữ nguyên.
