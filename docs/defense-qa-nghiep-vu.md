# Tổng hợp câu hỏi bảo vệ — Tập trung NGHIỆP VỤ & GÓC NHÌN DOANH NGHIỆP

> HRM Chấm công TechNova — 500 NV văn phòng. Stack: React+TS+Vite / Express+SQLite+JWT + Gemini AI.
> Mỗi câu trả lời ngắn gọn, đúng với code thực tế, có thể đưa thẳng vào phần bảo vệ.

---

## A. TỔNG QUAN & LỰA CHỌN HỆ THỐNG

**Q1. Hệ thống giải quyết bài toán gì của doanh nghiệp?**
A: Số hóa toàn bộ vòng đời chấm công văn phòng: **chấm công → tính công/theo ca → đơn từ & duyệt nhiều cấp → tính lương theo luật → dashboard quỹ lương**. Thay thế chấm công giấy + Excel, giảm công sức HR, minh bạch quy trình, chuẩn hoá theo Bộ luật Lao động 2019.

**Q2. Vì sao dùng web thay vì máy chấm công vật lý?**
A: Web là kênh chính, máy vật lý là **nguồn ưu tiên** (không loại trừ). NV văn phòng hay đi công tác/ họp ngoài/ làm tại nhà khách hàng → không luôn đi ngang máy. Web cho phép chấm bằng GPS vùng văn phòng, WiFi công ty, IP nội bộ, khuôn mặt, QR. Máy vật lý (nếu có) đẩy qua webhook (`source=1`), và khi trùng lượt, **bản máy được ưu tiên** (máy đáng tin hơn, khó giả mạo). Lợi thế: không tốn vốn đầu tư máy (5–8 máy × 15–20 triệu) + tích hợp trọn vòng đời (máy vật lý chỉ báo "có mặt", web tự động tính muộn/sớm/OT/theo ca/lương).

**Q3. Quy mô và giới hạn phạm vi?**
A: 500 NV active, 7 phòng ban, ca hành chính + ca sáng/chiều/đêm (≤48h/tuần theo luật). Mô hình văn phòng (không phải công nhân nhà máy). Dữ liệu demo seed: 483 NV, 20 ngày lễ, ~40.600 lượt chấm, ~20.800 bản ghi công, ~4.350 payslip.

**Q4. Tại sao SQLite mà không PostgreSQL?**
A: Quy mô 500 NV + tải chấm công theo loạt → SQLite WAL + event loop tuần tự đủ, không tốn vận hành DB server. Kiến trúc tách tầng `db.ts`/`repo.ts`/`engines` → khi vượt ngưỡng vài nghìn người, nâng PostgreSQL chỉ ảnh hưởng tầng lưu trữ, **không phá logic nghiệp vụ**.

---

## B. CHẤM CÔNG (Attendance)

**Q5. Có bao nhiêu phương thức chấm công? Phân biệt thế nào?**
A: 5 phương thức: **Thủ công, GPS, WiFi, IP, Khuôn mặt** (+ QR). Mỗi lượt ghi `source` (1=máy vật lý, 2=web). Khi cùng mốc có cả máy và web, **source=1 ưu tiên** → tránh lượt thừa làm ghép cặp VÀO/RA sai. Máy vật lý khó giả mạo hơn web (điện thoại).

**Q6. Logic ghép cặp VÀO/RA như thế nào?**
A: Punch **append-only** (chỉ ghi thêm). `recomputeRecord` ghép theo thứ tự: **lẻ = VÀO, chẵn = RA**. Tổng giờ = tổng các phiên (cặp). Mô hình **1 phiên/ngày**: đã có VÀO+RA (số lượt chẵn ≥ 2) → không cho chấm lại (UI disable "Đã hoàn tất"); muốn sửa → tạo đơn "Cập nhật công".

**Q7. Chống chấm trùng thế nào?**
A: Cửa sổ chống trùng **60 giây** (cấu hình được): lượt mới trong 60s so với lượt cuối → từ chối (`duplicate`). Tránh click liên tục tạo lượt rác.

