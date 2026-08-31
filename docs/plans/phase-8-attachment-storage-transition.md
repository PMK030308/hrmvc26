# Phase 8 - Attachment Storage Transition

Ngày lập kế hoạch: **2026-08-31**.

## 1. Mục tiêu và phạm vi

Loại bỏ data URL attachment khỏi SQLite trong production, giữ toàn bộ kiểm tra authorization của request attachment và chuyển sang storage bền vững qua abstraction dùng chung.

Phạm vi:

- Tạo `AttachmentStorage` interface không phụ thuộc provider.
- Local filesystem adapter cho development/self-hosted và object-storage adapter theo cấu hình production.
- Database chỉ lưu storage key và metadata đã xác minh.
- Download luôn đi qua backend authorization hoặc signed URL sống ngắn được cấp sau authorization DB-fresh.
- Expand-contract migration cho attachment cũ; kiểm tra checksum trước khi bỏ payload cũ.
- Rehearsal trên fresh DB và bản copy DB cũ; không chạy production migration trong phase code.

Không thay đổi policy ai được upload/download/delete; Phase 8 tái sử dụng authorization layer hiện có.

## 2. Policy đã chốt

- Production không dùng data URL trong SQLite.
- Development/test có thể dùng in-memory hoặc local adapter; legacy data URL chỉ tồn tại trong cửa sổ chuyển tiếp.
- Metadata DB gồm: storage key, original filename, MIME đã xác minh, binary size, SHA-256 checksum, uploader và timestamps.
- Không lưu public URL cố định.
- Attachment tối đa 5 MiB theo binary đã decode.
- Request-body limit phải chừa ít nhất khoảng 33% overhead Base64 cộng JSON envelope; không dùng giới hạn body thay cho decoded-size validation.
- MIME được xác minh bằng magic bytes, không tin filename hoặc `Content-Type`.
- Nội dung có rủi ro phải bị từ chối hoặc luôn tải với `Content-Disposition: attachment` và `nosniff`.
- Không xóa payload legacy nếu copy/checksum/finalize thất bại.

## 3. Thiết kế `AttachmentStorage`

Interface dự kiến:

```ts
interface AttachmentStorage {
  put(input: { key: string; bytes: Buffer; contentType: string; checksumSha256: string }): Promise<void>
  get(key: string): Promise<{ stream: NodeJS.ReadableStream; size: number; contentType?: string }>
  head(key: string): Promise<{ exists: boolean; size?: number; checksumSha256?: string }>
  delete(key: string): Promise<void>
}
```

Yêu cầu:

- Storage key do backend sinh, không lấy trực tiếp từ filename/user input.
- Key tách theo environment/tenant nếu sau này có multi-tenant; phase này không tự thêm tenant model.
- Adapter không log bytes, credential, signed URL hoặc attachment payload.
- Local adapter chống path traversal bằng resolved-path containment check và ghi file atomic qua temporary file + rename.
- Object adapter dùng private bucket/container, credential lấy từ secret manager/environment và không hard-code.
- Delete phải idempotent; lỗi storage và lỗi DB được audit mà không để DB trỏ tới object chưa hoàn tất ngoài trạng thái đã định nghĩa.

## 4. Schema và expand-contract migration

Các cột additive dự kiến cho `request_attachments`:

- `storage_provider` nullable trong cửa sổ chuyển tiếp.
- `storage_key` nullable trong cửa sổ chuyển tiếp.
- `storage_migrated_at` nullable.
- Giữ `data_url`/payload legacy cho tới khi finalize migration thành công.

Luồng migration:

1. Additive schema migration, app mới đọc được cả legacy và storage-backed row.
2. Batch migrator chọn row chưa có `storage_key`, decode và xác minh MIME/size/checksum.
3. Ghi object bằng deterministic migration key hoặc idempotency strategy.
4. `head/get` object, kiểm tra size và SHA-256 khớp DB/payload.
5. Transaction cập nhật provider/key/migrated timestamp, không xóa payload trong cùng release đầu tiên.
6. Sau thời gian quan sát và backup xác nhận, migration finalize mới null/drop payload legacy.

Nếu bất kỳ bước nào lỗi, row legacy phải còn đọc được và batch tiếp theo có thể retry an toàn.

## 5. Download/upload/delete contract

- Upload: authorize parent request trước, validate binary, ghi storage, rồi transaction ghi metadata; nếu DB thất bại thì cleanup object theo retry queue/compensation có audit.
- Download: load metadata + authorize DB-fresh; outsider nhận hidden `404`; sau đó stream backend hoặc cấp signed URL TTL ngắn.
- Delete: authorize và đánh dấu/xóa metadata trong transaction phù hợp; object deletion idempotent, có retry nếu provider tạm lỗi.
- Không cho client truyền storage key hoặc provider.
- Filename response được sanitize; MIME thực tế quyết định header, không dùng MIME client khai báo.

## 6. Danh sách file dự kiến thay đổi

- `server/src/services/attachmentStorage.ts`
- `server/src/services/localAttachmentStorage.ts`
- Adapter object storage phù hợp provider được chọn.
- `server/src/services/attachmentService.ts`
- `server/src/routes/requests.ts`
- `server/src/migrations/index.ts`
- `server/src/config` hoặc `server/src/lib/securityConfig.ts`
- Script/batch migrator và test tương ứng.
- `.env.example`/deployment documentation nếu đang được version-control.
- `docs/runbooks/authorization-rollout.md`

Không sửa `attendance-web/src/components/chatbot/ChatbotWidget.tsx`.

## 7. Các bước triển khai theo TDD

### Step 8.1 - Contract tests cho storage abstraction

