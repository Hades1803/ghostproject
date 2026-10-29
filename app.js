'use strict';
/* GhostProject — self-study tracker. Static site, dữ liệu ở localStorage + Turso (SQLite qua HTTP).
   Flow: bạn bạn gửi file .md → "Mở file .md" xem trước → học, tick checklist → viết trả lời,
   "Tạo file .md" gửi lại bạn bạn → bạn bạn mở file để đọc, hoặc đọc trực tiếp ở tab Báo cáo.
   UI: tasteskill "editorial-greeting" (seed 1472121576) — greeting là h1, panel tông, accent teal trên data. */

const $ = (id) => document.getElementById(id);
const KEY = 'ghostproject_v1';
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const today = () => iso(new Date());
const nowHM = () => new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

/* ---------------- state ---------------- */
function defaultState() {
  return { tasks: {}, reports: {}, checks: {}, turso: { url: '', token: '', lastSync: '' } };
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
/* HTML → md: đọc lại task/báo cáo dạng .html (từ "Tạo task", hoặc bạn bạn gửi file html khác)
   để checklist hoạt động như .md */
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
        // cả bảng một block (các hàng liền nhau); dòng đầu làm header
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
}
const pushTask = (day) => tsql('INSERT INTO tasks (day, content, updated_at) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at',
  [qi(day), qs(state.tasks[day].content), qi(state.tasks[day].addedAt || Date.now())]);
const pushReport = (day) => tsql('INSERT INTO reports (day, content, updated_at) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at',
  [qi(day), qs(state.reports[day].md), qi(state.reports[day].ts || Date.now())]);
const pushCheck = (day, idx, done) => tsql('INSERT INTO checks (day, idx, done) VALUES (?, ?, ?) ON CONFLICT(day, idx) DO UPDATE SET done = excluded.done',
  [qi(day), qi(idx), qi(done ? 1 : 0)]);

function setSyncStatus(msg) { const el = $('syncStatus'); if (el) el.textContent = msg; }
/* ghi nền: UI cập nhật local trước, lỗi chỉ hiện ở dòng trạng thái */
function bg(p) {
  const cfg = tursoCfg();
  if (!cfg.url || !cfg.token) return; // chế độ chỉ-trong-máy
  p.then(() => setSyncStatus('Đã lưu Turso · ' + nowHM()))
    .catch((e) => setSyncStatus('Lỗi Turso: ' + e.message));
}

