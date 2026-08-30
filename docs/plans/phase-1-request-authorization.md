# Phase 1 - Request Authorization

## 1. Mục tiêu và phạm vi

Phase này khắc phục các lỗ hổng phân quyền ở phân hệ đơn từ, với backend là nơi quyết định quyền cuối cùng. Phạm vi bao gồm:

- Xem chi tiết đơn và timeline/lịch sử duyệt.
- Sửa và hủy đơn.
- Duyệt và từ chối đơn tại đúng bước hiện tại.
- Liệt kê, tải xuống, upload và xóa file đính kèm.
- Phản hồi yêu cầu đổi ca bởi đúng nhân viên được đề nghị.
- Duy trì optimistic locking bằng `request_version`; yêu cầu dùng version cũ phải trả `409 Conflict`.
- Ngăn IDOR và tránh làm lộ sự tồn tại của đơn cho người không có quyền.
- Đưa các kiểm tra quyền dùng chung vào một authorization layer, không rải kiểm tra role trong từng route.
- Đưa kiểm tra quyền, trạng thái, version và cập nhật quan trọng vào cùng transaction khi có nguy cơ TOCTOU/race condition.

Mục tiêu tương thích là giữ nguyên URL và payload frontend hiện tại nếu không có lý do bảo mật bắt buộc phải đổi. Frontend tiếp tục dùng `capabilities` để hiển thị nút, nhưng `capabilities` chỉ là gợi ý giao diện; backend luôn kiểm tra lại quyền.

Độ phức tạp dự kiến: **cao**, vì quyền hiện nằm rải giữa route, engine, dữ liệu approval đã resolve và logic delegation.

## 2. Hiện trạng code và lỗ hổng đã xác minh

### 2.1. Bản đồ code hiện tại

- Request/approval HTTP routes: `server/src/routes/requests.ts`.
- Request workflow engine: `server/src/engines/request.ts`.
- SQLite schema và kết nối dùng chung: `server/src/db.ts`.
- Mapping/query repository: `server/src/repo.ts`.
- JWT authentication và role guard: `server/src/middleware/auth.ts`.
- Delegation routes và lifecycle: `server/src/routes/delegation.ts`.
- Error envelope: `server/src/types.ts`, `server/src/index.ts`.
- Frontend request API: `attendance-web/src/api/requests.ts`.
- Chi tiết đơn, timeline, attachment và action buttons: `attendance-web/src/pages/employee/RequestDetail.tsx`, `attendance-web/src/components/requests/widgets.tsx`.
- Danh sách đơn/duyệt: `attendance-web/src/pages/employee/Requests.tsx`, `attendance-web/src/pages/employee/Approvals.tsx`, `attendance-web/src/pages/admin/Requests.tsx`, `attendance-web/src/pages/director/Approvals.tsx`.

### 2.2. Schema và dữ liệu quyền

- `users` lưu `roles`, `permissions`, `department_scopes` dưới dạng JSON text. JWT chứa bản sao của các trường này cùng `id`, `email`, `employeeId`; TTL hiện là 7 ngày.
- `requests` lưu chủ đơn bằng `employee_id`, trạng thái, `request_version`, `current_level` và một cột JSON `capabilities`.
- `request_approvals` lưu từng bước: `request_id`, `level`, `approver_user_id`, trạng thái, comment và dấu vết `on_behalf_of_*` cho delegation/escalation.
- `request_attachments` chỉ lưu `request_id` và nội dung data URL; không lưu người upload.
- `delegations` lưu delegator/delegate, khoảng hiệu lực và `is_active`.
- Chưa có unique constraint cho `(request_id, level)` ở `request_approvals`; phase này cần cân nhắc guard bằng transaction/query trước khi đề xuất migration.

### 2.3. Cách tạo luồng duyệt hiện tại

- `FLOWS` trong `server/src/engines/request.ts` định nghĩa các bước theo loại đơn.
- `resolveApprover` resolve DirectManager, DepartmentHead, Role hoặc SpecificUser thành một `approver_user_id` cụ thể.
- Khi tạo đơn, `initApproval` insert bước cấp 1 ở trạng thái pending.
- Khi approve, engine đánh dấu bước hiện tại đã duyệt, tự bỏ qua điều kiện không thỏa, tự gộp cấp nếu cùng người duyệt, rồi insert bước tiếp theo hoặc hoàn tất đơn.
- Với bước theo role, code hiện chọn user đầu tiên có role để ghi `approver_user_id`, nhưng `pendingApprovals` lại cho nhiều người cùng role nhìn thấy bằng cách so chuỗi `approver_name`. Đây là hai mô hình quyền không đồng nhất cần chốt.

### 2.4. Cơ chế delegation hiện tại

- Delegation được resolve tại thời điểm tạo từng approval step.
- Nếu delegation đang active, approval row ghi delegate vào `approver_user_id` và người gốc vào `on_behalf_of_user_id`.
- `getActiveDelegation` kiểm tra `is_active=1` và ngày hiện tại trong `[from_date, to_date]`.
- Thu hồi delegation chỉ đổi `is_active=0`; approval row đang pending không được cập nhật.
- Vì approve hiện không xác minh actor, trạng thái delegation hết hạn/thu hồi cũng không được kiểm tra tại thời điểm action.

### 2.5. Lỗ hổng đã xác minh

