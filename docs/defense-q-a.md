# Tài liệu bảo vệ đồ án — Hệ thống HRM Chấm công (TechNova JSC)

> Tài liệu tổng hợp câu hỏi–trả lời phục vụ buổi bảo vệ đồ án tốt nghiệp. Hệ thống là **HRM chấm công cho nhân viên văn phòng, quy mô 500 người** (không phải nhà máy/công nhân). Stack: React 19 + TypeScript + Vite (frontend) và Express + better-sqlite3 + JWT (backend).

---

## 0. Thông tin tổng quan để mở đầu

| Hạng mục | Giá trị |
|---|---|
| Loại hình tổ chức | Công ty TNHH TechNova — nhân viên văn phòng |
| Quy mô | **500 nhân viên** active + ~12 cán bộ quản lý/vai (Admin, HR, Giám đốc, Kế toán, Trưởng phòng) |
| Số phòng ban | 7 (CNTT, Kinh doanh, Vận hành, CSKH, Marketing, Kế toán, Nhân sự) |
| Ca làm | Hành chính (T2–T6, 40h/tuần) + ca sáng/chiều/đêm (6 ngày/tuần, 48h/tuần — đúng giới hạn ≤48h/tuần) |
| Luật áp dụng | Bộ luật Lao động 2019 (Điều 105, 107, 98, 55, 112, 20) |
| Dữ liệu seed demo | 483 NV, 20 ngày lễ (2025–2026), ~40.600 lần chấm, ~20.800 bản ghi công, ~4.350 payslip qua 9 kỳ lương |

Mục tiêu của hệ thống: số hóa toàn bộ vòng đời chấm công văn phòng — **chấm công → tính công/theo ca → đơn từ & duyệt nhiều cấp → tính lương theo luật → dashboard quỹ lương** — thay thế chấm công giấy + Excel.

---

## 1. Ai sử dụng hệ thống? (Người dùng hệ thống)

Hệ thống phân quyền theo **vai trò (role)**, mỗi tài khoản có thể mang nhiều vai trò:

1. **Nhân viên (Employee)** — người dùng đông nhất (~480 tài khoản): tự chấm công (web/khuôn mặt/GPS), xem bảng công của mình, gửi đơn từ (nghỉ phép, đi muộn/về sớm, tăng ca, công tác, đổi ca, xin sửa công), theo dõi lịch sử lương.
2. **Quản lý trực tiếp (Manager)** — trưởng nhóm trực tiếp của nhân viên: duyệt đơn ở **cấp 1** (bước đầu tiên trong mọi luồng), quản lý team.
3. **Trưởng phòng (DepartmentHead)** — duyệt đơn ở **cấp 2** (toàn phòng ban).
4. **Kế toán (Accountant)** — duyệt các đơn có yếu tố **tài chính**: tăng ca (cấp cuối), công tác (chi phí, cấp cuối), sửa công (cấp cuối, làm căn cứ tính lương), và **chốt kỳ lương**.
5. **Nhân sự (HR)** — duyệt đơn sửa công (cấp trung), quản lý hồ sơ nhân viên, quy định chấm công, phân ca, bảng công tổng hợp.
6. **Giám đốc (Director)** — chỉ tham gia duyệt khi **được ủy quyền**; đơn nghỉ >3 ngày thì hệ thống tự "tham vấn" Giám đốc (thông báo, không chặn luồng).
7. **Quản trị viên (Admin)** — vận hành hệ thống, phân quyền, xem audit log, cấu hình.

**Vì sao web thay vì máy chấm công riêng?** — xem mục 2.

---

## 2. Vì sao dùng web thay vì máy chấm công vật lý?

Đây là câu hỏi trọng tâm mà giảng viên thường đặt. Trả lời theo 3 lớp:

### 2.1. Web là kênh chính, máy vật lý là nguồn ưu tiên — không loại trừ nhau
Hệ thống thiết kế **"physical-first" (ưu tiên nguồn vật lý)** nhưng **không phụ thuộc máy**:
- Máy chấm công vật lý (vân tay/khuôn mặt/thẻ từ) đẩy dữ liệu qua **webhook** `POST /api/attendance/device-punch` (xác thực bằng header `X-Device-Key`, `source=1`).
- Khi máy hỏng/mất mạng/nhân viên đi công tác/đi làm tại nhà khách hàng, nhân viên chấm bổ sung trên **web/app** (`source=2`) bằng khuôn mặt, GPS, WiFi, IP công ty, hoặc QR.
- Nếu cùng một lúc có cả bản ghi máy và bản ghi web, **bản ghi máy (source=1) được ưu tiên** khi trùng lặp.

