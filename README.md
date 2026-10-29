# GhostProject — website tự học theo day

Trang tĩnh (HTML/CSS/JS thuần), **không cần build, không cần server riêng**. Dữ liệu đồng bộ giữa 2 máy bằng **Turso** — SQLite chạy qua HTTP, dùng trực tiếp từ trình duyệt.

Flow đúng 3 bước: **bạn bạn gửi file .md → bạn xem, học, viết trả lời → tạo file .md gửi lại (hoặc nộp trong app), bạn bạn đọc.**

## 3 màn hình

| Màn | Dùng để |
|---|---|
| **Hôm nay** | Task tối nay (checklist tick được, bảng giờ nằm trong file task) và ô **Nộp báo cáo** ngay bên dưới. |
| **Báo cáo** | Danh sách mọi day: đã nộp thì mở ra đọc (báo cáo mới nhất mở sẵn), chưa nộp thì có nút **Viết báo cáo**. Cả hai người dùng chung màn này. |
| **Cài đặt** | Kết nối Turso, backup JSON, tải tất cả báo cáo `.md`, xoá dữ liệu. |

Nút **Giao task** (sidebar) mở hộp thoại cho người giao task: chọn Day → viết nội dung → **Đăng task** (lên Turso ngay) hoặc **Tải taskday.md** (gửi qua chat như cũ).

## Cài Turso (mỗi máy một lần, ~3 phút)

1. Vào [app.turso.tech](https://app.turso.tech) → đăng nhập bằng GitHub → **Create Database** (chọn region gần, ví dụ Singapore) → đặt tên, ví dụ `ghostproject`.
2. Mở database vừa tạo, copy **Database URL** (dạng `libsql://ghostproject-ten.turso.io`).
3. Bấm **Create Token** → copy token.
4. Trên mỗi máy: mở trang → **Cài đặt → Turso** → dán URL + token → **Kết nối & đồng bộ**.

Máy thứ hai chỉ cần dán đúng URL + token đó. Bảng dữ liệu được tạo tự động ở lần kết nối đầu tiên.

**Không cấu hình Turso?** App vẫn chạy được, chỉ lưu trong máy đó (dùng backup `.json` để chuyển dữ liệu).

## Cách đồng bộ hoạt động

| Bảng | Ai ghi | Nội dung |
|---|---|---|
| `tasks` | người giao task | nội dung từng day (`updated_at` mới hơn thắng) |
| `reports` | người học | báo cáo từng day |
| `checks` | người học | checklist đã tick |

- Ghi ngay khi có thay đổi: tick checklist, ngừng gõ báo cáo 0,9 giây, bấm Nộp báo cáo, đăng task.
- Đọc lại toàn bộ khi mở trang, khi bấm **Kết nối & đồng bộ**, và sau mỗi lần kết nối lại.
- Người kia cần **mở/refresh trang** để thấy dữ liệu mới (không có realtime).

## Học + nộp báo cáo

- **Nhận file**: bấm **Mở file .md** ở màn Hôm nay hoặc **Báo cáo** (hoặc kéo thả file vào trang). Hộp **Xem trước file** hiện bản render: file task (kiểu `taskday3.md`) thì sửa số Day nếu muốn rồi bấm **Nhận**; file báo cáo nhận lại từ bạn (kiểu `baocaoday5.md`, bắt đầu bằng `# Báo cáo Day N`) hiện preview và được lưu vào app nếu máy đó chưa có — nếu đã có thì chỉ xem, không đè. Nhận cả `.md` lẫn `.html`.
- **Học**: tick checklist ngay trong task; bảng giờ `TIME | MIN | PART` nằm trong nội dung task, tự render thành bảng.
- **Nộp**: viết vào ô báo cáo — template có sẵn ngày, % checklist. Ngừng gõ là tự lưu + đẩy lên Turso; bấm **Nộp báo cáo** để lưu và chuyển sang day kế tiếp chưa nộp.
- **Gửi lại qua chat**: **Tạo file .md** tải `baocaodayN.md` — bạn bạn mở file đó bằng **Mở file .md** để đọc preview, hoặc đọc trực tiếp ở tab **Báo cáo** (nếu hai máy đã kết nối Turso).

## Deploy lên Vercel

`node build-single.js` tạo `ghostproject.html` (bản single-file để gửi qua chat) **và** chép `index.html`, `style.css`, `app.js`, `ghostproject.html` vào `deploy/`.

1. **Git:** repo đã nối Vercel — push lên `main` là tự deploy (chỉ thư mục `deploy/` được đưa lên web).
2. **Tay:** [vercel.com/new](https://vercel.com/new) → kéo thư mục `deploy` → xong.

Trang phải chạy qua **https** (Vercel) để gọi được Turso; `file://` bị trình duyệt chặn CORS.

## Test

- `node test-smoke.js` — logic thuần: markdown, streak, chọn day, template báo cáo, nhận file task/báo cáo, decode Turso.
- `node --check app.js` — cú pháp.

## Lưu ý

- Token Turso nằm trong `localStorage` của máy nào dán nó; thu hồi/tạo token mới ở dashboard bất cứ lúc nào (dán lại vào Cài đặt).
- Backup `.json` **không chứa** token Turso.
- Streak và "day có báo cáo" chỉ tính day đã có báo cáo (kể cả bản đang viết).
