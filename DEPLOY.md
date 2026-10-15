# Triển khai hiện hành

Đọc docs/runbooks/railway-trial.md và BAT_DAU_O_DAY.md.

Bản mới: environment proxy-trial-20261015, web bdops-proxy-trial, Postgres riêng. Bản production cũ giữ nguyên. Mọi lệnh Railway phải ghi rõ project/environment/service mới.

Build bằng Dockerfile, pre-deploy npx prisma migrate deploy, start npm start. Không dùng db push --accept-data-loss, reset hoặc seed khi deploy. Không upload .env, .runtime, khóa, dữ liệu raw hoặc backup. Giữ khóa mã hóa và backup riêng; restore chỉ vào database mới trống trước khi đối chiếu.