### 2.2. Lý do doanh nghiệp văn phòng chọn web
- **Nhân viên văn phòng làm việc linh hoạt**: đi công tác, họp ngoài, làm tại nhà, tới trạm khách hàng → không luôn đi ngang máy chấm công ở văn phòng. Web cho phép chấm mọi nơi có chính sách định vị (GPS vùng văn phòng / WiFi công ty / IP nội bộ).
- **Không tốn vốn đầu tư máy**: 500 nhân viên cần ~5–8 máy chấm công vật lý (15–20 triệu/máy) + bảo trì. Web chạy trên điện thoại/máy tính sẵn có.
- **Tích hợp trọn vòng đời**: máy vật lý chỉ ra kết quả "có mặt/không", còn web gắn liền với đơn từ, duyệt, tính OT theo luật, trả lương, dashboard — một hệ thống duy nhất, không phải nhập lại Excel.
- **Triển khai nhanh, cập nhật luật dễ**: đổi hệ số OT/lễ theo luật chỉ cần sửa cấu hình (regulation) trên web, không phải cập nhật firmware máy.

### 2.3. Khi nào mới cần máy vật lý thuần?
Nhà máy, xưởng, cửa hàng — nơi nhân viên bắt buộc có mặt tại điểm cố định và cần chống giả mạo cao. **Văn phòng 500 người không bắt buộc máy**, web + chính sách định vị là đủ.

---

## 3. GPS/IP/WiFi — ai sở hữu, xử lý ra sao?

- **GPS (vĩ/kinh độ)**: do **thiết bị của nhân viên** thu thập tại thời điểm chấm, gửi kèm mỗi lần chấm. Hệ thống **không theo dõi định vị liên tục** — chỉ lưu tọa độ tại khoảnh khắc chấm công, ghi vào bản ghi `punches` (latitude, longitude, accuracy).
- **WiFi SSID**: SSID của mạng nhân viên đang kết nối khi chấm — dùng để xác nhận "đang trong văn phòng" (so khớp SSID công ty).
- **IP**: IP công ty (dải nội bộ) — dùng khi nhân viên chấm từ máy bàn trong văn phòng.
- **Mục đích**: phục vụ **chính sách định vị** của công ty (regulation có bật `enablePunchGps/Wifi/Ip` hay không) và **truy vết** khi có tranh chấp/khiếu nại về giờ chấm — không dùng để giám sát hành vi.
- **Riêng tư**: tọa độ chỉ lưu cùng bản ghi chấm công, chỉ HR/Admin được xem, có trong audit log. Không chia sẻ bên ngoài.

> Trả lời ngắn gọn: "GPS/IP do thiết bị nhân viên cung cấp tại lúc chấm; hệ thống chỉ lưu tại điểm chấm công để xác minh vùng làm việc và truy vết khiếu nại, không theo dõi liên tục."

---

## 4. Đồng thời 200 người chấm cùng lúc — hệ thống chịu được không?

Đây là câu kỹ thuật quan trọng. Trả lời:

### 4.1. Mô hình backend
- Backend **Node.js (Express)** — chạy **single-thread event loop**. Mỗi request chấm công đến được xử lý đồng bộ qua **better-sqlite3** (driver SQLite đồng bộ, không callback).
- Vì better-sqlite3 **đồng bộ**, mỗi lệnh ghi được thực hiện **tuần tự, nguyên tử** — không có race condition giữa hai lệnh ghi chạy song song trên cùng một connection.
- SQLite mở chế độ **WAL (Write-Ahead Logging)**: cho phép **nhiều reader song song + 1 writer tuần tự**. 200 người chấm cùng lúc = 200 request đến gần như cùng thời điểm; event loop xếp hàng lần lượt, mỗi ghi mất <1ms → 200 ghi xong trong **<0,3 giây**, người dùng không cảm nhận độ trễ.

