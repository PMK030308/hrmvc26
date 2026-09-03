# Phase 4 - Organization, Delegation & Admin Authorization

Ngày lập kế hoạch: **2026-08-29**.

## 1. Mục tiêu và phạm vi

Siết quyền cho dữ liệu tổ chức/nhân sự và các bề mặt quản trị:

- Branch, department, position và employee directory/detail/mutation.
- Delegation approver catalog, create/revoke/list/all.
- Attendance regulations và leave-type configuration.
- User/role management và permission matrix administration.
- Audit logs và notifications.
- Self profile tiếp tục self-only.

Endpoint chính: `/api/org/*`, `/api/delegation/*`, `/api/config/*`, `/api/audit/*`, `/api/notifications/*`, `/api/auth/me`.

## 2. Hiện trạng và lỗ hổng đã xác minh

- Manager/Director/Accountant có thể gọi employee list rộng; route chưa áp `department_scopes` nhất quán.
- Employee detail trả toàn bộ DTO, có thể gồm wage, address, phone và các trường nhạy cảm không cần thiết cho mọi role.
- HR/Admin create/update employee dùng payload động nhưng validation nghiệp vụ còn hạn chế.
- Employee delete thực hiện trực tiếp và có thể vướng foreign-key/orphan; không kiểm tra chính mình, active user hoặc dependency.
- `/org/reset-demo` là thao tác phá hủy toàn bộ dữ liệu, chỉ guard bằng role Admin trong JWT.
- Delegation `canDelegate` và Admin revoke dựa role snapshot; approver catalog có thể lộ user ngoài phạm vi cần thiết.
- Regulations/leave types dùng role guard rải rác; `/roles/matrix` legacy hard-code còn tồn tại.
- Audit chỉ Admin nhưng chưa fresh-hydrate và chưa có filter/limit boundary chặt.
- Notifications self-scoped tốt nhưng mark-read không báo 404 khi ID không thuộc actor.
- `department_scopes` là nền tảng của nhiều policy nhưng chưa có API/UI quản lý, chưa rõ scope rỗng và department hierarchy.
- Dashboard admin nhúng audit activity feed, tạo đường đọc audit ngoài `/api/audit`.
- Delegation hiện hữu có thể overlap; resolver có thể chọn một row mà không có invariant dữ liệu.

## 3. Quy tắc phân quyền đề xuất

### Organization

- Admin: global organization management nếu có permission.
- HR: view/manage trong scope được cấp; global chỉ khi permission `org.employee.view_all/manage_all` được bật.
- Manager: view directory tối thiểu trong scope/reporting line; không xem wage/private fields mặc định.
- Accountant: chỉ nhận identity fields cần cho payroll flow, không mặc nhiên xem hồ sơ cá nhân đầy đủ.
- Director: quyền aggregate/global tùy permission, không tự động có mutation.
- Employee: self profile qua endpoint profile, không dùng employee-admin detail endpoint.

### Delegation

- Chỉ actor có approval authority hợp lệ mới được tạo delegation.
- Delegate phải active, không phải chính mình và đáp ứng role/permission policy.
- Chỉ delegator được revoke; Admin override phải là permission riêng và DB-fresh.
- HR/Admin list-all theo permission, có scope nếu policy yêu cầu.
- Create/revoke chạy transaction với audit/notification.

### Admin/config/audit

- Reset-demo là permission riêng, có explicit environment guard và confirmation token; production mặc định disabled.
- Role/user mutation cần validation role catalog, employee uniqueness và transaction.
- Audit log chỉ cho permission rõ ràng, page size giới hạn.
- Notifications chỉ owner; foreign notification ID trả 404.

## 4. Permission dự kiến

- `org.catalog.view`
- `org.employee.view_scoped`
- `org.employee.view_all`
- `org.employee.manage_scoped`
- `org.employee.manage_all`
- `org.employee.view_sensitive`
- `org.employee.delete`
- `delegation.create`
- `delegation.revoke_own`
- `delegation.revoke_any`
- `delegation.view_all`
- `config.regulation.view`
- `config.regulation.manage`
- `config.leave_type.manage`
- `config.user.manage`
- `config.permission.manage`
- `audit.view`
- `system.demo_reset`

## 5. Authorization/service design

- `canViewEmployee(actor, employee, fieldSet)`
- `canManageEmployee(actor, employee)`
- `employeeProjectionFor(actor)` để không trả field nhạy cảm ngoài quyền.
- `canCreateDelegation(actor, delegate)`
- `canRevokeDelegation(actor, delegation)`
- `canViewDelegation(actor, delegation)`
- `requireFreshAdminPermission(permission)` thay role check trực tiếp.

### Projection contract cần chốt trước Step 4.2

| Projection | Field dự kiến |
|---|---|
| Directory | id, employeeCode, fullName, departmentId, positionId, status |
| Contact | Directory + work email/phone theo policy |
| Private HR | DOB, gender, address, marital status, hire/contract data |
| Payroll identity | id, code, name, department, wage/contract fields cần tính lương |
| Approver catalog | userId, employeeId, display name, role labels tối thiểu |
| Chatbot search | Directory projection, không avatar base64/wage/private fields |

Collection ngoài scope lọc và trả `200`; hidden detail trả `404`.

## 6. File/module dự kiến thay đổi

