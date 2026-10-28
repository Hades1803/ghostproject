'use strict';
/* GhostProject — self-study tracker. Static site, all data in localStorage.
   shortcut: storage is browser-local (no server) — use Backup export/import to move data between machines.
   UI: tasteskill "editorial-greeting" (seed 1472121576) — greeting là h1, panel tông, accent teal trên data. */

const $ = (id) => document.getElementById(id);
const KEY = 'ghostproject_v1';
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const today = () => iso(new Date());

/* ---------------- state ---------------- */
function defaultState() {
  return { tasks: {}, reports: {}, checks: {}, focus: [], cur: { task: null, report: null } };
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch { return null; }
}
function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
  queuePush(); // có cấu hình S3 thì đẩy debounced
}
let pushT = null; // debounce push lên S3 (khai báo sớm để save() gọi được lúc seed)
function queuePush() {
  const c = state.s3 || {};
  if (!c.bucket || !c.ak || !c.sk) return;
  clearTimeout(pushT);
  pushT = setTimeout(() => { if (!syncNow.busy) syncNow(false); }, 2500);
}

const SAMPLE_MD = `# Day 1 — Foundations

**Mục tiêu hôm nay:** hiểu cơ chế cốt lõi của §1 và chạy được trọn một buổi **§2 Predict → Run → Explain**.

## Bối cảnh
- Buổi học: tối ngày thường, 2 giờ (19:30 → 21:30)
- Nguyên tắc: ghi chú bằng tay, điện thoại để khỏi phòng, hard stop đúng giờ.

## Inside a 2-hour weekday evening

| TIME | MIN | PART |
|------|-----|------|
| 19:30 | 10 | Đọc lại ghi chú hôm qua — rẻ, giữ trí nhớ cao |
| 19:40 | 60 | **§1 Knowledge** — cơ chế cốt lõi |
| 20:40 | 35 | **§2 Predict → Run → Explain** |
| 21:15 | 15 | **§3 AI-Verify + §4 Drill** |
| 21:30 | — | **Hard stop. Dừng cả giữa câu.** |

> **21:30 là điểm dừng, không phải mục tiêu.** Hoàn thành section kém quan trọng hơn việc giữ trạng thái làm việc ngày mai và giấc ngủ tối nay. Đánh dấu chỗ dừng và làm tiếp ở phiên sau.

## Checklist
- [ ] Đọc lại ghi chú hôm qua (10')
- [ ] §1: viết lại cơ chế bằng lời của mình
- [ ] §2: Predict → Run → Explain với 3 ví dụ
- [ ] §3: kiểm chứng 1 điểm còn mơ hồ với AI
- [ ] §4: drill 5 câu
- [ ] Ghi lại chỗ dừng nếu dừng sớm
`;

let state = load();
if (!state) {
  state = defaultState();
  state.tasks[1] = { type: 'md', content: SAMPLE_MD, addedAt: 0 }; // addedAt 0: task thật của S3 luôn thắng sample khi trộn
  save();
}

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
function ckItems(day) {
  if (!state.tasks[day] || state.tasks[day].type !== 'md') return [];
  const checks = state.checks[day] || [];
  return [...state.tasks[day].content.matchAll(/^- \[( |x|X)\]\s*(.+)$/gm)]
    .map((m, k) => ({ done: m[1].toLowerCase() === 'x' || checks[k] === true, text: m[2].replace(/\*\*/g, '') }));
}