### 4.2. Vì sao đủ cho 500 nhân viên văn phòng?
- Chấm công **không phải tải cao liên tục**: chỉ cao ở 2 thời điểm (sáng 8h–8h15, chiều 17h–17h15) và tổng chỉ ~500 lượt/ngày. 200 đồng thời là kịch bản cực hạn đã dư sức.
- Wal + event loop tuần tự + ghi đồng bộ nguyên tử = **không mất bản ghi, không đếm trùng** ngay cả khi 200 người bấm trong cùng 1 giây.

### 4.3. Ngưỡng mở rộng (nếu giảng viên hỏi "nếu 5000 người?")
- **500–1000 người**: SQLite WAL + 1 máy chủ Node vẫn đủ (chấm công là tải theo loạt, không liên tục).
- **Vài nghìn trở lên / nhiều chi nhánh**: chuyển sang **PostgreSQL** (đa writer, row-level locking, replication) + tách dịch vụ. Kiến trúc backend đã tách engine/route/repo nên việc đổi DB chỉ ảnh tầng `db.ts` + `repo.ts`, không phá logic nghiệp vụ.
- Có thể thêm **Redis** làm hàng đợi/hệ điều phối khi cần chống trùng phân tán (nhiều máy chủ).

> Trả lời tóm tắt: "SQLite WAL + event loop tuần tự + ghi đồng bộ nguyên tử đảm bảo 200 lượt chấm đồng thời không mất không trùng; ngưỡng vài nghìn người thì nâng lên PostgreSQL."

---

## 5. Quy định giờ làm & tăng ca theo Bộ luật Lao động 2019

### 5.1. Giờ làm bình thường (Điều 105)
- Tối đa **8 giờ/ngày** và **48 giờ/tuần**.
- Hệ thống: ca hành chính 8h/ngày × 5 ngày = 40h/tuần; ca sáng/chiều/đêm 8h/ngày × 6 ngày = 48h/tuần (đạt giới hạn trên, hợp lệ).

### 5.2. Tăng ca (Điều 107) — giới hạn
- Tối đa **40 giờ/tháng** và **200 giờ/năm** (trong trường hợp đặc biệt do Bộ LĐ-TB&XH cho phép mới tới 300h/năm).
- Hệ thống lưu `ot_monthly_cap_hours=40`, `ot_yearly_cap_hours=200` trong `regulation`, dùng để kiểm soát/cảnh báo khi tính công.

### 5.3. Hệ số lương tăng ca (Điều 98) — cốt lõi tính lương
| Ngày | Hệ số |
|---|---|
| Ngày thường (T2–T6) | **1,5×** lương giờ |
| Ngày nghỉ (Thứ 7, CN) | **2,0×** |
| Ngày lễ, tết (Điều 112) | **3,0×** |

- Hệ số lưu trong `regulation`: `weekday_ot_coeff=1.5`, `weekend_ot_coeff=2.0`, `holiday_ot_coeff=3.0`.

### 5.4. Làm ban đêm (Điều 55)
- Giờ ban đêm: **22:00 – 06:00**.
- Làm giờ ban đêm (không phải OT) thêm **ít nhất 30%** → hệ thống `night_coeff=1.3`.
- **Tăng ca vào ban đêm** thêm **ít nhất 20%** nữa trên hệ số OT → `night_ot_extra=0.2`.

### 5.5. Ngày lễ (Điều 112)
- **11 ngày/năm** (Tết dương lịch, Tết âm lịch 5 ngày, Giải phóng 30/4, Quốc tế lao động 1/5, Quốc khánh 2/9, và các ngày lễ tết khác theo quy định).
- Bảng `holidays` seed sẵn **20 ngày cho 2025–2026** (gồm bù lễ khi rơi vào cuối tuần), `coefficient=3.0`.

### 5.6. Cách hệ thống phân loại ngày
Hàm `dayType(date)` tra cứu theo thứ tự:
1. Có trong bảng `holidays` → `'holiday'` (3×).
2. Thứ 7 hoặc Chủ nhật → `'weekend'` (2×).
3. Còn lại → `'weekday'` (1,5×).

