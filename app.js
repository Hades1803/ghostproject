'use strict';
/* GhostProject — self-study tracker. Static site, dữ liệu ở localStorage + Turso (SQLite qua HTTP).
   Flow: bạn bạn "Giao task" → bạn tick checklist + timer + "Nộp báo cáo" → cả hai đọc ở tab Báo cáo.
   UI: tasteskill "editorial-greeting" (seed 1472121576) — greeting là h1, panel tông, accent teal trên data. */

const $ = (id) => document.getElementById(id);
const KEY = 'ghostproject_v1';
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const today = () => iso(new Date());
const nowHM = () => new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

/* ---------------- state ---------------- */
function defaultState() {
  return { tasks: {}, reports: {}, checks: {}, focus: [], turso: { url: '', token: '', lastSync: '' } };
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return { ...defaultState(), ...s, turso: { ...defaultState().turso, ...(s.turso || {}) } };
  } catch { return null; }
}
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

let state = load();
if (!state) { state = defaultState(); save(); }

const taskDays = () => Object.keys(state.tasks).map(Number).sort((a, b) => a - b);
const nextDay = () => (taskDays().at(-1) || 0) + 1;
const focusMinutesForDay = (day) => state.focus.filter((e) => e.day === day).reduce((s, e) => s + e.minutes, 0);
function taskTitle(day) {
  const t = state.tasks[day]; if (!t) return '';
  if (t.type === 'html') return 'Task dạng HTML';
  const m = t.content.match(/^#\s+(.+)$/m);
  return m ? m[1].replace(/\*\*/g, '').trim() : `Day ${day}`;
}
function ckPair(day) {
  const c = state.checks[day] || [];
  let total = c.length;
  if (state.tasks[day]?.type === 'md') {
    const n = (state.tasks[day].content.match(/^- \[( |x|X)\]/gm) || []).length;
    if (n > total) total = n;
  }
  return [c.filter(Boolean).length, total];
}

/* ---------------- markdown renderer (small, offline) ---------------- */
function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(>])\*([^*\n]+)\*(?=[\s).,;:!?)<]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function splitRow(r) {
  return r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}
/* HTML → md: đọc lại task dạng .html (từ "Tạo task", báo cáo, hoặc bạn bạn gửi file html khác)
   để timer + checklist hoạt động như .md */
function htmlToMd(src) {
  const doc = new DOMParser().parseFromString(src, 'text/html');
  const inl = (n) => {
    let s = '';
    for (const c of n.childNodes) {
      if (c.nodeType === 3) s += c.nodeValue;
      else if (c.nodeType !== 1) continue;
      const t = c.tagName;
      if (t === 'STRONG' || t === 'B') s += '**' + inl(c) + '**';
      else if (t === 'EM' || t === 'I') s += '*' + inl(c) + '*';
      else if (t === 'CODE') s += '`' + c.textContent + '`';
      else if (t === 'BR') s += ' ';
      else s += inl(c); // span/other → đi tiếp
    }
    return s;
  };
  const cell = (n) => inl(n).replace(/\s+/g, ' ').trim();
  const out = [];
  const walk = (parent) => {
    for (const el of parent.children) {
      const t = el.tagName;
      if (/^H[1-5]$/.test(t)) {
        const lv = t === 'H1' || t === 'H2' ? 1 : +t[1] - 1; // mdToHtml: '# '→h2.doc-title, '## '→h3…
        out.push('#'.repeat(lv) + ' ' + cell(el));
      } else if (t === 'P' || t === 'DIV') {
        if (el.querySelector('table,ul,ol,blockquote,pre,h1,h2,h3,h4,h5')) { walk(el); continue; } // div bọc → đi sâu
        out.push(cell(el));
      } else if (t === 'TABLE') {
        const trs = [...el.rows];
        if (!trs.length) continue;
        const rowMd = (tr) => '| ' + [...tr.cells].map((c) => cell(c)).join(' | ') + ' |';
        // cả bảng một block (các hàng liền nhau — parseSchedule cần); dòng đầu làm header
        out.push(rowMd(trs[0]) + '\n| ' + [...trs[0].cells].map(() => '---').join(' | ') + ' |\n'
          + trs.slice(1).map(rowMd).join('\n'));
      } else if (t === 'UL' || t === 'OL') {
        let n = 0;
        const items = [];
        for (const li of el.children) {
          if (li.tagName !== 'LI') continue;
          const box = li.querySelector('input[type="checkbox"]');
          const txt = cell(li.querySelector('.ck span') || li);
          if (box || li.classList.contains('ckline')) items.push(`- [${box?.checked ? 'x' : ' '}] ${txt}`);
          else if (t === 'OL') items.push(`${++n}. ${txt}`);
          else items.push(`- ${txt}`);
        }
        if (items.length) out.push(items.join('\n')); // cả list một block
      } else if (t === 'BLOCKQUOTE') {
        out.push('> ' + cell(el));
      } else if (t === 'PRE') {
        out.push('```\n' + el.textContent.replace(/\r?\n$/, '') + '\n```');
      } else if (t === 'HR') {
        out.push('---');
      } else walk(el); // section/article/… → đi sâu
    }
  };
  walk(doc.body);
  return out.join('\n\n');
}