| Khu vực | Hiện trạng đã xác minh | Tác động |
|---|---|---|
| Chi tiết đơn | `GET /api/requests/:type/:id` chỉ yêu cầu JWT hợp lệ | Bất kỳ user đăng nhập nào biết ID/type đều đọc được đơn người khác, approvals và attachments kèm data URL |
| Timeline | `GET .../timeline` không kiểm tra quan hệ với đơn | Lộ lịch sử xử lý, approver, comment |
| Attachment list/download | `GET .../attachments` chỉ lọc theo `request_id`; detail cũng nhúng toàn bộ `data_url` | IDOR đọc/tải file của đơn khác |
| Upload attachment | Không kiểm tra request tồn tại, type khớp, quyền hoặc trạng thái | User bất kỳ có thể gắn file vào request ID bất kỳ, kể cả ID không tồn tại nếu FK chưa bắt được theo môi trường |
| Delete attachment | Chỉ cần attachment ID; không load request cha | User bất kỳ xóa file của đơn khác; xóa ID không tồn tại vẫn trả thành công |
| Sửa đơn | `updateRequest` nhận `userId` nhưng không dùng | User bất kỳ sửa đơn người khác nếu biết ID/type/version |
| Hủy đơn | `cancelRequest` không nhận actor | User bất kỳ hủy đơn người khác nếu biết ID/type/version |
| Approve | `approveRequest` không so actor với approval step hiện tại | User bất kỳ có thể approve; người duyệt cũ có thể duyệt bước sau |
| Reject | `rejectRequest` bỏ qua `_userId` | User bất kỳ có thể reject |
| Shift-swap response | `partnerRespond` kết thúc bằng `void userId` | User bất kỳ có thể phản hồi thay partner |
| Optimistic locking | Version được đọc và kiểm tra trước các câu `UPDATE`, nhưng không nằm trong transaction/conditional update | Hai request đồng thời có thể cùng vượt qua `ensureVersion` và cùng ghi/insert bước duyệt |
| Approval atomicity | Update approval row, insert bước mới, update request, effect, notification/audit tách rời | Có thể sinh trạng thái dở dang hoặc duplicate approval step khi lỗi/race |
| Capabilities | Backend tính `canEdit/canCancel/canRespond`, nhưng route mutation không enforce; frontend tự suy ra `canApprove` từ danh sách pending | Ẩn nút không tạo thành kiểm soát quyền |
| JWT roles | Request authz hiện có xu hướng dùng claims tồn tại tối đa 7 ngày | Role/permission bị thu hồi trong DB có thể vẫn còn hiệu lực đến khi token hết hạn nếu policy chỉ tin JWT |

### 2.6. Hành vi hiện tại có thể thay đổi khi siết quyền

- Link notification tới đơn sẽ trả `404` nếu người nhận không còn quan hệ hợp lệ với đơn.
- Người từng duyệt bước trước vẫn có thể xem timeline hay không phụ thuộc quyết định nghiệp vụ; mặc định đề xuất cho xem nếu có approval row liên quan, nhưng không được action bước sau.
- Admin hiện có thể approve mọi pending request qua `pendingApprovals`; cần xác nhận đây là quyền nghiệp vụ hay chỉ là hành vi cũ không chủ ý.
- HR/Director hiện được xem toàn bộ danh sách theo loại trong route list; Accountant chỉ thấy hàng chờ của mình. Siết detail phải đồng nhất với quyền list.
- Attachment hiện cho approver upload vì frontend truyền `canAdd={cap.canEdit || canApprove}`. Nếu backend giới hạn chỉ chủ đơn/HR/Admin, UI approver sẽ mất khả năng upload.
- Delegation hết hạn/thu hồi sau khi approval row đã được tạo sẽ thay đổi người có thể action; cần quy tắc fallback rõ ràng.
- `capabilities` lưu trong DB có thể cũ, nhưng `computeCapabilities` đang ghi đè khi response. Phase này nên coi cột lưu trữ là legacy, không dùng làm nguồn quyết định quyền.

## 3. Quy tắc phân quyền đề xuất

### 3.1. Actor context

Mỗi authorization decision dùng `RequestActor` được tải lại từ DB theo `req.user.id`, gồm user ID, employee ID, roles, permissions và department scopes. JWT chỉ chứng minh danh tính; không dùng claims role/permission cũ làm nguồn duy nhất cho action nhạy cảm.

### 3.2. View

Actor được xem request khi ít nhất một điều kiện đúng:

1. Actor là chủ đơn (`actor.employeeId === request.employee_id`).
2. Actor là approver liên quan theo approval row, bao gồm approver hiện tại hoặc người đã xử lý bước trước. Việc có cho delegator gốc xem khi delegate được assign cần chốt ở mục 11.
3. Actor là đúng partner của mutual shift swap.
4. Actor là HR/Admin có scope quản lý được xác nhận.
5. Các role khác chỉ được xem nếu có quan hệ approval cụ thể; không cấp quyền xem toàn công ty chỉ vì mang role Manager/Accountant/Director.

Nếu actor không có quyền view, endpoint theo resource ID trả `404` giống trường hợp không tồn tại để tránh enumeration.

### 3.3. Modify và cancel

- Chỉ chủ đơn được sửa/hủy.
- Sửa chỉ khi trạng thái thuộc tập được nghiệp vụ chốt; giữ tương thích ban đầu với `Draft(1)`, `Pending(2)`, `PendingPartnerConfirmation(6)`.
- Hủy giữ tương thích ban đầu với `Draft(1)`, `Pending(2)`, `PendingPartnerConfirmation(6)`, `PendingApproval(8)`; cần xác nhận có cho hủy khi approval đã xử lý một phần hay không.
- HR/Admin không tự động sửa nội dung hoặc hủy thay chủ đơn trừ khi người dùng xác nhận rõ quyền override.
- Version mismatch luôn được kiểm tra trên row mới nhất trong transaction và trả `409`.

### 3.4. Approve/reject

- Request phải đang ở trạng thái có thể xử lý và approval row ở `current_level` phải đang pending.
- Actor phải đúng entitlement của bước hiện tại: user cụ thể, role cụ thể theo quy tắc đã chốt, hoặc delegate hợp lệ.
- Approval row đã hoàn tất không thể xử lý lại.
- Người đã duyệt cấp trước không được xử lý cấp sau trừ khi cấp sau độc lập resolve chính họ theo quy tắc flow; cơ chế “gộp cấp cùng người” hiện tại tiếp tục tự xử lý trong engine, không cho actor gọi approve lần hai.
- Admin bypass chỉ được hỗ trợ nếu được xác nhận; nếu có, phải là policy explicit và audit ghi rõ override.

### 3.5. Attachments

Đề xuất authorization theo action thay vì một boolean chung:

- `read/download`: bất kỳ actor nào có `canViewRequest`.
- `upload`: mặc định chủ đơn khi request còn cho sửa; HR/Admin hoặc current approver chỉ khi nghiệp vụ xác nhận.
- `delete`: mặc định chủ đơn khi request còn cho sửa; do schema không lưu uploader nên chưa thể áp dụng “chỉ người upload được xóa”. HR/Admin override cần xác nhận.
- Luôn load attachment cùng request cha; attachment không tồn tại hoặc request không view được trả `404`.

### 3.6. Shift-swap response

