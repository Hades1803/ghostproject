# GhostProject — website tự học theo day

Trang tĩnh (HTML/CSS/JS thuần), **không cần build, không cần server riêng**. Dữ liệu đồng bộ giữa 2 máy bằng **Turso** — SQLite chạy qua HTTP, dùng trực tiếp từ trình duyệt.

Flow đúng 3 bước: **bạn bạn giao task → bạn học + nộp báo cáo → bạn bạn đọc báo cáo.**

## 3 màn hình

| Màn | Dùng để |
|---|---|
| **Hôm nay** | Task tối nay (checklist tick được, bảng giờ), timer buổi tối, và ô **Nộp báo cáo** ngay bên dưới. |
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
| `focus` | người học | phút tập trung từ timer |

- Ghi ngay khi có thay đổi: tick checklist, ngừng gõ báo cáo 0,9 giây, hết/ngừng timer, đăng task.
- Đọc lại toàn bộ khi mở trang, khi bấm **Kết nối & đồng bộ**, và sau mỗi lần kết nối lại.
- Người kia cần **mở/refresh trang** để thấy dữ liệu mới (không có realtime).

## Học + nộp báo cáo

- **Nhận task**: bạn bạn bấm **Giao task** → app bạn tự có khi mở trang. Hoặc **Nhận file** ở màn Hôm nay (hoặc kéo thả file vào trang) — nhận cả `.md` lẫn `.html`, số day lấy từ tên file.
- **Học**: tick checklist ngay trong task; timer tự đọc bảng giờ `TIME | MIN | PART` (19:30 → 21:30) trong task, kêu khi hết từng phần, bật **HARD STOP** ở dòng phút `—`.
- **Nộp**: viết vào ô báo cáo — template có sẵn ngày, phút từ timer, % checklist. Ngừng gõ là tự lưu + đẩy lên Turso; bấm **Nộp báo cáo** để lưu và chuyển sang day kế tiếp chưa nộp.
- **Đọc lại**: tab **Báo cáo** (cả hai người), hoặc **Cài đặt → Tải tất cả báo cáo .md**.

## Deploy lên Vercel

`node build-single.js` tạo `ghostproject.html` (bản single-file để gửi qua chat) **và** chép `index.html`, `style.css`, `app.js`, `ghostproject.html` vào `deploy/`.

1. **Git:** repo đã nối Vercel — push lên `main` là tự deploy (chỉ thư mục `deploy/` được đưa lên web).
2. **Tay:** [vercel.com/new](https://vercel.com/new) → kéo thư mục `deploy` → xong.

Trang phải chạy qua **https** (Vercel) để gọi được Turso; `file://` bị trình duyệt chặn CORS.

## Test

- `node test-smoke.js` — logic thuần: markdown, bảng lịch, timer, streak, chọn day, template báo cáo, decode Turso.
- `node --check app.js` — cú pháp.

## Lưu ý

- Token Turso nằm trong `localStorage` của máy nào dán nó; thu hồi/tạo token mới ở dashboard bất cứ lúc nào (dán lại vào Cài đặt).
- Backup `.json` **không chứa** token Turso.
- Streak và "day có báo cáo" chỉ tính day đã có báo cáo (kể cả bản đang viết).
