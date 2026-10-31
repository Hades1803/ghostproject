---
name: GhostProject
description: Sổ tự học 2 người — đọc đề bên trái, viết báo cáo bên phải, trên trang giấy kẻ dòng đặt trên bàn học.
colors:
  desk: "#efe9df"
  paper: "#fdfcf7"
  paper-dim: "#f4f0e6"
  rule: "#c9d6e2"
  rule-soft: "#e7ebee"
  edge: "#e4dccd"
  edge-soft: "#ede7da"
  margin: "#c2432f"
  ink: "#2b2b26"
  ink-hover: "#3d3b33"
  muted: "#6b655a"
  positive-bg: "#e2ece6"
  positive-ink: "#24503c"
  negative: "#b23a26"
  negative-bg: "#f6e4de"
  neutral-bg: "#efe9df"
  neutral-ink: "#5c564a"
typography:
  display:
    fontFamily: "Be Vietnam Pro, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: "1.1"
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Be Vietnam Pro, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
  title:
    fontFamily: "Be Vietnam Pro, system-ui, sans-serif"
    fontSize: "15.5px"
    fontWeight: 600
  body:
    fontFamily: "Be Vietnam Pro, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "34px"
  label:
    fontFamily: "Be Vietnam Pro, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
rounded:
  page: "6px"
  input: "8px"
  pill: "999px"
spacing:
  sm: "10px"
  md: "16px"
  lg: "24px"
  line: "34px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "0 18px"
  button-paper:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
  input-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    padding: "0 12px"
  chip-status:
    backgroundColor: "{colors.neutral-bg}"
    textColor: "{colors.neutral-ink}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
  pill-positive:
    backgroundColor: "{colors.positive-bg}"
    textColor: "{colors.positive-ink}"
    rounded: "{rounded.pill}"
    padding: "0 9px"
---

# Design System: GhostProject

## Overview

**Creative North Star: "Vở ngang 5 dòng" (seed d98988574edce53d)**

App không phải dashboard: là trang vở mở ngang trên bàn học tối. Bên trái là trang đề (task .md/.html), bên phải là trang vở kẻ dòng 34px với lề đỏ — chỗ viết báo cáo. Hai trang giấy cùng nằm trên mặt bàn kem #efe9df; mọi thứ khác chỉ là đồ trên bàn (chọn day, thanh trạng thái, nút). Đặc điểm nhận ra ngay: số day lớn nhất màn hình (h1 30px), chữ mực #2b2b26 đặt trên giấy #fdfcf7, và trạng thái lưu viết nhỏ như ghi chú bút chì ("Đang lưu… / Đã lưu giờ / Lưu lỗi").

Các thành phần không bọc trong "thẻ bo tròn trên nền xám" — thể loại dashboard bị từ chối tường minh. Danh mục (day picker) là select trên mặt bàn; danh sách báo cáo là các trang giấy nằm chồng dọc. Bảng trong task kẻ hairline; số cột (MIN) căn phải.

**Key Characteristics:**
- Pane = trang giấy 6px bo góc, bóng giấy thật nhẹ (0 2px 10px rgba(76,60,30,.10)), lề đỏ 1px dọc mép trái ở 44px (mobile 22px).
- Chỉ có MỘT khoảnh khắc chuyển động: trang giấy mờ dần hiện ra (opacity .2s), không trượt.
- Trạng thái luôn nói thật: chip lưu đổi chữ theo vòng đời thật của bản nháp; bài nộp không bao giờ bị đè.
- Màu xanh #c9d6e2 chỉ dành cho dòng kẻ 34px trong trang viết; đỏ #c2432f chỉ dành cho lề và lỗi.

## Colors

Palette bàn học: nền kem ấm, giấy hơi ngà, mực gần đen, và hai điểm nhấn mang nghĩa (lề đỏ, dòng kẻ xanh). Màu không dùng để trang trí — mọi màu phải chỉ ra một "vật" thật trên bàn.