- Chỉ actor có `employeeId === suggested_swap_partner_id`.
- Request phải là mutual swap, `swap_partner_status=Pending`, request status đang chờ partner và version khớp.
- Chủ đơn, HR, Admin hoặc approver không được phản hồi thay partner nếu không có quy tắc override được xác nhận.

## 4. Bảng endpoint - quyền - status code

| Endpoint | Quyền đề xuất | `401` | `403` | `404` chống lộ resource | `409` |
|---|---|---|---|---|---|
| `GET /api/requests/mine` | Chính user; pending được lọc bằng authorization layer | JWT thiếu/sai/hết hạn | Không dùng | Không dùng | Không dùng |
| `GET /api/requests/:type` | Owner; HR/Admin theo scope; role khác chỉ request liên quan nếu endpoint tiếp tục phục vụ họ | Có | Có thể dùng khi role không được phép gọi danh sách quản trị | Type không hợp lệ | Không dùng |
| `GET /api/requests/:type/:id` | `canViewRequest` | Có | Không ưu tiên | Không tồn tại hoặc không được view | Không dùng |
| `GET .../:id/timeline` | `canViewRequest` | Có | Không ưu tiên | Không tồn tại hoặc không được view | Không dùng |
| `PUT /api/requests/:type/:id` | `canModifyRequest` | Có | Actor xem được nhưng không được sửa | Không tồn tại hoặc không được view | Version cũ hoặc trạng thái không còn cho sửa |
| `POST .../:id/cancel` | `canCancelRequest` | Có | Actor xem được nhưng không được hủy | Không tồn tại hoặc không được view | Version cũ hoặc trạng thái không còn cho hủy |
| `GET .../:id/attachments` | `canManageRequestAttachment(..., 'read')` | Có | Không ưu tiên | Request không tồn tại/không view được | Không dùng |
| `POST .../:id/attachments` | `canManageRequestAttachment(..., 'upload')` | Có | Xem được nhưng không được upload | Request không tồn tại/không view được | Nếu upload gắn với expectedVersion: version cũ; cần chốt |
| `DELETE /api/requests/attachments/:attachmentId` | `canManageRequestAttachment(..., 'delete')` | Có | Xem được request nhưng không được xóa | Attachment/request không tồn tại hoặc không view được | Nếu delete gắn với expectedVersion: version cũ; cần chốt |
| Download attachment | Hiện là data URL từ GET; nếu tách endpoint thì dùng quyền `read` | Có | Không ưu tiên | Attachment/request không tồn tại hoặc không view được | Không dùng |
| `GET /api/approvals` | Chỉ các request actor có thể approve current step | Có | Không dùng | Không dùng | Không dùng |
| `POST /api/approvals/:type/:id/approve` | `canApproveCurrentStep(..., 'approve')` | Có | Xem được nhưng không phải current approver | Không tồn tại hoặc không được view | Version cũ, step đã xử lý, status thay đổi hoặc race thua |
| `POST /api/approvals/:type/:id/reject` | `canApproveCurrentStep(..., 'reject')` | Có | Xem được nhưng không phải current approver | Không tồn tại hoặc không được view | Version cũ, step đã xử lý, status thay đổi hoặc race thua |
| `POST /api/requests/shift-swaps/:id/partner-response` | `canRespondToShiftSwap` | Có | Xem được nhưng không phải partner | Không tồn tại hoặc không được view | Version cũ, đã phản hồi hoặc status thay đổi |

Quy ước chung:

- `401 Unauthorized`: không có JWT, JWT sai chữ ký hoặc hết hạn.
- `404 Not Found`: resource không tồn tại **hoặc** actor không được biết resource tồn tại.
- `403 Forbidden`: actor được phép biết/xem resource nhưng không được thực hiện action cụ thể.
- `409 Conflict`: optimistic-lock version cũ, current step/status đã thay đổi, hoặc request đồng thời đã thắng trước.

## 5. Thiết kế authorization layer

### 5.1. Module đề xuất

Tạo `server/src/authz/requestAuthorization.ts` (hoặc `server/src/lib/requestAuthorization.ts` nếu muốn bám cấu trúc hiện tại) làm nơi duy nhất chứa policy request.

Các type chính:

```ts
type RequestAction = 'view' | 'modify' | 'cancel' | 'approve' | 'reject'
type AttachmentAction = 'read' | 'upload' | 'delete'

interface RequestActor {
  userId: string
  employeeId: string
  roles: RoleCode[]
  permissions: PermissionFlag[]
  departmentScopes: string[]
}

interface RequestAuthorizationContext {
  requestRow: RequestRow
  currentApprovalRow: ApprovalRow | null
  actorApprovalRows: ApprovalRow[]
  activeDelegation: DelegationRow | null
}
```

API policy đề xuất:

```ts
canViewRequest(actor, context): boolean
canModifyRequest(actor, context): boolean
canCancelRequest(actor, context): boolean
canApproveCurrentStep(actor, context, action: 'approve' | 'reject'): boolean
canManageRequestAttachment(actor, context, action: AttachmentAction): boolean
canRespondToShiftSwap(actor, context): boolean
```

Helper dùng chung:

```ts
loadRequestActor(jwtUserId): RequestActor | null
loadRequestAuthorizationContext(type, requestId, actor): RequestAuthorizationContext | null
assertCanViewRequest(...): void
assertRequestAction(...): void
isCurrentApprovalEntitledActor(...): boolean
```

Các hàm `can*` thuần, không ghi DB và trả boolean để unit test dễ. Các hàm `assert*` chịu trách nhiệm ánh xạ sang `404/403`; route/engine không tự viết role check.

### 5.2. Nguồn sự thật

- Actor roles/permissions lấy mới từ `users` bằng JWT user ID.
- Ownership lấy từ `requests.employee_id`.
- Current approver lấy từ approval row có `request_id`, `level=current_level`, `status=Pending`.
- Delegation phải được kiểm tra lại tại thời điểm action, không chỉ tin snapshot `approver_user_id`.
- Không dùng JSON `requests.capabilities` làm authority.
- Không dùng `approver_name.includes(...)` làm authority lâu dài. Nếu business xác nhận “bất kỳ user có role X”, policy phải derive role step có cấu trúc; nếu schema hiện tại không biểu diễn đủ, cần quyết định bổ sung `approver_role` trong phase riêng hoặc migration nhỏ được phê duyệt.

### 5.3. Transaction và optimistic locking