Khi tính công, phần giờ tăng ca được tách thành `ot_weekday_hours`, `ot_weekend_hours`, `ot_holiday_hours` + `night_hours` để payroll áp đúng hệ số từng dòng.

### 5.7. Hợp đồng lao động (Điều 20) — 3 loại
Hệ thống lưu `contract_type` trên hồ sơ nhân viên:
1. **Hợp đồng không xác định thời hạn** (loại 2) — dùng cho nhân viên cũ, ổn định.
2. **Hợp đồng xác định thời hạn** (loại 1) — dùng cho nhân viên mới (đúng thông lệ: hợp đồng đầu tiên xác định thời hạn).
3. **Hợp đồng theo mùa vụ/công việc** (loại 3) — dự phòng cho nhân viên thời vụ.

> Trả lời tóm tắt: "Hệ thống rải 8h/ngày ≤48h/tuần; OT tối đa 40h/tháng 200h/năm; hệ số 1,5/2/3× theo ngày thường/T7-CN/lễ tết, cộng thêm 30% đêm và 20% OT đêm; 11 ngày lễ/năm theo Điều 112; 3 loại hợp đồng theo Điều 20."

---

## 6. Chống chấm trùng 60 giây (duplicate punch)

- Mỗi lần chấm, hệ thống lấy **mốc giờ của lần chấm gần nhất** trong ngày; nếu cách **< 60 giây** (cấu hình `duplicate_window_seconds=60`) thì **bỏ qua lần sau**, giữ lần đầu.
- **Lấy lần đầu trong cửa sổ 60s** — tránh bấm nhầm hai lần liên tiếp, tránh lỗi mạng nhân viên bấm lại.
- Cửa sổ **cấu hình được** trong trang Quy định (Regulations) — HR/Admin có thể đổi sang 30s/90s tùy chính sách.
- Đã kiểm thử runtime: chấm lần 1 lúc 08:00:00 → ghi nhận; chấm lần 2 lúc 08:00:30 (30s sau) → **bị từ chối** với thông báo "vừa chấm công cách đây ít hơn 60 giây"; chấm lần 3 lúc 08:01:30 (>60s) → ghi nhận bình thường.
- Ngoài chống trùng thời gian, hệ thống còn **ưu tiên nguồn vật lý** khi trùng nguồn: nếu máy (source=1) và web (source=2) cùng đẩy một mốc chấm, bản ghi máy được ưu tiên (chống nhân viên chấm web bù sau khi đã chấm máy).

> Trả lời tóm tắt: "Trong cửa sổ 60 giây (cấu hình được), chỉ lần chấm đầu tiên được ghi, các lần sau bỏ qua; ưu tiên nguồn máy vật lý khi trùng nguồn."

---

## 7. Tăng ca cuối tuần / lễ — tính ra sao?

Ví dụ minh họa (lương giờ = lương cơ bản / 160 giờ chuẩn/tháng):

- **Ngày thường**: NV làm thêm 2h sau giờ hành chính → 2h × 1,5 × lương giờ.
- **Thứ 7**: NV được duyệt OT 4h → 4h × 2,0 × lương giờ.
- **Ngày lễ (VD 1/5)**: NV OT 4h → 4h × 3,0 × lương giờ. Trong payslip hiện thành dòng riêng **"Làm thêm (lễ tết 3x)"**.
- **Ban đêm + OT**: NV ca đêm OT từ 22:00–01:00 (3h) vào ngày thường → 3h × 1,5 × lương giờ × (1 + 0,2 OT đêm) + phần hệ số đêm 30%.

Payslip tách từng dòng: `ot_weekday` (1,5×), `ot_weekend` (2×), `ot_holiday` (3×), `night` (1,3×), `night_ot` (OT đêm +20%) — minh bạch, nhân viên và kế toán đối chiếu được.

---

## 8. Ca đêm qua nửa đêm (overnight) — xử lý thế nào?

Đây là điểm kỹ thuật phức tạp nhất.