async function tursoPull() {
  const [t, r, c] = await Promise.all([
    tsql('SELECT day, content, updated_at FROM tasks'),
    tsql('SELECT day, content, updated_at FROM reports'),
    tsql('SELECT day, idx, done FROM checks'),
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
  Object.assign(state, { tasks, reports, checks });
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
  if (!first) return; // checklist chỉ đẩy một lần; về sau ghi ngay tại chỗ tick
  for (const [d, arr] of Object.entries(state.checks)) for (let i = 0; i < arr.length; i++) if (arr[i]) await pushCheck(+d, i, 1);
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
  const done = days.filter((d) => state.reports[d]).length;

  $('greetTitle').textContent = day ? `Tối nay, Day ${day}.` : 'Chưa có task.';
  if (day) {
    const [dn, tot] = ckPair(day);
    $('greetSub').textContent = `${taskTitle(day)} · checklist ${tot ? `${dn}/${tot}` : '—'} · ${done}/${days.length} day đã nộp báo cáo.`;
  } else {
    $('greetSub').textContent = 'Bạn bạn gửi file .md — bấm "Mở file .md" để xem trước và nhận task.';
  }

  $('kStreak').innerHTML = `${streak} <small>ngày</small>`;
  $('kDone').innerHTML = `${done}<small>/${days.length}</small>`;

  const body = $('todayBody');
  if (!day) {
    $('todayMeta').textContent = '';
    $('todayHint').textContent = '';
    body.innerHTML = '<div class="empty">Chưa có task. Bấm "Mở file .md" để xem trước file bạn bạn gửi — hoặc bảo bạn bạn bấm "Giao task".</div>';
    return;
  }
  const [dn, tot] = ckPair(day);
  $('todayMeta').textContent = `Day ${day}`;
  $('todayHint').textContent = tot ? '' : 'Task này không có checklist tự động — theo dõi tiến độ bằng báo cáo.';
  body.innerHTML = (tot ? bar(dn, tot) : '') + mdToHtml(state.tasks[day].content);
  const cks = state.checks[day] || [];
  body.querySelectorAll('input[data-ck]').forEach((inp) => {
    const k = +inp.dataset.ck;
    if (cks[k]) { inp.checked = true; inp.closest('.ck')?.classList.add('done'); }
  });
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
    const [dn, tot] = ckPair(d);
    const head = `<span class="d num">Day ${d}</span>
      <span class="name">${esc(taskTitle(d))}</span>
      <span class="fig num">${tot ? `${dn}<small>/${tot}</small>` : '—'}</span>
      <span class="pill ${r ? 'pos' : ''}">${r ? 'Đã nộp' : 'Chưa nộp'}</span>`;
    if (!r) return `<div class="rep-item"><div class="rep-head">${head}</div>
      <div class="btnrow" style="margin:0 0 16px"><button class="btn" data-open-report="${d}">Viết báo cáo</button></div></div>`;
    const isOpen = !opened;
    opened = true; // mở sẵn báo cáo mới nhất cho người đọc
    return `<details class="rep-item"${isOpen ? ' open' : ''}><summary>${head}</summary><div class="md">${mdToHtml(r.md)}</div></details>`;
  }).join('');
}

