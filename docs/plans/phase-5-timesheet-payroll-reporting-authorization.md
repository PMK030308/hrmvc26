# Phase 5 - Timesheet, Payroll & Reporting Authorization

Ngày lập kế hoạch: **2026-08-29**.

## 1. Mục tiêu và phạm vi

Bảo vệ dữ liệu bảng công, bảng công tổng hợp, phiếu lương, workflow chuyển lương, dashboard và report. Đây là phase dữ liệu tài chính/nhân sự nhạy cảm cao.

Endpoint chính:

- `/api/timesheet/*`
- `/api/payroll/*`
- `/api/dashboard/*`
- Các frontend admin/accountant/director report/payroll pages.

## 2. Hiện trạng và lỗ hổng đã xác minh

- `/timesheet/detailed` trả tất cả employee/attendance cho nhiều role, không áp scope Manager/HR.
- `/timesheet/list-summary` trả summary cùng toàn bộ details cho Manager/Director/Accountant.
- Build/confirm/rebuild/transfer workflow chỉ kiểm tra role, chưa kiểm tra state transition/idempotency/version.
- `transfer-to-payroll` insert payslip mỗi lần gọi; nguy cơ duplicate khi retry/concurrent call.
- Payroll sheet và dashboard salary/report trả dữ liệu toàn hệ thống theo role chung, không có data projection/scope rõ ràng.
- Report aggregate có thể vẫn tiết lộ lương cá nhân (`net`) theo employee.
- Frontend route guard không thay thế backend authorization.
- Endpoint approve payroll hiện chỉ ghi audit/trả `{ok:true}`; database chưa có payroll state/version/approved metadata.

## 3. Quy tắc phân quyền đề xuất

- Employee chỉ xem payslip của chính mình và confirm đúng summary detail của mình.
- Manager xem attendance/timesheet scoped nhưng không xem wage/net payroll mặc định.
- HR xem attendance/summary theo scope; quyền xem payroll detail cần permission riêng.
- Accountant xem payroll workflow/data cần thiết, không mặc nhiên xem private HR profile.
- Director xem aggregate/report và approve payroll nếu có permission; detail employee payroll là permission riêng.
- Admin không bypass workflow chỉ vì role; phải có permission/action relation.

Permission dự kiến:

- `timesheet.detail.view_self`
- `timesheet.detail.view_scoped`
- `timesheet.summary.build`
- `timesheet.summary.view_scoped`
- `timesheet.summary.confirm_hr`
- `timesheet.summary.rebuild`
- `timesheet.summary.transfer_payroll`
- `payroll.payslip.view_self`
- `payroll.sheet.view`
- `payroll.sheet.approve`
- `reports.attendance.view_scoped`
- `reports.payroll.view_aggregate`
- `reports.payroll.view_detail`

## 4. Workflow/state design

Đề xuất state transition được kiểm tra trong transaction:

```text
Summary Built -> HR Confirmed -> Transferred to Payroll -> Payroll Approved
```

- Không confirm/rebuild/transfer ở state không hợp lệ.
- Transfer phải idempotent theo `(period, employee_id)`.
- Approve payroll cần current state/version và audit đúng actor.
- Race loser trả `409`.

### Blocker nghiệp vụ/schema trước Step 5.3

Phải chốt trước khi code:

1. Approval thuộc payroll period, summary timesheet hay từng payslip.
2. Một bước hay nhiều bước; ai là current approver.
3. State/version/approved_by/approved_at nằm ở bảng nào.
4. Re-approve, partial period, regenerate/retransfer sau approve xử lý thế nào.
5. API nào nhận `expectedVersion` và response capability/state mới.

Mọi schema change dùng migration harness Phase 2.

## 5. Authorization/service design

- `canViewTimesheet(actor, employee)`
- `canViewSummary(actor, summary, detailProjection)`
- `canTransitionSummary(actor, summary, action)`
- `canViewPayslip(actor, payslip)`
- `canViewPayrollSheet(actor, period, projection)`
- `canApprovePayroll(actor, payrollState)`
- `reportProjectionFor(actor, reportType)`

## 6. Endpoint/permission/status table

| Endpoint | Permission | Relation/state | Status chính |
|---|---|---|---|
| `GET /timesheet/detailed` | `timesheet.detail.view_scoped` | Employee scope | 200/400/401/403 |
| `GET /timesheet/list-summary` | `timesheet.summary.view_scoped` | Metadata/detail projection | 200/401/403 |
| `POST build/confirm/rebuild/transfer` | action-specific | Valid workflow state/version | 200/400/401/403/404/409 |
| `GET /payroll/mine` | `payroll.payslip.view_self` | Self | 200/401/403 |
| `GET /payroll/by-period/:period` | self permission | Self + period | Chốt `200 null` compatibility hoặc `404` |
| `GET /payroll/sheet/:period` | `payroll.sheet.view` | Projection/scope | 200/401/403/404 |
| `POST /payroll/approve-payroll/:period` | `payroll.sheet.approve` | Current state/version | 200/401/403/404/409 |
| Dashboard/report payroll | aggregate/detail permission | Scope/projection | 200/400/401/403 |

