# GhostProject — sổ tự học theo day

Trang tĩnh (HTML/CSS/JS thuần), **không cần build, không cần server riêng**. Hai vai trò: **bạn bạn** giao task (file .md/.html), **bạn** học trên trang đề và viết báo cáo trên trang vở. Dữ liệu đồng bộ giữa 2 máy bằng **Turso** — SQLite qua HTTP, gọi thẳng từ trình duyệt.

Giao diện là một trang vở ngang: pane trái = trang đề, pane phải = trang vở kẻ dòng 34px với lề đỏ. (Chi tiết hệ thống hoá: xem `DESIGN.md`.)

## 3 màn hình

| Màn | Dùng để |
|---|---|
| **Làm bài** | Chọn day (select "Day N — tên day"), đọc task bên pane trái (nhiều file/day, tab đổi file), viết báo cáo bên pane phải. Nháp tự lưu; **Nộp bài** tạo phiên bản mới (v1, v2, …), bài cũ không bị đè. |
| **Báo cáo** | Danh sách mọi day: đã nộp thì mở ra đọc từng phiên bản, chưa nộp thì mở bản nháp viết tiếp. Cả hai người dùng chung màn này. |
| **Cài đặt** | Kết nối Turso, backup/import JSON, tải tất cả báo cáo .md, xoá dữ liệu. |

- **Giao task** (sidebar): hộp thoại tạo nội dung (markdown) + **Nhập file .md** — đặt **số day + tiêu đề bắt buộc** (không cho phép trùng số day), đăng lên Turso hoặc tải file gửi qua chat.
- **Mở file** (b chọn nhiều file cùng lúc): lô file vào một day — số day tự đoán từ tên/tiêu đề file, tiêu đề điền sẵn (day cũ dùng lại tiêu đề cũ, sửa được), xem trước từng file rồi **Nhận**: task .md/.html thêm vào day (file trùng tên được thay), file báo cáo (`# Báo cáo Day N`) chỉ lưu nếu day đó chưa nộp.
- **Task .html**: script bị bỏ, CSS link được nhúng thẳng (kể cả `@import` và `url(...)` thành data URI) không cần mạng; thiếu CSS nào hiện ô **dán CSS thủ công** ngay trong hộp xem trước. Chạy trong `iframe sandbox=""`.

## Cài Turso (mỗi máy một lần, ~3 phút)

1. Vào [app.turso.tech](https://app.turso.tech) → **Create Database** (region gần, ví dụ Singapore) → đặt tên, ví dụ `ghostproject`.
2. Copy **Database URL** (dạng `libsql://ghostproject-ten.turso.io`).
3. **Create Token** → copy token.
4. Trên mỗi máy: trang → **Cài đặt** → dán **URL database** + **Token truy cập** → **Kết nối & đồng bộ**.

Máy thứ hai chỉ cần dán đúng URL + token đó. Bảng được tạo tự động ở lần kết nối đầu; dữ liệu cũ (schem trước) tự migrate.

**Không cấu hình Turso?** App vẫn chạy, chỉ lưu trong máy đó (backup `.json` để chuyển máy).

## Cách đồng bộ hoạt động

| Bảng | Ai ghi | Nội dung |
|---|---|---|
| `days`, `taskfiles` | người giao task | tiêu đề day, các file task (kể cả HTML đã nhúng CSS) |
| `checks`, `reports`, `drafts` | người học | checklist, báo cáo từng phiên bản, bản nháp |

- Ghi ngay khi có thay đổi: tick checklist, ngừng gõ 0,9 giây (nháp), nộp bài, nhận file.
- Đọc lại toàn bộ khi mở trang và khi bấm **Kết nối & đồng bộ**; merges theo thời gian mới hơn (nháp/bài nộp/day) — không đè mất dữ liệu mới của máy kia.
- Người kia cần **mở/refresh trang** để thấy dữ liệu mới (không có realtime).

## Học + nộp báo cáo

- **Đọc task**: tick checklist ngay trong đề; task .html render trong iframe.
- **Viết**: template báo cáo có sẵn ngày + % checklist. Ngừng gõ là tự lưu (chip "Đang lưu… → Đã lưu giờ"); đổi day/tab sẽ flush trước khi chuyển.
- **Nộp**: bấm **Nộp bài** → tạo v mới, giữ nguyên các v cũ; đọc lại/so sánh ở tab **Báo cáo**.
- **Gửi lại qua chat**: **Tạo file .md** tải `baocaodayN.md`.

## Deploy lên Vercel

`node build-single.js` tạo `ghostproject.html` (bản single-file gửi qua chat) **và** chép `index.html`, `style.css`, `app.js`, `ghostproject.html` vào `deploy/`.

1. **Git:** repo đã nối Vercel — push `main` là tự deploy (thư mục `deploy/` được đưa lên web).
2. **Tay:** [vercel.com/new](https://vercel.com/new) → kéo thư mục `deploy`.

Trang phải chạy qua **https** (Vercel) để gọi được Turso; `file://` bị chặn CORS.

## Test

- `node test-smoke.js` — logic thuần: markdown (kể cả ảnh), migrate trạng thái cũ, tiêu đề day, nhiều file/day, streak, nhận file (thay/thêm/CSS nhúng thiếu → cảnh báo), nháp/nộp phiên bản, Turso helper + HTTP.
- `node --check app.js` — cú pháp.

## Lưu ý & giới hạn hiện tại

- **Phase 1**: ngày/tiêu đề, nhiều file task, nhúng CSS/ảnh, iframe sandbox, chia đôi màn + tab mobile, nháp tự lưu, nộp theo phiên bản, backup, Turso. **Chưa có**: review/phản hồi từng phần của bạn bạn, lịch sử hoạt động, thông báo, CSS tuỳ chỉnh ở Cài đặt.
- Token Turso nằm trong `localStorage` máy nào dán nó; thu hồi/tạo token mới ở dashboard bất cứ lúc nào (dán lại vào Cài đặt).
- Backup `.json` **không chứa** token Turso.
- Streak và "day đã nộp" chỉ tính bài đã nộp (nháp không tính).
