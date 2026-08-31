# Authorization & Integrity Rollout Runbook

Ngày cập nhật: **2026-08-31**.

## 1. Phạm vi

Runbook này áp dụng cho rollout authorization/integrity Phase 1–7 của backend HRM. Không dùng `reset-demo`, không chạy trực tiếp trên database production trước khi hoàn tất rehearsal trên database mới và bản sao đã khử dữ liệu nhạy cảm.

## 2. Cấu hình bắt buộc trước production

- `NODE_ENV=production`.
- `JWT_SECRET`: secret riêng của môi trường, ít nhất 32 ký tự, không dùng giá trị development mặc định.
- `CORS_ORIGINS`: danh sách origin chính xác, phân cách bằng dấu phẩy; không dùng wildcard.
- `TRUST_PROXY`: để trống/`false` nếu app trực tiếp nhận traffic; đặt số hop hoặc proxy expression chỉ theo topology đã xác minh.
- `ATTACHMENT_MAX_BYTES`: mặc định 5 MiB decoded.
- `AVATAR_MAX_BYTES`: mặc định 2 MiB decoded.
- `JSON_BODY_LIMIT`: mặc định `8mb`; phải lớn hơn payload base64 hợp lệ nhưng không mở rộng tùy tiện.
- `ATTACHMENT_STORAGE_PROVIDER=local`: provider production đầu tiên; mọi route vẫn đi qua `AttachmentStorage` để có thể thay bằng private Cloudflare R2.
- `ATTACHMENT_STORAGE_ROOT`: đường dẫn tuyệt đối trên persistent volume, nằm ngoài web root và không được public trực tiếp.
- `ATTACHMENT_STORAGE_PERSISTENT_VOLUME=true` và `ATTACHMENT_STORAGE_BACKUP_CONFIRMED=true`: xác nhận vận hành bắt buộc. Nếu không có volume và backup đáng tin cậy, dừng rollout local và chuyển sang private R2.
- Rate limit có thể điều chỉnh qua các biến `LOGIN_*`, `FORGOT_PASSWORD_*`, `FACE_VERIFY_*`, `DEVICE_PUNCH_*`; giữ default nếu chưa có số liệu staging.

Startup production phải dừng nếu thiếu JWT secret hợp lệ, CORS allowlist hoặc local attachment storage chưa được xác nhận persistent/backup.

### Phase 8 attachment storage commands

Các command không tự chạy schema migration và mặc định chỉ dry-run:

```bash
npm run attachments:backfill
npm run attachments:cleanup
```

Chỉ mutation khi thêm `-- --apply`; batch size từ 1 đến 500:

```bash
npm run attachments:backfill -- --apply --batch-size=100
npm run attachments:cleanup -- --apply --batch-size=100
```

- Backfill xác minh allowlist, magic bytes, decoded size và checksum trước/sau khi ghi file.
- Lỗi một attachment không xóa `data_url` legacy và command trả exit code khác 0.
- Cleanup retry các object đã được queue sau delete/compensation; error lưu trong DB đã được redaction.
- Không chạy `--apply` trên production trước backup, rehearsal DB copy và xác nhận persistent volume.

## 3. Preflight database

1. Dừng mọi job ghi dữ liệu hoặc chuyển hệ thống sang maintenance/read-only window.
2. Tạo backup database có timestamp và kiểm tra backup mở được bằng SQLite.
3. Chụp snapshot permission matrix và danh sách user có `config.permission.manage` thực tế.
4. Chạy read-only preflight:

```sql
SELECT request_id, level, COUNT(*) AS count
FROM request_approvals
GROUP BY request_id, level
HAVING COUNT(*) > 1;

SELECT period, employee_id, COUNT(*) AS count
FROM payslips
GROUP BY period, employee_id
HAVING COUNT(*) > 1;

PRAGMA foreign_key_check;
PRAGMA integrity_check;
```

Nếu có duplicate/orphan hoặc integrity check không trả `ok`, dừng rollout. Không tự xóa hay chọn bản ghi thắng.

## 4. Rehearsal migration

Chạy hai lần ngoài production:

1. Database mới hoàn toàn: `initSchema()` rồi `runMigrations()`; lần chạy thứ hai phải không apply thêm migration.
2. Bản sao database schema cũ/có dữ liệu mẫu: chạy preflight, migration, kiểm tra row counts và nghiệp vụ smoke test.

Kiểm tra sau migration:

- `schema_migrations` có đủ version và checksum ổn định LF/CRLF.
- Unique `(request_id, level)` hoạt động.
- Attachment cũ vẫn đọc được; cột uploader/checksum của dữ liệu cũ được phép `NULL`.
- Upload mới có uploader, checksum SHA-256 và kích thước derived từ decoded content.
- Migration version 5 chỉ thêm storage metadata và cleanup queue; không tự copy hoặc xóa payload legacy.
- Backfill dry-run phải báo không lỗi trước khi chạy apply; sau apply phải xác minh file size/checksum và download authorization.
- Unique payslip vẫn hoạt động.

## 5. Trình tự rollout

1. Backup và lưu permission snapshot.
2. Deploy schema-compatible application build.
3. Chạy migration một lần bằng process được kiểm soát.
4. Khởi động app với cấu hình production đã validate.
5. Smoke test theo thứ tự:
   - login, `/auth/me`, disabled user;
   - permission matrix read và một deny test;
   - request owner/approver/outsider;
   - attachment upload/download/delete;
   - attendance self/proxy/device;
   - organization scoped/global;
   - timesheet/payroll/report;
   - chatbot REST parity.
6. Theo dõi `401/403/404/409/413/429/5xx`, migration error và audit log trong ít nhất một business cycle phù hợp.

## 6. Rollback và forward-fix

- Không dùng destructive reset làm rollback.
- Nếu app lỗi nhưng schema mới vẫn backward-compatible: rollback application build, giữ schema, mở issue forward-fix.
- Nếu migration dừng ở preflight: không có version mới được ghi; sửa dữ liệu bằng quy trình được duyệt rồi chạy lại.
- Nếu migration đã commit và cần phục hồi dữ liệu: dừng app, lưu database lỗi để điều tra, restore backup đã xác minh, sau đó rollback app.
- Không sửa checksum migration đã apply. Mọi thay đổi tiếp theo là migration version mới.
- Khôi phục permission matrix từ snapshot chỉ khi xác nhận rollout đã thay đổi ngoài dự kiến; luôn giữ ít nhất một account active có quyền `config.permission.manage` thực tế.

## 7. Ngưỡng dừng rollout

Dừng hoặc rollback khi có một trong các điều kiện:

- Migration checksum mismatch, duplicate preflight hoặc `foreign_key_check` lỗi.
- Không còn active permission manager thực tế.
- Tăng bất thường `401/403/404` cho actor hợp lệ.
- Có attachment checksum mismatch hoặc download trả sai MIME/content.
- Có double side effect ở approve/confirm/transfer.
- Tỷ lệ `5xx` vượt ngưỡng vận hành đã thống nhất.

## 8. Các policy chưa được tự động hóa

- Password change chưa tự vô hiệu hóa mọi token cũ cho đến khi chốt session-version contract.
- Audit/face/chat retention chưa tự xóa dữ liệu vì chưa có retention policy được duyệt.
- Attachment vẫn dùng SQLite data URL trong expand-contract phase; chuyển file/object storage là rollout riêng.