**Q8. Ca đêm (qua 0h) tính sao cho đúng?**
A: Ca `isOvernight` (VD 22:00–06:00): mốc kết thúc dịch +1440 phút. Đặc biệt **lượt RA ca đêm lưu cùng ngày check-in** (khi NV chấm sáng hôm sau, hệ thống tự đóng phiên ca đêm hôm trước trong cửa sổ grace). Do đó `recomputeRecord(date)` chỉ phụ thuộc ca của chính ngày đó → đổi ca 1 ngày chỉ tính lại 1 bản ghi (tối ưu).

**Q9. Đi muộn / về sớm / quên chấm xử lý ra sao?**
A: So với cửa sổ ca (`checkInWindowTo` = giờ cho phép vào muộn tối đa, `checkOutWindowFrom` = giờ cho phép ra sớm tối đa):
- Vào sau `graceIn` → `lateMinutes`.
- Ra trước `graceOut` → `earlyLeaveMinutes`.
- Số lượt lẻ (chỉ VÀO) → cờ `MissingCheckOut`.
- Quên chấm RA → NV gửi đơn **"Cập nhật công"** (loại Sửa/Thêm giờ) → Quản lý → HR → Kế toán duyệt → engine tính lại.

**Q10. NV không có ca hôm đó nhưng vẫn chấm (cuối tuần/chưa xếp ca) thì sao?**
A: Vẫn ghi giờ vào/ra + tổng giờ (UI đúng), nhưng đánh cờ `NoShift`, `mainStatus=2` (ngoại lệ). Nếu có đơn OT đã duyệt cho ngày nghỉ/lễ → toàn bộ giờ làm là OT (theo `dayType`: ngày thường/cuối tuần/lễ).

---

## C. CA LÀM VIỆC & PHÂN CA

**Q11. Một ca có những tham số gì?**
A: Shift có: khung giờ, cửa sổ chấm VÀO/RA, nghỉ trưa, **hệ số ngày lễ** (`holidayCoefficient`), số công (`workDays`: 1=ngày, 0.5=nửa ngày), **ca qua đêm** (`isOvernight`), phạt đi muộn (số lần cho phép + phút phạt mỗi lần), trạng thái (đang dùng/ngưng), màu nhận diện.

**Q12. Phân ca có ràng buộc gì? Ai làm được?**
A: Quyền `shifts.schedule.manage_scoped`/`manage_all`. Phân ca 1 ô (NV×ngày) hoặc hàng loạt (chọn NV + ngày + thứ áp dụng). Ràng buộc: ngày hợp lệ `YYYY-MM-DD`, ca phải tồn tại. Khi gán/xóa 1 ô, engine **chỉ tính lại bản ghi ngày đó** (tối ưu — trước đây tính lại toàn bộ lịch sử NV). Nhiều máy xem chung qua backend deploy + auto-refresh 10s.

**Q13. Đổi ca giữa hai nhân viên an toàn thế nào?**
A: Đơn "Đổi ca" 2 chế độ: (1) tự đổi (chỉ mình), (2) đổi với đồng nghiệp → **đồng nghiệp phải xác nhận đồng ý** trước khi đơn vào quy trình duyệt (`PendingPartnerConfirmation`). Tránh NV tự "ép" ca cho người khác. Partner đủ điều kiện (cùng scope, active) mới nằm trong danh sách.

---

## D. ĐƠN TỪ & QUY TRÌNH DUYỆT

**Q14. Có mấy loại đơn? Tại sao chia vậy?**
A: 6 loại: **nghỉ phép, đi muộn/về sớm, làm thêm (OT), công tác, đổi ca, cập nhật công**. Mỗi loại có **luồng duyệt + nghiệp vụ khác nhau** (OT/công tác có yếu tố tài chính → thêm Kế toán; cập nhật công liên quan lương → HR + Kế toán).

**Q15. Trình bày luồng duyệt từng loại.**
A:
| Loại | Cấp 1 | Cấp 2 | Cấp 3 |
|---|---|---|---|
| Nghỉ phép | Quản lý | Trưởng phòng | — (+tham vấn GĐ nếu >3 ngày, không chặn) |
| Muộn/sớm | Quản lý | Trưởng phòng | — |
| OT | Quản lý | Trưởng phòng | **Kế toán** (tài chính) |
| Công tác | Quản lý | Trưởng phòng | **Kế toán** (chi phí) |
| Đổi ca | Quản lý | Trưởng phòng | — (mode 2 → partner confirm trước) |
| Cập nhật công | Quản lý | **HR** | **Kế toán** (căn cứ lương) |