- `server/src/authz/organizationAuthorization.ts`
- `server/src/authz/delegationAuthorization.ts`
- `server/src/services/employeeService.ts`
- `server/src/services/delegationService.ts`
- `server/src/routes/org.ts`
- `server/src/routes/delegation.ts`
- `server/src/routes/config.ts`
- `server/src/routes/audit.ts`
- `server/src/routes/notifications.ts`
- `server/src/repo.ts` cho DTO projection.
- Frontend org/delegation/config/audit API, types và pages.
- `server/src/routes/dashboard.ts` cho embedded audit feed.

## 7. Các bước triển khai

### Step 4.1 - RED tests cho employee IDOR và sensitive fields

- Manager ngoài scope, Accountant, HR scoped và outsider gọi list/detail.
- Kiểm tra wage/address/private fields không xuất hiện khi thiếu permission.
- Hoàn thành: test chứng minh hiện route trả quá rộng.
- Phụ thuộc: Phase 2.

### Step 4.2 - Employee authorization + DTO projection

- Query list theo scope; detail dùng hidden 404.
- Tách DTO directory/basic/private/payroll.
- Mutation validate target scope và chạy transaction/audit.
- Phụ thuộc: Step 4.1.

### Step 4.3 - Safe employee lifecycle

- Validate create/update, uniqueness và reference IDs.
- Delete hoặc deactivate theo business decision; kiểm tra user/request/payroll dependency.
- Reset-demo có environment kill switch và explicit confirmation.
- Phụ thuộc: Step 4.2 và quyết định delete/deactivate.

### Step 4.4 - Delegation authorization/service

- Fresh actor, permission riêng, date overlap/self/delegate validation.
- Create/revoke/audit/notification atomic.
- Revoke-any không dựa JWT Admin snapshot.
- Preflight inventory overlap hiện hữu; manual resolution report, không tự xóa.
- Transaction check ngăn overlap mới; test delegate bị disable/xóa khi step pending và Phase 1 regression.
- Phụ thuộc: Phase 2.

### Step 4.5 - Config/user/role/audit hardening

- Migrate role guards sang permission guard.
- Validate user role list, linked employee và duplicate email.
- Audit pagination max; permission matrix mutation audit đầy đủ.
- Thêm API/UI chỉnh `department_scopes`, validate department tồn tại và audit old/new.
- Chặn self-demotion/xóa active Admin cuối cùng theo bootstrap invariant Phase 2.
- Bao phủ audit activity feed trong dashboard hoặc disable path cho tới Phase 5.
- Phụ thuộc: Phase 2.

### Step 4.6 - Notification ownership semantics

- Mark-read foreign ID trả 404; mutation conditional theo recipient.
- Test concurrent mark-all/mark-one và invalid JWT.
- Phụ thuộc: Phase 2.

### Step 4.7 - Frontend capability/projection update

- UI không giả định mọi employee DTO đều có wage/private fields.
- Nút delete/reset/delegation override theo capability backend.
- Phụ thuộc: Step 4.2–4.6.

## 8. Test matrix

- Manager list/detail employee trong/ngoài scope.
- HR scoped/global permission.
- Accountant xem basic/payroll projection nhưng không private profile.
- Admin view/manage với permission và Admin JWT stale.
- Create/update invalid department/position/duplicate email/code.
- Delete employee có dependency và tự xóa chính mình.
- Reset-demo production disabled, missing confirmation, valid dev invocation.
- Delegation self, invalid date, overlap, inactive delegate, revoke own/other.
- Notification owner/foreign/missing.
- Audit page size âm/quá lớn và non-authorized actor.
- Scope rỗng, scope department không tồn tại, scope thay đổi có hiệu lực ngay với JWT cũ.
- Department cha/con theo policy đã chốt.
- Delegation overlap hiện hữu/mới và delegate disabled.
- Audit direct route và embedded dashboard feed.

## 9. Tiêu chí hoàn thành

- Employee list/detail không còn trả toàn hệ thống theo role chung.
- Sensitive fields có projection riêng.
- Delegation lifecycle dùng DB-fresh policy và transaction.
- Reset-demo không thể chạy tình cờ ở production.
- Config/audit/user management dùng permission foundation.

## 10. Rủi ro và rollback

- Frontend có thể phụ thuộc full employee DTO: rollout projection cùng type changes và compatibility field mapping ngắn hạn.
- Deactivate/delete thay đổi nghiệp vụ: không tự quyết định, giữ delete behavior cho đến khi chốt.
- Rollback theo route/service; không khôi phục reset-demo không bảo vệ.

## 11. Câu hỏi cần xác nhận

- HR global hay department-scoped cho employee data?
- Manager scope theo department hay reporting line?
- Accountant được xem những field employee nào?
- Employee delete thật hay chuyển sang inactive?
- Admin có được revoke delegation của người khác không?
- Scope department cha có bao gồm department con không; scope rỗng là none hay global?
- Chốt bảng projection × permission ở trên, đặc biệt Accountant/HR/Director.

## 12. Không làm

- Không thay payroll calculation.
- Không thiết kế lại sơ đồ tổ chức.
- Không thêm SSO/SCIM.

## 13. Verification commands

- Backend build + org/delegation/config/audit/notification integration tests trên DB tạm.
- Frontend lint/build + projection/capability tests.
- Phase 1 delegation/request regression và `git diff --check`.

## 14. Plan mutation log

- 2026-08-29: bổ sung scope management, field projection contract, delegation overlap/disabled delegate và embedded audit paths sau adversarial review.