### Primary
- **Mực Ink** (#2b2b26): chữ nội dung, nút chính (pill mực đậm), checkbox, caret, viền checkbox của trạng thái "on". Hover #3d3b33.

### Secondary
- **Lề đỏ Margin** (#c2432f): lề dọc 1px trên trang giấy, chữ lỗi, nút huỷ dữ liệu hover. Đỏ là chữ viết bằng bút đỏ — ít và có nghĩa.
- **Dòng kẻ Rule** (#c9d6e2): vạch ngang 34px nhịp đều trong textarea báo cáo; nhạt hơn #e7ebee dùng làm đường kẻ phụ trong bảng.

### Neutral
- **Bàn học Desk** (#efe9df): nền app, nền select, chip trung tính #efe9df + chữ #5c564a.
- **Giấy Paper** (#fdfcf7): pane, sheet modal, nút phụ, dropdown nền.
- **Giấy mờ Paper-dim** (#f4f0e6): hover của filetab/nút, đoạn code/pre.
- **Viền Edge** (#e4dccd) và **Edge-soft** (#ede7da): hairline 1px kẻ hàng, ngăn pane-bar.
- **Chì Muted** (#6b655a): chữ phụ, nhãn, trạng thái lưu, số trong chip.
- **Nền dương Positive** (#e2ece6/#24503c): pill "Đã nộp".
- **Nền lỗi Negative** (#f6e4de/#b23a26): pill cảnh báo trên modal nhập file.

### Named Rules
**The Two-Ink Rule.** Màn hình chỉ có mực #2b2b26 và hai bút màu có nghĩa: đỏ (lề/lỗi) và xanh (dòng kẻ/tick phụ). Không thêm màu thứ ba vào bất kỳ màn hình nào.

## Typography

**Display/Body Font:** Be Vietnam Pro (weights 400/500/600, Google Fonts), fallback system-ui / Segoe UI.

**Character:** Bộ chữ kiểu ghi vở: không font serif trang trí, chỉ đổi cỡ và độ đậm để phân cấp. Số day là chữ số lớn nhất màn hình ("Day 2" 30px/600), tên day chì nhỏ hơn ngay cạnh.

### Hierarchy
- **Display** (600, 30px/1.1, letter-spacing -0.01em): số day trong workspace; mobile 24px.
- **Headline** (600, 18px): tiêu đề sheet modal, "Báo cáo Day N" trong trang báo cáo.
- **Title** (600, 15.5px): tiêu đề nhóm trong Cài đặt, **bold** trong markdown, `.md h2` của đề.
- **Body** (400, 15px / line-height 34px trong editor): nội dung đề, textarea báo cáo — nhịp dòng kẻ là 34px và chữ đi đúng trên vạch.
- **Label** (500, 12.5px): chip, filetab, cột TIME/MIN, cột table, trạng thái lưu.

### Named Rules
**The Ruled-Page Rule.** Trong trang viết, mọi chữ phải đi trên nhịp 34px (`line-height:34px`, textarea padding khối = bội số của 34). Chữ không được rơi giữa hai dòng kẻ.

## Layout

Bàn học chia hai dọc: sidebar 240px (mặt bàn, không phải giấy) + `.canvas`. Trên desktop, vùng làm việc là `#wsSplit` — flex hai pane với gutter 18px kéo được; `58%` hiển thị khi rê/kéo (`#splitNum`); pane còn lại tràn full-bleed khi pane kia gập. Nhịp: `--pad 24px`, `--gap 16px`. Chiều cao pane = `calc(100svh - 96px)`; cả trang KHÔNG cuộn — mỗi pane tự cuộn trong mình (`.pane-scroll`).

Responsive: ≤999px bỏ chia đôi — có hai tab "Task / Trả lời" dưới đáy màn hình (`.mtabs`, pill giấy; tab đang mở nền mực). `.canvas` thành flex column cao 100svh, chỉ pane đang mở hiển thị; vị trí cuộn giữ nguyên khi đổi tab. ≤860px còn phonebar 48px thay sidebar; cùng hàng nav "Làm bài / Báo cáo / Cài đặt + Giao task".

## Elevation & Depth

Sâu bằng vật: bàn ở dưới, trang giấy nổi nhẹ trên bàn, modal là trang giấy nổi lên qua lớp màn tối rgba(43,43,38,.34). Chỉ có MỘT giá trị bóng — bóng giấy thật của vật mỏng:

### Shadow Vocabulary
- **Page shadow** (`box-shadow: 0 2px 10px rgba(76,60,30,.10), 0 1px 3px rgba(76,60,30,.06)`): chỉ dùng cho `.pane` (trang giấy trên bàn). Cấm dùng ở nút, modal, toast, card .rep-item/.set-panel — những "trang" khác dùng viền hairline 1px mà BẮT buộc có lề đỏ.

### Named Rules
**The Paper-Not-Card Rule.** Chỉ dùng bóng cho trang giấy (.pane). Nút, modal, toast, card danh sách đều phẳng; nếu cần tách khỏi nền thì bọc trong viền hairline + kèm lề đỏ 1px.

## Shapes

Giấy bo 6px, input bo 8px, mọi thứ hình tròn là pill 999px (nút, chip, filetab, toast, grip của gutter). Không góc lồi/cắt xéo. Checkbox là ô vuông net mực 1.5px bo 3px — nét bút chì, không phải switch. Bảng kẻ hairline ngang, không kẻ dọc; cột số căn phải.

## Components

### Buttons
- **Shape:** pill 999px, cao 36px mặc định.
- **Primary:** nền `{colors.ink}` chữ `{colors.paper}`, padding 0 18px; hover #3d3b33. Chỉ một nút chính mỗi vùng (Nộp bài / Nhận / Giao task / Kết nối).
- **Paper (default `.btn`):** nền giấy, viền sáng, chữ mực; hover nền paper-dim.
- **Ghost:** nền trong suốt viền trong suốt; hover paper-dim. Dùng cho hành động phụ (Mở menu, Đóng, Huỷ).
- **Danger:** chữ `{colors.negative}` trên nền trong; hover nền `{colors.negative-bg}`. Dành cho huỷ dữ liệu.
- **Focus:** `:focus-visible` outline 2px mực (textarea offset -2px).

### Filetabs (tab chọn file trong day)
- **Style:** pill 26px, chữ 12.5px muted; active nền paper-dim + viền edge, 500.
- **Behavior:** nằm trên pane-bar 44px với đường kẻ dưới 1px; strip cuộn ngang khi >2 file; mobile mỗi tab tối đa 50% width có ellipsis.

### Chips / Pills
- **Style:** cao 24px, pill, nền với tone nhóm: trung tính {colors.neutral-bg}/{colors.neutral-ink}, positive `{colors.positive-bg}/{colors.positive-ink}` (Đã nộp), warn `{colors.negative-bg}/{colors.negative}` (cảnh báo nhập file).
- **State:** chip số liệu ("Checklist 2/6", "1/2 day nộp", "Streak 1 ngày") nằm trên mặt bàn cạnh day picker.

### Page Pane (signature component)
- **Structure:** `.pane` = trang giấy: nền paper, bo 6px, bóng page shadow, lề đỏ 1px trong suốt (opacity .5). Cấu trúc dọc: `.pane-bar` (tab file + nút gập) → `.pane-scroll` (nội dung đề, padding trái 56px desktop / 44px mobile) → `.pane-actions` (chỉ pane phải: nhóm nút phụ trái, spacer, primary "Nộp bài" phải).
- **Editor:** `#repText` trong pane phải, dòng kẻ 34px bằng repeating-linear-gradient + `background-attachment:local`; trạng thái lưu là `.savechip` 12.5px muted, đỏ khi lỗi.

### Inputs / Fields
- **Style:** nền trắng, viền edge 1px, bo 8px, cao 36px (textarea minh hoạ 240px trong sheet).
- **Focus:** viền/mực đậm hơn; lỗi: dòng chữ đỏ dưới field + placeholder/edge không đổi màu.
- **Inline như "Day + Tiêu đề"** trong modal nhập file: label 12.5px muted, field nằm trên cùng hàng.

### Navigation
- **Desktop:** sidebar trên mặt bàn, không phải giấy: brand (ghost đỏ SVG 22px + tên), nav item là pill chữ muted, item hiện tại nền paper + chữ mực (KHÔNG bóng); "Giao task" là pill mực ở đáy.
- **Mobile (≤860px):** phonebar cao 48px sticky nền desk; sheet nav mở bằng "Mở menu".
- **Mobile (≤999px):** two-tab bar `.mtabs` dưới đáy vùng làm việc: "Task / Trả lời"; active nền mực chữ giấy.

### Modal Sheet
- **Structure:** nền tối rgba(43,43,38,.34) bao quanh; sheet giấy bo 8px, KHÔNG có bóng, w:min(760px,100%), h:max calc(100svh - 32px). Với modal nhập file: header + field Day/Tiêu đề + note đứng yên, chỉ `#stageList` cuộn, hàng nút Nhận/Huỷ ghim đáy trên hairline.

## Do's and Don'ts

### Do:
- **Do** giữ lề đỏ 1px trên mọi "trang giấy" (.pane, .rep-item, .set-panel) — đó là tài sản của thế giới.
- **Do** căn phải cột số (MIN, %, version) và để header số theo cùng.
- **Do** giữ nhịp dòng kẻ 34px nguyên vẹn trong pane viết (padding-top/bottom bội số 34).
- **Do** dùng chữ Việt có gốc, trạng thái thật ("Đang lưu… → Đã lưu giờ → Lưu lỗi").

### Don't:
- **Don't** dùng gradient trang trí. Gradient DUY NHẤT được phép là ruling 34px trong `#repText` (thế giới kẻ dòng, chức năng chứ không phải điểm nhấn).
- **Don't** đặt bóng vào nút, modal, toast, card — đó là trang giấy của dashboard: phẳng.
- **Don't** đưa eyebrow/kicker (chữ nhỏ uppercase trên tiêu đề) vào bất kỳ màn hình nào — cấm, không ghi nhận như một chuẩn.
- **Don't** dùng glyph icon (▲ ● ►) làm icon; icon là SVG nhỏ hoặc không có.
- **Don't** dashboard hoá: không grid thẻ trắng trên nền xám, không KPI card.
- **Don't** để cả trang cuộn chung khi bố cục chia đôi; chỉ pane cuộn trong mình (mobile thì pane đang mở cuộn theo tab).