- Ca đêm ví dụ **22:00 → 06:00 hôm sau**. Ngày "của ca" là **ngày bắt đầu** (nếu chấm vào 22:00 đêm T7, ca thuộc T7).
- Hệ thống dùng **phút tuyệt đối kể từ nửa đêm của ngày-ca**: 22:00 = 1320 phút, 06:00 hôm sau = 360 phút **cộng thêm 1440** (qua ngày) → 1800 phút. Nhờ đó `checkOut > checkIn` về mặt toán học và tính được số giờ.
- **OT tách block theo ngày**: phần trước 0h tính theo `dayType` của ngày-ca; phần sau 0h tính theo `dayType` của ngày-hôm-sau.
  - Ví dụ ca T7 22h → CN 04h, được duyệt OT cả phiên: block T7 (22h–0h) = 2h × 2× (thứ 7); block CN (0h–04h) = 4h × 2× (Chủ nhật). Cả hai đều 2× vì cả T7 và CN đều là ngày nghỉ.
  - Nếu ca đêm qua ngày lễ (VD 30/4 rơi vào hôm sau): block sau 0h sẽ 3× (lễ) — hệ thống tự nhận biết qua `holidays`.
- Cửa sổ checkout ca đêm: nếu nhân viên quên chấm ra và chấm bổ sung trong **grace period** sau giờ kết ca (mặc định 60 phút) của ngày hôm sau, hệ thống gắn bản ghi về **ngày-ca** (hôm trước) để khớp ca.
- Đã kiểm thử: ca đêm giờ làm thực = 8h, giờ đêm = 8h, OT phân loại đúng theo block.

> Trả lời tóm tắt: "Ca qua 0h tính bằng phút tuyệt đối kể từ nửa đêm ngày-ca (+1440 cho hôm sau); OT chia block trước/sau 0h, mỗi block áp hệ số theo loại ngày riêng của nó."

---

## 9. Luồng duyệt đơn từ & Ủy quyền duyệt

### 9.1. Luồng duyệt theo loại đơn (FLOWS)
| Loại đơn | Cấp 1 | Cấp 2 | Cấp 3 |
|---|---|---|---|
| Nghỉ phép (leaves) | Quản lý trực tiếp | Trưởng phòng | — (+tham vấn GĐ nếu >3 ngày) |
| Đi muộn/về sớm | Quản lý trực tiếp | Trưởng phòng | — |
| Tăng ca (overtimes) | Quản lý trực tiếp | Trưởng phòng | **Kế toán** |
| Công tác (business-trips) | Quản lý trực tiếp | Trưởng phòng | **Kế toán** (duyệt chi phí) |
| Đổi ca (shift-swaps) | Quản lý trực tiếp | Trưởng phòng | — (+đồng nghiệp xác nhận) |
| Sửa công (attendance-updates) | Quản lý trực tiếp | **HR** | **Kế toán** (căn cứ lương) |

- **Nghỉ phép > 3 ngày**: sau khi Quản lý + Trưởng phòng duyệt, hệ thống tạo một bước ảo **"Tham vấn Giám đốc"** (status=5) — **không chặn**, chỉ push thông báo cho Giám đốc để biết, đơn vẫn được tính là đã duyệt.
- **Giám đốc chỉ duyệt thực sự khi được ủy quyền** (xem 9.2).

### 9.2. Ủy quyền duyệt (Delegation) — tính năng mới
**Bối cảnh**: Trưởng phòng/Quản lý nghỉ phép, đi công tác, muốn ủy quyền cho người khác duyệt hộ trong khoảng thời gian vắng mặt.

**Cách hoạt động**:
1. Trưởng phòng vào trang **"Ủy quyền duyệt"** (chỉ hiện với role Manager/HR/Director/Accountant/Admin), chọn **người được ủy quyền** (phải có vai trò duyệt), nhập **từ ngày–đến ngày** + lý do.
2. Trong khoảng đó, **mọi đơn đáng lẽ gửi cho trưởng phòng tự chuyển sang người được ủy quyền** — không cần thao tác thủ công, không sót đơn.
3. **Vết audit**: bản ghi duyệt ghi rõ `approverName = "Nguyễn A (thay mặt Trần B)"` + cột `on_behalf_of_user_id` / `on_behalf_of_name`. Audit log ghi "Duyệt bởi Nguyễn A thay mặt Trần B".
4. Người được ủy quyền thấy đơn trong mục "Duyệt đơn" của mình (pending approvals khớp theo `approver_user_id` đã được giải thành delegate).
5. HR/Admin có trang giám sát **tất cả ủy quyền** (`/api/delegation/all`) để theo dõi.