Mỗi mutation `update/cancel/approve/reject/partnerResponse` dùng `db.transaction`:

1. Load actor mới từ DB.
2. Load request row và current approval/attachment context mới nhất.
3. Nếu actor không được view, trả `404`.
4. Kiểm tra action policy; nếu xem được nhưng action bị cấm, trả `403`.
5. Kiểm tra `expectedVersion` và trạng thái/current step.
6. Thực hiện conditional update, ví dụ `UPDATE requests ... WHERE id=? AND type=? AND request_version=?`; yêu cầu `changes === 1`, nếu không trả `409`.
7. Update approval row với điều kiện `status=Pending`; yêu cầu `changes === 1`.
8. Insert step tiếp theo, effect, balance, schedule, notification và audit trong cùng transaction khi đều là SQLite writes thuộc action đó.
9. Chỉ trả response sau commit.

Với hai approve đồng thời, chỉ transaction đầu tiên được update request/approval ở version cũ; transaction sau nhận `409`, không được insert duplicate step hay chạy effect lần hai.

### 5.4. Capabilities trả về frontend

Thay `computeCapabilities` bằng kết quả derive từ cùng authorization layer:

- `canEdit = canModifyRequest(...)`
- `canCancel = canCancelRequest(...)`
- `canRespond = canRespondToShiftSwap(...)`
- Cân nhắc bổ sung `canApprove`, `canReject`, `canUploadAttachment`, `canDeleteAttachment` vào response để frontend không phải suy ra từ list khác. Nếu muốn giữ shape nhỏ ở phase này, frontend có thể tiếp tục dùng list pending, nhưng backend vẫn enforce.

## 6. Danh sách file dự kiến thay đổi

### Backend bắt buộc

- `server/src/authz/requestAuthorization.ts` - authorization layer mới.
- `server/src/routes/requests.ts` - áp dụng policy cho detail, timeline, attachment, update/cancel, partner response và list filtering.
- `server/src/engines/request.ts` - transaction hóa mutation, enforce actor/current step/version và dùng policy chung.
- `server/src/repo.ts` - query raw/context nhỏ, attachment kèm request cha, tránh `mapRequest` tự động tải data URL khi không cần.
- `server/src/types.ts` - type/error code nhỏ nếu cần chuẩn hóa `REQUEST_NOT_FOUND`, `REQUEST_FORBIDDEN`, `REQUEST_VERSION_CONFLICT`.
- `server/src/middleware/auth.ts` - chỉ thay đổi nếu chọn cơ chế hydrate actor DB dùng chung ngay sau JWT; không thay JWT format trong phase này.

### Backend test dự kiến

- `server/src/authz/requestAuthorization.test.ts` - unit tests cho policy thuần.
- `server/src/engines/request.authorization.test.ts` - integration tests engine/transaction trên DB cô lập.
- `server/src/routes/requests.authorization.test.ts` - HTTP tests cho status code và chống resource enumeration.
- Có thể tách `server/src/app.ts` khỏi `server/src/index.ts` để test Express app không cần listen port; đây là refactor nhỏ phục vụ test, không đổi API.

### Frontend chỉ khi cần đồng bộ hành vi

- `attendance-web/src/types/index.ts` - nếu mở rộng capabilities.
- `attendance-web/src/pages/employee/RequestDetail.tsx` - dùng capabilities mới và xử lý `403/404/409` rõ ràng.
- `attendance-web/src/components/requests/widgets.tsx` - ẩn upload/delete đúng capabilities, xử lý attachment `404/403`.
- `attendance-web/src/api/requests.ts` - chỉ đổi nếu attachment mutation thêm `expectedVersion` hoặc có download endpoint riêng.

Không dự kiến thay đổi schema trong bước đầu. Nếu câu trả lời nghiệp vụ buộc biểu diễn `approver_role` hoặc uploader ownership, phải dừng và duyệt migration riêng trước khi implement phần đó.

## 7. Các bước triển khai nhỏ, theo thứ tự

### Bước 1 - Khóa contract quyền và status code

- **File/module liên quan:** tài liệu phase này; type nghiệp vụ trong `server/src/types.ts` chỉ ở giai đoạn implement.
- **Thay đổi dự kiến:** chốt các câu hỏi mục 11; lập bảng policy cuối cùng cho owner, current approver, prior approver, partner, HR, Admin, Manager, Accountant, Director và delegate.
- **Test tương ứng:** chuyển từng dòng policy thành test case named trước khi viết production code.
- **Điều kiện hoàn thành:** không còn ô quyền mơ hồ cho view/modify/cancel/approve/reject/attachment/partner response.
- **Phụ thuộc:** không có; mọi bước sau phụ thuộc bước này.

### Bước 2 - Tạo test harness backend cô lập

- **File/module liên quan:** test files mới; có thể tách `server/src/app.ts`, cấu hình DB test trong `server/src/db.ts` theo dependency injection hoặc `HRM_DB_PATH` dành cho test.
- **Thay đổi dự kiến:** chạy API/engine tests trên SQLite tạm, seed tối thiểu actor/request/approval/delegation; không dùng DB development.
- **Test tương ứng:** smoke test auth 401, request tồn tại, cleanup/rollback DB test.
- **Điều kiện hoàn thành:** test độc lập, lặp lại được, không sửa `server/data/hrm.db`, không cần package mới nếu dùng `node:test`, Express và fetch Node 22 hiện có.
- **Phụ thuộc:** Bước 1.

### Bước 3 - Viết authorization unit tests ở trạng thái RED

- **File/module liên quan:** `server/src/authz/requestAuthorization.test.ts`.
- **Thay đổi dự kiến:** tạo fixtures cho owner, employee khác, current/prior approver, HR/Admin, partner, delegate active/expired/revoked.
- **Test tương ứng:** toàn bộ nhánh của sáu hàm `can*`, bao gồm outsider và trạng thái không hợp lệ.
- **Điều kiện hoàn thành:** test chạy và fail đúng vì authorization layer chưa tồn tại/chưa đủ policy, không fail do setup.
- **Phụ thuộc:** Bước 1-2.

### Bước 4 - Implement authorization layer thuần