**Q16. Xử lý "kẹt duyệt" thế nào?**
A: **Escalation ngầm**: người duyệt gốc đang nghỉ phép được duyệt trong hôm nay (`isOnApprovedLeave`) → tự chuyển cấp trên: Trưởng nhóm nghỉ → Trưởng phòng duyệt (thay mặt); Trưởng phòng nghỉ → Giám đốc duyệt (thay mặt). Đơn không kẹt, có vết "thay mặt" trong lịch sử duyệt để minh bạch.

**Q17. Chống ghi đè khi 2 người duyệt cùng lúc?**
A: Mỗi đơn có `request_version`. Mọi duyệt/từ chối/hủy gửi `expectedRequestVersion` → không khớp (đã có người xử lý) → 409 "Phiên bản không khớp, tải lại" (optimistic concurrency).

**Q18. Quỹ phép (leave balance) quản lý ra sao?**
A: `LeaveBalance` theo năm (Allocated/Used/Pending). Tạo đơn nghỉ → `Pending += số ngày`; duyệt → `Pending -=`, `Used +=`; hủy/từ chối → hoàn `Pending`. Số ngày nghỉ tính theo `dayCalculationType` (ngày làm việc / ngày lịch / theo ca). HR biết NV còn bao nhiêu phép, không cho nghỉ quá hạn mức.

**Q19. Hạn mức OT theo luật kiểm tra thế nào?**
A: `enforceOtCap`: OT tháng ≤ `otMonthlyCapHours` (mặc định 40h), năm ≤ `otYearlyCapHours` (mặc định 200h). Khi tạo đơn OT, tính **OT đã dùng (pending + approved) + đơn này**; vượt → 409 "Vượt hạn mức tháng/năm theo luật". Form tạo đơn OT hiển thị progress bar OT tháng/năm để NV tự biết trước khi gửi.

**Q20. Đơn "cập nhật công" mấy loại? Tại sao 3 cấp?**
A: 3 loại: **Thêm bản ghi, Sửa giờ chấm, Xóa bản ghi**. 3 cấp vì: (1) Quản lý biết NV thực tế làm không; (2) HR xác nhận hợp lệ quy trình; (3) Kế toán duyệt cuối vì **cập nhật công ảnh hưởng trực tiếp lương**. Ràng buộc: giờ ra mới phải sau giờ vào (trừ loại Xóa).

**Q21. Đơn duyệt xong tác động gì lên dữ liệu?**
A: Tuỳ loại: nghỉ phép → trừ quỹ phép + `recompute` ngày nghỉ; OT → đánh dấu OT đã duyệt → `recompute` phân loại OT (thường/cuối tuần/lễ, phụ cấp đêm); cập nhật công → `applyAttendanceUpdate` sửa/thêm/xóa bản ghi chấm → `recomputeRecord` tính lại công + lương.

---

## E. BẢNG CÔNG & TÍNH CÔNG

**Q22. Bảng công tổng hợp gì?**
A: Theo kỳ (nửa tháng: 1–15, 16–cuối), theo phòng ban. Mỗi ô (NV×ngày) ghi: ca, giờ vào/ra, công chuẩn, công hưởng, đi muộn, về sớm, OT, vắng. Trạng thái xác nhận: NV xác nhận → HR xác nhận → chốt kỳ → chuyển sang tính lương.

**Q23. Công hưởng tính theo ca thế nào?**
A: `work_hours` = `shift.workDays` (1 ca = 1 công; nửa ca = 0.5). Không có ca → 0 công (dù có chấm → cờ NoShift). `paidUnits` = tổng công hưởng trong kỳ → vào công thức lương `paidWork = base × (paidUnits / 15)` (nửa tháng chuẩn 15 ngày công).

---

## F. LƯƠNG, BẢO HIỂM, THUẾ

**Q24. Trình bày công thức tính lương (nửa tháng).**
A:
```
base      = monthlyWage / 2                      (lương cơ bản nửa tháng)
paidWork  = base × (paidUnits / 15)              (công hưởng, 15 = ngày công chuẩn nửa tháng)
otTotal   = OT thường 1.5× + cuối tuần 2× + lễ 3× (+ phụ cấp đêm +30%, OT đêm +20%)
allowance = phụ cấp (mặc định 500.000)
gross     = paidWork + otTotal + allowance
insurance = gross × 10.5%                        (Bảo hiểm phần NV)
tax       = max(0, gross − 11.000.000) × 10%     (Thuế TNCN, giảm trừ 11M)
net       = gross − insurance − tax
```

