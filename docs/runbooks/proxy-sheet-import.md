# Nguồn Sheet và đối chiếu

Genjy sử dụng `GENJY_SOURCE_JSON` cấu hình server, không đưa credentials ra browser:

```json
{"key":"GENJY","spreadsheetId":"<id đã chia sẻ>","credentialRef":"GOOGLE_SHEETS","mode":"GOOGLE_AUTH"}
```

Chia sẻ workbook cho service account; đặt `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON` trong secret của host. Hoặc dùng OAuth với `GOOGLE_SHEETS_CLIENT_ID`, `GOOGLE_SHEETS_CLIENT_SECRET`, `GOOGLE_SHEETS_REFRESH_TOKEN`, đã cấp scope `spreadsheets.readonly`. Token truy cập trực tiếp chỉ dùng khi phiên còn hiệu lực. [Google Sheets](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get), [service account](https://developers.google.com/identity/protocols/oauth2/service-account).

Quét không giới hạn ranges; đọc mọi tab, kể cả hidden, giá trị/formula/note và vị trí ô. IP trong nguồn Genjy giữ sở hữu vĩnh viễn. PC là PC_CHUNG. Lỗi nguồn giữ các reservation cũ, không giải phóng IP. Lịch sử full credentials hoặc manual metadata ngăn ngoại lệ hoàn thiện bare Genjy.

Trong bản thử, `LOCAL_SNAPSHOT` nhận workbook JSON đã cung cấp: `{spreadsheetId,tabs:[{id,name,hidden,cells:[{a1,row,column,value,note,formula}]}]}`. Phải chỉ rõ nguồn local khi nghiệm thu; không gọi bản lưu cũ là dữ liệu site đang dùng. Production chuyển sang nguồn Google có quyền trước khi nhập thật.

Đối chiếu tổng hợp dùng `SheetSnapshot` với rows đã phân loại CURRENT_INVENTORY/LOOKUP_HISTORY/VM/GENJY_REFERENCE/OWNER_DECISION và valueState BLANK/FORMULA/PLACEHOLDER/UNRESOLVED/FULL. Lấy vị trí VM từ cột proxy thực tế, không suy từ note lân cận. Lịch sử không tạo stock hiện hành; ngày cũ không rõ giữ null.

`npx tsx scripts/proxy-import/inspect-snapshot.ts input.json report.json` chỉ đọc và ghi báo cáo đã bỏ credentials; không kết nối database. Lưu snapshot đã duyệt trên server, preview đợt SHEET rồi commit các dòng READY. Không tải các IP ví dụ trong hội thoại vào hệ thống thật.

Railway hiện dùng thiết lập service/pre-deploy hoặc Railway IaC cho service mới. `railway.toml` chỉ dành cho service legacy trong thời gian còn hỗ trợ; [trạng thái Config as Code](https://docs.railway.com/infrastructure-as-code#iac-vs-config-as-code). Đặt pre-deploy `npx prisma migrate deploy` tại service; đừng chỉ dựa vào TOML khi tạo service mới.