- **File/module liên quan:** `server/src/authz/requestAuthorization.ts`, query helpers nhỏ trong `server/src/repo.ts`.
- **Thay đổi dự kiến:** implement actor/context loader, sáu hàm `can*`, entitlement current step và mapper `404/403`.
- **Test tương ứng:** unit tests Bước 3 chuyển GREEN; thêm test JWT claim cũ nhưng role DB đã bị thu hồi.
- **Điều kiện hoàn thành:** route/engine có một API chung để hỏi quyền; không kiểm tra role request rải rác.
- **Phụ thuộc:** Bước 3.

### Bước 5 - Bảo vệ read endpoints và chống IDOR

- **File/module liên quan:** `server/src/routes/requests.ts`, `server/src/repo.ts`.
- **Thay đổi dự kiến:** áp dụng `canViewRequest` cho detail/timeline/attachment; load attachment qua request cha; list endpoints lọc bằng policy; không trả data URL trước khi authorize.
- **Test tương ứng:** owner/current approver/HR/Admin đọc thành công; Employee A đọc Employee B nhận 404; outsider timeline/attachment nhận 404; request không tồn tại nhận 404; JWT invalid nhận 401.
- **Điều kiện hoàn thành:** không endpoint đọc theo request/attachment ID nào chỉ dựa trên `requireAuth`.
- **Phụ thuộc:** Bước 4.

### Bước 6 - Bảo vệ update/cancel và attachment mutations

- **File/module liên quan:** `server/src/routes/requests.ts`, `server/src/engines/request.ts`, authorization layer.
- **Thay đổi dự kiến:** actor bắt buộc cho cancel/update; enforce owner và status; upload/delete load request cha; thêm transaction và conditional version update nơi phù hợp.
- **Test tương ứng:** A sửa/hủy B bị 404; approver xem được nhưng sửa/hủy bị 403; owner đúng trạng thái thành công; owner sai trạng thái/version cũ nhận 409; outsider upload/delete bị 404; policy HR/Admin theo quyết định Bước 1.
- **Điều kiện hoàn thành:** mọi mutation này kiểm tra actor + state + version trong transaction; không có orphan/unauthorized attachment write.
- **Phụ thuộc:** Bước 4-5.

### Bước 7 - Bảo vệ approve/reject và transaction hóa workflow

- **File/module liên quan:** `server/src/engines/request.ts`, `server/src/routes/requests.ts`, authorization layer.
- **Thay đổi dự kiến:** approve/reject load current pending approval trong transaction; authorize đúng actor/role/delegation; conditional update approval/request; giữ toàn bộ step transition/effect/audit/notification atomic.
- **Test tương ứng:** wrong approver 403/404 theo view; current approver thành công; prior approver không duyệt bước sau; repeat action 409; stale version 409; hai approve đồng thời chỉ một thành công; role step và Admin override theo rule đã chốt.
- **Điều kiện hoàn thành:** không thể xử lý current step nếu actor không entitled; không thể duplicate transition/effect dưới concurrency.
- **Phụ thuộc:** Bước 4 và quyết định role/delegation ở Bước 1.

### Bước 8 - Bảo vệ shift-swap partner response

- **File/module liên quan:** `server/src/engines/request.ts`, `server/src/routes/requests.ts`, authorization layer.
- **Thay đổi dự kiến:** dùng `canRespondToShiftSwap`; transaction hóa response + init approval; conditional version/status update.
- **Test tương ứng:** đúng partner accept/reject thành công; owner/người lạ/HR/Admin không phải partner bị chặn; version cũ hoặc phản hồi lần hai nhận 409.
- **Điều kiện hoàn thành:** `userId` không còn bị bỏ qua và approval chỉ được init một lần.
- **Phụ thuộc:** Bước 4, 7 vì dùng cùng transition pattern.

### Bước 9 - Đồng bộ capabilities/frontend tối thiểu

- **File/module liên quan:** `server/src/engines/request.ts`, frontend types/detail/widgets/API nếu cần.
- **Thay đổi dự kiến:** derive capabilities từ authorization layer; không dùng client list pending để quyết định duy nhất; xử lý 404/403/409 thân thiện, invalidate query sau conflict.
- **Test tương ứng:** UI không hiển thị action không được phép; gọi API thủ công vẫn bị backend chặn; stale version yêu cầu reload.
- **Điều kiện hoàn thành:** frontend phản ánh đúng policy nhưng không trở thành enforcement layer.
- **Phụ thuộc:** Bước 5-8.

### Bước 10 - Regression và security verification

- **File/module liên quan:** toàn bộ test suite request authorization; build/lint hiện có.
- **Thay đổi dự kiến:** chạy matrix đầy đủ, kiểm tra audit/notification/effects không chạy khi authorization hoặc conflict thất bại.
- **Test tương ứng:** matrix mục 8, build backend/frontend, lint và kiểm tra DB invariant.
- **Điều kiện hoàn thành:** tất cả tiêu chí mục 9 đạt; không có request mutation nhạy cảm ngoài policy/transaction.
- **Phụ thuộc:** tất cả bước trước.

## 8. Test matrix chi tiết

