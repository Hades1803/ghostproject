'use strict';
/* Gói index.html + style.css + app.js thành 1 file ghostproject.html để gửi qua chat.
   Chạy lại sau khi sửa code: node build-single.js */
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('style.css', 'utf8');
const js = fs.readFileSync('app.js', 'utf8');
const out = html
  .replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>')
  .replace('<script src="app.js"></script>', '<script>\n' + js + '\n</script>');
if (out === html) { console.error('Không tìm thấy thẻ link/script để inline — kiểm tra index.html'); process.exit(1); }
fs.writeFileSync('ghostproject.html', out);
console.log('Đã tạo ghostproject.html (' + Math.round(out.length / 1024) + ' KB) — gửi đúng file này qua chat.');

/* Chuẩn bị thư mục deploy/ — chỉ chứa file trang web, KHÔNG chứa script probe/test (chúng có key S3 trong code).
   Deploy = upload đúng thư mục này lên Vercel. */
fs.mkdirSync('deploy', { recursive: true });
for (const f of ['index.html', 'style.css', 'app.js', 'ghostproject.html']) {
  fs.copyFileSync(f, 'deploy/' + f);
}
console.log('Đã chép 4 file web vào deploy/ — upload thư mục này lên Vercel.');