**Q25. Bảo hiểm 10.5% giải thích các thành phần.**
A: Phần nhân viên đóng theo luật: BHXH (hưu trí/tử tuất) **8%** + BHYT (y tế) **1,5%** + BHTN (thất nghiệp) **1%** = **10,5%** gross. (Phần công ty đóng thêm ~21,5% nhưng phiếu lương chỉ thể hiện phần trừ của NV). Hiển thị là khoản **âm** trong phiếu lương (`type 7: Bảo hiểm (NV)`).

**Q26. Thuế TNCN tính sao? Có đúng luật không?**
A: Demo dùng công thức **giản lược**: `tax = (gross − 11.000.000) × 10%` nếu gross > 11 triệu (giảm trừ gia cảnh bản thân 11M/tháng). **Chưa** áp dụng biểu lũy tiến từng phần và giảm trừ người phụ thuộc → điểm đơn giản hoà. Nếu cần sát luật: chia bậc lũy tiến (5%–35%) + giảm trừ người phụ thuộc (4,4M/người).

**Q27. Phụ cấp đêm và OT đêm tính sao?**
A: Làm giờ đêm (22h–6h) → phụ cấp đêm **+30%** lương giờ (`nightCoeff − 1 = 0.3`). OT vào ban đêm → **+20%** thêm trên giờ OT (`nightOtExtra = 0.2`). Tách bạch trong payslip: dòng "Phụ cấp đêm (+30%)" và "OT đêm (+20%)".

**Q28. OT lễ 3× có thật sự vào lương không?**
A: Có. `computeOtPay` dùng `otHoliday` coefficient = 3.0 (cấu hình regulation). Trong payslip kỳ cận Tết có dòng "Làm thêm (lễ tết 3x)". Demo seed: kỳ Tết OT ≈ 914 triệu → NET 3,51 tỷ; kỳ thường OT ≈ 94 triệu → NET 2,84 tỷ → khớp lời giải thích "tháng có OT lễ tết cao hơn hẳn".

**Q29. Trạng thái phiếu lương?**
A: `PayrollSheetStatus`: Draft → SubmittedToDirector → DirectorApproved → ReturnedToAccountant → Published → Paid (+ Cancelled). Kế toán lập, Giám đốc duyệt, công bố cho NV, NV khiếu nại được (`PayrollComplaintStatus`: Open/InReview/Resolved/Rejected/Cancelled).

---

## G. PHÂN QUYỀN & BẢO MẬT

**Q30. Phân quyền theo vai trò hay theo tính năng?**
A: **Kết hợp role + permission chi tiết**. Có catalog quyền (`permissionCatalog.ts`) theo module (org, attendance, shifts, requests, timesheet, payroll, chatbot, audit...). Mỗi role có set quyền mặc định, Admin có thể cấp/thu quyền từng tính năng. Thêm **effective scope** (phạm vi hiệu lực): VD Manager chỉ thấy NV phòng mình, HR/Admin thấy toàn công ty.

**Q31. "Effective scope" nghĩa gì? Vì sao cần?**
A: Không chỉ "có quyền X" mà còn "có quyền X **trên đối tượng này không**". VD `org.employee.view_scoped`: Manager xem được NV trong phòng mình, không xem phòng khác. HR/Admin `view_all`. Scope = role + departmentScopes. Tránh NV tự xem/sửa dữ liệu người khác ngoài phạm vi.

**Q32. ủy quyền duyệt (delegation) hoạt động ra sao?**
A: Một user có thể ủy quyền quyền duyệt cho user khác (trong khoảng thời gian). Khi đó đơn chuyển đến **người được ủy quyền** với vết "thay mặt <nguyên>". Hệ thống load `getActiveDelegation` fresh từ DB mỗi request (không dùng JWT snapshot) → ủy quyền có hiệu lực ngay, thu hồi cũng ngay.

