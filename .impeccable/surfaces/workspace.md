---
version: 1
slug: "workspace"
primary_target: "workspace"
related_targets: ["reports","settings"]
---

# Surface brief — workspace (Làm bài) + Báo cáo + Cài đặt

## Direction contract

THESIS: App là trang vở mở ra trên bàn học tối: đọc đề trên trang giấy bên trái, viết trả lời ngay trên dòng kẻ bên trang kia. Từ chối bố cục mặc định "dashboard thẻ trắng trên nền xám" của thể loại app học tập.

OWN-WORLD: Bàn học màu #efe9df; hai trang giấy kem #fdfcf7 (pane trái = trang đề, pane phải = trang vở); dòng kẻ #c9d6e2 đúng nhịp 34px chỉ ở trang viết; lề đỏ #c2432f dọc mép trái mỗi trang; mực #2b2b26; chữ Be Vietnam Pro. Component language: pane là trang giấy (không phải card bo tròn), nút chính là pill mực đậm, bảng kẻ hairline, checkbox vuông nét mực, trạng thái lưu viết nhỏ như ghi chú bút chì.

STORY: Người học mở app buổi tối, thấy ngay Day hiện tại + tiêu đề day, đọc task như trang đề, gõ báo cáo trên dòng kẻ với trạng thái lưu thật (Đang lưu… / Đã lưu giờ / Lưu lỗi), nộp bài thành phiên bản mới — biết chắc bài cũ không bị đè.

FIRST VIEWPORT: Thanh trên 56px trên nền bàn: tên app trái, select chọn day + chips (Checklist x/y, Streak) phải. Dưới đó hai trang giấy: trái ~58% là đề bài (tiêu đề Day với con số day lớn nhất màn hình, nội dung task), phải ~42% là trang vở kẻ dòng (báo cáo nháp, "Đã lưu 20:32" nhỏ mờ, nút chính "Nộp bài" đặt góc dưới phải trang vở, cùng "Tạo file .md" + "Xem trước"). Giữa hai trang là khe bàn với tay kéo chia pane, kéo hiện số % ngay trên tay cầm; gập một trang thì trang còn lại chiếm trọn khung không viền. Mobile (<1000px): hai tab "Task" / "Trả lời" thay cho chia đôi.

FORM: Vở ngang 5 dòng — vị trí 1/7 trong danh sách grounded, là card IMPECCABLE'S PICK do người dùng chốt (không steer); sketch khóa: .impeccable/mocks/decision/model-pick.html; seed:d98988574edce53d.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
