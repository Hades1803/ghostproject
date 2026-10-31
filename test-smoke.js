'use strict';
/* Smoke test cho logic trong app.js — chạy: node test-smoke.js */
const fs = require('fs');
const vm = require('vm');

/* ---- DOM/localStorage stub tối thiểu ---- */
function el() {
  return {
    tagName: 'DIV', attributes: [], hidden: false,
    innerHTML: '', textContent: '', value: '', disabled: false,
    style: { setProperty() {}, removeProperty() {} }, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, closest() { return null; }, replaceWith() {},
    querySelectorAll() { return []; }, querySelector() { return null; }, click() {}, focus() {}, select() {}, remove() {},
    setAttribute() {}, removeAttribute() { return null; }, getAttribute() { return null; }, setSelectionRange() {},
    set onclick(f) { this._onclick = f; }, get onclick() { return this._onclick; },
  };
}
const els = {};
const sandbox = {
  document: {
    getElementById: (id) => (els[id] ||= el()),
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: () => el(),
    addEventListener() {},
    body: { appendChild() {} },
  },
  localStorage: (() => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; })(),
  window: {}, navigator: {}, alert() {}, confirm() { return true; },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  Blob, console, setInterval, clearInterval, setTimeout, clearTimeout,
  TextEncoder, TextDecoder, crypto: require('node:crypto').webcrypto,
  location: { protocol: 'https:', hash: '' }, fetch: () => Promise.reject(new Error('no network in smoke test')),
};
sandbox.addEventListener = () => {}; // hashchange listener trong init()
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync('app.js', 'utf8')
  + `\n;globalThis.__A = {
    get state() { return state; },
    migrateState, dayTitle, ckPair, calcStreak, curDay, reportTemplate, refMatch, embedCss, inlineMdAssets,
    prepareImport, stageFiles, acceptStaged, saveDraftNow, submitReport, stageBadges,
    mdToHtml, tursoBase, tsqlRows, tsql, iso, today, save, renderAll,
    getStaged: () => staged,
    setPick: (v) => { pickDay = v; },
    setTitle: (t) => { if (staged) staged.title = t; },
    reset: (s) => { state = migrateState(s || {}); pickDay = null; },
  };`,
  sandbox
);

const A = sandbox.__A;
let fails = 0;
function assert(name, cond) {
  if (cond) console.log('  ok  ' + name);
  else { fails++; console.log('  FAIL ' + name); }
}
/* stub cho mọi getElementById */
const $ = (id) => (els[id] ||= el());

/* task mẫu: bảng lịch + checklist + blockquote */
const SAMPLE = `# Day 1 — Foundations

**Mục tiêu hôm nay:** hiểu cơ chế cốt lõi của §1.

## Inside a 2-hour weekday evening

| TIME | MIN | PART |
|------|-----|------|
| 19:30 | 10 | Đọc lại ghi chú hôm qua |
| 19:40 | 60 | **§1 Knowledge** — cơ chế cốt lõi |
| 20:40 | 35 | **§2 Predict → Run → Explain** |
| 21:15 | 15 | **§3 AI-Verify + §4 Drill** |
| 21:30 | — | **Hard stop. Dừng cả giữa câu.** |

> **21:30 là điểm dừng, không phải mục tiêu.**

## Checklist
- [ ] Đọc lại ghi chú hôm qua (10')
- [ ] §1: viết lại cơ chế bằng lời của mình
- [ ] §2: Predict → Run → Explain với 3 ví dụ
- [ ] §3: kiểm chứng 1 điểm còn mơ hồ với AI
- [ ] §4: drill 5 câu
- [ ] Ghi lại chỗ dừng nếu dừng sớm
`;

/* ---- markdown renderer ---- */
console.log('mdToHtml:');
const html = A.mdToHtml(SAMPLE);
assert('render <table>', html.includes('<table>'));
assert('render th TIME', html.includes('>TIME<'));
assert('render 6 checkbox', (html.match(/data-ck="\d+"/g) || []).length === 6);
assert('render blockquote', html.includes('<blockquote>'));
assert('render doc-title (md # → h2)', html.includes('<h2 class="doc-title">'));
assert('bold trong bảng', html.includes('<strong>'));
const one = A.mdToHtml('**a** và *b* và `c`');
assert('inline bold/em/code', one.includes('<strong>a</strong>') && one.includes('<em>b</em>') && one.includes('<code>c</code>'));
assert('XSS bị escape', A.mdToHtml('<img src=x onerror=alert(1)>').includes('&lt;img'));
const imgMd = A.mdToHtml('![sơ đồ](anh.png)');
assert('ảnh md → <img>', imgMd.includes('<img src="anh.png" alt="sơ đồ"'));