function mdToHtml(src) {
  const lines = esc(src).split(/\r?\n/);
  const out = [];
  const p = [];
  let ck = 0; // checkbox index in document order
  const flushP = () => { if (p.length) { out.push('<p>' + inline(p.join(' ')) + '</p>'); p.length = 0; } };

  let i = 0;
  while (i < lines.length) {
    const L = lines[i];
    if (/^```/.test(L)) { // code fence
      flushP(); const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; out.push('<pre><code>' + buf.join('\n') + '</code></pre>'); continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(L)) { flushP(); out.push('<hr>'); i++; continue; }
    const h = L.match(/^(#{1,4})\s+(.*)$/);
    // md '# ' là tiêu đề tài liệu trong app → h2.doc-title (chỉ greeting được làm h1)
    if (h) { flushP(); const lvl = Math.min(5, h[1].length + 1);
      out.push(`<h${lvl}${h[1].length === 1 ? ' class="doc-title"' : ''}>` + inline(h[2]) + `</h${lvl}>`); i++; continue; }
    // table: header line + separator line
    if (/^\s*\|.*\|?\s*$/.test(L) && i + 1 < lines.length && /^\s*\|?[\s:\-|]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flushP();
      const head = splitRow(L); let j = i + 2; const body = [];
      while (j < lines.length && /\|/.test(lines[j]) && lines[j].trim() !== '') { body.push(splitRow(lines[j])); j++; }
      const numRe = /^-?\d[\d.,]*%?$/;
      const colNum = head.map((_, c) => body.filter((r) => numRe.test(r[c] || '')).length);
      const thCls = (c) => colNum[c] > 0 && colNum[c] >= Math.ceil(body.length * 0.6) ? ' class="n"' : '';
      let html = '<table><thead><tr>' + head.map((c, ci) => `<th${thCls(ci)}>` + inline(c) + '</th>').join('') + '</tr></thead><tbody>';
      for (const r of body) html += '<tr>' + r.map((c) => `<td${numRe.test(c) ? ' class="n"' : ''}>` + inline(c) + '</td>').join('') + '</tr>';
      out.push(html + '</tbody></table>');
      i = j; continue;
    }
    if (/^\s*&gt;/.test(L)) { // blockquote (nguồn đã escape nên '>' thành '&gt;')
      flushP(); const buf = [];
      while (i < lines.length && /^\s*&gt;/.test(lines[i])) { buf.push(lines[i].replace(/^\s*&gt;\s?/, '')); i++; }
      out.push('<blockquote><p>' + inline(buf.join(' ')) + '</p></blockquote>'); continue;
    }
    const ul = L.match(/^\s*[-*]\s+(.*)$/);
    const ol = L.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushP();
      const ordered = !!ol; const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*[-*]\s+(.*)$/) || lines[i].match(/^\s*\d+[.)]\s+(.*)$/);
        if (!m) break; items.push(m[1]); i++;
      }
      let html = ordered ? '<ol>' : '<ul>';
      for (const it of items) {
        const t = it.match(/^\[([ xX])\]\s+(.*)$/);
        if (t) {
          const idx = ck++;
          html += `<li class="ckline"><label class="ck"><input type="checkbox" data-ck="${idx}"><span>` + inline(t[2]) + '</span></label></li>';
        } else html += '<li>' + inline(it) + '</li>';
      }
      out.push(html + (ordered ? '</ol>' : '</ul>')); continue;
    }
    if (L.trim() === '') { flushP(); i++; continue; }
    p.push(L.trim()); i++;
  }
  flushP();
  return out.join('\n');
}

/* schedule table → timer rows; null nếu không tìm thấy bảng phù hợp */
function parseSchedule(md) {
  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^\s*\|.*\|/.test(lines[i]) && lines[i + 1].includes('-') && /^\s*\|?[\s:\-|]+\|?\s*$/.test(lines[i + 1])) {
      const rows = []; let j = i + 2;
      while (j < lines.length && /\|/.test(lines[j]) && lines[j].trim() !== '') { rows.push(splitRow(lines[j])); j++; }
      const sched = rows.filter((c) => c.length >= 3).map((c) => ({
        time: c[0],
        min: /^\d+$/.test(c[1]) ? +c[1] : 0,
        label: c.slice(2).join(' · ').replace(/\*\*/g, ''),
      }));
      if (sched.filter((r) => r.min > 0).length >= 2) return sched;
      i = j;
    }
  }
  return null;
}
const DEFAULT_SCHED = [
  { time: '19:30', min: 10, label: 'Đọc lại ghi chú hôm qua' },
  { time: '19:40', min: 60, label: '§1 Knowledge' },
  { time: '20:40', min: 35, label: '§2 Predict → Run → Explain' },
  { time: '21:15', min: 15, label: '§3 AI-Verify + §4 Drill' },
  { time: '21:30', min: 0, label: 'Hard stop — dừng cả giữa câu', stop: true },
];

/* ---------------- helpers ---------------- */
function download(name, text, mime = 'text/markdown') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}
let toastT;
function toast(msg) {
  const el = $('toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2600);
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); }
  catch {
    const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('Đã copy vào clipboard');
}
function beep(times = 1) {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)();
    for (let k = 0; k < times; k++) {
      const o = a.createOscillator(); const g = a.createGain();
      o.connect(g); g.connect(a.destination); o.frequency.value = 880;
      o.start(a.currentTime + k * 0.35); o.stop(a.currentTime + k * 0.35 + 0.22);
    }
  } catch { /* im lặng là được */ }
}

/* ---------------- tabs ---------------- */
function retag(el, tag) {
  if (!el || el.tagName === tag) return el;
  const n = document.createElement(tag);
  for (const a of el.attributes || []) n.setAttribute(a.name, a.value);
  n.innerHTML = el.innerHTML;
  el.replaceWith(n);
  return n;
}
function setScreenTitle(name) {
  // bất biến: đúng MỘT h1 trong DOM tại mọi thời điểm — tiêu đề của màn đang mở
  if (name === 'dash') {
    document.querySelectorAll('.screen-title').forEach((t) => retag(t, 'H2'));
    retag($('greetTitle'), 'H1');
  } else {
    document.querySelectorAll('.screen-title').forEach((t) => retag(t, t.dataset.screen === name ? 'H1' : 'H2'));
    retag($('greetTitle'), 'H2');
  }
}
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + name));
  document.querySelectorAll('.nav-item[data-tab]').forEach((a) => {
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  setScreenTitle(name);
  $('sidebar')?.classList.remove('open');
  renderAll();
}

/* ---------------- dải buổi tối (signature element) ---------------- */
const toMin = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + (m || 0); };
const hmText = (m) => `${Math.floor(m / 60)} giờ ${String(m % 60).padStart(2, '0')} phút`;
function stripHTML(sched) {
  const total = sched.reduce((s, r) => s + r.min, 0);
  const start = toMin(sched[0].time); const end = start + total;
  const n = new Date().getHours() * 60 + new Date().getMinutes();
  const inWindow = n >= start && n < end;
  const pct = inWindow ? Math.min(100, Math.max(0, ((n - start) / (end - start)) * 100)) : null;
  const segs = sched.filter((r) => r.min > 0)
    .map((r) => `<span class="seg" style="width:${((r.min / total) * 100).toFixed(2)}%" title="${esc(r.time)} · ${esc(r.label)}"></span>`)
    .join('');
  return `<div class="strip" role="img" aria-label="Buổi học từ ${esc(sched[0].time)} đến ${esc(sched.at(-1).time)}, dừng cứng">${segs}${pct != null ? `<span class="now" style="left:${pct.toFixed(2)}%"></span>` : ''}</div>
  <div class="strip-labels"><span>${esc(sched[0].time)}</span><b>${esc(sched.at(-1).time)} · dừng cứng</b></div>`;
}
function stripState(sched) {
  const start = toMin(sched[0].time);
  const end = start + sched.reduce((s, r) => s + r.min, 0);
  const n = new Date().getHours() * 60 + new Date().getMinutes();
  if (n < start) return n < start - 360 ? `Bắt đầu lúc ${sched[0].time}.` : `Bắt đầu sau ${hmText(start - n)} nữa.`;
  if (n >= end) return 'Hard stop đã qua — mai học tiếp.';
  let acc = start;
  for (const r of sched) {
    const rowEnd = acc + r.min;
    if (n < rowEnd && r.min > 0) {
      const nx = sched[sched.indexOf(r) + 1];
      return `Đang: ${r.label} — còn ${rowEnd - n} phút${nx ? ` tới ${nx.time}` : ''}.`;
    }
    acc = rowEnd;
  }
  return '';
}

/* thanh tiến độ checklist: track + fill, nhãn 2 đầu */
const bar = (dn, tot) => tot ? `<div class="btnrow" style="margin-top:0;margin-bottom:12px;align-items:center;gap:12px">
  <span class="track"><span style="width:${Math.round((dn / tot) * 100)}%"></span></span>
  <span class="num" style="font-weight:500">${dn}/${tot}</span></div>` : '';

/* ---------------- Turso — SQLite qua HTTP (v2/pipeline), không cần server riêng ---------------- */
const tursoCfg = () => ({ url: '', token: '', lastSync: '', ...(state.turso || {}) });
/* chấp nhận libsql://…, https://…/v2/pipeline, hoặc bản sao URL từ dashboard */
const tursoBase = (u) => u.trim().replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '').replace(/\/v2\/pipeline$/, '');
async function tsql(sql, args = []) {
  const cfg = tursoCfg();
  if (!cfg.url || !cfg.token) throw new Error('Chưa điền URL + token Turso');
  let res;
  try {
    res = await fetch(tursoBase(cfg.url) + '/v2/pipeline', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + cfg.token, 'content-type': 'application/json' },
      body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql, args } }, { type: 'close' }] }),
    });
  } catch {
    throw new Error('Không gọi được Turso' + (location.protocol === 'file:' ? ' (mở trang qua https — file:// bị chặn)' : ''));
  }
  if (!res.ok) throw new Error(`Turso HTTP ${res.status}` + (res.status === 401 ? ' — token sai?' : ''));
  const j = await res.json();
  const r = j?.results?.[0];
  if (!r || r.type !== 'ok') throw new Error(r?.error?.message || 'Turso từ chối truy vấn');
  return r.response?.result || null;
}
const qs = (v) => ({ type: 'text', value: String(v) });
const qi = (v) => ({ type: 'integer', value: String(Math.round(v)) });
function tsqlRows(result) {
  if (!result || !result.rows) return [];
  return result.rows.map((row) => Object.fromEntries((result.cols || []).map((c, i) => {
    const v = row[i] || { type: 'null' };
    return [c.name, v.type === 'integer' || v.type === 'float' ? Number(v.value) : v.type === 'null' ? null : v.value];
  })));
}
async function tursoBootstrap() {
  await tsql('CREATE TABLE IF NOT EXISTS tasks (day INTEGER PRIMARY KEY, content TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  await tsql('CREATE TABLE IF NOT EXISTS reports (day INTEGER PRIMARY KEY, content TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  await tsql('CREATE TABLE IF NOT EXISTS checks (day INTEGER NOT NULL, idx INTEGER NOT NULL, done INTEGER NOT NULL, PRIMARY KEY (day, idx))');
  await tsql('CREATE TABLE IF NOT EXISTS focus (ts INTEGER PRIMARY KEY, day INTEGER NOT NULL, date TEXT NOT NULL, minutes INTEGER NOT NULL)');
}
const pushTask = (day) => tsql('INSERT INTO tasks (day, content, updated_at) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at',
  [qi(day), qs(state.tasks[day].content), qi(state.tasks[day].addedAt || Date.now())]);
const pushReport = (day) => tsql('INSERT INTO reports (day, content, updated_at) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at',
  [qi(day), qs(state.reports[day].md), qi(state.reports[day].ts || Date.now())]);
const pushCheck = (day, idx, done) => tsql('INSERT INTO checks (day, idx, done) VALUES (?, ?, ?) ON CONFLICT(day, idx) DO UPDATE SET done = excluded.done',
  [qi(day), qi(idx), qi(done ? 1 : 0)]);
const pushFocus = (e) => tsql('INSERT OR IGNORE INTO focus (ts, day, date, minutes) VALUES (?, ?, ?, ?)',
  [qi(e.ts), qi(e.day), qs(e.date), qi(e.minutes)]);

function setSyncStatus(msg) { const el = $('syncStatus'); if (el) el.textContent = msg; }
/* ghi nền: UI cập nhật local trước, lỗi chỉ hiện ở dòng trạng thái */
function bg(p) {
  const cfg = tursoCfg();
  if (!cfg.url || !cfg.token) return; // chế độ chỉ-trong-máy
  p.then(() => setSyncStatus('Đã lưu Turso · ' + nowHM()))
    .catch((e) => setSyncStatus('Lỗi Turso: ' + e.message));
}

async function tursoPull() {
  const [t, r, c, f] = await Promise.all([
    tsql('SELECT day, content, updated_at FROM tasks'),
    tsql('SELECT day, content, updated_at FROM reports'),
    tsql('SELECT day, idx, done FROM checks'),
    tsql('SELECT ts, day, date, minutes FROM focus'),
  ]);
  const tasks = {};
  for (const x of tsqlRows(t)) tasks[x.day] = { type: 'md', content: x.content, addedAt: x.updated_at };
  const reports = {};
  for (const x of tsqlRows(r)) {
    const d = new Date(x.updated_at);
    reports[x.day] = { md: x.content, ts: x.updated_at, date: iso(d), at: d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) };
  }
  const checks = {};
  for (const x of tsqlRows(c)) (checks[x.day] ||= [])[x.idx] = !!x.done;
  const focus = tsqlRows(f).map((x) => ({ ts: x.ts, day: x.day, date: x.date, minutes: x.minutes })).sort((a, b) => a.ts - b.ts);
  Object.assign(state, { tasks, reports, checks, focus });
  save();
}
/* đẩy dữ liệu local mới hơn lên (lần đầu kết nối / sau nhập backup) */
async function pushLocalNewer() {
  const first = !tursoCfg().pushed;
  const [rt, rr] = await Promise.all([
    tsql('SELECT day, updated_at FROM tasks'),
    tsql('SELECT day, updated_at FROM reports'),
  ]);
  const tM = new Map(tsqlRows(rt).map((x) => [x.day, x.updated_at]));
  const rM = new Map(tsqlRows(rr).map((x) => [x.day, x.updated_at]));
  for (const [d, t] of Object.entries(state.tasks)) if (!tM.has(+d) || (t.addedAt || 0) > tM.get(+d)) await pushTask(+d);
  for (const [d, r] of Object.entries(state.reports)) if (!rM.has(+d) || (r.ts || 0) > rM.get(+d)) await pushReport(+d);
  if (!first) return; // checklist + phút chỉ đẩy một lần; về sau ghi ngay tại chỗ tick/hết giờ
  for (const [d, arr] of Object.entries(state.checks)) for (let i = 0; i < arr.length; i++) if (arr[i]) await pushCheck(+d, i, 1);
  for (const e of state.focus) await pushFocus(e);
}

async function tursoConnect(manual) {
  if (tursoConnect.busy) return;
  const cfg = tursoCfg();
  if (!cfg.url || !cfg.token) { if (manual) toast('Điền URL + token Turso trước'); return; }
  tursoConnect.busy = true;
  setSyncStatus('Đang kết nối Turso…');
  try {
    await tursoBootstrap();
    await pushLocalNewer();
    await tursoPull();
    state.turso = { ...cfg, lastSync: new Date().toISOString(), pushed: true }; save();
    repLoadedDay = null;
    renderAll();
    setSyncStatus('Turso · đồng bộ ' + nowHM());
    if (manual) toast('Đã kết nối Turso');
  } catch (e) {
    setSyncStatus('Lỗi Turso: ' + e.message);
    if (manual) toast('Lỗi: ' + e.message);
  } finally { tursoConnect.busy = false; }
}

/* ---------------- hôm nay ---------------- */
let pickDay = null; // day đang mở; null = tự chọn day mới nhất chưa nộp
function curDay() {
  const days = taskDays();
  if (!days.length) return null;
  if (pickDay != null && state.tasks[pickDay]) return pickDay;
  pickDay = days.filter((d) => !state.reports[d]).at(-1) ?? days.at(-1);
  return pickDay;
}
function calcStreak() {
  const dates = new Set(Object.values(state.reports).map((r) => r.date).filter(Boolean));
  const d = new Date();
  if (!dates.has(iso(d))) { d.setDate(d.getDate() - 1); if (!dates.has(iso(d))) return 0; }
  let n = 0;
  while (dates.has(iso(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function renderToday() {
  const days = taskDays();
  const day = curDay();
  const streak = calcStreak();
  const weekAgo = iso(new Date(Date.now() - 6 * 864e5));
  const mins = state.focus.filter((e) => e.date >= weekAgo).reduce((s, e) => s + e.minutes, 0);
  const done = days.filter((d) => state.reports[d]).length;

  $('greetTitle').textContent = day ? `Tối nay, Day ${day}.` : 'Chưa có task.';
  if (day) {
    const [dn, tot] = ckPair(day);
    $('greetSub').textContent = `${taskTitle(day)} · checklist ${tot ? `${dn}/${tot}` : '—'} · ${done}/${days.length} day đã nộp báo cáo.`;
  } else {
    $('greetSub').textContent = 'Bạn bạn giao task (hoặc bạn nhận file taskdayN.md) — task sẽ hiện ở đây.';
  }

  $('kStreak').innerHTML = `${streak} <small>ngày</small>`;
  $('kMin').innerHTML = `${mins} <small>phút · 7 ngày</small>`;
  $('kDone').innerHTML = `${done}<small>/${days.length}</small>`;

  const body = $('todayBody');
  if (!day) {
    $('todayMeta').textContent = '';
    $('todayHint').textContent = '';
    body.innerHTML = '<div class="empty">Chưa có task. Bấm "Nhận file" (taskdayN.md hoặc .html) — hoặc bảo bạn bạn bấm "Giao task".</div>';
    $('timerPanel').hidden = true;
    return;
  }
  $('timerPanel').hidden = false;
  const [dn, tot] = ckPair(day);
  $('todayMeta').textContent = `Day ${day}`;
  $('todayHint').textContent = tot ? `Checklist ${dn}/${tot} · timer đọc bảng giờ trong task.` : 'Task này không có checklist tự động.';
  body.innerHTML = (tot ? bar(dn, tot) : '') + mdToHtml(state.tasks[day].content);
  const cks = state.checks[day] || [];
  body.querySelectorAll('input[data-ck]').forEach((inp) => {
    const k = +inp.dataset.ck;
    if (cks[k]) { inp.checked = true; inp.closest('.ck')?.classList.add('done'); }
  });
  timerSetup(day, true);
}

/* ---------------- báo cáo — danh sách, cả hai bên đọc ---------------- */
function renderReports() {
  const days = taskDays().slice().sort((a, b) => b - a);
  const doneN = days.filter((d) => state.reports[d]).length;
  $('repListMeta').textContent = days.length ? `${doneN}/${days.length} day đã nộp` : '';
  const list = $('repList');
  if (!days.length) {
    list.innerHTML = '<div class="empty">Chưa có task — chưa có gì để báo cáo.</div>';
    return;
  }
  let opened = false;
  list.innerHTML = days.map((d) => {
    const r = state.reports[d];
    const pmin = focusMinutesForDay(d);
    const [dn, tot] = ckPair(d);
    const head = `<span class="d num">Day ${d}</span>
      <span class="name">${esc(taskTitle(d))}</span>
      <span class="fig num">${tot ? `${dn}<small>/${tot}</small>` : '—'}</span>
      <span class="fig num">${pmin} <small>phút</small></span>
      <span class="pill ${r ? 'pos' : ''}">${r ? 'Đã nộp' : 'Chưa nộp'}</span>`;
    if (!r) return `<div class="rep-item"><div class="rep-head">${head}</div>
      <div class="btnrow" style="margin:0 0 16px"><button class="btn" data-open-report="${d}">Viết báo cáo</button></div></div>`;
    const isOpen = !opened;
    opened = true; // mở sẵn báo cáo mới nhất cho người đọc
    return `<details class="rep-item"${isOpen ? ' open' : ''}><summary>${head}</summary><div class="md">${mdToHtml(r.md)}</div></details>`;
  }).join('');
}

/* ---------------- timer ---------------- */
const timer = { day: null, sched: DEFAULT_SCHED, i: -1, remain: 0, running: false, started: false, logged: false, doneMin: 0, int: null };
function timerSetup(day, confirmIfRunning) {
  if (timer.day === day) return true;
  if (confirmIfRunning && timer.started && !timer.logged
    && !confirm('Timer đang chạy. Chuyển day sẽ mất tiến trình timer. Chuyển chứ?')) return false;
  clearInterval(timer.int);
  Object.assign(timer, { day, i: -1, remain: 0, running: false, started: false, logged: false, doneMin: 0, int: null });
  const t = state.tasks[day];
  timer.sched = (t && t.type === 'md' && parseSchedule(t.content)) || DEFAULT_SCHED;
  renderTimer();
  return true;
}
const fmtClock = (s) => {
  s = Math.max(0, Math.round(s));
  if (s < 3600) return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  return Math.floor(s / 3600) + ':' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};
function renderTimer() {
  const s = timer.sched;
  $('timerMeta').textContent = timer.day != null ? `Day ${timer.day}` : '';
  $('timerStrip').innerHTML = stripHTML(s) + `<p class="meta" style="margin-top:10px">${stripState(s)}</p>`;
  $('timerRows').innerHTML = s.map((r, idx) => {
    let cls = '';
    if (idx < timer.i) cls += ' done';
    if (idx === timer.i && timer.started && timer.running) cls += ' cur';
    if (r.min === 0) cls += ' stop';
    return `<div class="t-row ${cls}"><span class="tt num">${esc(r.time)}</span><span class="tm num">${r.min || '—'}</span><span class="tp">${esc(r.label)}</span></div>`;
  }).join('');

  const row = timer.i >= 0 && timer.i < s.length ? s[timer.i] : null;
  const finished = timer.started && (timer.i >= s.length || timer.logged);
  if (!timer.started) {
    const total = s.reduce((x, r) => x + r.min, 0);
    $('timerLabel').textContent = 'Sẵn sàng?';
    $('timerClock').textContent = fmtClock(total * 60);
    $('timerNext').textContent = 'Bắt đầu: ' + s[0].label;
  } else if (finished) {
    $('timerLabel').textContent = 'Hoàn thành phiên.';
    $('timerClock').textContent = fmtClock(timer.doneMin * 60);
    $('timerNext').textContent = `Đã ghi ${timer.doneMin} phút cho Day ${timer.day}`;
  } else {
    $('timerLabel').textContent = row.time + ' — ' + row.label;
    $('timerClock').textContent = fmtClock(Math.max(0, timer.remain));
    const nx = s[timer.i + 1];
    $('timerNext').textContent = nx ? 'Tiếp: ' + nx.label : '';
  }
  $('btnStart').disabled = timer.running;
  $('btnStart').textContent = timer.logged ? 'Lại từ đầu' : (timer.started && !timer.running ? 'Tiếp tục' : 'Bắt đầu');
  $('btnPause').disabled = !timer.started || timer.logged;
  $('btnPause').textContent = timer.running ? 'Tạm dừng' : (timer.started ? 'Tiếp tục' : 'Tạm dừng');
  $('btnStop').disabled = !timer.started || timer.logged;
  const hasStop = s.some((r) => r.min === 0);
  $('timerBanner').hidden = !(finished && timer.logged && hasStop);
}
function tick() {
  timer.remain--;
  if (timer.remain < 0) { advance(); return; }
  renderTimer();
}
function advance() {
  const row = timer.sched[timer.i];
  if (row && row.min > 0) { timer.doneMin += row.min; beep(); }
  timer.i++;
  if (timer.i >= timer.sched.length || timer.sched[timer.i].min === 0) { finishSession(); return; }
  timer.remain = timer.sched[timer.i].min * 60;
  renderTimer();
}
function finishSession() {
  clearInterval(timer.int); timer.running = false;
  if (!timer.logged && timer.doneMin > 0) {
    state.focus.push({ date: today(), day: timer.day, minutes: timer.doneMin, ts: Date.now() });
    timer.logged = true; save(); bg(pushFocus(state.focus.at(-1)));
    renderToday();
    toast(`Đã ghi ${timer.doneMin} phút cho Day ${timer.day}`);
  }
  renderTimer();
}
function resetTimerRun() {
  clearInterval(timer.int);
  Object.assign(timer, { i: -1, remain: 0, running: false, started: false, logged: false, doneMin: 0 });
}

/* ---------------- report ---------------- */
let repLoadedDay = null;
function reportTemplate(day) {
  const [dn, tot] = ckPair(day);
  const mins = focusMinutesForDay(day);
  return `# Báo cáo Day ${day}
- Ngày: ${today()}
- Thời gian tập trung: ${mins} phút (từ timer)
- Checklist: ${dn}/${tot}${tot ? ' (' + Math.round((dn / tot) * 100) + '%)' : ''}

## Đã làm
- ...

## Không làm / lý do
- ...

## Học được
- ...

## Câu hỏi cho bạn
- ...

## Bằng chứng
- (link ghi chú / code / ảnh)
`;
}
function renderReport() {
  const day = curDay();
  const ta = $('repText');
  $('repPanel').hidden = day == null;
  if (day == null) {
    $('repTitle').textContent = 'Báo cáo hôm nay';
    $('repSavedInfo').textContent = '';
    ta.value = ''; ta.disabled = true;
    $('repPrev').innerHTML = '<p class="meta">Chưa có task nào.</p>';
    return;
  }
  ta.disabled = false;
  $('repTitle').textContent = `Báo cáo Day ${day}`;
  if (repLoadedDay !== day) {
    repLoadedDay = day;
    ta.value = state.reports[day] ? state.reports[day].md : reportTemplate(day);
  }
  const r = state.reports[day];
  $('repSavedInfo').textContent = r ? `Đã nộp ${r.date} ${r.at || ''}` : 'Chưa nộp';
  $('repPrev').innerHTML = mdToHtml(ta.value);
}
function saveDraft() {
  const day = curDay(); if (day == null) return;
  state.reports[day] = { md: $('repText').value, date: today(), at: nowHM(), ts: Date.now() };
  save(); bg(pushReport(day));
  $('repSavedInfo').textContent = `Đã nộp ${state.reports[day].date} ${state.reports[day].at}`;
}
function reportHtmlExport(day, md) {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Báo cáo Day ${day}</title>
<style>body{font:15px/1.6 Georgia,serif;max-width:720px;margin:40px auto;padding:0 20px;color:#1f201d}
h1{font-size:1.4rem}h2{font-size:1.05rem;margin:1.2em 0 .4em;padding-top:.6em;border-top:1px solid #eaeaea}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #eaeaea;padding:6px 10px;text-align:left}
blockquote{border-left:4px solid #fde68a;background:#fffbeb;margin:12px 0;padding:10px 14px;border-radius:10px;color:#92400e}</style>
</head><body>${mdToHtml(md)}</body></html>`;
}

/* ---------------- create task (cho người giao task) ---------------- */
let crAuto = true;
function createTemplate(n) {
  return `# Day ${n} — <tiêu đề>

**Mục tiêu hôm nay:** <mục tiêu 1 dòng>

## Bối cảnh
- <ràng buộc, tài liệu đọc, rule...>

## Inside a 2-hour weekday evening

| TIME | MIN | PART |
|------|-----|------|
| 19:30 | 10 | Đọc lại ghi chú hôm qua |
| 19:40 | 60 | **§1 Knowledge — <chủ đề>** |
| 20:40 | 35 | **§2 Predict → Run → Explain** |
| 21:15 | 15 | **§3 AI-Verify + §4 Drill** |
| 21:30 | — | **Hard stop. Dừng cả giữa câu.** |

> **21:30 là điểm dừng, không phải mục tiêu.** Đánh dấu chỗ dừng và làm tiếp ở phiên sau.

## Checklist
- [ ] <việc 1>
- [ ] <việc 2>
- [ ] <việc 3>
- [ ] Ghi lại chỗ dừng nếu dừng sớm
`;
}

/* ---------------- import / backup ---------------- */
async function handleFiles(files) {
  const touched = []; let first = null;
  for (const f of files) {
    const text = await f.text();
    const isHtml = /\.html?$/i.test(f.name) || /^\s*<(!doctype|html)/i.test(text);
    const md = isHtml ? htmlToMd(text) : text; // task .html cũng đọc được: chuyển về md để có checklist + timer
    const m = f.name.match(/day\s*(\d+)/i) || f.name.match(/(\d+)/);
    const day = m ? +m[1] : nextDay();
    if (state.tasks[day] && state.tasks[day].content !== md && !confirm(`Day ${day} đã có task. Ghi đè?`)) continue;
    if (state.tasks[day]?.content !== md) delete state.checks[day]; // task mới → checklist cũ không còn đúng
    state.tasks[day] = { type: 'md', content: md, addedAt: Date.now() };
    touched.push(day);
    if (first == null) first = day;
  }
  if (!touched.length) return;
  resetTimerRun(); timer.day = null; // task có thể đổi → buộc dựng lại lịch timer
  pickDay = null; repLoadedDay = null;
  save(); renderAll();
  for (const d of touched) bg(pushTask(d));
  toast(`Đã nhận task Day ${first}`);
}
function openReport(day) {
  pickDay = day; repLoadedDay = null; save(); switchTab('dash');
}

/* ---------------- wiring ---------------- */
function renderAll() {
  renderToday(); renderReport(); renderReports();
  const n = taskDays().filter((d) => state.reports[d]).length;
  $('allRepCount').textContent = n ? `${n} day đã có báo cáo trong app.` : 'Chưa day nào có báo cáo.';
}
function init() {
  // điều hướng: mọi [data-tab] (sidebar, footnote), [data-open-report] → mở day đó ở Hôm nay
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { e.preventDefault(); switchTab(tab.dataset.tab); return; }
    const orp = e.target.closest('[data-open-report]');
    if (orp) { openReport(+orp.dataset.openReport); return; }
  });
  $('menuBtn').onclick = () => $('sidebar').classList.add('open');
  $('menuClose').onclick = () => $('sidebar').classList.remove('open');

  // giao task (modal)
  const modal = $('assignModal');
  const closeAssign = () => { modal.hidden = true; };
  $('btnAssign').onclick = () => {
    const n = nextDay();
    $('crDay').value = n;
    $('crText').value = createTemplate(n); crAuto = true;
    renderCrPrev();
    modal.hidden = false;
    $('sidebar').classList.remove('open');
    $('crText').focus();
    $('crText').setSelectionRange(0, 0);
    $('crText').scrollTop = 0;
  };
  $('assignClose').onclick = closeAssign;
  modal.addEventListener('click', (e) => { if (e.target === modal) closeAssign(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeAssign(); });

  // nhận file task (nút + kéo thả toàn trang)
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = (e) => { handleFiles([...e.target.files]); e.target.value = ''; };
  document.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault(); handleFiles([...e.dataTransfer.files]);
  });

  // backup — không đưa token Turso vào file
  $('backupOut').onclick = () => {
    const { turso, ...data } = state;
    download('ghostproject-backup.json', JSON.stringify(data, null, 2), 'application/json');
  };
  $('backupIn').onclick = () => $('backupFile').click();
  $('backupFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || typeof data.tasks !== 'object') throw new Error('bad');
      if (!confirm('Nhập backup sẽ thay thế dữ liệu máy này. Tiếp tục?')) return;
      state = { ...defaultState(), ...data, turso: { ...state.turso, pushed: false } };
      pickDay = null; repLoadedDay = null; resetTimerRun(); timer.day = null;
      save(); renderAll(); toast('Đã nhập backup');
    } catch { alert('File backup không hợp lệ.'); }
    e.target.value = '';
  };
  $('resetAll').onclick = () => {
    if (!confirm('Xoá TOÀN BỘ task, báo cáo, tiến độ — cả trên Turso nếu đã kết nối? Không hoàn tác được.')) return;
    state = { ...defaultState(), turso: state.turso };
    pickDay = null; repLoadedDay = null; resetTimerRun(); timer.day = null;
    save(); renderAll();
    if (tursoCfg().url && tursoCfg().token) {
      bg((async () => { for (const t of ['tasks', 'reports', 'checks', 'focus']) await tsql('DELETE FROM ' + t); })());
    }
    toast('Đã xoá hết');
  };
  $('dlAllMd').onclick = () => {
    const days = taskDays().filter((d) => state.reports[d]);
    if (!days.length) { toast('Chưa có báo cáo nào'); return; }
    download(`baocao-day${days[0]}-den-day${days.at(-1)}.md`, days.map((d) => state.reports[d].md).join('\n\n---\n\n'));
    toast(`Đã tải ${days.length} báo cáo gộp một file`);
  };

  // Turso
  const tMap = { tursoUrl: 'url', tursoToken: 'token' };
  for (const [id, k] of Object.entries(tMap)) {
    const inp = $(id);
    inp.value = tursoCfg()[k] || '';
    inp.addEventListener('input', () => {
      state.turso = { ...tursoCfg(), [k]: inp.value.trim() };
      save(); setSyncStatus('Đã lưu — bấm "Kết nối & đồng bộ"');
    });
  }
  $('btnConnect').onclick = () => tursoConnect(true);
  setSyncStatus(tursoCfg().lastSync ? 'Đồng bộ lần cuối: ' + new Date(tursoCfg().lastSync).toLocaleString('vi-VN') : 'Chưa kết nối Turso');

  // checklist của task tối nay
  $('todayBody').addEventListener('change', (e) => {
    const k = e.target.dataset.ck; if (k === undefined) return;
    const day = curDay(); if (day == null) return;
    const arr = state.checks[day] || (state.checks[day] = []);
    arr[+k] = e.target.checked;
    e.target.closest('.ck')?.classList.toggle('done', e.target.checked);
    save(); bg(pushCheck(day, +k, e.target.checked));
    renderToday();
  });

  // timer
  $('btnStart').onclick = () => {
    if (timer.logged) resetTimerRun();
    if (!timer.started) {
      timer.started = true; timer.i = 0;
      timer.remain = (timer.sched[0]?.min || 0) * 60;
    }
    timer.running = true; clearInterval(timer.int); timer.int = setInterval(tick, 1000);
    renderTimer();
  };
  $('btnPause').onclick = () => {
    if (!timer.started || timer.logged) return;
    if (timer.running) { clearInterval(timer.int); timer.running = false; }
    else { timer.running = true; clearInterval(timer.int); timer.int = setInterval(tick, 1000); }
    renderTimer();
  };
  $('btnStop').onclick = () => {
    if (!timer.started || timer.logged) return;
    clearInterval(timer.int); timer.running = false;
    let mins = timer.doneMin;
    if (timer.i < timer.sched.length && timer.sched[timer.i].min > 0) {
      mins += Math.floor((timer.sched[timer.i].min * 60 - timer.remain) / 60);
    }
    if (mins > 0) {
      state.focus.push({ date: today(), day: timer.day, minutes: mins, ts: Date.now() });
      timer.logged = true; save(); bg(pushFocus(state.focus.at(-1))); renderToday();
      toast(`Đã ghi ${mins} phút cho Day ${timer.day}`);
    } else toast('Chưa đủ 1 phút để ghi');
    renderTimer();
  };

  // báo cáo: tự lưu khi ngừng gõ (900ms) → tự đẩy Turso
  let deb, draftT;
  $('repText').addEventListener('input', () => {
    clearTimeout(deb); deb = setTimeout(() => { $('repPrev').innerHTML = mdToHtml($('repText').value); }, 250);
    clearTimeout(draftT); draftT = setTimeout(saveDraft, 900);
  });
  $('btnRefill').onclick = () => {
    const day = curDay(); if (day == null) return;
    $('repText').value = reportTemplate(day);
    renderReport();
    toast('Đã điền lại từ checklist + timer');
  };
  $('btnSaveDraft').onclick = () => {
    const day = curDay(); if (day == null) return;
    const had = !!state.reports[day];
    saveDraft();
    pickDay = null; repLoadedDay = null; // nộp xong → tự sang day kế tiếp chưa nộp
    renderAll();
    toast(had ? `Đã cập nhật báo cáo Day ${day}` : `Đã nộp báo cáo Day ${day}`);
  };
  $('btnCopy').onclick = () => copyText($('repText').value);
  $('btnDlMd').onclick = () => {
    const day = curDay(); if (day == null) return;
    saveDraft();
    download(`baocaoday${day}.md`, $('repText').value);
    toast(`Đã tải baocaoday${day}.md`);
  };
  $('btnDlHtml').onclick = () => {
    const day = curDay(); if (day == null) return;
    saveDraft();
    download(`baocaoday${day}.html`, reportHtmlExport(day, $('repText').value), 'text/html');
    toast(`Đã tải baocaoday${day}.html`);
  };

  // giao task — nội dung
  $('crText').value = createTemplate(1); crAuto = true;
  $('crDay').addEventListener('input', () => {
    const n = Math.max(1, +$('crDay').value || 1);
    if (crAuto) { $('crText').value = createTemplate(n); renderCrPrev(); }
  });
  $('crText').addEventListener('input', () => { crAuto = false; renderCrPrev(); });
  $('btnCrPrev').onclick = renderCrPrev;
  $('btnCrDl').onclick = () => {
    const n = Math.max(1, +$('crDay').value || 1);
    download(`taskday${n}.md`, $('crText').value);
    toast(`Đã tải taskday${n}.md`);
  };
  $('btnCrSave').onclick = () => {
    const n = Math.max(1, +$('crDay').value || 1);
    if (state.tasks[n] && !confirm(`Day ${n} đã có task. Ghi đè?`)) return;
    state.tasks[n] = { type: 'md', content: $('crText').value, addedAt: Date.now() };
    delete state.checks[n];
    save(); bg(pushTask(n));
    modal.hidden = true;
    pickDay = n; repLoadedDay = null;
    renderAll();
    toast(`Đã giao Day ${n}`);
  };
  function renderCrPrev() { $('crPrev').innerHTML = mdToHtml($('crText').value); }
  renderCrPrev();

  // cập nhật dải buổi tối mỗi 30 giây khi đang mở Hôm nay
  setInterval(() => {
    if ($('tab-dash')?.classList.contains('active')) { renderToday(); renderTimer(); }
  }, 30000);

  const TABS = ['dash', 'report', 'settings'];
  const hashTab = () => (location.hash.startsWith('#tab-') && TABS.includes(location.hash.slice(5)) ? location.hash.slice(5) : 'dash');
  switchTab(hashTab());
  window.addEventListener('hashchange', () => { // deep-link: /#tab-report mở thẳng màn Báo cáo
    const t = hashTab();
    switchTab(t);
  });

  // có cấu hình Turso thì kéo dữ liệu về khi mở trang
  if (tursoCfg().url && tursoCfg().token) tursoConnect(false);
}
init();
