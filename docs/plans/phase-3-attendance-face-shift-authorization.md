# Phase 3 - Attendance, Face & Shift Authorization

Ngày lập kế hoạch: **2026-08-29**.

## 1. Mục tiêu và phạm vi

Bảo vệ attendance, face recognition, device punch, proxy punch, employee timesheet và shift scheduling bằng permission + ownership/scope rules ở backend.

Endpoint chính:

- `/api/attendance/*`
- `/api/face/*`
- `/api/shifts/*`
- Request helper `/api/requests/my-shift/:date` và `/partner-shift/:partnerId/:date`

## 2. Hiện trạng và lỗ hổng đã xác minh

- Self attendance routes dùng `req.user.employeeId`, tương đối an toàn nhưng chưa có permission matrix và input range validation thống nhất.
- `/attendance/proxy-punch` chỉ yêu cầu đăng nhập; chưa xác minh actor có quyền proxy punch hoặc target thuộc scope.
- `/attendance/leavers-today` có nguy cơ lộ danh sách nhân viên ngoài scope.
- `/requests/partner-shift/:partnerId/:date` chỉ yêu cầu đăng nhập, có thể tra ca của nhân viên bất kỳ bằng ID.
- Shift/schedule routes dùng role chung; Manager có thể nhận danh sách toàn bộ nhân viên nếu không truyền filter.
- `device-punch` có default shared secret `technova-device`, chưa có device identity, rotation hoặc rate/replay protection.
- Face data là dữ liệu sinh trắc học nhạy cảm; cần bảo đảm self-only và không log descriptor/snapshot.
- `GET /requests/my-shift/:date` được khai báo sau `GET /requests/:type/:id`, nên có thể bị generic route bắt nhầm.
- Frontend tra ca partner trước khi request tồn tại; policy “chỉ owner request/partner” chưa đủ cho preview flow.
- Face attempt token chưa được ghi rõ phải bind với đúng actor và consume atomic.

## 3. Quy tắc phân quyền đề xuất

- Employee xem/chấm công và face data của chính mình.
- Manager chỉ xem attendance/schedule và proxy punch cho employee trong scope được xác nhận.
- HR/Admin xem/quản lý theo permission; HR vẫn bị department scope nếu business chưa cho global.
- Director/Accountant không mặc nhiên được xem attendance cá nhân chi tiết nếu chỉ cần aggregate report.
- Partner shift lookup chỉ cho owner request hoặc đúng suggested partner trong ngữ cảnh tạo/đổi ca hợp lệ.
- Device punch dùng device credential bắt buộc từ environment/database, không có insecure default production.
- Face register/status/attempt/verify luôn gắn `employeeId` từ actor, không nhận target employee từ client.

Permission dự kiến:

- `attendance.punch.self`
- `attendance.view.self`
- `attendance.view.scoped`
- `attendance.proxy_punch.scoped`
- `attendance.timesheet.confirm_self`
- `attendance.leave_plan.view_self`
- `attendance.leavers.view_scoped`
- `face.manage.self`
- `shifts.catalog.view`
- `shifts.catalog.manage`
- `shifts.schedule.view_self`
- `shifts.schedule.view_scoped`
- `shifts.schedule.manage_scoped`

## 4. Authorization layer đề xuất

- `canViewAttendance(actor, employee, action)`
- `canProxyPunch(actor, targetEmployee)`
- `canViewShiftSchedule(actor, targetEmployee)`
- `canManageShiftAssignment(actor, targetEmployee)`
- `canViewLeavePlan(actor, targetEmployee)`
- `canUseFaceIdentity(actor, employeeId)`
- `authorizeDevicePunch(device, employeeCode, timestamp)`

## 5. Endpoint/permission/status table

| Endpoint | Permission | Relation/scope | Status chính |
|---|---|---|---|
| `POST /attendance/punch` | `attendance.punch.self` | Self | 200/400/401/403/409 |
| `POST /attendance/proxy-punch` | `attendance.proxy_punch.scoped` | Target trong scope | 200/400/401/403/404/409 |
| `GET /attendance/today/detail/timesheet` | `attendance.view.self` | Self | 200/400/401/403 |
| `POST /attendance/confirm-timesheet` | `attendance.timesheet.confirm_self` | Own detail + valid state | 200/400/401/404/409 |
| `GET/POST /face/*` | `face.manage.self` | Token/face data của self | 200/400/401/403/409 |
| `GET /shifts/schedule` | `shifts.schedule.view_scoped` | Filtered scope | 200/400/401/403 |
| `POST /shifts/assign`, `/bulk-assign` | `shifts.schedule.manage_scoped` | Mọi target trong scope | 200/400/401/403/404/409 |
| `GET /requests/my-shift/:date` | shift self permission | Self | 200/400/401/403 |
| `GET /requests/partner-shift/:partnerId/:date` | partner-preview permission | Catalog token hoặc approved preview scope | 200/400/401/404 |

## 6. File/module dự kiến thay đổi

- `server/src/authz/attendanceAuthorization.ts`
- `server/src/authz/shiftAuthorization.ts`
- `server/src/services/deviceAuthService.ts`
- `server/src/routes/attendance.ts`
- `server/src/routes/face.ts`
- `server/src/routes/shifts.ts`
- `server/src/routes/requests.ts` cho shift lookup.
- `server/src/engines/attendance.ts` cho transaction/idempotency nếu cần.
- `server/src/db.ts` hoặc migration files cho device identity nếu chốt.
- Frontend attendance/shift API, pages và capability types.

## 7. Các bước triển khai

### Step 3.1 - RED tests cho IDOR/scope

