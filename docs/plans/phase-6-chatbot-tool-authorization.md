# Phase 6 - Chatbot Tool Authorization

Ngày lập kế hoạch: **2026-08-29**.

## 1. Mục tiêu và phạm vi

Đảm bảo chatbot không trở thành đường vòng bỏ qua authorization của REST API. Mọi tool đọc/tạo dữ liệu phải gọi cùng service/policy đã được bảo vệ ở Phase 1–5.

Phạm vi:

- `/api/chatbot`
- `/api/chatbot/create`
- `/api/chatbot/status`
- Tool declarations, tool executor, system prompt và draft confirmation.
- Data minimization khi gửi context/kết quả tới Gemini.

## 2. Hiện trạng và lỗ hổng đã xác minh

- `buildTools(roles)` và `isManagerLike` dựa role snapshot trong JWT.
- `search_employees`, employee detail và overview query trực tiếp DB; Manager/Accountant có thể nhận dữ liệu ngoài scope.
- Tool request query đọc trực tiếp requests thay vì request authorization service.
- LLM system prompt mô tả quyền theo role nhưng prompt không phải security boundary.
- `/chatbot/create` gọi request engine tốt hơn tool read, nhưng cần permission create và actor DB-fresh.
- Error catch ở chat route có thể biến lỗi authorization thành generic `500`, làm sai semantics và khó audit.
- Conversation history do client gửi có thể chứa prompt injection hoặc dữ liệu không cần thiết; tool executor phải fail closed.
- REST request create hiện chưa có root permission `requests.request.create_own`; chatbot permission không được thay thế permission gốc này.

## 3. Nguyên tắc thiết kế

- LLM chỉ đề xuất tool call; backend quyết định tool có tồn tại và actor được dùng hay không.
- Tool availability và tool execution đều dùng DB-fresh actor, nhưng execution luôn kiểm tra lại.
- Không query trực tiếp bảng nghiệp vụ trong route chatbot nếu đã có protected service.
- Tool output chỉ chứa projection tối thiểu.
- Không gửi face descriptor, avatar base64, password hash, token, wage/payroll detail nếu tool không có permission rõ ràng.
- Draft tạo đơn phải được server rebuild/validate khi confirm; không tin hidden fields từ client/LLM.

## 4. Permission dự kiến

- `chatbot.use`
- `chatbot.request.create_self`
- `chatbot.employee.search_scoped`
- `chatbot.attendance.view_self`
- `chatbot.attendance.view_scoped`
- `chatbot.request.view_self`
- `chatbot.request.view_scoped`
- `chatbot.leave_balance.view_self`
- `chatbot.report.view_aggregate`

Các permission chatbot không được mở rộng dữ liệu vượt permission gốc; ví dụ employee search cần cả chatbot permission và organization permission phù hợp.

## 5. Tool/permission/relation table

| Tool/action | Permission kép | Relation/projection | Status/error |
|---|---|---|---|
| My profile | `chatbot.use` + self profile | Self projection | 200/401/403 |
| My attendance | chatbot + `attendance.view.self` | Self/date range | 200/400/401/403 |
| My requests | chatbot + request view-own | Self/request policy | 200/401/403 |
| Employee search/detail | chatbot + org scoped view | Scope + safe projection | 200/400/401/403/404 |
| Attendance overview | chatbot + report aggregate | Scoped aggregate | 200/400/401/403 |
| Propose/confirm request | chatbot + `requests.request.create_own` | Self + request validation | 200/400/401/403/409 |
| Unknown/disabled tool | None | Fail closed | Tool error, không thực thi DB |

## 6. Service/tool design

- `buildAuthorizedTools(actor)` từ permission catalog.
- `executeAuthorizedTool(actor, toolName, args)` với switch tới domain services.
- Tool contract typed bằng schema validation.
- `sanitizeToolResult(toolName, result, actor)`.
- `createRequestDraft(actor, type, fields)` và confirm luôn rebuild/validate từ server.
- Chỉ thêm signed/server-side draft token nếu threat model chứng minh có hidden server-derived state hoặc yêu cầu chống replay; không mặc định mở rộng schema.

## 7. File/module dự kiến thay đổi