/* ---- migrateState: dữ liệu cũ → hình dạng mới ---- */
console.log('migrateState:');
const old = A.migrateState({
  tasks: { 2: { type: 'md', content: '# Hello' }, 3: '# Ba' },
  checks: { 2: [true, false], 3: { 0: [false] } },
  reports: {
    2: { md: '# Báo cáo Day 2', ts: 5, date: '2026-01-01', at: '21:00' },
    4: '# Báo cáo Day 4',
  },
  settings: { split: 300, panes: 'zzz' },
});
assert('task cũ → mảng 1 file', Array.isArray(old.tasks[2]) && old.tasks[2].length === 1 && old.tasks[2][0].src === '# Hello');
assert('task dạng chuỗi → file .md', old.tasks[3][0].type === 'md' && old.tasks[3][0].src === '# Ba');
assert('checks cũ (mảng) → theo file 0', JSON.stringify(old.checks[2]) === '{"0":[true,false]}');
assert('checks mới giữ nguyên', JSON.stringify(old.checks[3]) === '{"0":[false]}');
assert('report cũ → subs v1', old.reports[2].subs[0].v === 1 && old.reports[2].subs[0].md === '# Báo cáo Day 2');
assert('report dạng chuỗi → subs', old.reports[4].subs.length === 1);
assert('draft mặc định null', old.reports[2].draft === null);
assert('split kẹp 24..78', old.settings.split === 78);
assert('panes lạ → both', old.settings.panes === 'both');

/* ---- dayTitle ---- */
console.log('dayTitle:');
A.reset({ tasks: { 3: [{ name: 't.md', type: 'md', src: '# Day 3 — **Stack** ở đây' }] }, days: { 3: { title: 'Ngăn xếp', updatedAt: 1 } } });
assert('lấy tiêu đề đã đặt', A.dayTitle(3) === 'Ngăn xếp');
A.reset({ tasks: { 3: [{ name: 't.md', type: 'md', src: '# Day 3 — **Stack** ở đây' }] } });
assert('fallback từ tiêu đề file, bỏ **', A.dayTitle(3) === 'Day 3 — Stack ở đây');
assert('không có gì → Day N', A.dayTitle(9) === 'Day 9');

/* ---- ckPair: nhiều file/day ---- */
console.log('ckPair:');
A.reset({
  tasks: {
    5: [
      { name: 'a.md', type: 'md', src: '- [ ] một\n- [ ] hai\n- [ ] ba' },
      { name: 'b.md', type: 'md', src: '- [ ] bốn\n- [ ] năm' },
      { name: 'slide.html', type: 'html', src: '<p>x</p>', html: '<!doctype html><p>x</p>' },
    ],
  },
  checks: { 5: { 0: [true, false, true] } },
});
assert('gộp 2 file .md, bỏ .html → 2/5', JSON.stringify(A.ckPair(5)) === '[2,5]');
A.reset({ tasks: { 5: [{ name: 'a.md', type: 'md', src: '- [ ] một' }] }, checks: { 5: { 0: [true, true, false] } } });
assert('checklist thừa vẫn tính (task đổi)', JSON.stringify(A.ckPair(5)) === '[2,3]');

/* ---- streak từ các phiên bản đã nộp ---- */
console.log('streak:');
const d1 = new Date(Date.now() - 864e5);
A.reset({ reports: { 1: { subs: [{ v: 1, md: 'x', ts: 1, date: A.today(), at: '21:00' }], draft: null } } });
assert('hôm nay có bài = 1', A.calcStreak() === 1);
A.reset({ reports: { 1: { subs: [{ v: 1, md: 'x', ts: 1, date: A.today(), at: '' }], draft: null }, 2: { subs: [{ v: 1, md: 'y', ts: 2, date: A.iso(d1), at: '' }], draft: null } } });
assert('2 ngày liên tục', A.calcStreak() === 2);
A.reset({ reports: { 2: { subs: [{ v: 1, md: 'y', ts: 2, date: A.iso(d1), at: '' }], draft: { md: 'nháp', savedAt: 1 } } } });
assert('nháp không tính streak, hôm nay trống → 1', A.calcStreak() === 1);

