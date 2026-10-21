# Script AI-OPS: kết quả chưa rõ và key trùng tên file (21/10/2026)

Bản được rà: 05b64cb / 34cda98. Bộ tái hiện độc lập `.runtime/review-ops-client-retry-20261021.test.ts`: trước sửa 2 đỏ / 2 (`repro-before.txt`),
sau sửa 2 xanh / 2 (`repro-after.txt`), kỳ vọng không đổi. Hai ca đó được giữ nguyên trong test chính thức
`src/__tests__/ops-api/ops-client-retry.test.ts` (13 ca; chạy với script cũ: 12 đỏ, chỉ ca đối chứng 4xx xanh). Server giả, token / PIN giả; không quay video.
Chỉ sửa `scripts/ops-client.mjs` (+ test, runbook); không đổi API, nghiệp vụ tiền, quyền hay giao diện.

| # | Trước | Sau | Kiểm chứng |
|---|---|---|---|
| 1 | Server nhận POST rồi trả 502 HTML → script lưu ANSWERED, thoát 1, `pending` trống | Chỉ phản hồi đúng envelope và có nghĩa theo hợp đồng mới chốt: 2xx + `ok:true` → DONE, 4xx + `ok:false` + `error.code` → ANSWERED. 5xx (502 / 503 / 504 / 500), HTML, JSON sai cấu trúc, mảng, 2xx mà `ok:false`, phản hồi đứt → UNKNOWN, giữ key / đường dẫn / nội dung, có trong `pending`, in "Chưa xác định kết quả. Gửi lại bằng retry <key>.", thoát 3 | 8 kiểu phản hồi: server thực hiện lệnh 1 lần rồi trả phản hồi đó; `retry` gửi đúng key + đường dẫn + nội dung, tổng tác động 1, sau đó `pending` trống. 422 đúng hợp đồng → ANSWERED, không pending |
| 2 | `review:collision:1` và `review_collision_1` chung file (`:` → `_`); `retry review:collision:1` gửi `review_collision_1` | File = `k-<sha256(key nguyên bản)>.json` (hex chữ thường: không đụng nhau vì `:` / `_` hay chữ hoa / thường trên Windows); key nguyên bản trong bản ghi, kiểm khớp tuyệt đối và kiểm hash nội dung khi đọc; `retry` gửi đúng key được yêu cầu. File cũ đúng key vẫn dùng được, giữ nguyên; file cũ giữ key khác / bản ghi hỏng / sai cấu trúc → dừng, báo rõ, không gửi, không ghi đè hay xoá. Danh sách key hợp lệ của API giữ nguyên | 5 key `case:mix:0001`, `case_mix_0001`, `Case_Mix_0001`, `CASE_MIX_0001`, `case.mix.0001` → 5 file, mỗi `retry` gửi đúng key + nội dung của nó; cùng key khác nội dung vẫn bị từ chối; nhật ký cũ: đúng key gửi lại được, file cũ không đổi; key va chạm tên cũ, file hỏng, file của key khác → dừng, 0 request |

Kiểm lại: nhóm API / script `src/__tests__/ops-api` (5 file / 36 ca) + bộ tái hiện ba lỗi trước `.runtime/review-ops-api-ack-20261021.test.ts` (3 / 3)
+ bộ tái hiện này (2 / 2) đều xanh. Cả bộ 132 file / 641 test xanh (một lần chạy trước có 1 ca cũ `proxy-retire` đỏ ngẫu nhiên do dải IP thử ngẫu nhiên
203.1.x trùng giữa các test chạy song song; chạy riêng 2 lần và chạy lại cả bộ đều xanh; không liên quan script). Typecheck sạch, lint không lỗi.