/* ---------------- đồng bộ S3 (Long Vân / S3-compatible, SigV4 bằng crypto.subtle) ---------------- */
const S3_DEFAULTS = { endpoint: 'https://s3-hcm-r1.longvan.net', region: 'hcm5-r1', bucket: '', ak: '', sk: '', lastSync: '' };
const s3cfg = () => ({ ...S3_DEFAULTS, ...(state.s3 || {}) });
const te = new TextEncoder();
const sha256hex = async (d) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', typeof d === 'string' ? te.encode(d) : d))].map((b) => b.toString(16).padStart(2, '0')).join('');
const hmacK = async (k, m) => crypto.subtle.importKey('raw', typeof k === 'string' ? te.encode(k) : k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']).then((key) => crypto.subtle.sign('HMAC', key, te.encode(m)));
const hmacHex = async (k, m) => [...new Uint8Array(await hmacK(k, m))].map((b) => b.toString(16).padStart(2, '0')).join('');
const uriEnc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const canonPath = (p) => ('/' + (p || '').replace(/^\/+/, '')).split('/').map((s) => uriEnc(s)).join('/');

async function s3Call(method, file, body) {
  const cfg = s3cfg();
  if (!cfg.endpoint || !cfg.bucket) throw new Error('Chưa điền bucket trong Cài đặt');
  const host = cfg.endpoint.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const path = canonPath(`/${cfg.bucket}/${file}`);
  const query = method === 'GET' ? { v: String(Date.now()) } : {}; // bust cache edge (cache key theo URL, bỏ qua auth)
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256hex(body || '');
  const headers = { 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  if (body !== undefined) headers['content-type'] = 'application/json; charset=utf-8';
  const sorted = Object.keys(headers).sort();
  const qs = Object.keys(query).sort().map((k) => `${uriEnc(k)}=${query[k] ? uriEnc(query[k]) : ''}`).join('&');
  const canonical = [method, path, qs,
    sorted.map((h) => `${h}:${String(headers[h]).trim()}\n`).join(''),
    sorted.join(';'), payloadHash].join('\n');
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256hex(canonical)].join('\n');
  const kSig = await hmacK(await hmacK(await hmacK(await hmacK('AWS4' + cfg.sk, dateStamp), cfg.region), 's3'), 'aws4_request');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${cfg.ak}/${scope}, SignedHeaders=${sorted.join(';')}, Signature=${await hmacHex(kSig, toSign)}`;
  let res;
  try {
    res = await fetch(`https://${host}${path}` + (qs ? `?${qs}` : ''), { method, headers, body: body === undefined ? undefined : body });
  } catch {
    throw new Error('Không gọi được S3' + (location.protocol === 'file:' ? ' (mở trang qua https — file:// bị chặn CORS)' : ''));
  }
  if (method === 'GET' && res.status === 404) return null; // file chưa có lần nào → coi như rỗng
  if (!res.ok) throw new Error(`${method} ${file} → HTTP ${res.status}`);
  return method === 'GET' ? await res.json() : true;
}

function mergeIn(remoteTasks, remoteReports) {
  let changed = false;
  for (const [d, t] of Object.entries(remoteTasks?.tasks || {})) {
    const cur = state.tasks[d];
    if (!cur || (t.addedAt || 0) > (cur.addedAt || 0)) {
      if (cur && cur.content !== t.content) delete state.checks[d]; // task đổi → checklist cũ sai lệch
      state.tasks[d] = t; changed = true;
    }
  }
  for (const [d, r] of Object.entries(remoteReports?.reports || {})) {
    if (!state.reports[d] || (r.ts || 0) > (state.reports[d].ts || 0)) { state.reports[d] = r; changed = true; }
  }
  for (const [d, arr] of Object.entries(remoteReports?.checks || {})) {
    const cur = state.checks[d] || [];
    state.checks[d] = arr.map((v, i) => v || cur[i]);
    if (state.checks[d].some((v, i) => v !== cur[i])) changed = true;
  }
  for (const e of remoteReports?.focus || []) {
    if (!state.focus.some((x) => (x.ts && x.ts === e.ts) || (!x.ts && x.date === e.date && x.day === e.day && x.minutes === e.minutes))) {
      state.focus.push(e); changed = true;
    }
  }
  return changed;
}

let lastPush = '';
async function syncNow(manual) {
  if (syncNow.busy) return;
  const cfg = s3cfg();
  if (!cfg.bucket || !cfg.ak || !cfg.sk) {
    if (manual) toast('Điền bucket + access key trong Cài đặt trước');
    return;
  }
  syncNow.busy = true;
  setSyncStatus('Đang đồng bộ…');
  try {
    const [rt, rr] = await Promise.all([s3Call('GET', 'tasks.json'), s3Call('GET', 'reports.json')]);
    if (mergeIn(rt, rr)) { save(); renderAll(); }
    const now = new Date().toISOString();
    const tJson = JSON.stringify({ tasks: state.tasks, updatedAt: now });
    const rJson = JSON.stringify({ reports: state.reports, checks: state.checks, focus: state.focus, updatedAt: now });
    const fresh = JSON.stringify(state.tasks) + JSON.stringify([state.reports, state.checks, state.focus]);
    if (fresh !== lastPush) {
      await s3Call('PUT', 'tasks.json', tJson);
      await s3Call('PUT', 'reports.json', rJson);
      lastPush = fresh;
    }
    state.s3 = { ...cfg, lastSync: now };
    save();
    setSyncStatus('Đồng bộ lúc ' + new Date(now).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));
    if (manual) toast('Đã đồng bộ với S3');
  } catch (e) {
    setSyncStatus('Lỗi đồng bộ: ' + e.message);
    if (manual) toast('Đồng bộ lỗi: ' + e.message);
  } finally { syncNow.busy = false; }
}
function setSyncStatus(msg) { const el = $('syncStatus'); if (el) el.textContent = msg; }