| ID | Actor / tình huống | Endpoint/action | Kỳ vọng |
|---|---|---|---|
| A01 | Chủ đơn | Xem detail/timeline/attachments của mình | `200`, đúng dữ liệu |
| A02 | Employee A | Xem detail đơn Employee B | `404`, response không phân biệt với ID không tồn tại |
| A03 | Employee A | Sửa đơn Employee B với version đúng | `404`, DB không đổi, không audit success |
| A04 | Employee A | Hủy đơn Employee B | `404`, balance/status không đổi |
| A05 | Chủ đơn, status cho sửa | Update với version đúng | `200`, version +1 |
| A06 | Chủ đơn, status không cho sửa/hủy | Update/cancel | `409` |
| A07 | HR được phép theo scope | View/list request | `200` |
| A08 | HR/Admin quản lý theo policy đã chốt | Modify/cancel/attachment | `200` hoặc `403` đúng bảng policy cuối cùng |
| A09 | Người không thuộc current step nhưng được view | Approve/reject | `403`, approval/request không đổi |
| A10 | Outsider không được view | Approve/reject | `404` |
| A11 | Đúng current approver | Approve | `200`, step hiện tại approved, chuyển đúng step/version |
| A12 | Đúng current approver | Reject | `200`, request rejected, effect/balance đúng |
| A13 | Người đã duyệt bước trước | Approve/reject bước sau | `403`; nếu cùng người ở step sau thì engine đã auto-merge theo flow, không action lần hai |
| A14 | Bất kỳ approver | Duyệt lại approval row đã xử lý | `409` |
| A15 | Current approver | Approve với version cũ | `409`, không update approval, không insert step |
| A16 | Hai request đồng thời cùng actor/version | Approve | Chính xác một `200`, một `409`; một next-step/effect duy nhất |
| A17 | Hai actor cạnh tranh ở role step | Approve đồng thời | Chính xác một thắng; actor còn lại `409` |
| A18 | Delegate hợp lệ | View + approve current delegated step | `200`, audit ghi thay mặt đúng |
| A19 | Delegate hết hạn | Approve | Bị chặn theo rule fallback đã chốt; không dùng snapshot cũ mù quáng |
| A20 | Delegation bị thu hồi | Approve | Bị chặn theo rule fallback đã chốt |
| A21 | Delegator gốc sau khi delegation hết hạn/thu hồi | Approve | Kết quả theo câu trả lời mục 11, test bắt buộc |
| A22 | Người lạ | List/download attachment | `404` |
| A23 | Người lạ | Upload vào request ID biết trước | `404`, không insert row |
| A24 | Người lạ | Delete attachment ID biết trước | `404`, file còn nguyên |
| A25 | Chủ đơn ở trạng thái cho sửa | Upload/delete attachment | `200` theo policy |
| A26 | Current approver | Upload/delete attachment | `200` hoặc `403` theo policy được chốt |
| A27 | Attachment không tồn tại | Delete/download | `404` |
| A28 | Request không tồn tại | Detail/timeline/mutation | `404` |
| A29 | Type không khớp ID thật | Detail/mutation | `404`, không lộ type thật |
| A30 | Đúng shift-swap partner | Accept/reject với version đúng | `200`, trạng thái/version đúng; accept init approval một lần |
| A31 | Người không phải partner | Partner response | `403` nếu được view, ngược lại `404` |
| A32 | Partner phản hồi lần hai | Partner response | `409` |
| A33 | JWT thiếu | Mọi protected endpoint | `401` |
| A34 | JWT sai chữ ký/hết hạn | Mọi protected endpoint | `401` |
| A35 | JWT còn role cũ nhưng DB đã thu hồi role | HR/Admin/approve action | Quyền mới từ DB được áp dụng; action bị chặn |
| A36 | Request view được nhưng action bị cấm | Modify/cancel/approve/attachment | `403`, không dùng `404` cho action-level denial sau khi đã xác định view |
| A37 | Authorization fail giữa flow | Approve/reject/cancel | Không audit success, notification, balance/schedule effect hoặc version increment |
| A38 | Lỗi khi insert next approval/effect | Approve transaction | Toàn bộ transaction rollback |

Ngoài status code, mỗi integration test mutation phải assert invariant DB: `request_version`, request status, approval statuses/count, attachment count, leave balance, schedule/effect, audit và notification.

## 9. Tiêu chí hoàn thành

- Sáu hàm policy dùng chung tồn tại và có unit tests.
- Tất cả endpoint trong mục tiêu đều enforce backend authorization.
- Không route request-sensitive nào chỉ dựa vào frontend `capabilities` hoặc ẩn nút.
- Người không có quyền nhận `404` cho resource-scoped reads và không suy ra resource tồn tại.
- Actor xem được nhưng không được action nhận `403` theo bảng đã chốt.
- Missing/invalid/expired JWT luôn nhận `401`.
- Version cũ, step/status đã thay đổi và race loser nhận `409`.
- Update/cancel/approve/reject/partner response có authorization + state + version check trong transaction.
- Hai approve đồng thời chỉ tạo một kết quả nghiệp vụ.
- Delegation active/expired/revoked có test và hành vi đã được xác nhận.
- Attachment read/upload/delete luôn authorize qua request cha.
- Frontend vẫn chạy các flow hiện tại và xử lý conflict/forbidden/not-found hợp lý.
- Backend build, frontend build/lint và toàn bộ test matrix đạt.
- Không thay đổi ngoài phạm vi phase.

## 10. Rủi ro và phương án rollback

### Rủi ro

- **Cao - Role approver không được biểu diễn rõ:** approval row ghi user cụ thể nhưng pending list cho cả role bằng chuỗi tên. Siết sai có thể khóa người duyệt hợp lệ hoặc tiếp tục mở rộng quyền quá mức.
- **Cao - Delegation snapshot:** approval pending đã assign delegate có thể tồn tại sau khi delegation hết hạn/thu hồi; chưa có quy tắc reassignment.
- **Cao - Transaction hóa effects:** approve cuối có thể cập nhật leave balance, schedule/attendance và notification; bỏ sót write ngoài transaction gây trạng thái nửa vời.
- **Trung bình - JWT claims cũ:** hydrate user từ DB tăng query nhưng cần để role bị thu hồi có hiệu lực ngay.
- **Trung bình - Attachment payload lớn:** detail hiện nhúng data URL; refactor query có thể làm thay đổi frontend caching/download.
- **Trung bình - Frontend phụ thuộc capabilities:** thêm capability fields hoặc siết attachment có thể làm thay đổi nút đang hiển thị.
- **Thấp - Route ordering hiện tại:** các route generic `/:type/:id` đứng trước một số route cụ thể; đây là vấn đề hiện hữu nhưng không tự sửa nếu không ảnh hưởng trực tiếp test authorization.

### Rollback

- Triển khai thành các commit nhỏ theo bước 4-9 để có thể revert từng lớp.
- Không xóa cột `capabilities` hoặc thay schema destructive trong phase này.
- Giữ nguyên endpoint/payload hiện tại; authorization layer có thể được gỡ khỏi từng route độc lập nếu cần rollback khẩn cấp.
- Nếu transaction refactor gây regression, rollback engine mutation về commit trước nhưng không deploy lại các route IDOR cũ; ưu tiên giữ read authorization fix.
- Trước triển khai production, sao lưu SQLite DB theo quy trình hiện tại; phase này không dự kiến migration.
- Feature flag authorization không được khuyến nghị vì có thể vô tình bật lại lỗ hổng; rollback phải bằng version deploy đã biết, không bằng bypass runtime.

## 11. Những câu hỏi nghiệp vụ cần xác nhận

1. **HR/Admin “quản lý” chính xác gồm action nào?** Chỉ view/list, hay được sửa/hủy đơn thay nhân viên, approve/reject ngoài flow, upload/delete attachment?

