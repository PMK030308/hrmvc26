# Phase 2 - Shared Authorization Foundation

Ngày lập kế hoạch: **2026-08-29**.

## 1. Mục tiêu và phạm vi

Biến authorization foundation của Phase 1 thành nền tảng dùng chung cho các phân hệ tiếp theo, nhưng chưa thay đổi business rule của attendance, organization, payroll hay chatbot trong phase này.

Kết quả cần có:

- Permission registry chung cho toàn hệ thống.
- Actor được hydrate mới từ database.
- Middleware/helper dùng chung cho permission, scope và hidden-resource semantics.
- Permission matrix API/UI có thể quản lý permission ngoài request.
- Cơ chế default seed không ghi đè cấu hình Admin.
- Compatibility bridge cho `requireRole` trong lúc migrate từng module.
- Migration ledger tối thiểu phải tồn tại trước mọi schema change ở Phase 3–7.

## 2. Hiện trạng và lỗ hổng đã xác minh

- `requireRole` đọc `req.user.roles` từ JWT; role thay đổi trong DB có thể chưa có hiệu lực đến khi token hết hạn.
- `role_feature_permissions` và `permissionService.ts` đang gắn chặt với `REQUEST_PERMISSIONS`.
- `/config/roles/matrix` vẫn trả `FEATURE_PERMS` hard-code và chỉ read-only.
- Frontend `usePermissions`, `authStore`, route guards và navigation dùng role/permission snapshot để hiển thị; đây chỉ nên là presentation hint.
- Các route ngoài request chưa có actor/context abstraction thống nhất.
- `users` chưa có `is_active`; chỉ `employees.status` tồn tại, nên chưa thể tự tuyên bố user “disabled”.
- `users.permissions` vẫn được map vào DTO nhưng Phase 1 không dùng nó làm authority; nguồn permission chính thức chưa được chốt.
- `/auth/me` và frontend vẫn nhận permission legacy/JWT snapshot.
- Permission matrix chưa có revision/optimistic locking; hai Admin có thể last-write-wins.
- Không có invariant bảo vệ Admin cuối cùng hoặc đường recovery nếu `config.permission.manage` bị revoke khỏi tất cả principal.

## 3. Thiết kế đề xuất

### Permission catalog

Tạo catalog typed theo namespace:

- `requests.*` giữ nguyên.
- `attendance.*`
- `shifts.*`
- `org.*`
- `delegation.*`
- `config.*`
- `timesheet.*`
- `payroll.*`
- `reports.*`
- `audit.*`
- `chatbot.*`

Catalog chỉ định `key`, label, module, action, default roles và trạng thái `enforced`.

### Shared actor

Đề xuất API:

- `loadAuthorizationActor(userId)`
- `hasPermission(actor, permission)`
- `requireFreshActor(req)`
- `requirePermission(permission)`
- `assertResourceVisible(visible)`
- `assertActionAllowed(visible, allowed)`
- `matchesDepartmentScope(actor, departmentId)`

Request authorization tiếp tục dùng relation-specific policy riêng nhưng dựa trên actor chung.

### Authority decisions bắt buộc

Trước Step 2.2 phải chốt:

1. `users.permissions` là:
   - legacy field không dùng làm authority; hoặc
   - direct grant được OR với role permissions; hoặc
   - explicit override/deny.
2. Active principal dựa vào cột `users.is_active` mới hay mapping từ `employees.status`.
3. Probation, OnLeave, Resigned và Terminated có được login/action hay chỉ read-only.
4. Bootstrap authority:
   - immutable system-owner role/permission; hoặc
   - invariant luôn còn ít nhất một active principal quản lý matrix.

Khuyến nghị nhỏ nhất: `users.permissions` legacy-only, thêm `users.is_active`, và chặn self-demotion/xóa Admin active cuối cùng.

### Migration harness tối thiểu