- Test outsider/Manager ngoài scope gọi proxy punch, partner shift lookup và schedule list.
- Test self attendance/face vẫn hoạt động.
- Contract test static request helper routes không bị `/:type/:id` shadow.
- Hoàn thành: test chứng minh route hiện tại trả dữ liệu/action quá rộng.
- Phụ thuộc: Phase 2.

### Step 3.2 - Attendance/shift policy và scoped query helpers

- Thêm relation helpers cho self, department scope và reporting relation đã chốt.
- Query phải lọc tại DB/service hoặc trước mapping; không fetch toàn hệ thống rồi trả nhầm.
- Test Manager trong/ngoài scope, HR scope, Admin global nếu được cấp permission.
- Chốt partner preview: đề xuất `/requests/catalog` trả partner IDs hợp lệ và token ngắn hạn/bounded lookup; projection chỉ ca/ngày cần thiết.
- Sửa route ordering hoặc constrain `:type` theo `VALID_TYPES` trước khi authorize.
- Phụ thuộc: Step 3.1.

### Step 3.3 - Bảo vệ proxy punch và confirmation

- Proxy punch kiểm tra permission, target active, scope và source hợp lệ trong transaction.
- Confirm summary detail phải đúng employee và đúng trạng thái cho phép; not-found/hidden trả 404.
- Audit ghi actor/target/source nhưng không ghi biometric/base64.
- Phụ thuộc: Step 3.2.

### Step 3.4 - Face data boundary

- Tách validation service, giới hạn payload, bảo vệ attempt token và replay.
- Không cho route nhận target employee tùy ý.
- Token phải thuộc đúng DB-fresh actor; consume bằng conditional update `used=0` trong transaction.
- Test descriptor invalid, token reuse, token user A dùng bởi user B, hai verify đồng thời, user disabled.
- Phụ thuộc: Step 3.2.

### Step 3.5 - Device punch hardening

- Loại insecure default ở production; xác định credential rotation/device identity.
- Validate timestamp window, employee state, duplicate/replay và request size.
- Test missing/wrong key, stale timestamp, replay, valid device.
- Phụ thuộc: quyết định device credential.

### Step 3.6 - Shift catalog/schedule enforcement

- Catalog view/manage và schedule view/manage tách riêng.
- Manager không được assign/bulk assign ngoài scope.
- Delete/assign/bulk assign + recompute chạy transaction; bulk fail toàn bộ nếu một target/date/shift invalid.
- Test retry/duplicate assignment và partial bulk failure.
- Phụ thuộc: Step 3.2.

### Step 3.7 - Frontend capabilities và regression

- Frontend chỉ hiển thị proxy/assign/view controls theo capability backend.
- Build và integration test toàn phase.
- Phụ thuộc: Step 3.3–3.6.

## 8. Test matrix

- Employee xem/chấm công chính mình.
- Employee xem attendance/shift của employee khác.
- Manager trong scope và ngoài scope.
- HR với department scope; Admin với global permission.
- Proxy punch target hợp lệ/ngoài scope/inactive.
- Face status/register/attempt/verify của chính mình và token replay.
- Device key thiếu/sai/hợp lệ; timestamp stale; duplicate punch.
- Shift schedule list/assign/bulk assign ngoài scope.
- Confirmation detail của chính employee và employee khác.
- JWT stale role và user disabled.

## 9. Tiêu chí hoàn thành

- Không còn attendance/face/shift route nhạy cảm chỉ dựa `requireRole` hoặc login.
- Partner shift lookup không còn IDOR.
- Proxy punch và bulk assign bị scope chặn ở backend.
- Device/face secrets và payload nhạy cảm không bị log.
- Tất cả test/build pass.

## 10. Rủi ro và rollback

- Scope sai có thể khóa Manager: rollout permission theo module, log deny có kiểm soát, giữ snapshot matrix.
- Device credential thay đổi có thể ngắt máy chấm công: hỗ trợ rotation window trước khi bỏ key cũ.
- Rollback không phục hồi insecure default; có thể tạm disable device endpoint bằng config.

## 11. Câu hỏi cần xác nhận

- Đã chốt 2026-08-30: effective scope là hợp của `department_scopes` (gồm phòng ban con) và reporting line trực tiếp/gián tiếp, nhưng chỉ có hiệu lực khi actor có permission tương ứng.
- HR không mặc định global; `attendance.view_all` mới cho toàn công ty, `attendance.view_scoped` chỉ cho effective scope.
- Proxy punch yêu cầu `attendance.proxy_punch`, target trong effective scope, target khác self và lý do có nội dung; punch/audit giữ provenance proxy rõ ràng.
- Mỗi máy chấm công có `device_id` và credential hash riêng, hỗ trợ rotate/revoke; không dùng shared fallback key.
- Partner preview dùng cùng tập eligibility DB-fresh với request catalog; stale catalog và cross-department IDOR bị từ chối, chưa dùng preview token ở Phase 3.
- Scope rỗng luôn deny; global chỉ đến từ permission `view_all`/`manage_all` rõ ràng.

## 12. Verification commands

- Backend: build + toàn bộ test, đặc biệt attendance/face/shift integration trên DB tạm.
- Frontend: lint/build và capability UI tests.
- Repository: `git diff --check`.

## 13. Không làm

- Không thay thuật toán tính công/OT ngoài phần atomicity bắt buộc.
- Không thay model face recognition.
- Không redesign trang attendance/shift lớn.

## 14. Plan mutation log

- 2026-08-29: bổ sung route shadowing, partner preview contract, face token actor binding/atomic consume và shift mutation atomicity sau adversarial review.
- 2026-08-30: ghi nhận policy đã chốt và triển khai permission-driven effective scope, proxy provenance, per-device credential, partner DB-fresh eligibility và frontend capability cho shift management.