## 7. File/module dự kiến thay đổi

- `server/src/authz/timesheetAuthorization.ts`
- `server/src/authz/payrollAuthorization.ts`
- `server/src/services/timesheetService.ts`
- `server/src/services/payrollService.ts`
- `server/src/services/reportService.ts`
- `server/src/routes/timesheet.ts`
- `server/src/routes/dashboard.ts`
- `server/src/lib/payroll.ts` chỉ khi cần transaction boundary, không đổi công thức.
- `server/src/db.ts`/migration cho unique/idempotency/version nếu cần.
- Frontend API/types/pages cho summary/payroll/report capabilities.

## 8. Các bước triển khai

### Step 5.1 - RED tests cho scope và payroll exposure

- Manager ngoài scope xem detailed/list-summary.
- HR scoped xem department khác.
- Role không có payroll detail xem sheet/report individual net.
- Employee xem payslip người khác bằng period/ID variation.
- Phụ thuộc: Phase 3 + 4.

### Step 5.2 - Scoped timesheet query/projection

- Tách self/scoped/global query.
- Summary list không tự động nhúng mọi detail nếu actor chỉ cần metadata.
- Hidden 404 cho detail ngoài scope.
- Phụ thuộc: Step 5.1.

### Step 5.3 - Summary workflow transaction/state

- Build, confirm, rebuild và transfer có service transaction.
- Validate transition; audit/side effects atomic.
- Test duplicate/retry/concurrent transfer.
- Phụ thuộc: Step 5.2.

### Step 5.4 - Payroll authorization và idempotency

- Self payslip giữ self-only.
- Sheet/period/detail projection theo permission.
- Unique guard cho `(period, employee_id)`; approve state/version.
- Phụ thuộc: Step 5.3 và migration plan.

### Step 5.5 - Dashboard/report data minimization

- Aggregate endpoint không trả individual net nếu chỉ có aggregate permission.
- Manager/HR report scope được lọc.
- Validate date/period/page inputs.
- Phụ thuộc: Step 5.2–5.4.

### Step 5.6 - Frontend capabilities và stale conflict UX

- Nút confirm/rebuild/transfer/approve theo backend capability.
- `409` yêu cầu reload state; không retry mù mutation tài chính.
- Phụ thuộc: Step 5.3–5.5.

## 9. Test matrix

- Employee self payslip và payslip người khác.
- Manager timesheet trong/ngoài scope; Manager không xem payroll detail.
- HR scoped/global permission.
- Accountant summary/payroll action phù hợp.
- Director aggregate vs detail permission.
- Build summary duplicate.
- Confirm sai state, rebuild sau transfer, transfer hai lần.
- Hai transfer/approve đồng thời.
- Payroll period không tồn tại.
- Date/period malformed.
- JWT stale role/user disabled.

## 10. Tiêu chí hoàn thành

- Không route timesheet/payroll/report nào trả dữ liệu toàn hệ thống chỉ vì role chung.
- Payroll transfer và approve idempotent/race-safe.
- Aggregate và detail permission tách rõ.
- Không thay công thức tính lương.

## 11. Rủi ro và rollback

- Unique constraint có thể fail vì dữ liệu duplicate hiện hữu: audit/cleanup script trước migration.
- Projection mới có thể làm frontend thiếu field: update types/pages cùng step.
- Rollback route/service nhưng giữ constraint bảo vệ duplicate nếu đã xác minh an toàn.

## 12. Câu hỏi cần xác nhận

- HR được xem payroll detail hay chỉ aggregate?
- Director được xem individual net hay chỉ tổng hợp?
- Manager có xem summary metadata của scope không?
- Payroll approval một bước hay cần workflow nhiều bước/version riêng?
- `/payroll/by-period/:period` giữ `200 null` hay đổi `404`?
- Chốt đầy đủ năm blocker state/schema ở mục 4.

## 13. Verification commands

- Backend build + timesheet/payroll/dashboard concurrency and authorization tests.
- Frontend lint/build + `409` reload behavior tests.
- Migration tests qua harness Phase 2; `git diff --check`.

## 14. Không làm

- Không đổi hệ số/công thức lương, OT, night shift.
- Không tích hợp ngân hàng/kế toán ngoài.
- Không redesign dashboard lớn.

## 15. Plan mutation log

- 2026-08-29: đánh dấu payroll approval state/version là blocker, thêm endpoint/status table và not-found compatibility decision sau adversarial review.