- Bảng `schema_migrations(version, name, checksum, applied_at)`.
- Migration forward-only, idempotent ở cấp runner và chạy trước seed.
- Test fresh DB, existing DB, repeat apply, checksum mismatch và failed migration rollback.
- Phase 7 dùng harness này để cleanup/constraint/rollout; không tạo harness lần đầu ở Phase 7.

### Matrix concurrency và recovery

- Matrix có revision toàn cục hoặc ETag.
- Client gửi `expectedVersion`; stale save trả `409`.
- Matrix update + revision + audit nằm cùng transaction.
- Permission `config.permission.manage` không thể bị revoke khỏi active principal cuối cùng.
- Permission chưa `enforced` phải disable/ẩn trong Admin UI để tránh cảm giác bảo vệ giả.

### Frontend capability source

- `/auth/me` hoặc `/auth/capabilities` trả `effectivePermissions`, actor revision và role/scope DB-fresh.
- App refresh capability khi bootstrap, sau role/scope/matrix update và khi nhận authorization conflict phù hợp.
- Nav/route guard của module đã migrate dùng capability; vẫn chỉ là presentation.

### Ý nghĩa `authz_version`

- `users.authz_version` là revision theo principal để optimistic concurrency, refresh capability và truy vết thay đổi quyền.
- Trường này không phải cache key và không thay thế DB lookup: backend vẫn hydrate actor, trạng thái tài khoản/nhân viên, role, scope và effective permissions trực tiếp từ database trên mỗi request được bảo vệ.
- Mutation user role/scope/`is_active`, thay đổi employee status ảnh hưởng khả năng đăng nhập và thay đổi permission matrix đều tăng revision tương ứng trong cùng transaction.
- Permission matrix đồng thời có global `permission_matrix_state.version`; frontend nhận cả user revision và matrix version.

## 4. Status code

- Không có/không hợp lệ/hết hạn JWT: `401`.
- User trong JWT không còn tồn tại hoặc bị vô hiệu hóa: `401`.
- Resource không tồn tại hoặc actor không được biết tồn tại: `404`.
- Actor nhìn thấy resource nhưng thiếu permission/action relation: `403`.
- Conflict/version/state race: `409`.

## 5. File/module dự kiến thay đổi

- `server/src/authz/authorizationActor.ts` - actor chung.
- `server/src/authz/authorizationAssertions.ts` - assertion/status semantics.
- `server/src/authz/permissionCatalog.ts` - catalog typed.
- `server/src/services/permissionService.ts` - generic catalog/matrix.
- `server/src/middleware/auth.ts` - DB-fresh permission middleware.
- `server/src/migrations/*`, `server/src/services/migrationService.ts` - migration harness.
- `server/src/routes/auth.ts` - effective permission/capability response.
- `server/src/authz/requestAuthorizationContext.ts` - dùng actor chung.
- `server/src/routes/config.ts` - matrix API chung.
- `server/src/types.ts` - permission types nếu cần.
- `attendance-web/src/types/index.ts` - generic matrix DTO.
- `attendance-web/src/api/config.ts` - generic matrix API.
- `attendance-web/src/pages/admin/Roles.tsx` - nhóm permission theo module.
- `attendance-web/src/hooks/usePermissions.ts`, `stores/authStore.ts` - ghi rõ presentation-only.

## 6. Các bước triển khai

### Step 2.1 - Contract tests cho actor và permission catalog

- File/module: test mới dưới `server/src/authz/` và `server/src/services/`.
- Thay đổi: test multi-role OR, revoked role có hiệu lực ngay, unknown permission fail closed, default seed idempotent.
- Test: actor tải DB mới dù JWT chứa role cũ; authority behavior của `users.permissions`; active-state mapping cho Probation/OnLeave/Resigned/Terminated.
- Hoàn thành: RED đúng vì abstraction chưa tồn tại.
- Phụ thuộc: Phase 1.

### Step 2.2 - Migration harness tối thiểu