- File/module: storage interface và fake/in-memory adapter test.
- Thay đổi: định nghĩa put/get/head/delete, error mapping và key rules.
- Test: round-trip, missing key, retry delete, checksum mismatch, path traversal.
- Hoàn thành: adapter contract chạy giống nhau cho fake và local filesystem.
- Phụ thuộc: không có.

### Step 8.2 - Additive schema migration

- File/module: migration registry và migration integration tests.
- Thay đổi: thêm provider/key/migrated timestamp nullable và index cần thiết.
- Test: fresh DB, legacy DB có attachment, repeat apply, checksum LF/CRLF, rollback-on-failure.
- Hoàn thành: row legacy không đổi payload/metadata và app cũ vẫn tương thích trong cửa sổ expand.
- Phụ thuộc: Step 8.1 contract ổn định.

### Step 8.3 - Local filesystem adapter

- File/module: local adapter + config.
- Thay đổi: private root, safe key resolution, atomic write, stream read, idempotent delete.
- Test: traversal, partial write, duplicate retry, checksum/size, missing file.
- Hoàn thành: không thể đọc/ghi ngoài configured root và không có plaintext secret/log payload.
- Phụ thuộc: Step 8.1.

### Step 8.4 - Production object-storage adapter

- File/module: provider adapter và config validation.
- Thay đổi: private object operations, optional short-lived signed download, credential fail-fast.
- Test: provider contract bằng mock/fake server; revoked/invalid credential; signed URL TTL và key binding.
- Hoàn thành: production không fallback về data URL hoặc public bucket khi config thiếu.
- Phụ thuộc: provider phải được người dùng chọn trước khi code adapter cụ thể.

### Step 8.5 - Route/service integration

- File/module: attachment service và request routes.
- Thay đổi: upload/download/delete dùng abstraction; authorization vẫn chạy trước storage access.
- Test: owner/current approver/outsider, hidden 404, MIME mismatch, oversize, dangerous type, provider failure.
- Hoàn thành: REST contract tương thích, không lộ storage key/public URL và không bypass authorization.
- Phụ thuộc: Step 8.2 và ít nhất một adapter.

### Step 8.6 - Legacy backfill migrator

- File/module: batch migration command/service.
- Thay đổi: dry-run, bounded batch, resume cursor, checksum verify, structured audit/report.
- Test: valid row, corrupt base64, checksum mismatch, interrupted batch, retry, mixed legacy/new rows.
- Hoàn thành: lỗi một row không xóa dữ liệu và không làm mất khả năng retry; report xác định rõ row bị chặn.
- Phụ thuộc: Step 8.2-8.5.

### Step 8.7 - Rehearsal và finalize gate

- File/module: runbook và migration tests/scripts.
- Thay đổi: rehearsal fresh DB + sanitized copy, read-both smoke test, backup/restore procedure.
- Test: row counts, checksum sample/all rows theo quy mô, download authorization, repeat migration.
- Hoàn thành: có báo cáo migration; chưa drop/null legacy payload cho đến khi người dùng duyệt finalize riêng.
- Phụ thuộc: Step 8.6.

## 8. Test matrix

- Upload 0 byte, malformed base64, >5 MiB decoded, metadata size giả.
- Filename/MIME khai báo khác magic bytes.
- PDF/png/jpeg/webp hợp lệ; format không allowlist.
- Storage key traversal và collision.
- Object/local write thành công nhưng DB transaction thất bại.
- DB row thành công nhưng provider tạm unavailable khi download/delete.
- Owner/approver hợp lệ download; outsider nhận 404 trước khi storage access.
- Attachment legacy và attachment mới cùng được đọc trong cửa sổ expand.
- Backfill checksum đúng/sai, batch bị dừng giữa chừng và chạy lại.
- Hai worker migration cùng chọn một row.
- Signed URL hết hạn, sai key hoặc được tạo cho actor không còn quyền.
- Production thiếu provider config phải fail closed.

## 9. Tiêu chí hoàn thành

- Production path không ghi data URL/payload vào SQLite.
- Tất cả attachment access đi qua authorization DB-fresh.
- Local và object adapter đạt cùng contract test.
- Legacy migrator có dry-run, batch, resume và checksum verification.
- Không xóa payload cũ trong phase nếu chưa qua finalize gate riêng.
- Full backend/frontend test, build, lint và migration rehearsal đạt.
- Có rollback/read-both runbook và không chạy production migration tự động.

## 10. Rủi ro và rollback

- Provider outage: giữ metadata/trạng thái retry, không giả trả thành công.
- Orphan object: compensation/reconciliation report, không quét-xóa mù.
- Corrupt legacy payload: quarantine/report row, không xóa.
- App rollback: schema additive và payload legacy còn tồn tại trong cửa sổ chuyển tiếp.
- Provider credential leak: rotate/revoke credential; không log secret/signed URL.

## 11. Câu hỏi cần chốt trước implementation

- Provider production cụ thể: S3-compatible, Cloudflare R2, MinIO, Azure Blob hay filesystem bền vững trên VPS?
- Local storage root và cơ chế backup/restore mong muốn.
- Signed URL hay backend streaming là mặc định production?
- Có antivirus/content scanning service hay chỉ allowlist + magic bytes trong phase này?
- Thời gian quan sát trước khi finalize xóa/null payload legacy.

## 12. Cố ý không làm

- Không thay đổi request authorization/business workflow.
- Không tạo public bucket hoặc public URL lâu dài.
- Không tự chạy migration trên production.
- Không xóa legacy payload trước finalize approval.
- Không triển khai session invalidation/retention; các hạng mục đó thuộc Phase 9.
