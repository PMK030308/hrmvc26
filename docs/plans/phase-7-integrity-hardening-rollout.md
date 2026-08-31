# Phase 7 - Integrity, Hardening & Rollout

Ngày lập kế hoạch: **2026-08-29**.

## 1. Mục tiêu và phạm vi

Khóa các khoảng trống integrity/operational security còn lại sau khi mọi module đã migrate authorization, đồng thời chuẩn bị rollout/rollback có kiểm chứng.

Phạm vi:

- Database constraints và migration discipline.
- Request approval uniqueness và attachment metadata còn hoãn từ Phase 1.
- File/base64/input limits và validation chung.
- Idempotency/concurrency regression.
- Security logging/audit coverage.
- End-to-end authorization regression và deployment runbook.

## 2. Hiện trạng và technical debt đã xác minh

- Schema cũ được tạo/alter trực tiếp trong `db.ts`; migration ledger mới phải được tạo từ Phase 2 trước mọi schema change mới.
- `request_approvals` chưa có unique `(request_id, level)`.
- Attachment chưa lưu uploader; data URL nằm trong SQLite và app JSON limit là 12 MB.
- Một số mutation không có version/idempotency key riêng.
- Device key có insecure development fallback.
- Nhiều input query/body dùng `Number/String` trực tiếp, chưa có schema validation thống nhất.
- Chưa có full E2E authorization suite theo role/scope/module.
- JWT/device secrets có development fallback; CORS đang mở; login/forgot-password/face/device chưa có abuse limits.
- Server tin `X-Forwarded-For` trực tiếp nhưng chưa có `trust proxy` policy.
- Password change chưa có quyết định invalidation cho token/session cũ.

## 3. Thiết kế migration/integrity

### Migration discipline

- Dùng migration harness đã tạo ở Phase 2.
- Migration forward-only; rollback bằng migration mới hoặc documented restore.
- Test trên SQLite tạm và bản copy dữ liệu, không chạy trực tiếp production trong phase code.

### Constraint dự kiến

- Unique `request_approvals(request_id, level)` sau khi audit duplicate.
- Unique `payslips(period, employee_id)` nếu Phase 5 xác nhận.
- Index cho permission/scope/query paths.
- Foreign-key/index bổ sung chỉ sau khi kiểm tra dữ liệu hiện hữu.

### Attachment hardening

- Quyết định thêm `uploaded_by_user_id`, checksum và storage strategy.
- Validate filename, MIME allowlist, decoded size và data URL format.
- Download endpoint trả đúng content headers và authorization.
- Không increment request version nếu giữ quyết định Phase 1.

## 4. File/module dự kiến thay đổi

- `server/src/migrations/*`
- `server/src/services/migrationService.ts`
- `server/src/db.ts`, `server/src/index.ts`
- `server/src/services/attachmentService.ts`
- `server/src/routes/requests.ts`
- Input validation schemas cho routes đã migrate.
- `server/src/*authorization*.integration.test.ts`
- Frontend attachment API/widget nếu download contract đổi.
- `docs/runbooks/authorization-rollout.md`

## 5. Các bước triển khai

### Step 7.1 - Schema/data audit và migration preflight

- Re-run harness tests fresh/existing DB, repeat apply, checksum mismatch và failure rollback.
- Inventory duplicate/orphan/null data trước constraint.
- Phụ thuộc: Phase 1–6 schema đã ổn định.

### Step 7.2 - Additive migrations và integrity constraints

- Thêm migration ledger và constraints đã xác minh.
- Có preflight report/cleanup plan, không tự xóa dữ liệu mơ hồ.
- Test database copy/tạm.
- Phụ thuộc: Step 7.1.

### Step 7.3 - Attachment service hardening

- Authorization parent, validation, checksum/uploader nếu được chốt, download/delete atomic.
- Test outsider/current approver/owner/uploader/oversize/MIME mismatch.
- Phụ thuộc: business decision uploader + Step 7.2 nếu đổi schema.

### Step 7.4 - Validation và request-size boundaries

- Schema validation cho route nhạy cảm, page/date/period limits.
- Limit riêng avatar/attachment/chat history thay vì một global 12 MB mặc định.
- Error `400/413` không lộ internals.
- Phụ thuộc: domain routes hoàn tất.

### Step 7.5 - Authentication/session/security baseline liên quan rollout

- Production startup fail nếu JWT/device secret thiếu hoặc còn default.
- CORS allowlist theo environment; xác định `trust proxy` và client IP policy.
- Abuse limits cho login, forgot-password, face attempt/verify và device endpoint.
- Chốt token invalidation sau password change và secret rotation window.
- Test startup config, CORS origin, rate boundary, spoofed forwarded IP và old token sau password change.
- Phụ thuộc: deployment environment decisions.

### Step 7.6 - Cross-module concurrency/idempotency suite

- Hai approve/transfer/confirm/revoke/assign đồng thời.
- Retry cùng payload và stale version.
- Audit/notification/side effect chỉ một lần.
- Phụ thuộc: Phase 1–6.

### Step 7.7 - Full authorization E2E matrix

- Role × scope × resource relation × action × status code.
- REST và chatbot parity.
- Frontend hidden controls chỉ là UX; direct HTTP vẫn bị backend chặn.
- Phụ thuộc: tất cả phase.

### Step 7.8 - Rollout/rollback runbook