- File/module: `server/src/migrations/*`, `server/src/services/migrationService.ts`, `db.ts`, `index.ts` và test DB tạm.
- Context: Phase 3/5/6 có thể cần schema change; không tiếp tục `ALTER TABLE` ad hoc.
- Thay đổi: migration ledger, ordered runner, checksum, transaction/error handling.
- Test: fresh/existing DB, repeat apply, checksum mismatch, failed migration không đánh dấu complete.
- Verification: `npm run build`; chạy migration tests trên `HRM_DB_PATH` tạm.
- Hoàn thành: mọi schema change mới phải đi qua runner.
- Rollback: disable runner chỉ khi schema chưa đổi; migration đã apply dùng forward-fix/restore procedure.
- Phụ thuộc: Step 2.1 decisions.

### Step 2.3 - Tách generic actor/assertion

- File/module: `authorizationActor.ts`, `authorizationAssertions.ts`, request context.
- Thay đổi: request policy dùng actor chung mà không đổi behavior.
- Test: toàn bộ Phase 1 tests tiếp tục pass.
- Hoàn thành: không duplicate logic load user/permission.
- Verification: Phase 1 unit/integration tests và backend build.
- Rollback: request context adapter quay lại loader cũ nhưng không xóa migration ledger.
- Phụ thuộc: Step 2.1–2.2.

### Step 2.4 - Generic permission catalog và seed

- File/module: `permissionCatalog.ts`, `permissionService.ts`, `db.ts/index.ts` nếu cần.
- Thay đổi: request permissions trở thành một module trong catalog; seed toàn catalog bằng `INSERT OR IGNORE`.
- Test: không ghi đè Admin edits; duplicate key bị reject; catalog/matrix đầy đủ.
- Hoàn thành: service không import trực tiếp request policy constants.
- Permission chưa enforce được đánh dấu và không cho Admin chỉnh.
- Verification: permission service tests + restart seed test.
- Phụ thuộc: Step 2.3.

### Step 2.5 - Middleware DB-fresh và capability endpoint

- File/module: `middleware/auth.ts` và tests.
- Thay đổi: thêm `requireFreshActor`/`requirePermission`; giữ `requireRole` tạm thời cho route chưa migrate.
- Test: JWT role Admin cũ nhưng DB đã bỏ Admin không được qua permission guard; `/auth/me` phản ánh matrix/role/scope mới mà không cần login lại.
- Hoàn thành: middleware mới không tin authority snapshot trong JWT.
- Verification: auth middleware/API integration tests và frontend bootstrap build.
- Phụ thuộc: Step 2.4.

### Step 2.6 - Generic matrix API, optimistic locking và Admin UI

- File/module: config route/API/types/Roles page.
- Thay đổi: hiển thị theo nhóm module, validate full matrix, save transactionally, audit actor.
- Test: non-Admin 403; stale JWT Admin bị từ chối nếu DB không còn Admin; malformed matrix 400; hai Admin save cùng version chỉ một winner; self-demotion/Admin cuối cùng bị chặn.
- Hoàn thành: legacy static matrix không còn là nguồn mô tả quyền chính.
- Matrix update/revision/audit atomic; stale version `409`.
- Verification: API integration tests, frontend matrix helper tests/build.
- Rollback: restore matrix snapshot qua bootstrap authority, không bypass bằng JWT cũ.
- Phụ thuộc: Step 2.4–2.5.

### Step 2.7 - Request root permissions và compatibility verification

- File/module: request routes/engine/authz, chatbot create dependency contract và frontend request create.
- Context: Phase 1 chưa có `requests.request.create_own`; catalog/OT usage/shift helper chỉ yêu cầu login.
- Thay đổi: thêm root create permission; bảo vệ create/catalog/OT usage; ghi shift helper vào Phase 3 do phụ thuộc scope/partner preview.
- Test: Admin revoke create permission; REST/chatbot create parity; Phase 1 matrix/capability/409/404 regression.
- Verification: toàn bộ backend tests/build, frontend tests/build/lint, `git diff --check`.
- Hoàn thành: request create không là đường bypass và foundation không regress Phase 1.
- Rollback: restore request permission defaults/matrix snapshot; không bỏ backend guard.
- Phụ thuộc: tất cả step trước.

