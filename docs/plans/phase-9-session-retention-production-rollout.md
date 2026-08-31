# Phase 9 - Session Invalidation, Retention & Production Rollout

Ngày lập kế hoạch: **2026-08-31**.

## 1. Mục tiêu và phạm vi

Hoàn thiện authentication lifecycle và data-retention trước production rollout sau khi Phase 8 đã chuyển attachment sang storage bền vững.

Phạm vi:

- `users.session_version` và DB-fresh token invalidation.
- Password change/reset làm logout toàn bộ thiết bị.
- Reset token một lần, TTL ngắn và chỉ lưu hash.
- Scheduled retention cleanup theo batch, có dry-run và audit.
- Production CORS/trust-proxy/secrets/storage configuration smoke test.
- Final migration/deployment/rollback rehearsal.

## 2. Session/token policy đã chốt

- JWT access và refresh token chứa `session_version` tại thời điểm phát hành.
- Mọi protected request so sánh claim với `users.session_version` DB-fresh.
- Token thiếu/sai/stale version trả `401`.
- Đổi hoặc reset mật khẩu tăng `session_version` trong cùng transaction với password hash mutation.
- Mặc định đăng xuất toàn bộ thiết bị; giữ phiên hiện tại là tính năng sau.
- Không tái sử dụng `authz_version`; hai version có mục đích độc lập.
- Reset token: random entropy đủ mạnh, chỉ lưu hash, TTL ngắn, one-time consume atomic và không log token.

## 3. Retention policy đã chốt

| Dữ liệu | Thời gian lưu |
|---|---:|
| Audit authorization, payroll, employee mutation | 2 năm |
| Audit security/login thông thường | 1 năm |
| Face-attempt metadata | 90 ngày |
| Ảnh/capture khuôn mặt của attempt | 7 ngày |
| Chatbot conversation/tool metadata | 90 ngày |
| Chatbot tool action làm thay đổi nghiệp vụ | 2 năm trong audit log độc lập |

Quy tắc:

- Không lưu raw face image lâu hơn cần thiết.
- Không ghi JWT, password, reset token, secret, API key hoặc attachment data vào audit.
- Xóa metadata chatbot không được làm mất audit của hành động tạo/sửa/duyệt nghiệp vụ.
- Cleanup chạy scheduled, bounded batch, có dry-run/report/audit; không bulk-delete khi startup.

## 4. Thiết kế session version và reset token

Schema additive dự kiến:

- `users.session_version INTEGER NOT NULL DEFAULT 1`.
- Bảng reset-token riêng: id, user_id, token_hash, expires_at, consumed_at, created_at và metadata tối thiểu cần cho security audit.

Luồng password change/reset:

1. Xác thực actor hoặc reset token hợp lệ.
2. Transaction load user DB-fresh.
3. Cập nhật password hash.
4. Tăng `session_version` atomically.
5. Với reset token: đánh dấu `consumed_at` bằng conditional update trong cùng transaction.
6. Ghi audit không chứa secret/token/password.

Refresh endpoint phải kiểm tra session version giống access token; refresh token cũ không được phát hành access token mới.

## 5. Thiết kế retention cleanup

- Job/command riêng, không chạy implicit khi app startup.
- `--dry-run` mặc định an toàn cho thao tác thủ công đầu tiên.
- Batch size và cutoff time cấu hình; transaction ngắn.
- Mỗi category có selector và delete/anonymize strategy riêng.
- Audit job gồm category, cutoff, scanned/deleted/skipped/error counts; không chứa payload nhạy cảm.
- Có lock/lease để tránh hai scheduler cleanup cùng category đồng thời.
- Face capture có TTL 7 ngày độc lập với face-attempt metadata 90 ngày.

## 6. Danh sách file dự kiến thay đổi

- `server/src/migrations/index.ts`
- `server/src/middleware/auth.ts`
- `server/src/routes/auth.ts`
- Token/session/reset-token services mới hoặc hiện có.
- `server/src/services/retentionService.ts`
- Scheduled job/CLI entrypoint và lock service.
- Audit service/category mapping.
- Integration/unit tests liên quan.
- `docs/runbooks/authorization-rollout.md`
- Deployment environment documentation.

Không sửa `attendance-web/src/components/chatbot/ChatbotWidget.tsx` trừ khi người dùng giao riêng.

## 7. Các bước triển khai theo TDD

### Step 9.1 - Session schema và JWT claim

- File/module: migration, auth middleware/token service.
- Thay đổi: thêm `session_version`, ký claim và so sánh DB-fresh.
- Test: token current/stale/missing version, disabled user, authz version thay đổi độc lập.
- Hoàn thành: token cũ/stale nhận 401 và token hợp lệ không phụ thuộc role claim.
- Phụ thuộc: migration harness hiện có.

### Step 9.2 - Password change invalidation

- File/module: auth route/service.
- Thay đổi: password hash + increment session version trong transaction.
- Test: success, wrong current password, transaction rollback, access/refresh token cũ, hai đổi mật khẩu đồng thời.
- Hoàn thành: không có trạng thái password mới nhưng session version cũ hoặc ngược lại.
- Phụ thuộc: Step 9.1.

