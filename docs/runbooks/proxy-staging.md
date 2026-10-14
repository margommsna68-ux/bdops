# Môi trường thử kho proxy

Chạy trên nhánh `feat/proxy-inventory` trong `bdops-proxy-app/`. Source gốc và snapshot source ở `bdops/` được giữ để đối chiếu.

1. `npm ci --ignore-scripts --legacy-peer-deps`, sau đó `npx prisma generate`.
2. `.env` trỏ vào database ứng dụng thử; `.env.test` có `DATABASE_URL_TEST` trỏ vào database **khác**.
3. Integration tests gọi `assertTestDatabase` trước khi tạo fixtures. So sánh host/port/database, không so mật khẩu.
4. Prisma test CLI chạy qua `npm run db:test -- migrate deploy`, không ghi đè `.env`.
5. Chỉ nhập dữ liệu giả thuộc 192.0.2.0/24, 198.51.100.0/24 trong nghiệm thu.

Baseline `0_init` chỉ áp dụng trực tiếp lên database trống. Database đã có dữ liệu cần backup, diff schema và xác nhận khớp trước `migrate resolve --applied 0_init`. Không seed, reset hoặc push schema tự động.

Railway dùng pre-deploy `npx prisma migrate deploy`, startup `npm start`. Service mới cấu hình trực tiếp tại Settings hoặc Railway IaC; TOML trong source chỉ phục vụ service legacy còn hỗ trợ. Giữ encryption key ổn định và riêng mỗi môi trường. Không đưa credentials vào screenshot/log/Git.