- Backup DB, migration preflight, matrix snapshot, smoke tests, deny monitoring.
- Rollout module-by-module; kill switch nơi cần.
- Version compatibility matrix: app cũ/schema mới, expand-contract window, backup restore threshold và forward-fix owner.
- Rollback application version và forward-fix migration procedure.
- Phụ thuộc: Step 7.1–7.7.

## 6. Test matrix tối thiểu

- Fresh DB và DB hiện hữu qua mọi migration.
- Duplicate approval/payslip hiện hữu.
- Attachment oversized, MIME/extension mismatch, malformed base64, outsider download/delete.
- Stale version và hai mutation đồng thời ở mọi workflow quan trọng.
- User role/scope thay đổi khi JWT còn hạn.
- User disabled/deleted.
- Permission matrix revoke/restore và restart server.
- REST/chatbot cùng actor/action cho kết quả quyền giống nhau.
- Audit actor/target/action/status nhưng không chứa secret/biometric/payroll payload.
- Production default-secret rejection, CORS allowlist, rate limits và forwarded-IP spoofing.
- Password change/session invalidation theo contract đã chốt.

## 7. Tiêu chí hoàn thành

- Có migration ledger và runbook, không còn schema evolution ad hoc cho thay đổi mới.
- Constraint/idempotency quan trọng được database hỗ trợ.
- File/input boundaries có validation và test.
- Full authorization regression pass.
- Có rollback procedure đã diễn tập trên DB tạm/copy.
- Authentication/security baseline trực tiếp liên quan authorization rollout đã được cấu hình fail-safe.

## 8. Rủi ro và rollback

- Constraint fail trên dữ liệu bẩn: preflight dừng migration và xuất report; không tự xóa.
- Attachment schema/storage thay đổi: expand-contract, đọc được cả old/new trong giai đoạn chuyển tiếp.
- Permission rollout khóa user hợp lệ: snapshot matrix và per-module rollback.
- Không dùng destructive reset làm rollback.

## 9. Câu hỏi cần xác nhận

- Có thêm `uploaded_by_user_id` trong Phase 7 không?
- Attachment tiếp tục SQLite data URL hay chuyển object/file storage?
- Mức giới hạn avatar/attachment/chat history cụ thể?
- Thời gian lưu audit/face attempt/chat metadata?
- Có môi trường staging/DB copy để diễn tập migration không?
- Password change có vô hiệu hóa mọi token cũ không; dùng token version hay cơ chế nào?
- CORS origins, trusted proxies và rate limit cụ thể theo môi trường?

## 10. Không làm

- Không đổi công thức payroll/attendance.
- Không thêm realtime.
- Không thay UI lớn.
- Không triển khai production hoặc tự chạy migration production.

## 11. Verification commands

- Backend/frontend full build và toàn bộ tests.
- Migration rehearsal trên fresh DB + sanitized DB copy.
- Authorization E2E matrix, REST/chatbot parity, concurrency suite.
- Startup/CORS/rate/session smoke tests và `git diff --check`.

## 12. Plan mutation log

- 2026-08-29: migration harness chuyển lên Phase 2; bổ sung default-secret, CORS, abuse limit, trust-proxy, session invalidation và rollback compatibility matrix sau adversarial review.
- 2026-08-31: xác nhận attachment 5 MiB/file, avatar 2 MiB, kiểm tra kích thước binary sau decode và xác minh MIME bằng magic bytes. Phase 7 giữ storage data URL chỉ cho development/test để bảo toàn expand-contract; production storage được tách sang Phase 8.
- 2026-08-31: xác nhận password change/reset phải vô hiệu hóa toàn bộ access/refresh token bằng `users.session_version`; reset token dùng một lần, hạn ngắn và chỉ lưu hash. Hạng mục này cùng retention cleanup được chuyển sang Phase 9 để không trộn với migration attachment.
- 2026-08-31: xác nhận CORS dùng exact HTTPS origins theo môi trường; `TRUST_PROXY=false` khi Node nhận trực tiếp, bằng `1` khi có đúng một reverse proxy do hệ thống kiểm soát và proxy phải ghi đè `X-Forwarded-For`.

## 13. Policy đã chốt và phần việc chuyển tiếp

Phase 7 hoàn thành phần hardening an toàn có thể triển khai độc lập: migration constraint, attachment validation/checksum/uploader, download authorization, request/avatar size boundary, production startup validation, exact-origin CORS, trust-proxy policy và abuse limits.

Các quyết định sau đã được chốt nhưng cố ý không nhồi thêm vào checkpoint Phase 7:

- Production không lưu attachment data URL trong SQLite. Phase 8 triển khai `AttachmentStorage`, local filesystem/object storage và migration dữ liệu cũ theo expand-contract.
- Password change/reset tăng `users.session_version` trong transaction; JWT cũ nhận `401`. Phase 9 triển khai cùng reset-token hash/one-time/short-TTL.
- Retention cleanup chạy theo lịch, theo batch, có dry-run và audit; tuyệt đối không xóa hàng loạt khi startup. Phase 9 triển khai policy retention đã xác nhận.
- Giá trị `CORS_ORIGINS` và `TRUST_PROXY` cụ thể chỉ được điền khi có domain và sơ đồ Nginx/Cloudflare/VPS thực tế; policy fail-safe đã được xác nhận.