/* ---- chọn day ---- */
console.log('curDay:');
A.reset({ tasks: { 1: [{ name: 'a.md', type: 'md', src: '# Day 1' }] } });
assert('chưa nộp → day mới nhất', A.curDay() === 1);
A.reset({
  tasks: { 1: [{ name: 'a.md', type: 'md', src: '# Day 1' }], 2: [{ name: 'b.md', type: 'md', src: '# Day 2' }] },
  reports: { 1: { subs: [{ v: 1, md: 'x', ts: 1, date: A.today(), at: '' }], draft: null } },
});
assert('day 1 đã nộp → day 2', A.curDay() === 2);
A.setPick(1);
assert('pickDay được tôn trọng', A.curDay() === 1);
A.setPick(null);
A.reset({});
assert('không có task → null', A.curDay() === null);

/* ---- report template ---- */
console.log('report:');
A.reset({ tasks: { 1: [{ name: 'a.md', type: 'md', src: SAMPLE }] }, checks: { 1: { 0: [true, true, false, false, false, false] } } });
const rep = A.reportTemplate(1);
assert('checklist 2/6', rep.includes('Checklist: 2/6 (33%)'));
assert('có ngày hôm nay', rep.includes('Ngày: ' + A.today()));
assert('tiêu đề file baocaoday', rep.startsWith('# Báo cáo Day 1'));

/* ---- ghép css/ảnh ---- */
console.log('embedCss:');
const files = [
  { name: 'assets/site.css', text: 'body{background:url(img/bg.png)}', dataUrl: null },
  { name: 'img/bg.png', text: null, dataUrl: 'data:image/png;base64,AAA' },
  { name: 'theme.css', text: '@import "base.css";\n.x{color:red}', dataUrl: null },
  { name: 'base.css', text: 'body{margin:0}', dataUrl: null },
];
assert('refMatch theo đuôi đường dẫn', A.refMatch('../img/bg.png', files).name === 'img/bg.png');
assert('refMatch không khớp → null', A.refMatch('nope.css', files) === null);
const w1 = [];
const css1 = A.embedCss('@import "theme.css";\nh1{background:url(../img/bg.png)}', 'main.css', files, w1);
assert('url(ảnh) → data URI', css1.includes('url("data:image/png;base64,AAA")'));
assert('@import nội bộ nhúng thẳng', css1.includes('body{margin:0}') && css1.includes('color:red'));
assert('không cảnh báo khi đủ file', w1.length === 0);
const w2 = [];
const css2 = A.embedCss('a{background:url(missing.png)}', 'main.css', files, w2);
assert('ảnh thiếu → giữ nguyên + cảnh báo', css2.includes('missing.png') && w2.length === 1 && /missing\.png/.test(w2[0]));
const w3 = [];
A.embedCss('@import "other.css";', 'main.css', files, w3);
assert('@import thiếu → cảnh báo', w3.some((x) => /other\.css/.test(x)));
const w4 = [];
assert('ảnh .md nhúng data URI', A.inlineMdAssets('![a](img/bg.png)', 't.md', files, w4).includes('![a](data:image/png;base64,AAA)'));
A.inlineMdAssets('![a](khong.png)', 't.md', files, w4);
assert('ảnh .md thiếu → cảnh báo', w4.length === 1 && /khong\.png/.test(w4[0]));