**Đã kiểm thử runtime**: Trưởng phòng IT (Trần Hải Yến) ủy quyền cho HR (Đặng Phương Anh) trong 10–24/8; nhân viên IT (Phạm Minh Khôi) gửi đơn đi muộn → đơn tự chuyển cho Đặng Phương Anh, vết duyệt ghi "Đặng Phương Anh (thay mặt Trần Hải Yến)", HR thấy đơn trong danh sách chờ duyệt.

> Trả lời tóm tắt: "Quản lý cài ủy quyền + khoảng vắng trước; trong khoảng đó đơn tự chuyển sang người ủy quyền, vết audit ghi 'duyệt thay mặt'; HR/Admin giám sát toàn bộ."

---

## 10. Kế toán tham gia duyệt — vai trò cụ thể?

Kế toán (Accountant) là cấp duyệt cho **các đơn có yếu tố tài chính**:
- **Tăng ca (overtimes)** — cấp cuối: kế toán xác nhận số giờ OT và chi phí OT trước khi tính lương.
- **Công tác (business-trips)** — cấp cuối: kế toán duyệt **chi phí công tác** (vé, khách sạn, phụ cấp).
- **Sửa công (attendance-updates)** — cấp cuối (sau HR): kế toán nhận bản ghi sửa công làm **căn cứ tính lương** (thêm/sửa/xóa giờ chấm ảnh hưởng công → lương).
- **Chốt kỳ lương (payroll approval)**: kế toán kiểm tra và chốt kỳ lương trước khi trình Giám đốc.

> **Lưu ý phân biệt**: các đơn thuần kế toán (thanh toán nhà cung cấp, tạm ứng, thuế, hóa đơn) **không nằm trong phạm vi đồ án** — chỉ ghi nhận trong báo cáo. Đồ án chỉ xây Kế toán tham gia vào **vòng chấm công → lương**, đúng nghĩa "Kế toán duyệt đơn tài chính liên quan công/lương".

---

## 11. Dashboard quỹ lương & phân tích

Trang Dashboard tổng quan (Admin/HR) có 3 biểu đồ mới phục vụ phân tích tài chính nhân sự:

### 11.1. Quỹ lương theo phòng ban
- `GET /api/dashboard/salary-fund?period=` → BarChart theo phòng ban: quỹ NET, quỹ GROSS, headcount mỗi phòng.
- Dùng để so sánh gánh lương giữa các phòng, kết hợp headcount để đánh giá lương bình quân.

### 11.2. Giờ công trung bình / nhân viên
- `GET /api/dashboard/work-hours-avg?from=&to=` → số giờ làm thực tế trung bình/NV toàn công ty và theo phòng ban.
- Dùng để phát hiện phòng nào làm quá giờ (nguy cơ OT vượt ngưỡng) hoặc thiếu giờ.

### 11.3. So sánh quỹ lương các kỳ (tháng)
- `GET /api/dashboard/salary-monthly` → GroupedBars: quỹ NET vs tổng OT qua các kỳ lương (nửa tháng).
- **Giải thích tháng cao/tháng thấp**: các kỳ cận Tết/lễ có OT cao → quỹ NET cao; các kỳ bình thường OT thấp → NET thấp. Biểu đồ đi kèm dòng giải thích tự nhiên: *"Các kỳ cận Tết/lễ thường có nhiều tăng ca (OT lễ 3×) nên quỹ lương NET cao hơn hẳn các kỳ thường."*
- Demo seed: kỳ **2026021** (cận Tết) OT ≈ 914 triệu → NET 3,51 tỷ; kỳ **2026071** (thường) OT ≈ 94 triệu → NET 2,84 tỷ → biến động rõ rệt, khớp với lời giải thích.

> Trả lời tóm tắt: "3 biểu đồ: quỹ lương/phòng, giờ công TB/NV, so sánh các kỳ — tháng cao do OT lễ tết 3×, tháng thường OT thấp."

---

## 12. Tài khoản demo