2. **Admin có quyền approve/reject mọi bước như hiện tại không?** Nếu có, đây là override độc lập hay Admin chỉ được action khi approval step resolve tới Admin?
3. **HR có được xem toàn bộ request hay chỉ theo `department_scopes`?** Admin có luôn toàn công ty không?
4. **Manager/Director/Accountant từng duyệt bước trước có tiếp tục được xem detail/timeline sau khi đơn chuyển bước hoặc hoàn tất không?** Đề xuất mặc định: được xem vì là approver liên quan, nhưng không được action bước sau.
5. **Bước approver theo role (HR/Accountant/Director) là “bất kỳ user đang có role” hay chỉ user cụ thể đã được resolve vào `approver_user_id`?** Đây là quyết định quan trọng nhất cho `canApproveCurrentStep`.
6. **Nếu nhiều user cùng role đều có thể duyệt, có cần scope phòng ban hoặc cơ chế claim/assignment không?** Ai thắng race sẽ xử lý bước; những người còn lại chỉ thấy lịch sử hay không?
7. **Delegation hết hạn/thu hồi khi một approval đang pending:** delegate mất quyền ngay chứ? Approval quay về delegator gốc, tự resolve lại approver hiện tại, hay cần HR/Admin reassign thủ công?
8. **Delegator gốc có được xem và/hoặc approve trong thời gian delegation còn active không?** Đề xuất: được xem, không approve khi đã giao quyền.
9. **Attachment:** current approver có được upload tài liệu bổ sung không? Có được xóa file của chủ đơn không? HR/Admin có override xóa không?
10. **Có cần lưu người upload attachment để áp dụng “chỉ người upload được xóa” không?** Nếu có sẽ cần migration, nằm ngoài giả định “không migration” ban đầu.
11. **Attachment mutation có phải tăng `request_version` và yêu cầu `expectedVersion` không?** Đề xuất: nếu attachment là một phần hồ sơ cần optimistic locking, có; nếu tách độc lập, không tăng version nhưng vẫn transaction/authz.
12. **Chủ đơn được sửa/hủy Pending sau khi đã có một hoặc nhiều cấp duyệt hoàn tất không?** Logic hiện tại cho phép theo status, có thể làm nội dung đã duyệt thay đổi mà không reset approval flow.
13. **Khi sửa đơn Pending, có phải reset approvals/current level hoặc chạy lại điều kiện flow/quỹ phép/OT cap không?** Phase authorization không nên tự quyết định.
14. **Partner đổi ca có được xem toàn bộ detail/timeline/attachments hay chỉ phần thông tin cần để phản hồi?** Đề xuất nhỏ nhất hiện tại: được view request liên quan, nhưng attachment cần xác nhận.
15. **Khi actor không phải current approver nhưng là owner/prior approver, approve/reject trả `403`; outsider trả `404` - có đồng ý quy ước này không?**

## 12. Những phần cố ý không làm trong phase này

- Không thay đổi chấm công, face recognition, bảng công, bảng tổng hợp, tính lương hoặc payroll.
- Không thay đổi realtime, notification transport hoặc chatbot.
- Không redesign giao diện hoặc điều hướng lớn.
- Không thay đổi quy trình duyệt, số cấp, điều kiện flow, OT cap, leave balance hoặc business effects trừ phần cần để transaction atomic.
- Không đổi cơ chế JWT sang cookie/session, không xử lý CSRF tổng thể; chỉ hydrate authorization actor từ DB nếu được duyệt.
- Không xử lý rate limiting, CSP hoặc các hạng mục security ngoài request authorization.
- Không sửa delegation CRUD ngoài phần cần đọc trạng thái delegation để authorize request action.
- Không tự thêm migration/schema cho `approver_role`, attachment uploader hoặc unique index khi chưa chốt nghiệp vụ.
- Không sửa route ordering hoặc các endpoint catalog/shift lookup trừ khi test chứng minh nó cản trở trực tiếp authorization phase.
- Không thay frontend thành authority; frontend chỉ phản ánh kết quả policy backend.


## 13. Quyết định nghiệp vụ đã chốt

1. **HR/Admin “quản lý” gồm action nào?**

   * **HR:** được `view/list` request trong `department_scopes` được phép.
   * **Admin:** được `view/list` toàn bộ request trong hệ thống.
   * HR/Admin **không được sửa hoặc hủy đơn thay nhân viên** chỉ vì có role HR/Admin.
   * HR/Admin chỉ được `approve/reject` nếu chính họ là actor hợp lệ của approval step hiện tại.
   * HR/Admin được đọc/download attachment nếu có quyền xem request.
   * Không có quyền xóa attachment override trong Phase 1.
   * Nếu HR/Admin đồng thời là current approver thì áp dụng quyền của current approver.

2. **Admin có quyền approve/reject mọi bước như hiện tại không?**

   **Không.**

   Trong Phase 1, Admin không có global approval bypass.

   Admin chỉ được approve/reject khi approval step hiện tại thực sự resolve đến Admin đó.

   Nếu sau này cần chức năng emergency override thì triển khai thành policy riêng, endpoint/action explicit và bắt buộc audit rõ `admin override`; không ngầm cho phép chỉ vì actor có role Admin.

3. **HR xem toàn bộ request hay theo `department_scopes`? Admin có toàn công ty không?**

   * HR chỉ được xem request thuộc `department_scopes` hiện tại của HR.
   * Admin được xem toàn công ty.
   * Scope và role phải hydrate lại từ DB tại thời điểm request; không lấy JWT claims cũ làm authority.

4. **Manager/Director/Accountant đã duyệt bước trước có tiếp tục được xem request không?**

   **Có.**

   Người đã từng là approver hợp lệ của request được tiếp tục xem:

   * detail;
   * timeline;
   * attachment ở chế độ read/download.

   Tuy nhiên họ không được approve/reject bước sau trừ khi bước sau độc lập resolve lại đúng chính họ.