## 7. Endpoint/contract table

| Endpoint | Permission/authority | Relation | Status chính |
|---|---|---|---|
| `GET /auth/me` hoặc `/auth/capabilities` | Authenticated active principal | Self | 200/401 |
| `GET /config/roles/matrix` | Bootstrap hoặc `config.permission.manage` | N/A | 200/401/403 |
| `PUT /config/roles/matrix` | Bootstrap hoặc `config.permission.manage` | expected matrix version | 200/400/401/403/409 |
| `PUT /config/roles/users/:id` | `config.user.manage` | Admin-last invariant | 200/400/401/403/404/409 |
| `POST /requests/:type` | `requests.request.create_own` | Self employee | 200/400/401/403/409 |
| `GET /requests/catalog` | request create/view capability | Self context | 200/401/403 |
| `GET /requests/ot-usage` | request create/view capability | Self employee | 200/400/401/403 |

## 8. Test matrix

- JWT hợp lệ, user còn active.
- JWT hợp lệ nhưng user đã bị xóa/vô hiệu hóa.
- JWT có Admin nhưng DB đã bỏ Admin.
- DB thêm role mới trong lúc JWT còn cũ.
- Một role allow, role khác deny/không allow: merge OR.
- Permission không có trong catalog.
- Matrix thiếu permission, thiếu role, trùng permission, role lạ.
- Seed lần đầu và restart sau khi Admin chỉnh matrix.
- Request authorization regression đầy đủ.
- Admin cuối cùng, self-demotion và recovery path.
- Matrix stale version/concurrent save/audit atomicity.
- Effective permissions frontend refresh không cần login lại.
- Request create permission revoked cho REST và chatbot.

## 9. Tiêu chí hoàn thành

- Có một actor loader và assertion layer chung.
- Permission service không còn request-only.
- Matrix UI/API dùng catalog động.
- Có middleware DB-fresh sẵn cho Phase 3–6.
- Không đổi behavior business của module ngoài request.
- Migration harness có trước mọi schema change phase sau.
- Có bootstrap/recovery rule và Admin-last invariant.
- Effective permissions có nguồn DB-fresh cho frontend presentation.

## 10. Rủi ro và rollback

- Rủi ro default permission sai làm khóa chức năng: seed additive và snapshot matrix trước rollout.
- Rủi ro request regression: giữ adapter và chạy toàn bộ Phase 1 integration tests.
- Rollback: route chưa migrate tiếp tục dùng `requireRole`; actor/catalog mới có thể bị vô hiệu hóa theo module mà không xóa bảng.

## 11. Câu hỏi cần xác nhận trước implementation

1. `users.permissions` legacy-only, direct grant hay override?
2. Có thêm `users.is_active` không; mapping employee status ra quyền login/action thế nào?
3. Bootstrap authority dùng system-owner bất biến hay invariant Admin cuối cùng?
4. Scope rỗng nghĩa là không có scope hay global? Phase 2 chỉ định nghĩa semantics, Phase 4 cung cấp UI/API quản lý.

## 12. Verification commands

```powershell
cd server
npm run build
$tests = Get-ChildItem -Path '.\src' -Recurse -Filter '*.test.ts' | ForEach-Object { $_.FullName }
& '.\node_modules\.bin\tsx.cmd' --test $tests

cd ..\attendance-web
npm run lint
npm run build

cd ..
git diff --check
```

## 13. Không làm trong phase này

- Không thay rule attendance, payroll, organization hoặc chatbot.
- Không thiết kế role hierarchy.
- Không đổi JWT transport/localStorage.
- Không thêm SSO, refresh token hoặc MFA.

## 14. Plan mutation log

- 2026-08-29: thêm migration harness, active-user/permission authority decisions, bootstrap Admin invariant, effective permission endpoint và matrix optimistic locking sau adversarial review.
- 2026-08-30: xác nhận checksum chuẩn hóa LF/CRLF, ghi rõ `authz_version` không phải cache và thêm checkpoint rehearsal trên DB mới/legacy tạm.