**Q33. Dữ liệu nhạy cảm (lương, định vị) bảo mật thế nào?**
A: (1) JWT xác thực mỗi request; (2) mật khẩu băm **bcryptjs**; (3) **audit log** ghi mọi thao tác; (4) định vị chỉ lưu tại mốc chấm, chỉ HR/Admin xem; (5) route tách `requireAuth`/`requirePermission` + scope check; (6) production fail-closed (JWT_SECRET dài, CORS HTTPS exact, persistent disk, backup confirmed) — trừ mode demo.

**Q34. Audit log ghi gì? Phục vụ gì?**
A: Ghi `user_id, action (1=create,2=update,3=delete), entity_type, entity_id, message`. Truy vết: ai sửa lương, ai phân ca, ai duyệt đơn... Bảo mật + minh bạch + trách nhiệm.

---

## H. CHATBOT AI

**Q35. Chatbot làm được gì? Không phải đồ chơi?**
A: 2 nhóm: **(1) Tra cứu** (chấm công của tôi, đơn của tôi, quỹ phép, OT, nhân viên trong scope, dashboard) và **(2) Tạo đơn tự động** (thu thập thông tin → trình bản nháp → NV xác nhận mới ghi DB). Dùng **function-calling**: LLM gọi tool backend, tool gọi đúng service/authorization như REST API → **chatbot không là "đường vòng" bỏ qua phân quyền**.

**Q36. Chatbot có tự tạo đơn được luôn không? Vì sao phải xác nhận?**
A: Không. Chatbot chỉ **đề xuất bản nháp** (`propose_create_request`) — chưa ghi DB. Phải NV bấm "Tạo đơn" → mới gọi `/chatbot/create` để thực sự tạo. Tạo đơn là thao tác có hậu quả (trừ phép, chốt OT) → cần con người xác nhận, tránh LLM "tự ý" tạo sai.

**Q37. Chatbot tôn trọng phân quyền thế nào?**
A: Mỗi tool check quyền (`canUseChatbotTool`) + scope. VD `search_employees` chỉ trả NV trong scope; `get_my_attendance` chỉ của chính user. Tool gọi cùng service authorization với REST → cùng chính sách, không lỗ hổng.

**Q38. Chatbot không bịa số liệu chứ?**
A: Không. System prompt yêu cầu "chỉ tra cứu dữ liệu của chính user (hoặc NV họ có quyền) — không bịa số liệu". Tool trả dữ liệu thật từ DB; LLM chỉ tổng hợp thành câu tiếng Việt. Tool lỗi → trả lỗi, LLM không được bịa.

---

## I. DASHBOARD & BÁO CÁO

**Q39. Dashboard trả lời câu hỏi gì cho doanh nghiệp?**
A: 3 góc nhìn chính: **quỹ lương theo phòng ban** (NET + OT — so sánh chi phí nhân sự các phòng); **giờ công trung bình/NV** (phát hiện phòng làm thiếu/thừa giờ); **so sánh quỹ lương các kỳ** (tháng cao do OT lễ tết 3×, tháng thường OT thấp → ra quyết định điều tiết OT).

**Q40. Dashboard có realtime không?**
A: Dữ liệu tính từ bảng công + payslip đã chốt. Hiện tại làm mới theo request (một số trang có auto-refresh). Nếu muốn realtime hơn → thêm SSE/websocket đẩy thay đổi (mở rộng).

---

## J. MỞ RỘNG & VẬN HÀNH THỰC TẾ

**Q41. Hệ thống có mở rộng được khi công ty tăng trưởng không?**
A: Có. Tách tầng rõ (routes → services → repo → db). Khi: (1) vài nghìn NV → đổi SQLite→PostgreSQL (chỉ tầng lưu trữ); (2) nhiều chi nhánh → thêm bảng `branches` + lọc theo branch (engine không đổi); (3) tải cao → thêm cache/queue cho chấm công.

**Q42. Nếu máy chấm công hỏng đúng ngày chốt kỳ lương?**
A: NV chấm bù trên web (GPS/WiFi/khuôn mặt, `source=2`). Khi máy khôi phục đẩy bản ghi (`source=1`), hệ thống ưu tiên bản máy cho mốc trùng. Kế toán chốt kỳ sau khi HR xác nhận đủ dữ liệu. Không mất công vì dữ liệu web đã lưu.