/* ---------------- dashboard ---------------- */
let logAll = false;
function calcStreak() {
  const dates = new Set(Object.values(state.reports).map((r) => r.date).filter(Boolean));
  const d = new Date();
  if (!dates.has(iso(d))) { d.setDate(d.getDate() - 1); if (!dates.has(iso(d))) return 0; }
  let n = 0;
  while (dates.has(iso(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function renderDash() {
  const days = taskDays();
  const streak = calcStreak();
  const weekAgo = iso(new Date(Date.now() - 6 * 864e5));
  const mins = state.focus.filter((e) => e.date >= weekAgo).reduce((s, e) => s + e.minutes, 0);
  const done = days.filter((d) => state.reports[d]).length;
  const cur = days.at(-1) ?? null;

  $('greetTitle').textContent = cur ? `Tối nay, Day ${cur}.` : 'Chưa có task.';
  if (cur) {
    const [dn, tot] = ckPair(cur);
    $('greetSub').textContent = `${taskTitle(cur)} · checklist ${tot ? `${dn}/${tot}` : '—'} · ${done}/${days.length} day đã nộp báo cáo.`;
  } else {
    $('greetSub').textContent = 'Nhận file taskdayN.md từ bạn bạn, hoặc tự tạo ở tab "Tạo task".';
  }

  $('kStreak').innerHTML = `${streak} <small>ngày</small>`;
  $('kMin').innerHTML = `${mins} <small>phút · 7 ngày</small>`;
  $('kDone').innerHTML = `${done}<small>/${days.length}</small>`;

  // panel task tối nay — có checklist 4 mục đầu để cân chiều cao với panel bên cạnh
  const ov = $('ovTask');
  if (!cur) {
    $('ovTaskKicker').textContent = 'Tối nay';
    $('ovTaskMeta').textContent = '';
    ov.innerHTML = '<div class="empty">Chưa có task nào. Import file taskdayN.md hoặc .html, hoặc bảo bạn bạn đăng ở tab "Tạo task".</div>';
  } else {
    $('ovTaskKicker').textContent = 'Tối nay';
    $('ovTaskMeta').textContent = `Day ${cur}`;
    const [dn, tot] = ckPair(cur);
    const items = ckItems(cur);
    ov.innerHTML = `
      <p style="font-size:16px;font-weight:500;line-height:1.4">${esc(taskTitle(cur))}</p>
      ${bar(dn, tot)}
      ${items.length ? `<ul class="ov-list">${items.slice(0, 4).map((it) =>
        `<li class="${it.done ? 'ok' : ''}">${esc(it.text)}</li>`).join('')}</ul>` : ''}
      <div class="btnrow">
        <button class="btn primary" data-open="${cur}">Mở task</button>
        <button class="btn" data-open-report="${cur}">Viết báo cáo</button>
      </div>`;
  }

  // panel buổi tối
  const sched = (cur && state.tasks[cur]?.type === 'md' && parseSchedule(state.tasks[cur].content)) || DEFAULT_SCHED;
  $('ovTimeMeta').textContent = `${sched[0].time} → ${sched.at(-1).time}`;
  $('ovTime').innerHTML = stripHTML(sched) + `<div class="t-rows" style="margin:10px 0 0">${
    sched.filter((r) => r.min > 0).map((r) =>
      `<div class="t-row"><span class="tt num">${esc(r.time)}</span><span class="tm num">${r.min}</span><span class="tp">${esc(r.label)}</span></div>`).join('')
  }</div>`;
  $('ovTimeState').textContent = stripState(sched);

  // nhật ký day (cap 8 dòng, có nút xem tất cả)
  const log = $('ovLog');
  if (!days.length) {
    log.innerHTML = '<div class="empty">Chưa có day nào. Day đầu tiên sẽ xuất hiện ở đây sau khi import hoặc tạo task.</div>';
  } else {
    const shown = logAll ? days : days.slice(0, 8);
    log.innerHTML = shown.map((d) => {
      const [dn, tot] = ckPair(d);
      const rep = state.reports[d];
      const pmin = focusMinutesForDay(d);
      return `<div class="row">
        <span class="d num">Day ${d}</span>
        <span class="name">${esc(taskTitle(d))}</span>
        <span class="fig num">${tot ? `${dn}<small>/${tot}</small>` : '—'}</span>
        <span class="fig num">${pmin} <small>phút</small></span>
        <span class="pill ${rep ? 'pos' : ''}">${rep ? 'Đã gửi' : 'Chưa nộp'}</span>
        <button class="text-action" data-open="${d}">Mở</button>
      </div>`;
    }).join('');
    if (days.length > 8 && !logAll) log.insertAdjacentHTML('beforeend', `<button class="text-action more" id="logMore">Tất cả ${days.length} day</button>`);
    const more = $('logMore'); if (more) more.onclick = () => { logAll = true; renderDash(); };
  }
}

/* ---------------- task view ---------------- */
function renderTask() {
  const days = taskDays();
  $('taskDay').innerHTML = days.map((d) => `<option value="${d}">Day ${d}</option>`).join('') || '<option value="">—</option>';
  if (!state.tasks[state.cur.task]) state.cur.task = days.at(-1) ?? null;
  if (state.cur.task != null) $('taskDay').value = state.cur.task;

  const t = state.cur.task != null ? state.tasks[state.cur.task] : null;
  $('taskEmpty').hidden = !!t;
  $('taskWrap').hidden = !t;
  if (!t) return;
  const day = state.cur.task;
  $('timerMeta').textContent = `Day ${day}`;
  timerSetup(day, false); // no-op nếu cùng day; xác nhận đã do caller xử lý

  const body = $('taskBody');
  if (t.type === 'html') {
    body.innerHTML = '<p class="meta" style="margin-bottom:12px">Task dạng .html — xem nguyên bản bên dưới (không có checklist tự động).</p>';
    const f = document.createElement('iframe');
    f.style.cssText = 'width:100%;height:70vh;border:1px solid var(--border);border-radius:12px;background:#fff';
    f.sandbox = ''; f.srcdoc = t.content;
    body.appendChild(f);
  } else {
    body.innerHTML = mdToHtml(t.content);
    const cks = state.checks[day] || [];
    body.querySelectorAll('input[data-ck]').forEach((inp) => {
      const k = +inp.dataset.ck;
      if (cks[k]) { inp.checked = true; inp.closest('.ck')?.classList.add('done'); }
    });
  }

  // panel tiến độ ở rail: thanh + các mục còn lại + nút sang báo cáo
  const [dn, tot] = ckPair(day);
  const undone = ckItems(day).filter((it) => !it.done);
  $('railMeta').textContent = tot ? `${dn}/${tot}` : '';
  $('railProg').innerHTML = bar(dn, tot)
    + (tot
      ? (undone.length
        ? `<ul class="ov-list">${undone.slice(0, 6).map((it) => `<li>${esc(it.text)}</li>`).join('')}</ul>`
          + (undone.length > 6 ? `<p class="meta" style="margin-top:8px">Còn ${undone.length - 6} mục nữa trong checklist.</p>` : '')
        : '<p class="meta">Checklist đã xong hết cho day này.</p>')
      : '<p class="meta">Task này không có checklist tự động.</p>')
    + `<div class="btnrow"><button class="btn" data-open-report="${day}">Viết báo cáo</button></div>`
    + `<p class="meta" style="margin-top:10px">Dừng cứng ${esc(timer.sched.at(-1).time)} — dừng cả giữa câu.</p>`;
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
    timer.logged = true; save(); renderDash();
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
function pickReportDay() {
  const days = taskDays();
  if (!state.tasks[state.cur.report]) {
    state.cur.report = days.filter((d) => !state.reports[d]).at(-1) ?? days.at(-1) ?? null;
    repLoadedDay = null;
  }
  return state.cur.report;
}
function renderReport() {
  const days = taskDays();
  $('repDay').innerHTML = days.map((d) => `<option value="${d}">Day ${d}</option>`).join('') || '<option value="">—</option>';
  const day = pickReportDay();
  if (day != null) $('repDay').value = day;
  if (day == null) { $('repPrev').innerHTML = '<p class="meta">Chưa có day nào có task.</p>'; return; }
  if (repLoadedDay !== day) {
    repLoadedDay = day;
    const r = state.reports[day];
    $('repText').value = r ? r.md : reportTemplate(day);
    const info = $('repSavedInfo');
    info.textContent = r ? `Đã lưu ${r.date} ${r.at || ''}. Tải lại file để gửi bạn bạn.` : '';
  }
  $('repPrev').innerHTML = mdToHtml($('repText').value);
}
function saveDraft() {
  const day = state.cur.report; if (day == null) return;
  state.reports[day] = { md: $('repText').value, date: today(), at: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }), ts: Date.now() };
  save(); renderDash();
  $('repSavedInfo').textContent = `Đã lưu ${state.reports[day].date} ${state.reports[day].at}`;
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
  let first = null;
  for (const f of files) {
    const text = await f.text();
    const isHtml = /\.html?$/i.test(f.name) || /^\s*<(!doctype|html)/i.test(text);
    const md = isHtml ? htmlToMd(text) : text; // task .html cũng đọc được: chuyển về md để có checklist + timer
    const m = f.name.match(/day\s*(\d+)/i) || f.name.match(/(\d+)/);
    const day = m ? +m[1] : nextDay();
    if (state.tasks[day] && state.tasks[day].content !== md && !confirm(`Day ${day} đã có task. Ghi đè?`)) continue;
    if (state.tasks[day]?.content !== md) delete state.checks[day]; // task mới → checklist cũ không còn đúng
    state.tasks[day] = { type: 'md', content: md, addedAt: Date.now() };
    if (!first) first = day;
  }
  resetTimerRun(); timer.day = null; // task có thể đổi → buộc dựng lại lịch timer
  save(); renderAll();
  if (first != null) { toast(`Đã nhận task Day ${first}`); openTask(first); }
}
function openTask(day) {
  if (!timerSetup(day, true)) return;
  state.cur.task = day; save(); switchTab('task');
}
function openReport(day) {
  state.cur.report = day; repLoadedDay = null; save(); switchTab('report');
}

/* ---------------- wiring ---------------- */
function renderAll() {
  renderDash(); renderTask(); renderReport();
  const n = taskDays().filter((d) => state.reports[d]).length;
  $('allRepCount').textContent = n ? `${n} day đã có báo cáo trong app.` : 'Chưa day nào có báo cáo.';
}
function init() {
  // điều hướng: mọi [data-tab] (sidebar, footnote), [data-open] → task, [data-open-report] → báo cáo
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { e.preventDefault(); switchTab(tab.dataset.tab); return; }
    const op = e.target.closest('[data-open]');
    if (op) { openTask(+op.dataset.open); return; }
    const orp = e.target.closest('[data-open-report]');
    if (orp) { openReport(+orp.dataset.openReport); return; }
  });
  $('menuBtn').onclick = () => $('sidebar').classList.add('open');
  $('menuClose').onclick = () => $('sidebar').classList.remove('open');

  // dashboard — nhận file task (nút + kéo thả toàn trang)
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = (e) => { handleFiles([...e.target.files]); e.target.value = ''; };
  document.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault(); handleFiles([...e.dataTransfer.files]);
  });
  $('backupOut').onclick = () => download('ghostproject-backup.json', JSON.stringify(state, null, 2), 'application/json');
  $('backupIn').onclick = () => $('backupFile').click();
  $('backupFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || typeof data.tasks !== 'object') throw new Error('bad');
      if (!confirm('Nhập backup sẽ thay thế toàn bộ dữ liệu hiện tại. Tiếp tục?')) return;
      state = { ...defaultState(), ...data }; repLoadedDay = null; resetTimerRun(); timer.day = null;
      save(); renderAll(); toast('Đã nhập backup');
    } catch { alert('File backup không hợp lệ.'); }
    e.target.value = '';
  };
  $('resetAll').onclick = () => {
    if (!confirm('Xoá TOÀN BỘ task, báo cáo, tiến độ của GhostProject? Không hoàn tác được.')) return;
    state = defaultState(); repLoadedDay = null; resetTimerRun(); timer.day = null;
    save(); renderAll(); toast('Đã xoá hết');
  };
  $('dlAllReports').onclick = () => {
    const days = taskDays().filter((d) => state.reports[d]);
    if (!days.length) { toast('Chưa có báo cáo nào'); return; }
    const md = days.map((d) => state.reports[d].md).join('\n\n---\n\n');
    download(`baocao-day${days[0]}-den-day${days.at(-1)}.md`, md);
    toast(`Đã tải ${days.length} báo cáo gộp một file`);
  };

  // đồng bộ S3
  const s3Map = { s3Endpoint: 'endpoint', s3Region: 'region', s3Bucket: 'bucket', s3Ak: 'ak', s3Sk: 'sk' };
  for (const [id, k] of Object.entries(s3Map)) {
    const inp = $(id);
    inp.value = s3cfg()[k] || '';
    inp.addEventListener('input', () => {
      state.s3 = { ...s3cfg(), [k]: inp.value.trim() };
      save(); setSyncStatus('Đã lưu thông tin — bấm "Đồng bộ ngay" để chạy');
    });
  }
  $('btnSyncNow').onclick = () => syncNow(true);
  setSyncStatus(s3cfg().lastSync ? 'Lần đồng bộ cuối: ' + new Date(s3cfg().lastSync).toLocaleString('vi-VN') : 'Chưa đồng bộ lần nào');

  // task
  $('taskDay').onchange = (e) => {
    const d = +e.target.value;
    if (!timerSetup(d, true)) { e.target.value = state.cur.task; return; }
    state.cur.task = d; save(); renderAll();
  };
  $('taskBody').addEventListener('change', (e) => {
    const k = e.target.dataset.ck; if (k === undefined) return;
    const arr = state.checks[state.cur.task] || (state.checks[state.cur.task] = []);
    arr[+k] = e.target.checked;
    e.target.closest('.ck')?.classList.toggle('done', e.target.checked);
    save(); renderDash();
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
      timer.logged = true; save(); renderDash();
      toast(`Đã ghi ${mins} phút cho Day ${timer.day}`);
    } else toast('Chưa đủ 1 phút để ghi');
    renderTimer();
  };

  // report
  $('repDay').onchange = (e) => { state.cur.report = +e.target.value; repLoadedDay = null; save(); renderReport(); };
  let deb;
  $('repText').addEventListener('input', () => {
    clearTimeout(deb); deb = setTimeout(() => { $('repPrev').innerHTML = mdToHtml($('repText').value); }, 250);
  });
  $('btnRefill').onclick = () => { $('repText').value = reportTemplate(state.cur.report); $('repPrev').innerHTML = mdToHtml($('repText').value); toast('Đã điền lại từ checklist + timer'); };
  $('btnSaveDraft').onclick = () => { saveDraft(); toast('Đã lưu nháp'); };
  $('btnCopy').onclick = () => copyText($('repText').value);
  $('btnDlMd').onclick = () => {
    if (state.cur.report == null) return;
    saveDraft(); download(`baocaoday${state.cur.report}.md`, $('repText').value);
    toast(`Đã tải baocaoday${state.cur.report}.md`);
  };
  $('btnDlHtml').onclick = () => {
    if (state.cur.report == null) return;
    saveDraft(); download(`baocaoday${state.cur.report}.html`, reportHtmlExport(state.cur.report, $('repText').value), 'text/html');
    toast(`Đã tải baocaoday${state.cur.report}.html`);
  };

  // create
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
    toast(`Đã tải taskday${n}.md — gửi cho người học`);
  };
  $('btnCrSave').onclick = () => {
    const n = Math.max(1, +$('crDay').value || 1);
    state.tasks[n] = { type: 'md', content: $('crText').value, addedAt: Date.now() };
    delete state.checks[n]; save(); renderAll(); toast(`Đã lưu Day ${n} vào app`);
  };
  function renderCrPrev() { $('crPrev').innerHTML = mdToHtml($('crText').value); }
  renderCrPrev();

  // cập nhật vị trí "bây giờ" trên dải buổi tối mỗi 30 giây
  setInterval(() => {
    if ($('tab-dash')?.classList.contains('active')) renderDash();
  }, 30000);

  const startHash = location.hash.startsWith('#tab-') && ['dash', 'task', 'report', 'create', 'settings'].includes(location.hash.slice(5)) ? location.hash.slice(5) : 'dash';
  switchTab(startHash);
  window.addEventListener('hashchange', () => { // deep-link: /#tab-task mở thẳng màn Task
    const t = location.hash.startsWith('#tab-') ? location.hash.slice(5) : 'dash';
    if (['dash', 'task', 'report', 'create', 'settings'].includes(t)) switchTab(t);
  });

  // có cấu hình S3 thì kéo dữ liệu từ bucket về khi mở trang
  if (s3cfg().bucket && s3cfg().ak && s3cfg().sk) syncNow(false);
}
init();