- `server/src/routes/chatbot.ts`
- `server/src/services/chatbotToolService.ts`
- Domain services từ Phase 1–5.
- `server/src/lib/gemini.ts` nếu cần preserve typed authorization errors.
- `server/src/db.ts`/migration nếu lưu short-lived draft token.
- `attendance-web/src/api/chatbot.ts`
- `attendance-web/src/components/chatbot/ChatbotWidget.tsx` chỉ phần contract/capability, bảo toàn thay đổi hiện có của người dùng.

## 8. Các bước triển khai

### Step 6.1 - Tool inventory và RED authorization tests

- Liệt kê mọi tool, bảng/service đang truy cập và dữ liệu output.
- Test Manager ngoài scope search/detail, Accountant search, request read bị matrix revoke.
- Test prompt/tool name giả không bypass.
- Phụ thuộc: Phase 2 và domain policy Phase 3–5.

### Step 6.2 - Typed tool registry

- Tool có permission prerequisites, schema args và output projection.
- Build tool list từ actor DB-fresh.
- Unknown/disabled tool fail closed.
- Phụ thuộc: Step 6.1.

### Step 6.3 - Replace direct DB reads bằng domain services

- Profile/attendance/request/employee/report tools gọi protected services.
- Giữ status `401/403/404/409`; chỉ lỗi provider/unexpected mới thành 5xx và không lộ stack/secret.
- Phụ thuộc: Step 6.2.

### Step 6.4 - Secure draft/confirm flow

- Server validate lại toàn bộ field và actor tại confirm.
- Bắt đầu bằng giải pháp nhỏ nhất: rebuild + validate toàn bộ fields/actor/root permission khi confirm.
- Chỉ thêm signed short-lived draft token sau threat model; nếu cần schema thì dùng migration harness Phase 2.
- Tạo request vẫn dùng request engine transaction/policy.
- Phụ thuộc: Phase 1 + Step 6.2.

### Step 6.5 - Data minimization và prompt-injection boundaries

- Giới hạn history length/size, tool result fields và sensitive data.
- Không đưa permission internals/secret vào prompt.
- LLM text không được dùng để quyết định target/scope.
- Phụ thuộc: Step 6.3.

### Step 6.6 - Frontend capability và regression

- Widget chỉ hiện khi `chatbot.use`/status cho phép.
- Bảo toàn UI/chatbot code hiện có; chỉ đổi contract cần thiết.
- Test create request qua chatbot và REST có cùng authorization outcome.
- Phụ thuộc: Step 6.3–6.5.

## 9. Test matrix

- Employee dùng self tools.
- Request view permission bị revoke nhưng chatbot vẫn được mở.
- Manager search/detail employee trong/ngoài scope.
- HR/Admin permission thay đổi trong DB khi JWT cũ.
- Accountant không có employee private-data permission.
- Unknown tool/tool args invalid.
- Prompt injection yêu cầu query toàn database.
- Draft payload bị sửa, hết hạn hoặc replay.
- Chatbot create request và REST create cùng validation/business rule.
- Gemini lỗi/time-out không làm lộ stack/secret.

## 10. Tiêu chí hoàn thành

- Không còn tool nghiệp vụ query trực tiếp DB nếu có domain service.
- Tool availability và execution đều DB-fresh/fail-closed.
- Chatbot không mở rộng quyền so với REST.
- Sensitive fields không gửi tới model ngoài nhu cầu rõ ràng.

## 11. Rủi ro và rollback

- Tool output thay đổi có thể giảm chất lượng câu trả lời: giữ contract version và golden tests.
- Gemini function schema thay đổi: rollback registry adapter, không rollback authorization.
- Có thể disable riêng tool hoặc toàn widget qua status/config.

## 12. Câu hỏi cần xác nhận

- Accountant có cần employee search trong chatbot không?
- Có lưu draft server-side hay dùng signed stateless token?
- History tối đa bao nhiêu message/ký tự?
- Có cho chatbot trả payroll aggregate/detail không?
- Threat model có thực sự yêu cầu signed/server-side draft token không?

## 13. Verification commands

- Backend build + tool registry/domain parity integration tests với provider mocked.
- Frontend lint/build; bảo toàn diff chatbot hiện có của người dùng.
- REST/chatbot authorization parity suite và `git diff --check`.

## 14. Không làm

- Không đổi nhà cung cấp/model Gemini.
- Không xây RAG/vector database.
- Không redesign widget lớn.

## 15. Plan mutation log

- 2026-08-29: thêm root request-create permission, tool contract table, preserve authorization status và chọn draft solution nhỏ nhất sau adversarial review.
