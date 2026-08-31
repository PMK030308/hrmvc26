# Phase 10 - Production Rollout Checkpoint

Ngày checkpoint: **2026-08-31**.

## Mục tiêu

Chuẩn bị cấu hình và công cụ fail-closed để đưa Phase 1-9 lên production mà không tự deploy, không tự chạy migration trên production và không chấp nhận storage/backup giả định.

## Phạm vi đã tự động hóa

- Frontend production build bắt buộc có exact HTTPS `VITE_API_URL` kết thúc bằng `/api`.
- Backend production bắt buộc có persistent SQLite path, xác nhận backup/restore, exact CORS, topology proxy, attachment storage, password-reset delivery và retention scheduler.
- Production DB trống không được tự seed tài khoản/demo data.
- Password reset delivery đi qua HTTPS webhook có bearer secret; token không được log hoặc trả trong production response.
- Retention scheduler chạy bounded batch sau initial delay, không cleanup ngay khi startup và dùng lease hiện có.
- Health endpoint kiểm tra kết nối DB và schema version.
- `production:preflight` chỉ đọc config/DB/storage, kiểm tra checksum migration, pending migration, integrity, foreign keys và row nền tảng.
- Render Blueprint dùng một paid service có persistent disk, một instance và tắt auto-deploy.

## Điều kiện vẫn cần người vận hành xác nhận

1. Domain frontend/backend thật.
2. Webhook gửi email reset password và bearer secret thật.
3. Backup SQLite/attachment độc lập với service, restore rehearsal thành công; chỉ sau đó đặt các biến `*_BACKUP_CONFIRMED=true`.
4. Database production đã có dữ liệu/bootstrap hợp lệ; không dùng demo seed.
5. Migration v6 được chạy trong maintenance window đã phê duyệt.
6. Smoke test và ngưỡng rollback được theo dõi sau deploy.

## Trình tự rollout đề xuất

1. Tạo backup app-consistent và thử restore vào môi trường tạm.
2. Chạy full test/build/lint từ đúng commit.
3. Cấu hình toàn bộ env secret/sync-false trên Render và `VITE_API_URL` trên Vercel.
4. Chạy rehearsal migration trên bản sao DB mới nhất.
5. Tắt ghi hoặc mở maintenance window.
6. Chạy migration production bằng quy trình được kiểm soát.
7. Chạy `npm run production:preflight` trên service có persistent disk.
8. Deploy backend, kiểm tra `/api/health`, login, refresh, password reset, attachment và retention dry-run.
9. Deploy frontend và kiểm tra CORS từ exact origin.
10. Theo dõi `401/403/404/409/413/429/5xx`, disk usage và cleanup audit; rollback app nếu vượt ngưỡng.

## Ngưỡng dừng

- Không có persistent volume hoặc backup/restore chưa được chứng minh.
- `production:preflight` có pending/checksum mismatch/integrity/foreign-key error.
- Production DB trống hoặc chỉ chứa demo seed.
- Webhook reset password không xác thực HTTPS/bearer hoặc gửi thất bại.
- Domain/topology chưa chốt nên chưa thể đặt exact CORS và trust proxy.
- Attachment download/checksum hoặc session invalidation smoke test thất bại.

## Cố ý không làm tự động

- Không push, deploy, đổi DNS, tạo Render/Vercel project hoặc điền secret thay người vận hành.
- Không chạy migration/backfill/retention apply trên production.
- Không đặt `DATABASE_BACKUP_CONFIRMED` hay `ATTACHMENT_STORAGE_BACKUP_CONFIRMED` thành true khi chưa có bằng chứng restore.
- Không tự chọn nhà cung cấp email hoặc domain production.
