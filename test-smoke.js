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
    querySelectorAll() { return []; }, click() {},
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
  + '\n;globalThis.__A = { state, timer, mdToHtml, parseSchedule, calcStreak, iso, today, tick, finishSession, timerSetup, reportTemplate, mergeIn, s3cfg, queuePush };',
  sandbox
);

const A = sandbox.__A;
const ctx = A; // hàm trong app.js là global của vm; state/timer lấy qua hook
let fails = 0;
function assert(name, cond) {
  if (cond) console.log('  ok  ' + name);
  else { fails++; console.log('  FAIL ' + name); }
}

const SAMPLE = ctx.state.tasks[1].content;

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

/* ---- schedule parser ---- */
console.log('parseSchedule:');
const sched = ctx.parseSchedule(SAMPLE);
assert('5 dòng lịch', Array.isArray(sched) && sched.length === 5);
assert('row 19:40 = 60p', sched[1].time === '19:40' && sched[1].min === 60);
assert('dòng cuối là hard stop (min 0)', sched[4].min === 0);
assert('bỏ ** trong label', !sched[1].label.includes('**'));
assert('md không có bảng → null', ctx.parseSchedule('# Day 2\n\nChỉ chữ, không bảng.') === null);
assert('bảng thiếu số phút → null', ctx.parseSchedule('| A | B |\n|---|---|\n| x | y |') === null);

/* ---- streak ---- */
console.log('streak:');
ctx.state.reports = { 1: { md: '', date: ctx.today() } };
assert('hôm nay có báo cáo = 1', ctx.calcStreak() === 1);
ctx.state.reports[2] = { md: '', date: ctx.iso(new Date(Date.now() - 864e5)) };
assert('2 ngày liên tục', ctx.calcStreak() === 2);
delete ctx.state.reports[1];
assert('hôm nay trống, hôm qua có → 1', ctx.calcStreak() === 1);

/* ---- timer ---- */
console.log('timer:');
assert('timerSetup day 1', ctx.timerSetup(1, false) === true && ctx.timer.sched.length === 5);
ctx.timer.started = true; ctx.timer.i = 0; ctx.timer.remain = 0;
ctx.tick(); // hết 10p đầu → advance
assert('advance: done 10p, sang row 1', ctx.timer.doneMin === 10 && ctx.timer.i === 1);
ctx.timer.doneMin = 120; ctx.timer.i = 4; ctx.timer.remain = 0;
ctx.finishSession();
assert('finishSession ghi 120p vào focus', ctx.state.focus.some((e) => e.day === 1 && e.minutes === 120));
assert('logged sau finish', ctx.timer.logged === true);

/* ---- report template ---- */
console.log('report:');
ctx.state.checks[1] = [true, true, false, false, false, false];
const rep = ctx.reportTemplate(1);
assert('checklist 2/6', rep.includes('Checklist: 2/6 (33%)'));
assert('có ngày hôm nay', rep.includes('Ngày: ' + ctx.today()));
assert('tên file baocaoday', rep.startsWith('# Báo cáo Day 1'));

/* ---- state lưu/đọc lại ---- */
console.log('storage:');
const raw = JSON.parse(sandbox.localStorage.getItem('ghostproject_v1'));
assert('state có task day 1', !!raw.tasks[1]);
assert('state có focus', raw.focus.length > 0);

/* ---- merge S3 ---- */
console.log('mergeIn:');
assert('s3cfg mặc định đúng endpoint', ctx.s3cfg().endpoint === 'https://s3-hcm-r1.longvan.net' && ctx.s3cfg().region === 'hcm5-r1');
// task mới hơn ở remote thắng task cũ ở local
ctx.state.tasks[9] = { type: 'md', content: '# Day 9 — cũ', addedAt: 100 };
const changed1 = ctx.mergeIn({ tasks: { 9: { type: 'md', content: '# Day 9 — mới', addedAt: 200 } } }, null);
assert('task remote mới hơn thắng', changed1 && ctx.state.tasks[9].content === '# Day 9 — mới');
// task cũ hơn ở remote KHÔNG đè task local
ctx.mergeIn({ tasks: { 9: { type: 'md', content: '# Day 9 — cũ hơn', addedAt: 50 } } }, null);
assert('task remote cũ hơn không đè', ctx.state.tasks[9].content === '# Day 9 — mới');
// checks: OR-merge (tick ở máy nào cũng được giữ)
ctx.state.checks[9] = [true, false, false];
ctx.mergeIn(null, { checks: { 9: [false, true, false] } });
assert('checks OR-merge', ctx.state.checks[9][0] === true && ctx.state.checks[9][1] === true);
// focus: trộn theo ts, không nhân đôi
ctx.state.focus = [{ date: '2026-10-26', day: 9, minutes: 30, ts: 111 }];
ctx.mergeIn(null, { focus: [{ date: '2026-10-26', day: 9, minutes: 30, ts: 111 }, { date: '2026-10-26', day: 9, minutes: 45, ts: 222 }] });
assert('focus không nhân đôi + thêm entry mới', ctx.state.focus.length === 2 && ctx.state.focus.some((e) => e.ts === 222));
// reports: ts mới hơn thắng
ctx.state.reports[9] = { md: 'bản cũ', date: 'x', ts: 1 };
ctx.mergeIn(null, { reports: { 9: { md: 'bản mới', date: 'y', ts: 2 } } });
assert('report ts mới thắng', ctx.state.reports[9].md === 'bản mới');
// task đổi nội dung → checklist của day đó bị reset
ctx.state.checks[9] = [true, true, true];
ctx.mergeIn({ tasks: { 9: { type: 'md', content: '# Day 9 — đổi hoàn toàn', addedAt: 999 } } }, null);
assert('task đổi → checks reset', !ctx.state.checks[9] || ctx.state.checks[9].length === 0);

console.log(fails ? `\n${fails} test FAIL` : '\nTất cả test pass ✓');
process.exit(fails ? 1 : 0);