5. **Approver theo role là bất kỳ user có role hay user cụ thể trong `approver_user_id`?**

   **Phase 1 dùng user cụ thể đã resolve vào `approver_user_id`.**

   `approver_user_id` của current approval row là authority chính cho quyền approve/reject.

   Không dùng `approver_name.includes(...)` và không cho tất cả user cùng role cùng có quyền approve chỉ dựa trên role.

   Lý do:

   * phù hợp schema hiện tại;
   * tương thích với delegation hiện tại;
   * không cần migration;
   * tránh mở rộng quyền ngoài ý muốn.

   Nếu nghiệp vụ sau này thực sự cần mô hình “approval pool theo role”, triển khai thành phase riêng với representation có cấu trúc như `approver_role`, scope và concurrency rule rõ ràng.

6. **Nếu nhiều user cùng role thì có cần scope/claim không?**

   Không áp dụng trong Phase 1 vì role step được resolve thành một `approver_user_id` cụ thể.

   Không triển khai cơ chế “ai cùng role approve trước thì thắng” trong Phase 1.

   Nếu sau này chuyển sang role-pool approval thì bắt buộc thiết kế thêm:

   * department scope;
   * eligibility;
   * claim/assignment hoặc first-writer-wins;
   * audit actor thực tế;
   * concurrency protection.

7. **Delegation hết hạn/thu hồi khi approval đang pending thì xử lý thế nào?**

   Delegate **mất quyền approve/reject ngay lập tức** khi delegation hết hạn hoặc bị revoke.

   Approval không cần tạo row mới.

   Quyền action quay về **delegator gốc** được lưu trong `on_behalf_of_user_id`.

   Khi authorize:

   * delegation còn active → delegate được action;
   * delegation hết hạn/revoked → delegate bị chặn và delegator gốc được action.

   Việc kiểm tra delegation phải thực hiện lại tại thời điểm action, không tin snapshot cũ.

8. **Delegator gốc có được xem/approve khi delegation đang active không?**

   * Được **view** request, timeline và attachments.
   * **Không được approve/reject** trong thời gian delegation còn active.
   * Khi delegation hết hạn/revoked thì quyền approve/reject quay lại delegator nếu step vẫn pending.

9. **Current approver và HR/Admin có quyền gì với attachment?**

   * Owner:

     * read/download;
     * upload khi request còn ở trạng thái cho phép chỉnh sửa hồ sơ;
     * delete khi request còn ở trạng thái cho phép chỉnh sửa hồ sơ.
   * Current approver:

     * read/download;
     * được upload tài liệu bổ sung trong lúc step của mình đang pending;
     * không được xóa attachment trong Phase 1.
   * Prior approver:

     * chỉ read/download.
   * HR/Admin:

     * read/download nếu có quyền view request;
     * không có delete override;
     * chỉ được upload nếu đồng thời là current approver.

10. **Có cần lưu uploader của attachment không?**

    **Không trong Phase 1.**

    Không migration schema chỉ để thêm uploader ở phase authorization này.

    Vì chưa lưu uploader nên Phase 1 không áp dụng rule “chỉ người upload mới được xóa”.

    Nếu sau này cần current approver có thể xóa chính file mình upload thì thêm `uploaded_by_user_id` trong migration riêng.

11. **Attachment mutation có tăng `request_version` và yêu cầu `expectedVersion` không?**

    **Không trong Phase 1.**

    Upload/delete attachment được xem là mutation độc lập:

    * vẫn phải authorization qua request cha;
    * vẫn kiểm tra trạng thái request phù hợp;
    * vẫn chạy trong transaction thích hợp;
    * nhưng không increment `request_version`;
    * không yêu cầu frontend gửi `expectedVersion`.

    `request_version` tiếp tục bảo vệ các mutation thay đổi request/workflow chính như update, cancel, approve, reject và partner response.

12. **Owner có được sửa/hủy Pending sau khi approval đã bắt đầu không?**

    Tách hai action:

    **Modify:** không được sửa nội dung sau khi approval workflow đã bắt đầu.

    Nếu request đã có approval step được khởi tạo thì owner không được modify nội dung nữa. Việc này tránh trường hợp approver đang duyệt một nội dung nhưng owner thay đổi nội dung phía dưới.

    **Cancel:** owner vẫn được cancel request khi request chưa ở trạng thái terminal, kể cả đã có một số approval step hoàn tất, miễn business effect cuối cùng chưa hoàn tất.

    Cancel phải transaction hóa và không cho approval tiếp tục xử lý sau khi request đã cancelled.

13. **Khi sửa Pending có reset approvals/current level không?**

    **Không triển khai reset approval flow trong Phase 1.**

    Phase 1 không cho sửa nội dung sau khi approval workflow đã được initialize, vì vậy không phát sinh trường hợp phải reset approval/current level.

    Nếu tương lai muốn hỗ trợ “edit after submit”, đây phải là nghiệp vụ riêng:

    * reset hoặc invalidate approvals;
    * resolve lại flow;
    * chạy lại condition;
    * validate leave balance/OT cap;
    * tăng version;
    * audit thay đổi.

14. **Shift-swap partner được xem những gì?**

    Partner được xem request liên quan đủ để đưa ra quyết định và trong Phase 1 được:

    * xem request detail;
    * xem timeline;
    * read/download attachments.

    Partner không được:

    * sửa/hủy request;
    * upload/delete attachment;
    * approve/reject approval workflow.

    Chỉ đúng `suggested_swap_partner_id` mới được thực hiện partner response.

    Nếu sau này attachment có dữ liệu nhạy cảm không nên chia sẻ cho partner thì cần tách attachment visibility thành policy chi tiết hơn.

15. **Status code cho actor không phải current approver?**

    **Đồng ý quy ước:**

    * Owner/prior approver/partner/HR/Admin có quyền view request nhưng không có quyền approve/reject → `403 Forbidden`.
    * Outsider không có quyền biết request tồn tại → `404 Not Found`.
    * Request thực sự không tồn tại → `404 Not Found`.
    * JWT thiếu/sai/hết hạn → `401 Unauthorized`.
    * Actor đúng quyền nhưng version cũ, step đã được xử lý, request status/current level đã thay đổi hoặc thua race → `409 Conflict`.

### Kết luận Phase 1

Authorization Phase 1 sử dụng nguyên tắc:

**Identity từ JWT, authority từ DB, quyền action từ authorization layer, ownership/current approval từ dữ liệu mới nhất trong transaction.**

Không dùng frontend `capabilities`, JWT role claims cũ, `approver_name` hoặc role chung làm nguồn quyết định quyền cuối cùng.

Không triển khai Admin approval bypass, role-pool approval, attachment uploader migration hoặc edit-after-approval trong Phase 1.
