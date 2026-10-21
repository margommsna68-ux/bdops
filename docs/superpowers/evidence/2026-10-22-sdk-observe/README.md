# AI ghi nhận SDK đang chạy + tiền tích luỹ (yêu cầu chủ dự án 22/10/2026)

Dữ liệu thử, DB thử / bản thử local; không dùng VM hay mã SDK thật, chưa nhập bảng 31 VM của vt-01. Không quay video.

| Ca | Kết quả | Nơi kiểm |
|---|---|---|
| VM chưa có EarnApp vẫn ghi được mã + tiền (mã mới = Chưa xác nhận) | đạt | test 1, local C3–C5 |
| Sai lượt / revision / VM | 409 CYCLE_CHANGED / REVISION_CONFLICT / 404, không ghi | test 3 |
| Mã ở VM khác (cả lệnh bị từ chối, không chuyển) | 409 DUPLICATE | test 3, test 4, local C8 |
| SDK Đã dùng / Chưa xác nhận giữ nguyên dấu | đạt | test 4 |
| Kết quả cũ đến muộn | OLDER, giữ số mới | test 2, local C7 |
| Mất phản hồi rồi gửi lại cùng key | replay, xác nhận như lần đầu, không ghi thêm | test 1, local C6 |
| Thiếu quyền (tiền không có SDK_AMOUNT, không VM_OPS, token thu hồi, mất quyền trong giao dịch) | 403 / 401, không ghi | test 5, test 6 |
| Không đọc được ≠ 0; hai file cùng mã = một SDK; hai số cho một mã → 422 | đạt | test 1–2, ops-client-sdk.test.ts |
| Không phát sinh quỹ / chi phí / số dư EarnApp / yêu cầu rút / tài khoản EarnApp | đạt | test 1, test 3, local C10 |
| Ô SDK hiện tiền + giờ kiểm tra của mã hiện hành; cột Tiền / Rút không đổi nghĩa | đạt | local-browser.txt, sdk-cell.png |

Test: `src/__tests__/ops-api/ops-sdk-observe.integration.test.ts` (7), `ops-client-sdk.test.ts` (2); cả bộ 709/709.
