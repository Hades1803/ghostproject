'use strict';
/* Smoke test cho logic trong app.js — chạy: node test-smoke.js */
const fs = require('fs');
const vm = require('vm');

/* ---- DOM/localStorage stub tối thiểu ---- */
function el() {
  return {
    tagName: 'DIV', attributes: [], hidden: false,
    innerHTML: '', textContent: '', value: '', disabled: false,
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, appendChild() {}, closest() { return null; }, replaceWith() {},
    querySelectorAll() { return []; }, click() {}, focus() {},
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
  + '\n;globalThis.__A = { state, save, renderAll, mdToHtml, calcStreak, iso, today, reportTemplate, tursoBase, tsqlRows, tsql, curDay, stageFiles, acceptStaged, getStaged: () => staged, setPick: (v) => { pickDay = v; } };',
  sandbox
);

const A = sandbox.__A;
const ctx = A; // hàm trong app.js là global của vm; state lấy qua hook
let fails = 0;
function assert(name, cond) {
  if (cond) console.log('  ok  ' + name);
  else { fails++; console.log('  FAIL ' + name); }
}

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
ctx.state.tasks[1] = { type: 'md', content: SAMPLE, addedAt: 1 };

/* ---- markdown renderer ---- */
console.log('mdToHtml:');
const html = ctx.mdToHtml(SAMPLE);
assert('render <table>', html.includes('<table>'));
assert('render th TIME', html.includes('>TIME<'));
assert('render 6 checkbox', (html.match(/data-ck="\d+"/g) || []).length === 6);
assert('render blockquote', html.includes('<blockquote>'));
assert('render doc-title (md # → h2)', html.includes('<h2 class="doc-title">'));
assert('bold trong bảng', html.includes('<strong>'));
const one = ctx.mdToHtml('**a** và *b* và `c`');
assert('inline bold/em/code', one.includes('<strong>a</strong>') && one.includes('<em>b</em>') && one.includes('<code>c</code>'));
assert('XSS bị escape', ctx.mdToHtml('<img src=x onerror=alert(1)>').includes('&lt;img'));

/* ---- streak ---- */
console.log('streak:');
ctx.state.reports = { 1: { md: '', date: ctx.today() } };
assert('hôm nay có báo cáo = 1', ctx.calcStreak() === 1);
ctx.state.reports[2] = { md: '', date: ctx.iso(new Date(Date.now() - 864e5)) };
assert('2 ngày liên tục', ctx.calcStreak() === 2);
delete ctx.state.reports[1];
assert('hôm nay trống, hôm qua có → 1', ctx.calcStreak() === 1);

/* ---- chọn day ---- */
console.log('curDay:');
ctx.state.reports = {};
ctx.setPick(null);
assert('chưa nộp → day mới nhất', ctx.curDay() === 1);
ctx.state.reports[1] = { md: 'x', date: ctx.today(), ts: 1 };
ctx.state.tasks[2] = { type: 'md', content: SAMPLE, addedAt: 2 };
ctx.setPick(null);
assert('đã nộp day 1 → nhảy day 2', ctx.curDay() === 2);
ctx.state.reports[2] = { md: 'x', date: ctx.today(), ts: 2 };
ctx.setPick(null);
assert('nộp hết → day mới nhất', ctx.curDay() === 2);

/* ---- report template ---- */
console.log('report:');
ctx.state.checks[1] = [true, true, false, false, false, false];
const rep = ctx.reportTemplate(1);
assert('checklist 2/6', rep.includes('Checklist: 2/6 (33%)'));
assert('có ngày hôm nay', rep.includes('Ngày: ' + ctx.today()));
assert('tên file baocaoday', rep.startsWith('# Báo cáo Day 1'));

/* ---- state lưu/đọc lại ---- */
console.log('storage:');
ctx.save();
const raw = JSON.parse(sandbox.localStorage.getItem('ghostproject_v1'));
assert('state có task day 1', !!raw.tasks[1]);
assert('backup không cần token ở đây, state.turso có mặt', typeof raw.turso === 'object');

/* ---- Turso helpers ---- */
console.log('turso:');
assert('libsql:// → https://', ctx.tursoBase('libsql://db-org.turso.io') === 'https://db-org.turso.io');
assert('bỏ /v2/pipeline + slash cuối', ctx.tursoBase('https://db-org.turso.io/v2/pipeline/') === 'https://db-org.turso.io');
const rows = ctx.tsqlRows({
  cols: [{ name: 'day' }, { name: 'content' }, { name: 'minutes' }, { name: 'note' }],
  rows: [[{ type: 'integer', value: '3' }, { type: 'text', value: '# Day 3' }, { type: 'float', value: '12.5' }, { type: 'null' }]],
});
assert('decode integer → number', rows[0].day === 3);
assert('decode text', rows[0].content === '# Day 3');
assert('decode float', rows[0].minutes === 12.5);
assert('decode null', rows[0].note === null);
assert('rows rỗng khi không có result', ctx.tsqlRows(null).length === 0);

/* ---- Turso HTTP: request/response thật (fetch giả) ---- */
(async () => {
  /* ---- nhận file: task + báo cáo (stage → accept) ---- */
  console.log('stageFiles:');
  ctx.state.reports = {};
  ctx.setPick(null);
  await ctx.stageFiles([
    { name: 'taskday9.md', text: async () => '# Day 9 — Test\n\n- [ ] việc 1' },
    { name: 'reply.md', text: async () => '# Báo cáo Day 5\n- Ngày: 2026-01-01\n' },
    { name: 'khongso.md', text: async () => '# Ghi chú chung\n' },
  ]);
  const st = ctx.getStaged();
  assert('3 file staged', st.length === 3);
  assert('task file → kind task, day 9 từ tên', st[0].kind === 'task' && st[0].day === 9);
  assert('report file → kind report, day từ tiêu đề', st[1].kind === 'report' && st[1].day === 5);
  assert('file không có số → nextDay', st[2].kind === 'task' && st[2].day === 3);
  ctx.acceptStaged();
  assert('accept: nhận task day 9', !!ctx.state.tasks[9]);
  assert('accept: lưu báo cáo day 5', ctx.state.reports[5] && ctx.state.reports[5].md.startsWith('# Báo cáo Day 5'));
  assert('accept: ngày lấy từ dòng Ngày', ctx.state.reports[5].date === '2026-01-01');
  assert('staged dọn sạch', ctx.getStaged().length === 0);
  const repSnapshot = JSON.stringify(ctx.state.reports[5]);
  await ctx.stageFiles([{ name: 'reply2.md', text: async () => '# Báo cáo Day 5\n- Ngày: 2026-02-02\n' }]);
  ctx.acceptStaged();
  assert('báo cáo đã có → không đè', JSON.stringify(ctx.state.reports[5]) === repSnapshot);

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
  ctx.state.turso = { url: 'libsql://db-org.turso.io', token: 'tok' };
  const out = await ctx.tsql('SELECT ? AS n', [{ type: 'text', value: 'x' }]);
  assert('POST đúng endpoint /v2/pipeline', calls[0].url === 'https://db-org.turso.io/v2/pipeline' && calls[0].opt.method === 'POST');
  assert('Bearer token', calls[0].opt.headers.authorization === 'Bearer tok');
  const body = JSON.parse(calls[0].opt.body);
  assert('pipeline = execute + close', body.requests[0].type === 'execute' && body.requests[1].type === 'close');
  assert('giữ arg kiểu text', JSON.stringify(body.requests[0].stmt.args) === '[{"type":"text","value":"x"}]');
  assert('trả rows đã decode', ctx.tsqlRows(out)[0].n === 1);
  let err = '';
  try { await ctx.tsql('nope'); } catch (e) { err = e.message; }
  assert('lỗi Turso → message', err === 'boom');

  console.log(fails ? `\n${fails} test FAIL` : '\nTất cả test pass ✓');
  process.exit(fails ? 1 : 0);
})();
