# GhostProject — website tự học theo day

Trang tĩnh (HTML/CSS/JS thuần), **không cần cài gì** — mở `index.html` bằng Chrome/Edge là chạy. Có bản single-file `ghostproject.html` để gửi qua chat (build lại bằng `node build-single.js`).

## Flow hàng ngày

**Cách 1 — gửi file qua chat (không cần S3):**

1. **Bạn bạn tạo task**: mở trang → tab **Tạo task** → điền nội dung → bấm **Tải taskdayN.md** → gửi file qua chat.
2. **Bạn nhận task**: mở trang → **Tổng quan** → bấm **Nhận file** (hoặc kéo thả file vào trang) — số day tự nhận từ tên file.
3. **Học**: tab **Task** → xem task, tick checklist (tự lưu), bấm **Bắt đầu** timer — timer tự đọc bảng lịch (TIME/MIN/PART) trong task, kêu khi hết từng phần và bật **HARD STOP** ở dòng phút `—`.
4. **Báo cáo**: tab **Báo cáo** → template tự điền ngày, số phút tập trung (từ timer), % checklist → **Tải baocaodayN.md** (hoặc `.html`) → gửi lại bạn bạn.

**Cách 2 — đồng bộ qua S3 (không cần gửi file):** xem mục Đồng bộ S3 bên dưới.

## Đồng bộ S3 (Long Vân / S3-compatible)

Hai máy cùng mở trang, cùng điền thông tin bucket ở **Cài đặt → Đồng bộ S3**:

- **Endpoint**: `https://s3-hcm-r1.longvan.net` (đã test — endpoint client `s3-hcm5-r1` bị chặn thao tác object)
- **Region**: `hcm5-r1`
- **Bucket**: tên bucket (ví dụ `ghostproject` — nên tạo bucket riêng trong console Long Vân vì access key không có quyền tạo bucket)
- **Access key / Secret key**: của bạn

Cách hoạt động: hai file JSON trong bucket —

| File | Chủ sở hữu | Nội dung |
|---|---|---|
| `tasks.json` | người giao task | nội dung từng day (theo `addedAt`, mới hơn thắng) |
| `reports.json` | người học | báo cáo, checklist, phút tập trung (trộn OR, không nhân đôi) |

App tự **kéo về khi mở trang** và **đẩy lên 2,5 giây sau mỗi lần lưu**; nút **Đồng bộ ngay** chạy tay ở Cài đặt.

**Quan trọng:** đồng bộ cần trang được mở qua **https** (GitHub Pages, hoặc static hosting của Long Vân). Mở bằng `file://` thì trình duyệt chặn CORS (Origin `null` không được phép echo) — app sẽ hiện lỗi rõ ràng. Xem/nhập file qua chat vẫn dùng được bình thường với `file://`.

CORS trên bucket đã cấu hình sẵn: AllowedOrigin `*`, method GET/PUT/HEAD (script `s3-probe2.mjs` có thể đặt lại nếu cần).

## Tính năng

- **Tổng quan**: dải buổi tối 19:30 → 21:30 với vạch "bây giờ" + hard stop; streak; phút tập trung 7 ngày; day có báo cáo; nhật ký từng day (cap 8 dòng).
- **Báo cáo** lưu nháp trong máy — day có báo cáo (kể cả nháp) mới tính vào streak.
- **Cài đặt**: backup xuất/nhập `.json`, gộp tất cả báo cáo thành 1 file `.md`, đồng bộ S3, xoá dữ liệu.

## Lưu ý

- Toàn bộ dữ liệu nằm trong **localStorage của trình duyệt**: dùng Chrome/Edge thường (không dùng chế độ ẩn danh), và backup định kỳ.
- Khóa S3 nằm plaintext trong localStorage của máy nào điền nó — bucket nên dùng riêng cho GhostProject, key có thể xoay/thu hồi bất cứ lúc nào.
- Task `.html` chỉ xem được nguyên bản, không có checklist/timer tự động (chỉ có với `.md`).

## Deploy lên Vercel

Chạy `node build-single.js` — nó build `ghostproject.html` **và** chép 4 file web vào `deploy/`. Chỉ upload thư mục `deploy/` (các script khác ở thư mục gốc chứa key S3, không được đưa lên web). Hai cách:

1. **Kéo–thả (nhanh nhất):** vào [vercel.com/new](https://vercel.com/new) → kéo thư mục `deploy` vào → xong, nhận ngay `https://tên-project.vercel.app`.
2. **CLI:** `npm i -g vercel` → `cd deploy` → `vercel --prod` (đăng nhập lần đầu bằng browser).

Mở trang qua https là đồng bộ S3 chạy được ngay (CORS bucket đã cho mọi origin). Điền thông tin bucket ở **Cài đặt → Đồng bộ S3** trên máy nào cũng cần điền một lần.

## Test

- `node test-smoke.js` — 33 assert logic (md, lịch, timer, streak, merge S3).
- `node test-sync.mjs` — end-to-end với bucket thật (cần key trong file).
- `node s3-probe.mjs` / `s3-probe2.mjs` — chẩn đoán quyền/CORS bucket.