**Q43. Dữ liệu persist qua các lần deploy?**
A: Production dùng **persistent disk** (Render) tại `/opt/render/project/src/data` → DB SQLite + file đính kèm giữ qua redeploy. Có guard fail-closed: bắt buộc persistent volume + backup confirmed (trừ mode demo `HRM_ALLOW_INSECURE_PRODUCTION=true`). Demo mode: dữ liệu ephemeral (mất khi redeploy) — chỉ cho đồ án.

**Q44. Hệ thống có tuân thủ luật LĐ không? Nêu mấy điều.**
A: Có, áp dụng: Điều 105 (chấm công ghi giờ vào/ra, tổng giờ); Điều 107 (OT hệ số 1.5×/2×/3× + hạn mức tháng/năm); Điều 98 (phụ cấp đêm +30%, OT đêm +20%); Điều 55, 112 (nghỉ phép năm có quỹ phép, tính theo ngày làm việc); Điều 20 (thời giờ ≤48h/tuần — ca 6 ngày × 8h = 48h).

**Q45. Điểm đơn giản hoà so với thực tế? (trả lời thẳng để hội đồng thấy hiểu biết)**
A: (1) Bảo hiểm tính trên **gross** chứ không "mức lương đóng BH" riêng, **chưa áp trần** 20× lương cơ sở; (2) Thuế TNCN dùng giảm trừ 11M + 10% phần vượt, **chưa** biểu lũy tiến + giảm trừ người phụ thuộc; (3) Chấm công 1 phiên/ngày (VÀO+RA xong không chấm lại) — muốn sửa phải qua đơn; (4) Chưa có hợp đồng điện tử/e-signature (duyệt = click button + audit log); (5) Chưa tích hợp ngân hàng chuyển lương thực tế (chỉ tính + xuất).

---

## K. CÂU HỎI "KHÓ" HAY GẶP

**Q46. Nếu NV chấm công ở nhà (GPS không vùng văn phòng) thì có tính không?**
A: Tùy chính sách. GPS/WiFi/IP phải khớp vùng văn phòng cấu hình. Nếu ở nhà (vùng không khớp) → lượt chấm vẫn ghi nhưng đánh cờ ngoại lệ (chưa hợp lệ) → HR/Quản lý duyệt qua đơn "Cập nhật công" nếu NV có lý do chính đáng (làm tại nhà, công tác). Hệ thống **không tự động tính** công không hợp lệ.

**Q47. Nếu 2 NV đổi ca, 1 người không xác nhận thì sao?**
A: Đơn ở `PendingPartnerConfirmation`. Partner **từ chối** → `PartnerRejected`, đơn không vào quy trình duyệt. Partner **không phản hồi** → đơn kẹt ở pending cho partner (không tự duyệt). Có thể thêm timeout tự hủy (mở rộng).

**Q48. Lỗi mạng khi chấm công thì lượt chấm có mất không?**
A: Frontend có thể retry. Backend ghi lượt chấm **append-only** + kiểm tra trùng 60s → retry tạo lượt trùng trong 60s → bỏ, giữ lượt đầu. Nếu mất mạng hoàn toàn → NV chấm lại khi có mạng (lượt cũ chưa gửi thì không tồn tại).

**Q49. Sửa công đã duyệt nhưng sai, có thu hồi không?**
A: Có khái niệm `Recovery/Truy thu` trong PayrollComponentType. Kế toán tạo kỳ lương mới với khoản "Truy thu/Thu hồi" để điều chỉnh sai sót kỳ trước. Đơn sửa công sau khi duyệt đã `recompute` lại; nếu vẫn sai → tạo đơn sửa công mới + Kế toán truy thu/bù ở kỳ sau.

**Q50. Vì sao không làm luôn app mobile native?**
A: Web responsive chạy trên trình duyệt điện thoại, dùng được GPS/khuôn mặt camera web → đủ cho NV văn phòng. Native app tốn chi phí phát triển + duy trì 2 nền tảng + store approval. Web PWA có thể "add to home screen" nếu cần trải nghiệm gần native. Đủ cho 500 NV.

---

*Đi kèm mã nguồn `server/` + `attendance-web/`. Demo: `cd server && npm run seed && npm run dev` (:4000); `cd attendance-web && npm run dev` (:5173). Đăng nhập: admin@technova.vn / 123456.*