### Step 9.3 - One-time reset token

- File/module: reset token service/routes/schema.
- Thay đổi: random token, hash-at-rest, short TTL, conditional consume.
- Test: valid, expired, replay, concurrent consume, DB leak không dùng được token, session invalidation.
- Hoàn thành: chỉ một request có thể consume token và token plaintext không lưu/log.
- Phụ thuộc: Step 9.1-9.2.

### Step 9.4 - Retention selectors và dry-run

- File/module: retention service/tests.
- Thay đổi: category-specific cutoff và dry-run counts.
- Test: boundary timestamp, category classification, business-action audit preserved, raw face capture 7 ngày.
- Hoàn thành: dry-run không mutation và report xác định được tập sẽ xử lý.
- Phụ thuộc: audit/chat/face schema inventory.

### Step 9.5 - Scheduled bounded cleanup

- File/module: scheduler/CLI, lock, audit.
- Thay đổi: batch delete/anonymize, retry và lease.
- Test: batch boundary, crash/restart, concurrent worker, partial failure, audit redaction.
- Hoàn thành: không startup bulk delete; job có thể resume và không xóa vượt cutoff/category.
- Phụ thuộc: Step 9.4.

### Step 9.6 - Production configuration checkpoint

- File/module: config/runbook.
- Thay đổi: exact `CORS_ORIGINS`, `TRUST_PROXY`, JWT/storage credentials theo topology thực tế.
- Test: direct Node, one controlled proxy, spoofed forwarded header, staging/prod origin separation.
- Hoàn thành: config được chốt từ domain và sơ đồ deploy, không wildcard/suffix matching.
- Phụ thuộc: người dùng cung cấp deployment topology.

### Step 9.7 - Final rollout rehearsal

- File/module: runbook/migration scripts/smoke suite.
- Thay đổi: backup, migration, storage, session, retention dry-run và rollback sequence.
- Test: fresh DB, sanitized DB copy, repeat migration, old token rejection, attachment download, cleanup dry-run.
- Hoàn thành: có báo cáo checkpoint và explicit approval trước production deploy.
- Phụ thuộc: Phase 8 và Step 9.1-9.6.

## 8. Test matrix

- Access/refresh token với current, stale, missing hoặc malformed `session_version`.
- `authz_version` tăng không vô hiệu session; `session_version` tăng luôn vô hiệu session.
- Password change thành công/thất bại/rollback/concurrent.
- Reset token valid, expired, replay và hai request consume đồng thời.
- Reset-token DB chỉ chứa hash; audit/log không chứa token.
- Retention đúng ngay trước/đúng/sau cutoff cho từng category.
- Face metadata 90 ngày nhưng capture 7 ngày.
- Chat metadata bị xóa nhưng business audit 2 năm còn nguyên.
- Cleanup dry-run không thay đổi row; batch thật có giới hạn và audit counts.
- Hai cleanup worker cùng category.
- Direct backend với `TRUST_PROXY=false`; một proxy với value `1`; spoofed XFF bị vô hiệu.
- Staging origin không tự được phép trong production và ngược lại.

## 9. Tiêu chí hoàn thành

- Mọi protected request thực thi session version DB-fresh.
- Password change/reset vô hiệu hóa toàn bộ access/refresh token cũ.
- Reset token hashed, one-time, short-lived và race-safe.
- Retention job có dry-run, batch, lock, audit và không chạy bulk-delete khi startup.
- Policy retention được test ở boundary.
- Production config được chốt theo topology thực tế.
- Full test/build/lint và migration/deployment rehearsal đạt trước production approval.

## 10. Rủi ro và rollback

- Token toàn hệ thống bị logout khi deploy claim mới: dùng compatibility window có thời hạn rõ hoặc maintenance logout có thông báo; không chấp nhận token không version vô thời hạn.
- Reset-token race: conditional consume trong transaction và unique/hash index.
- Cleanup xóa nhầm: dry-run, backup, bounded batch, category-specific query và rollout từng category.
- Sai trust proxy: smoke test từ direct path và proxy path; backend direct access phải bị firewall nếu bật proxy trust.
- Rollback app: schema additive; không giảm `session_version`; token cũ vẫn phải bị vô hiệu.

## 11. Câu hỏi cần chốt trước implementation/deploy

- Access token và refresh token hiện tại có endpoint/lifetime cụ thể nào cần giữ compatibility?
- TTL reset token mong muốn; mặc định đề xuất 15 phút.
- Scheduler production dùng cron/systemd, container scheduler hay job service nào?
- Với audit hết retention: hard delete hay archive sang cold storage trước?
- Domain frontend/backend và sơ đồ Nginx/Cloudflare/VPS thực tế.

## 12. Cố ý không làm

- Không thêm chức năng giữ lại phiên hiện tại sau đổi mật khẩu.
- Không thêm MFA/SSO/SCIM.
- Không tự deploy hoặc chạy migration production.
- Không thay đổi công thức attendance/payroll.
- Không dùng startup hook để bulk cleanup retention.