/* ---------------- report ---------------- */
let repLoadedDay = null;
function reportTemplate(day) {
  const [dn, tot] = ckPair(day);
  return `# Báo cáo Day ${day}
- Ngày: ${today()}
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

/* ---------------- import: xem trước file (.md task hoặc báo cáo) rồi mới nhận ----------------
   File báo cáo nhận diện theo dòng đầu "# Báo cáo Day N" — chính là file app tự tạo ra. */
let staged = []; // {name, md, day, kind: 'task' | 'report'}
async function stageFiles(files) {
  staged = [];
  for (const f of files) {
    const text = await f.text();
    const isHtml = /\.html?$/i.test(f.name) || /^\s*<(!doctype|html)/i.test(text);
    const md = isHtml ? htmlToMd(text) : text; // task .html cũng đọc được: chuyển về md để có checklist
    const rep = md.match(/^#\s*Báo cáo\s*Day\s*(\d+)/m);
    const m = f.name.match(/day\s*(\d+)/i) || f.name.match(/(\d+)/);
    staged.push({ name: f.name, md, day: rep ? +rep[1] : (m ? +m[1] : nextDay()), kind: rep ? 'report' : 'task' });
  }
  if (!staged.length) return;
  renderStage();
  $('importModal').hidden = false;
  $('btnStageAccept').focus();
}
function renderStage() {
  $('stageList').innerHTML = staged.map((s, i) => {
    const hasTask = state.tasks[s.day] && state.tasks[s.day].content !== s.md;
    const hasRep = !!state.reports[s.day];
    const pill = s.kind === 'report'
      ? (hasRep ? `<span class="pill">Báo cáo Day ${s.day} — đã có trong app, chỉ xem</span>`
                : `<span class="pill pos">Báo cáo Day ${s.day} — sẽ lưu</span>`)
      : (hasTask ? `<span class="pill warn">Day ${s.day} đã có task — sẽ ghi đè</span>`
                 : `<span class="pill pos">Task mới</span>`);
    return `<div class="stage-item">
      <div class="stage-head">
        <span class="name">${esc(s.name)}</span>
        <label class="inline-field">Day<input type="number" class="input num" min="1" value="${s.day}" data-stage-day="${i}" style="width:76px"></label>
        ${pill}
      </div>
      <div class="md stage-prev">${mdToHtml(s.md)}</div>
    </div>`;
  }).join('');
}
function acceptStaged() {
  const repDays = [];
  for (const s of staged) {
    if (s.kind === 'report') {
      if (!state.reports[s.day]) { // không đè báo cáo đã có (bản trong app luôn mới hơn)
        const dm = s.md.match(/^-\s*Ngày:\s*(\d{4}-\d{2}-\d{2})/m);
        state.reports[s.day] = { md: s.md, ts: Date.now(), date: dm ? dm[1] : today(), at: nowHM() };
        repDays.push(s.day);
        bg(pushReport(s.day));
      }
      continue;
    }
    const day = Math.max(1, +s.day || nextDay());
    if (state.tasks[day]?.content !== s.md) delete state.checks[day]; // task mới → checklist cũ không còn đúng
    state.tasks[day] = { type: 'md', content: s.md, addedAt: Date.now() };
    bg(pushTask(day));
  }
  staged = [];
  $('importModal').hidden = true;
  pickDay = null; repLoadedDay = null;
  save(); renderAll();
  toast(repDays.length ? `Đã lưu ${repDays.map((d) => 'Day ' + d).join(', ')} vào app` : 'Đã nhận');
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
  const openAssign = () => {
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
  document.querySelectorAll('[data-assign]').forEach((b) => { b.onclick = openAssign; });
  $('assignClose').onclick = closeAssign;
  modal.addEventListener('click', (e) => { if (e.target === modal) closeAssign(); });
  // modal nhận file: xem trước task
  const im = $('importModal');
  const closeImport = () => { staged = []; im.hidden = true; };
  $('stageClose').onclick = $('stageCancel').onclick = closeImport;
  $('btnStageAccept').onclick = acceptStaged;
  im.addEventListener('click', (e) => { if (e.target === im) closeImport(); });
  $('stageList').addEventListener('change', (e) => {
    const i = e.target.dataset.stageDay; if (i === undefined) return;
    staged[+i].day = Math.max(1, +e.target.value || staged[+i].day);
    renderStage();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!modal.hidden) closeAssign();
    if (!im.hidden) closeImport();
  });

  // nhận file task (nút + kéo thả toàn trang) → mở modal xem trước
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = (e) => { stageFiles([...e.target.files]); e.target.value = ''; };
  document.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault(); stageFiles([...e.dataTransfer.files]);
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
      pickDay = null; repLoadedDay = null;
      save(); renderAll(); toast('Đã nhập backup');
    } catch { alert('File backup không hợp lệ.'); }
    e.target.value = '';
  };
  $('resetAll').onclick = () => {
    if (!confirm('Xoá TOÀN BỘ task, báo cáo, tiến độ — cả trên Turso nếu đã kết nối? Không hoàn tác được.')) return;
    state = { ...defaultState(), turso: state.turso };
    pickDay = null; repLoadedDay = null;
    save(); renderAll();
    if (tursoCfg().url && tursoCfg().token) {
      bg((async () => { for (const t of ['tasks', 'reports', 'checks']) await tsql('DELETE FROM ' + t); })());
    }
    toast('Đã xoá hết');
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
    toast('Đã điền lại từ checklist');
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
    toast(`Đã tạo baocaoday${day}.md — gửi file này cho bạn bạn`);
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

  // nút "Mở file .md" ở tab Báo cáo dùng chung ô chọn file với Hôm nay
  $('repFileBtn').onclick = () => $('importFile').click();
  const dlAll = () => {
    const days = taskDays().filter((d) => state.reports[d]);
    if (!days.length) { toast('Chưa có báo cáo nào'); return; }
    download(`baocao-day${days[0]}-den-day${days.at(-1)}.md`, days.map((d) => state.reports[d].md).join('\n\n---\n\n'));
    toast(`Đã tải ${days.length} báo cáo gộp một file`);
  };
  $('dlAllReports').onclick = dlAll;
  $('dlAllMd').onclick = dlAll;

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