/* ---- nhận file: chuẩn bị, xem trước, rồi mới nhận ---- */
(async () => {
  console.log('prepareImport:');
  A.reset({ tasks: { 2: [{ name: 'old.md', type: 'md', src: '# Day 2 cũ' }] } });
  const prep = await A.prepareImport([
    { name: 'taskday7.md', text: async () => '# Day 7 — Cây\n\n- [ ] việc 1' },
    { name: 'taskday7-b.md', text: async () => '# Day 7 — Cây (phần 2)\n\n- [ ] việc 2' },
    { name: 'baocaoday2-ban.md', text: async () => '# Báo cáo Day 2\n- Ngày: 2026-01-01\n\n## Đã làm\n- xong' },
    { name: 'note.txt', text: async () => 'ghi chú lẻ' },
  ]);
  assert('2 file task + 1 báo cáo + 1 note', prep.tasks.length === 3 && prep.reports.length === 1);
  assert('task cùng day → day 7, không cảnh báo lệch', prep.day === 7 && !prep.dayHint);
  assert('tiêu đề bắt đầu trống', prep.title === '');
  assert('báo cáo nhận theo tiêu đề', prep.reports[0].day === 2);
  assert('day mới → tiêu đề trống', prep.title === '');

  A.reset({ tasks: { 2: [{ name: 'old.md', type: 'md', src: '# Day 2' }] }, days: { 2: { title: 'Ngăn xếp', updatedAt: 1 } } });
  const prep3 = await A.prepareImport([{ name: 'taskday2.md', text: async () => '# Day 2' }]);
  assert('day đã có → dùng lại tiêu đề', prep3.title === 'Ngăn xếp');

  const prep2 = await A.prepareImport([{ name: 'a-day8.md', text: async () => '# A' }, { name: 'b-day9.md', text: async () => '# B' }]);
  assert('task nhiều day → dayHint + rơi về nextDay', !!prep2.dayHint && prep2.day === 3);

  console.log('stage + accept:');
  A.reset({ tasks: { 2: [{ name: 'old.md', type: 'md', src: '# Day 2 cũ' }] }, checks: { 2: { 0: [true] } }, days: { 2: { title: 'Cũ', updatedAt: 1 } } });
  await A.stageFiles([
    { name: 'taskday2.md', text: async () => '# Day 2 — Mới\n\n- [ ] một\n- [ ] hai' },
    { name: 'baocaoday2-ban.md', text: async () => '# Báo cáo Day 2\n- Ngày: 2026-01-01\n' },
  ]);
  const st = A.getStaged();
  assert('stage: 1 file task + 1 báo cáo', st.tasks.length === 1 && st.reports.length === 1);
  assert('stage: cảnh báo day đã có file', /đã có 1 file/.test(A.stageBadges()));
  A.setTitle('');
  A.acceptStaged();
  assert('thiếu tiêu đề → chưa nhận', !!A.getStaged() && A.state.days[2].title === 'Cũ');
  A.setTitle('Ngăn xếp & hàng đợi');
  A.acceptStaged();
  assert('nhận: thêm file, giữ file cũ', A.state.tasks[2].length === 2 && A.state.tasks[2][0].src === '# Day 2 cũ' && A.state.tasks[2][1].name === 'taskday2.md');
  assert('nhận: tiêu đề day mới', A.state.days[2].title === 'Ngăn xếp & hàng đợi');
  assert('nhận: checklist cũ giữ nguyên', JSON.stringify(A.state.checks[2]) === '{"0":[true]}');
  assert('nhận: báo cáo lưu v1', A.state.reports[2].subs.length === 1 && A.state.reports[2].subs[0].v === 1);
  assert('nhận: staged dọn sạch', A.getStaged() === null);

  // cùng tên file → thay đúng file đó, không nhân đôi
  await A.stageFiles([{ name: 'taskday2.md', text: async () => '# Day 2 — Bản sửa\n\n- [ ] một' }]);
  A.setTitle('Ngăn xếp & hàng đợi');
  A.acceptStaged();
  assert('file trùng tên → thay tại chỗ', A.state.tasks[2].length === 2 && A.state.tasks[2][1].src.includes('Bản sửa'));

  const snap = A.state.reports[2].subs[0].md;
  await A.stageFiles([{ name: 'baocaoday2-lan2.md', text: async () => '# Báo cáo Day 2\n- Ngày: 2026-02-02\n' }]);
  A.setTitle('x');
  A.acceptStaged();
  assert('báo cáo đã có → không đè', A.state.reports[2].subs.length === 1 && A.state.reports[2].subs[0].md === snap);

  /* ---- nháp tự lưu / nộp phiên bản, không đè ---- */
  console.log('draft + submit:');
  A.reset({ tasks: { 3: [{ name: 'a.md', type: 'md', src: '# Day 3' }] } });
  A.setPick(3);
  $('repText').value = '# Báo cáo Day 3\n- Ngày: ' + A.today() + '\n\n## Đã làm\n- phần 1';
  A.saveDraftNow();
  assert('autosave: nháp vào state', A.state.reports[3].draft.md.includes('phần 1'));
  assert('autosave: chip báo đã lưu', /Đã lưu/.test($('saveState').textContent));
  assert('autosave: nháp riêng, chưa có bài nộp', A.state.reports[3].subs.length === 0);
  A.submitReport();
  assert('nộp: v1, nháp xoá', A.state.reports[3].subs.length === 1 && A.state.reports[3].subs[0].v === 1 && A.state.reports[3].draft === null);
  const v1md = A.state.reports[3].subs[0].md;
  $('repText').value = '# Báo cáo Day 3\n\n## Đã làm\n- phần 2';
  A.saveDraftNow();
  A.submitReport();
  assert('nộp lần 2: thêm v2, giữ v1', A.state.reports[3].subs.length === 2 && A.state.reports[3].subs[1].v === 2);
  assert('v1 không bị ghi đè', A.state.reports[3].subs[0].md === v1md);
  $('repText').value = '   ';
  const before = A.state.reports[3].subs.length;
  A.submitReport();
  assert('nộp rỗng → bỏ qua', A.state.reports[3].subs.length === before);

  /* ---- lưu/đọc lại ---- */
  console.log('storage:');
  A.save();
  const raw = JSON.parse(sandbox.localStorage.getItem('ghostproject_v1'));
  assert('state có task dạng mảng', Array.isArray(raw.tasks[3]));
  assert('state có settings.split', typeof raw.settings.split === 'number');
  assert('state.turso có mặt', typeof raw.turso === 'object');

  /* ---- Turso helpers ---- */
  console.log('turso:');
  assert('libsql:// → https://', A.tursoBase('libsql://db-org.turso.io') === 'https://db-org.turso.io');
  assert('bỏ /v2/pipeline + slash cuối', A.tursoBase('https://db-org.turso.io/v2/pipeline/') === 'https://db-org.turso.io');
  const rows = A.tsqlRows({
    cols: [{ name: 'day' }, { name: 'src' }, { name: 'ts' }, { name: 'html' }],
    rows: [[{ type: 'integer', value: '3' }, { type: 'text', value: '# Day 3' }, { type: 'float', value: '12.5' }, { type: 'null' }]],
  });
  assert('decode integer → number', rows[0].day === 3);
  assert('decode text', rows[0].src === '# Day 3');
  assert('decode float', rows[0].ts === 12.5);
  assert('decode null', rows[0].html === null);
  assert('rows rỗng khi không có result', A.tsqlRows(null).length === 0);

  console.log('turso http:');
  const calls = [];
  sandbox.fetch = async (url, opt) => {
    calls.push({ url, opt });
    if (calls.length === 2) return { ok: true, status: 200, json: async () => ({ results: [{ type: 'error', error: { message: 'boom' } }] }) };
    return {
      ok: true, status: 200,
      json: async () => ({ results: [{ type: 'ok', response: { type: 'execute', result: { cols: [{ name: 'n' }], rows: [[{ type: 'integer', value: '1' }]] } } }] }),
    };
  };
  A.state.turso = { url: 'libsql://db-org.turso.io', token: 'tok' };
  const out = await A.tsql('SELECT ? AS n', [{ type: 'text', value: 'x' }]);
  assert('POST đúng endpoint /v2/pipeline', calls[0].url === 'https://db-org.turso.io/v2/pipeline' && calls[0].opt.method === 'POST');
  assert('Bearer token', calls[0].opt.headers.authorization === 'Bearer tok');
  const body = JSON.parse(calls[0].opt.body);
  assert('pipeline = execute + close', body.requests[0].type === 'execute' && body.requests[1].type === 'close');
  assert('giữ arg kiểu text', JSON.stringify(body.requests[0].stmt.args) === '[{"type":"text","value":"x"}]');
  assert('trả rows đã decode', A.tsqlRows(out)[0].n === 1);
  let err = '';
  try { await A.tsql('nope'); } catch (e) { err = e.message; }
  assert('lỗi Turso → message', err === 'boom');

  console.log(fails ? `\n${fails} test FAIL` : '\nTất cả test pass ✓');
  process.exit(fails ? 1 : 0);
})();
