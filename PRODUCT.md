# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Hai người, hai vai trò trên hai máy riêng (không đăng nhập, nhận diện bằng dữ liệu):

- **Người học** — người dùng chính. Học buổi tối theo day, đọc task, viết trả lời/báo cáo, nộp.
- **Bạn của người học (người giao task)** — soạn/giao task theo day, đọc bài nộp của người học. Phase 2 sẽ thêm vai trò review cho người này.

## Product Purpose

Tracker tự học theo **day tuần tự** (Day 1, Day 2, Day 12… — không phải ngày trên lịch): bạn bạn gửi file task (.md/.html), người học đọc task, học, viết bài trả lời rồi nộp lại; cả hai đọc được bài nộp trong app. Thành công = người học luôn biết task hôm nay là gì và làm tới đâu; bạn bạn đọc được bài nộp không cần cài gì thêm.

## Positioning

Flow **file-first qua chat, không tài khoản**: task đến là một file (.md/.html) — file đó CHÍNH là task, render đúng như bạn soạn; bài trả lời cũng là một file .md tạo từ app gửi ngược lại qua chat. Turso (SQLite qua HTTP) chỉ là lớp đồng bộ tuỳ chọn để hai máy đọc trực tiếp trong app — không có nó app vẫn chạy đủ.

## Operating Context

- Học buổi tối ngày thường, session có bảng giờ + hard stop nằm trong nội dung file task (văn hoá làm việc của bộ đôi).
- File trao đổi qua chat (Zalo/Messenger); app dùng trên cả điện thoại và máy tính (mobile-first, desktop ngang hàng).
- Dữ liệu: localStorage làm cache/offline, Turso đồng bộ giữa 2 máy; site chạy trên Vercel (phải qua HTTPS để gọi Turso).
- Spec gốc đầy đủ: `C:\Users\anhqu\Downloads\tmp` (bản spec "Personal Learning Tracker" — nguồn của Phase 1).

## Capabilities and Constraints

- **Kiến trúc (chốt với user):** site tĩnh HTML/CSS/JS, KHÔNG backend, KHÔNG auth. SQLite = Turso qua HTTP (`/v2/pipeline`). Spec gốc đòi local-first SQLite trên đĩa — đã quyết định "phiên dịch" sang web tĩnh + Turso.
- **2 vai trò (chốt với user):** giữ mô hình bạn-giao-task / bạn-học. Spec gốc nói single-user — không áp dụng.
- **Phạm vi Phase 1 (chốt với user):** workspace cốt lõi — reviews/annotations (Phase 2), activity/notifications + search/filter dashboard (Phase 3), custom CSS editor (Phase 4) **chưa làm**.
- Day = số nguyên dương bất kỳ (Day 1, 2, 10, 50…), trùng số day bị chặn với thông báo rõ; **tiêu đề day bắt buộc, không rỗng**, dùng làm khóa tìm kiếm chính (nhập tiêu đề 1 lần cho nhiều file cùng day; sửa tiêu đề không mất dữ liệu).
- Task: nhiều file cho 1 day; giữ **bản gốc** tách khỏi bản render; thay task không xoá bài nộp/checklist/lịch sử.
- **Import HTML phải nhúng CSS thật:** chọn kèm file .css (và ảnh khi có) trong cùng lần import → resolve đường dẫn tương đối giữa các file đã chọn → nhúng thành `<style>` thật; thiếu css/ảnh phải cảnh báo rõ, không im lặng. HTML render trong iframe **sandbox**, script trong task không được chạm vào dữ liệu app.
- Markdown first-class: bảng, checklist, code fence, blockquote; giữ source, có khung xem source.
- **Split-pane:** desktop = task trái + editor phải, scroll độc lập, co giãn được; mobile = tab Task/Trả lời, không mất nháp khi chuyển.
- Draft autosave (debounce) với trạng thái thật: Đang lưu / Đã lưu / Lưu lỗi; không hiện "Đã lưu" khi chưa lưu thành công.
- Nộp bài: **không ghi đè** — mỗi lần nộp là một phiên bản, review (Phase 2) gắn với phiên bản nó review; draft tách khỏi bài đã nộp.
- Đồng bộ: ghi ngay khi có thay đổi (tick checklist, ngừng gõ ~0,9s, nộp bài, đăng task); phía kia cần mở/refresh để thấy; không realtime.
- Backup JSON không chứa token Turso; reset xoá cả Turso.

## Brand Commitments

- Tên app: **GhostProject** (logo chữ trong sidebar).
- Toàn bộ UI text bằng **tiếng Việt**.
- Ràng buộc người dùng nêu rõ: giao diện **không được trông "AI-generated"** — sạch, gọn, dễ nhìn (yêu cầu "gọn gàng dễ nhìn" của user là ràng buộc, không phải gợi ý).

## Evidence on Hand

- Spec Phase-đầy-đủ: `C:\Users\anhqu\Downloads\tmp` (1092 dòng, 20 mục + acceptance criteria).
- App đang sống: https://ghostproject-virid.vercel.app/ — repo này, 3 màn (Hôm nay / Báo cáo / Cài đặt) + modal Giao task.
- Không có ảnh/logo/asset thương hiệu nào ngoài logo chữ; không fabricate nội dung thương mại.

## Product Principles

1. **File-first:** task đến và bài trả lời đi đều dưới dạng file qua chat — app là nơi đọc/viết/tạo file đó, không phải hệ thống quản lý dự án.
2. **Đúng như bạn soạn:** nội dung task hiển thị trung thực với thiết kế gốc (nhất là HTML+CSS); bản gốc luôn được giữ.
3. **Nhìn là biết:** tình trạng day (chưa có task / đang làm / đã nộp / có gì mới) thấy ngay, không phải đào.
4. **Không mất chữ:** làm offline được, autosave mọi thứ, đồng bộ khi có mạng.
5. **Gọn, không enterprise:** workspace đọc task + viết bài là trung tâm thị giác; không filter tree, không badge cocktail.

## Accessibility & Inclusion

- UI tiếng Việt, cỡ chữ đọc được trên điện thoại; keyboard accessibility cho các thao tác chính (spec mục 15); không dựa vào màu một mình cho trạng thái.