| Vai trò | Email | Mật khẩu |
|---|---|---|
| Quản trị viên | `admin@technova.vn` | `123456` |
| Giám đốc | `triet.pham@technova.vn` | `123456` |
| Trưởng phòng IT (đang ủy quyền) | `yen.tran@technova.vn` | `123456` |
| HR (được ủy quyền) | `anh.dang@technova.vn` | `123456` |
| Nhân viên IT | `khoi.pham@technova.vn` | `123456` |

Tất cả ~500 nhân viên dùng mật khẩu `123456` (demo); thật sẽ do Admin/HR cấp + đổi mật khẩu đầu tiên.

---

## 13. Kiểm thử đã thực hiện (verification)

| Kiểm thử | Kết quả |
|---|---|
| Reseed 500 NV + holidays + 60 ngày công | 483 NV, 20 ngày lễ, 40.602 punch, 20.799 record, 4.347 payslip ✅ |
| `npm run build` frontend (3216 module) | Pass, không lỗi TS ✅ |
| `tsc -p tsconfig.json` server | Pass, không lỗi ✅ |
| Dashboard salary-fund | 7 phòng, NET tổng 2,65 tỷ ✅ |
| Dashboard salary-monthly | 9 kỳ, kỳ Tết OT 914M → NET 3,51 tỷ; kỳ thường OT 94M → NET 2,84 tỷ ✅ |
| Dashboard work-hours-avg | TB 176,9 h/NV, 7 phòng ✅ |
| Ủy quyền: đơn tự chuyển + vết "thay mặt" | Đơn của NV IT → HR (Đặng Phương Anh "thay mặt" Trần Hải Yến), HR thấy trong pending ✅ |
| Chống trùng 60s | Lần 2 trong 30s bị từ chối, lần 3 >60s ghi nhận ✅ |
| OT lễ 3× trong payslip | payslip kỳ Tết có dòng "Làm thêm (lễ tết 3x)" = 12.000.000 đ ✅ |
| Ca đêm qua 0h | actual_work_hours=8, night_hours=8, OT tách block đúng ✅ |

---

## 14. Câu hỏi mở rộng có thể gặp

**Q: Nếu nhân viên quên chấm ra thì sao?**
A: Nhân viên gửi đơn "Sửa công" (attendance-updates, loại "Thêm/Sửa giờ chấm") → Quản lý → HR → Kế toán duyệt. Sau khi duyệt, engine `recomputeRecord` tính lại công cho ngày đó.

**Q: Nếu máy chấm công hỏng đúng ngày chốt kỳ lương?**
A: Nhân viên chấm bù trên web (source=2) với GPS/WiFi; khi máy khôi phục và đẩy bản ghi (source=1), hệ thống ưu tiên bản máy cho các mốc trùng. Kế toán có thể chốt kỳ sau khi HR xác nhận đủ dữ liệu.

**Q: Hệ thống có hỗ trợ nhiều chi nhánh không?**
A: Schema có `department` + vùng định vị (GPS/WiFi/IP) theo văn phòng; hiện chạy 1 công ty. Mở rộng đa chi nhánh: thêm bảng `branches` + lọc theo branch — kiến trúc engine không đổi.

**Q: Dữ liệu nhạy cảm (lương, định vị) bảo mật thế nào?**
A: (1) JWT xác thực mỗi request, phân quyền theo role; (2) mật khẩu băm bcryptjs; (3) audit log ghi mọi thao tác; (4) định vị chỉ lưu tại mốc chấm, chỉ HR/Admin xem; (5) backend tách route `requireAuth`/`requireRole`.

**Q: Tại sao SQLite mà không PostgreSQL ngay từ đầu?**
A: Quy mô 500 NV văn phòng + tải chấm công theo loạt → SQLite WAL + event loop tuần tự đủ, không tốn vận hành DB server. Kiến trúc đã tách tầng `db.ts`/`repo.ts` nên khi vượt ngưỡng vài nghìn người, nâng PostgreSQL chỉ ảnh tầng lưu trữ, không phá logic.

---

*Tài liệu này đi kèm mã nguồn tại `attendance-web/` (frontend) và `server/` (backend). Chạy demo: `cd server && npm run seed && npm run dev` (:4000); `cd attendance-web && npm run dev` (:5173).*