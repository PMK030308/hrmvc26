# Authorization Hardening Roadmap sau Phase 1

Ngày rà soát source: **2026-08-29**.

## 1. Mục tiêu tổng thể

Roadmap này tiếp tục chương trình siết phân quyền sau `phase-1-request-authorization.md`. Mục tiêu là đưa toàn bộ backend về cùng một mô hình:

- JWT chỉ xác nhận danh tính phiên đăng nhập.
- User, role, department scope và permission được tải mới từ database cho thao tác nhạy cảm.
- Permission matrix quyết định khả năng chức năng; ownership, scope, trạng thái và quan hệ nghiệp vụ vẫn là điều kiện bắt buộc.
- Frontend chỉ dùng capability để trình bày, không phải nơi thực thi quyền.
- Mutation quan trọng có transaction, optimistic locking hoặc idempotency phù hợp.
- Actor không có quyền biết resource tồn tại nhận `404`; actor nhìn thấy resource nhưng không được action nhận `403`; xung đột trạng thái/version nhận `409`.

## 2. Hiện trạng đã xác minh

Phase 1 đã bảo vệ request detail/timeline/update/cancel/approve/reject/attachment/shift-swap response và đã có bảng `role_feature_permissions`. Phase 1 **không có nghĩa mọi endpoint `/requests/*` đã hoàn tất**: create, catalog, OT usage và shift lookup vẫn phải được đưa vào Phase 2–3. Các phân hệ còn lại vẫn dùng nhiều `requireRole(...)` dựa vào role snapshot trong JWT và một số route trả dữ liệu toàn hệ thống chỉ vì actor có role chung.

Các bề mặt còn lại:

- Attendance, face punch, device punch, proxy punch và employee timesheet.
- Shift catalog và phân ca.
- Organization/employee directory, wage/profile fields.
- Delegation lifecycle.
- Regulations, leave types, role/user management, audit và notifications.
- Summary timesheet, payroll, dashboard và reports.
- Chatbot tool-calling truy vấn trực tiếp database.
- Database integrity, attachment metadata, input limits, deployment/rollback và regression toàn hệ thống.

## 3. Số phase và thứ tự

| Phase | Tên | Phụ thuộc | Kết quả chính |
|---|---|---|---|
| 1 | Request Authorization | Hoàn thành | Request authorization layer và request permission matrix |
| 2 | Shared Authorization Foundation | Phase 1 + quyết định authority/bootstrap | Permission registry chung, DB-fresh actor, migration harness, middleware/capability dùng lại |
| 3 | Attendance, Face & Shift Authorization | Phase 2 | Self/scope authorization cho chấm công, khuôn mặt và phân ca |
| 4 | Organization, Delegation & Admin Authorization | Phase 2 | Bảo vệ dữ liệu nhân sự, delegation, config, role/user, audit |
| 5 | Timesheet, Payroll & Reporting Authorization | Phase 3 + 4 | Bảo vệ dữ liệu công/lương và workflow tổng hợp lương |
| 6 | Chatbot Tool Authorization | Phase 2 + policy từ Phase 3–5 | Tool chatbot gọi cùng service/authorization như REST API |
| 7 | Integrity, Hardening & Rollout | Phase 1–6 | Constraint, input/file hardening, regression, rollout/rollback |

Tổng cộng: **7 phase**, trong đó Phase 1 đã hoàn thành và còn **6 phase**.

## 4. Dependency graph

```text
Phase 1 Request Authorization
            |
            v
Phase 2 Shared Authorization Foundation
       |                     |
       v                     v
Phase 3 Attendance      Phase 4 Org/Admin
       \                     /
        \                   /
         v                 v
      Phase 5 Timesheet/Payroll/Reports
                    |
                    v
          Phase 6 Chatbot Authorization
                    |
                    v
       Phase 7 Integrity/Hardening/Rollout
```

Theo yêu cầu hiện tại, các phase sẽ được triển khai **tuần tự**, kể cả khi graph cho phép Phase 3 và Phase 4 chạy song song.

## 5. Invariant bắt buộc qua mọi phase

- Không dùng frontend route guard hoặc việc ẩn nút làm authority.
- Không dùng `approver_name`, tên role hiển thị hoặc dữ liệu LLM làm bằng chứng quyền.
- Không tin role/scope cũ trong JWT cho mutation nhạy cảm.
- Không trả dữ liệu toàn công ty cho Manager/Accountant nếu chưa áp scope rõ ràng.
- Không ghi log secret, token, face descriptor, ảnh base64, payroll chi tiết hoặc dữ liệu nhạy cảm.
- Không làm thay đổi business calculation nếu phase chỉ xử lý authorization.
- Mỗi permission mới phải có default rõ ràng, endpoint mapping, test matrix và UI matrix nếu Admin cần chỉnh.
- Mỗi phase phải chạy backend tests/build, frontend build/lint liên quan và `git diff --check`.

## 6. Cách triển khai

Chế độ thực hiện là **direct mode trong worktree hiện tại**:

- Không tự commit, push, tạo PR hoặc chạy production migration.
- Giữ nguyên thay đổi ngoài phạm vi, đặc biệt file chatbot đang có thay đổi của người dùng.
- Mỗi phase bắt đầu bằng RED test, triển khai nhỏ theo step, rồi GREEN verification.
- Mỗi phase có rollback ở mức feature/module; không rollback bằng `git reset --hard`.

## 7. Gate chuyển phase

Chỉ chuyển sang phase tiếp theo khi:

1. Tất cả endpoint trong phase có permission + relation/scope rule rõ ràng.
2. Test matrix của phase pass.
3. Backend/frontend build pass.
4. Không còn role check rải rác trong các route thuộc phạm vi phase, trừ bootstrap/emergency guard được ghi rõ.
5. Không làm thay đổi response contract ngoài phần đã ghi trong plan.
6. Rủi ro migration/rollback đã được kiểm tra trên database tạm.
7. Đã kiểm kê các đường truy cập chéo domain (dashboard, chatbot, catalog/helper endpoint), không chỉ route nằm trong file chính của module.

## 8. Protocol thay đổi roadmap

Nếu source thực tế làm phát sinh yêu cầu mới:

- Ghi finding vào phần “Plan mutation log” của file phase liên quan.
- Chỉ chèn step mới nếu nó cần để đạt tiêu chí hoàn thành của phase.
- Hạng mục khác nghiệp vụ được chuyển sang phase phù hợp hoặc một phase mới, không lén mở rộng scope.
- Quyết định nghiệp vụ chưa chắc chắn phải được liệt kê và dừng đúng step phụ thuộc quyết định đó.

## 9. Readiness và blocker

| Phase | Trạng thái | Blocker trước implementation |
|---|---|---|
| 2 | Chưa sẵn sàng | Active-user semantics; authority của `users.permissions`; bootstrap Admin/matrix recovery |
| 3 | Chưa sẵn sàng | Manager/HR scope; proxy punch; partner shift preview; device credential |
| 4 | Chưa sẵn sàng | Employee field projection; scope hierarchy; delete/deactivate; Admin delegation override |
| 5 | Chưa sẵn sàng | Payroll state/version/approval model; HR/Director payroll visibility |
| 6 | Phụ thuộc | Chờ policy/service Phase 1–5; quyết định draft token chỉ sau threat model |
| 7 | Phụ thuộc | Attachment uploader/storage/limits; staging/DB copy và session/secret rollout |

Không bắt đầu code step phụ thuộc blocker cho đến khi quyết định được ghi vào file phase tương ứng.

## 10. Những phần chưa tự quyết định

- Manager được scope theo `department_scopes`, theo reporting line, hay cả hai.
- HR có được xem wage/payroll chi tiết trong department scope hay chỉ dữ liệu nhân sự không lương.
- Accountant được xem employee directory tới mức nào.
- Ai được proxy punch và có cần employee consent/notification không.
- Device punch có danh sách device/rotation key hay chỉ một shared key.
- Attachment uploader ownership và quyền xóa file của uploader.
- Có cho sửa request sau khi approval đã bắt đầu hay không.
- Payroll approval có cần optimistic version riêng và nhiều bước duyệt hay không.
- Tài khoản active dựa `users.is_active` mới hay `employees.status`; các trạng thái Probation/OnLeave/Resigned/Terminated xử lý thế nào.
- `users.permissions` là legacy presentation data, direct grant hay override.
- Bootstrap/recovery authority khi permission matrix bị cấu hình sai và bảo vệ Admin cuối cùng.

## 11. Exclusions

- Roadmap này không tuyên bố hệ thống “security-complete”.
- Không bao gồm SSO/MFA/SCIM, pentest độc lập, infrastructure hardening toàn diện hoặc compliance certification.
- Authentication/session baseline liên quan trực tiếp authorization rollout chỉ được xử lý ở Phase 7.

## 12. Roadmap amendment sau khi hoàn thành Phase 7

Ngày cập nhật: **2026-08-31**.

Roadmap ban đầu có 7 phase. Sau khi policy production được chốt, rollout được tách thêm hai phase để không trộn migration storage với session/retention:

| Phase | Tên | Phụ thuộc | Kết quả chính |
|---|---|---|---|
| 8 | Attachment Storage Transition | Phase 7 | `AttachmentStorage`, private durable storage, expand-contract migration và legacy backfill có checksum |
| 9 | Session Invalidation, Retention & Production Rollout | Phase 8 | `session_version`, one-time reset token, scheduled retention và final production rehearsal |

Thứ tự mới:

```text
Phase 7 Integrity/Hardening checkpoint
                  |
                  v
Phase 8 Attachment Storage Transition
                  |
                  v
Phase 9 Session/Retention/Production Rollout
```

Tổng roadmap hiện tại: **9 phase**. Phase 8 bắt buộc hoàn thành trước production rollout; không được dùng data URL attachment trong SQLite làm thiết kế production chính thức.
