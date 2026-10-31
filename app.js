'use strict';
/* GhostProject — self-study tracker. Static site, dữ liệu ở localStorage + Turso (SQLite qua HTTP).
   Flow: bạn bạn gửi file (.md/.html + css/ảnh) → "Mở file" xem trước, ghép CSS → học trên trang đề,
   viết báo cáo trên trang vở (tự lưu bản nháp) → "Nộp bài" thành phiên bản mới, "Tạo file .md" gửi lại.
   Mỗi day có tiêu đề bắt buộc; một day giữ được nhiều file task; task .html chạy trong iframe sandbox. */

const $ = (id) => document.getElementById(id);
const KEY = 'ghostproject_v1';
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const today = () => iso(new Date());
const nowHM = () => new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

/* ---------------- state ----------------
   days:   { [day]: { title, updatedAt } }              — tiêu đề bắt buộc của từng day
   tasks:  { [day]: [ { name, type:'md'|'html', src, html, addedAt } ] }  — nhiều file/day;
             src = nội dung gốc, html = bản .html đã nhúng CSS (type html)
   checks: { [day]: { [taskIdx]: [bool,…] } }           — checklist theo từng file
   reports:{ [day]: { subs:[{v,md,ts,date,at}], draft:{md,savedAt}|null } } — nộp nhiều phiên bản,
             nháp tách riêng, không bao giờ đè bài đã nộp */
function defaultState() {
  return {
    days: {}, tasks: {}, checks: {}, reports: {},
    settings: { split: 58, panes: 'both' },
    turso: { url: '', token: '', lastSync: '' },
  };
}
/* dữ liệu từ các phiên bản cũ → hình dạng mới (thuần, dùng được ở cả test) */
function migrateState(s) {
  const st = {
    ...defaultState(), ...s,
    turso: { ...defaultState().turso, ...(s.turso || {}) },
    settings: { ...defaultState().settings, ...(s.settings || {}) },
  };
  st.settings.split = Math.min(78, Math.max(24, +st.settings.split || 58));
  if (!['both', 'left', 'right'].includes(st.settings.panes)) st.settings.panes = 'both';
  const tasks = {};
  for (const [d, t] of Object.entries(st.tasks || {})) {
    if (Array.isArray(t)) tasks[d] = t;
    else if (typeof t === 'string') tasks[d] = [{ name: 'task.md', type: 'md', src: t, html: null, addedAt: 0 }];
    else if (t && typeof t === 'object') tasks[d] = [{ name: 'task.md', type: t.type || 'md', src: t.content ?? t.src ?? '', html: t.html || null, addedAt: t.addedAt || 0 }];
  }
  st.tasks = tasks;
  const checks = {};
  for (const [d, c] of Object.entries(st.checks || {})) {
    if (c && typeof c === 'object' && !Array.isArray(c)) checks[d] = c;
    else if (Array.isArray(c)) checks[d] = { 0: c };
  }
  st.checks = checks;
  const reports = {};
  for (const [d, r] of Object.entries(st.reports || {})) {
    if (r && Array.isArray(r.subs)) reports[d] = r;
    else if (r && typeof r === 'object' && r.md != null) reports[d] = { subs: [{ v: 1, md: r.md, ts: r.ts || 0, date: r.date || '', at: r.at || '' }], draft: r.draft || null };
    else if (typeof r === 'string') reports[d] = { subs: [{ v: 1, md: r, ts: 0, date: '', at: '' }], draft: null };
  }
  st.reports = reports;
  st.days ||= {};
  return st;
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return migrateState(JSON.parse(raw));
  } catch { return null; }
}
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

let state = load();
if (!state) { state = defaultState(); save(); }

const taskDays = () => Object.keys(state.tasks).map(Number).sort((a, b) => a - b);
const nextDay = () => (taskDays().at(-1) || 0) + 1;
function dayTitle(day) {
  const t = state.days[day]?.title;
  if (t) return t;
  const first = (state.tasks[day] || []).find((x) => x.type === 'md');
  const m = first && first.src.match(/^#\s*(.+)$/m);
  return m ? m[1].replace(/\*\*/g, '').trim() : `Day ${day}`;
}
/* checklist tính gộp theo từng file .md trong day */
function ckPair(day) {
  let done = 0, total = 0;
  (state.tasks[day] || []).forEach((t, ti) => {
    if (t.type !== 'md') return;
    const n = (t.src.match(/^- \[( |x|X)\]/gm) || []).length;
    const arr = state.checks[day]?.[ti] || [];
    let d = 0;
    for (let i = 0; i < Math.max(n, arr.length); i++) if (arr[i]) d++;
    done += d; total += Math.max(n, arr.length);
  });
  return [done, total];
}

/* ---------------- markdown renderer (small, offline) ---------------- */
function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(>])\*([^*\n]+)\*(?=[\s).,;:!?)<]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function splitRow(r) {
  return r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}
/* HTML → md: đọc lại task/báo cáo dạng .html để checklist hoạt động như .md */
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
        if (items.length) out.push(items.join('\n'));
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
    // md '# ' là tiêu đề tài liệu trong app → h2.doc-title (chỉ screen-title được làm h1)
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
  document.querySelectorAll('.screen-title').forEach((t) => retag(t, t.dataset.screen === name ? 'H1' : 'H2'));
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

/* ---------------- import: ghép CSS + ảnh vào task .html trước khi nhận ----------------
   CSS nhúng thật: <link> → <style>, @import nội bộ giải theo file đã chọn, url(…) ảnh/font
   thành data URI. Thiếu file nào thì cảnh báo + có ô dán CSS thủ công. Không chạy script. */
const RES_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
};
const tailOf = (p) => {
  const s = String(p || '').split(/[?#]/)[0].split(/[\\/]/).filter(Boolean);
  return s.length ? s[s.length - 1].toLowerCase() : '';
};
/* ghép đường dẫn tương đối với file đã chọn: khớp theo đuôi đường dẫn dài nhất */
function refMatch(ref, files) {
  const clean = (p) => String(p || '').split(/[?#]/)[0].replace(/\\/g, '/').split('/').filter((x) => x && x !== '.' && x !== '..');
  const refSegs = clean(ref).map((x) => x.toLowerCase());
  if (!refSegs.length) return null;
  let best = null, bestLen = 0;
  for (const f of files) {
    const fSegs = clean(f.name).map((x) => x.toLowerCase());
    let k = 0; const n = Math.min(refSegs.length, fSegs.length);
    while (k < n && fSegs[fSegs.length - 1 - k] === refSegs[refSegs.length - 1 - k]) k++;
    if (k > bestLen) { best = f; bestLen = k; }
  }
  return bestLen ? best : null;
}
function embedCss(cssText, cssName, files, warns, depth = 0) {
  if (depth > 4) { warns.push(`${cssName}: CSS lồng nhau quá sâu — bỏ qua phần @import`); return cssText; }
  cssText = cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) => {
    if (/^(data:|https?:|blob:|#)/i.test(u)) return m;
    const f = refMatch(u, files);
    if (!f || !f.dataUrl) { warns.push(`${cssName}: không tìm thấy ${u} — giữ nguyên đường dẫn`); return m; }
    return 'url("' + f.dataUrl + '")';
  });
  cssText = cssText.replace(/@import\s+(?:url\(\s*)?(['"]?)([^'")\s]+)\1(?:\s*\))?\s*[^;]*;/g, (m, q, u) => {
    if (/^(https?:)?\/\//i.test(u)) { warns.push(`${cssName}: CSS ngoài ${u} — iframe cần mạng mới tải được`); return m; }
    const f = refMatch(u, files.filter((x) => x.text != null));
    if (!f) { warns.push(`${cssName}: không tìm thấy CSS ${u} — dán thủ công bên dưới`); return m; }
    return embedCss(f.text, f.name, files, warns, depth + 1);
  });
  return cssText;
}
function processHtml(src, name, files, warns) {
  const doc = new DOMParser().parseFromString(src, 'text/html');
  doc.querySelectorAll('script').forEach((s) => s.remove()); // sandbox cũng chặn, xoá cho sạch
  const cssFiles = files.filter((x) => x.text != null && /\.css$/i.test(x.name));
  const missing = [];
  let cssOk = 0, cssMissing = 0, imgMissing = 0;
  doc.querySelectorAll('link[href]').forEach((ln) => {
    const rel = (ln.getAttribute('rel') || '').toLowerCase();
    const href = ln.getAttribute('href') || '';
    if (!rel.includes('stylesheet')) return;
    if (/^(https?:)?\/\//i.test(href) || /^data:/i.test(href)) { warns.push(`${name}: stylesheet ngoài ${href} — iframe cần mạng mới tải được`); return; }
    const f = refMatch(href, cssFiles);
    if (!f) {
      warns.push(`${name}: không tìm thấy ${href} trong các file đã chọn — dán CSS thủ công bên dưới`);
      const k = tailOf(href);
      ln.dataset.missingCss = k; missing.push(k); cssMissing++;
      return;
    }
    const w = [];
    const css = embedCss(f.text, f.name, files, w);
    w.forEach((x) => warns.push(`${f.name}: ${x}`));
    const st = doc.createElement('style');
    st.textContent = css;
    ln.replaceWith(st); cssOk++;
  });
  doc.querySelectorAll('style').forEach((st) => { st.textContent = embedCss(st.textContent || '', name, files, warns); });
  doc.querySelectorAll('img[src], source[src]').forEach((el) => {
    const u = el.getAttribute('src') || '';
    if (/^(data:|https?:)/i.test(u)) return;
    const f = refMatch(u, files);
    if (f && f.dataUrl) el.setAttribute('src', f.dataUrl);
    else { warns.push(`${name}: không tìm thấy ảnh ${u} — ảnh sẽ trống`); imgMissing++; }
  });
  return { html: '<!doctype html>\n' + doc.documentElement.outerHTML, warns, missing, stats: { cssOk, cssMissing, imgMissing } };
}
/* ảnh trong .md: nhúng data URI, giữ nguyên đường dẫn nếu thiếu file (nguồn gốc vẫn lưu ở src) */
function inlineMdAssets(src, name, files, warns) {
  return String(src).replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, u) => {
    if (/^(data:|https?:)/i.test(u)) return m;
    const f = refMatch(u, files);
    if (f && f.dataUrl) return `![${alt}](${f.dataUrl})`;
    warns.push(`${name}: không tìm thấy ảnh ${u} — ảnh sẽ trống`);
    return m;
  });
}
/* lần nhận cuối: dán CSS thủ công vào các link còn thiếu */
function applyManualCss(html, manual) {
  if (!html || !manual || !Object.keys(manual).length) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let filled = false;
  doc.querySelectorAll('link[data-missing-css]').forEach((ln) => {
    const k = ln.dataset.missingCss;
    const css = manual[k] || manual[tailOf(k)];
    if (css && css.trim()) {
      const st = doc.createElement('style'); st.textContent = css;
      ln.replaceWith(st); filled = true;
    }
  });
  return filled ? '<!doctype html>\n' + doc.documentElement.outerHTML : html;
}
const fileDataUrl = (f) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(new Error('Không đọc được ' + f.name));
  r.readAsDataURL(f);
});

/* ---------------- nhận file: xem trước rồi mới nhận ----------------
   Lô file = task .md/.html + css/ảnh đi kèm (vào cùng một Day, tiêu đề chỉ hỏi một lần)
   + file báo cáo nhận diện theo dòng đầu "# Báo cáo Day N". */
let staged = null;
async function stageFiles(files) {
  staged = await prepareImport(files);
  renderStage();
  $('importModal').hidden = false;
}
async function prepareImport(list) {
  const out = { files: [], tasks: [], reports: [], warns: [], manual: {}, title: '', day: null, dayHint: null,
    stats: { html: 0, cssOk: 0, cssMissing: 0, imgMissing: 0 } };
  for (const f of list) {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    const isText = ['md', 'markdown', 'txt', 'html', 'htm', 'css'].includes(ext);
    if (!(isText || RES_MIME[ext])) { out.warns.push(`Bỏ qua file lạ: ${f.name}`); continue; }
    const rec = { name: f.name, text: null, dataUrl: null };
    if (isText) rec.text = await f.text();
    else rec.dataUrl = await fileDataUrl(f);
    out.files.push(rec);
    if (!isText || ext === 'css') continue; // css/asset chỉ là nguyên liệu ghép
    if (ext === 'html' || ext === 'htm') out.tasks.push({ name: f.name, type: 'html', src: rec.text, html: null, warnings: [] });
    else {
      const rep = rec.text.match(/^#\s*Báo cáo\s*Day\s*(\d+)/m);
      if (rep) out.reports.push({ name: f.name, md: rec.text, day: +rep[1], warnings: [] });
      else {
        const m = f.name.match(/day\s*(\d+)/i) || f.name.match(/(\d+)/);
        out.tasks.push({ name: f.name, type: 'md', src: rec.text, html: null, day: m ? +m[1] : null, warnings: [] });
      }
    }
  }
  const hintDays = [...new Set(out.tasks.map((t) => t.day).filter((x) => x != null))];
  out.day = hintDays.length === 1 ? hintDays[0] : nextDay();
  if (hintDays.length > 1) out.dayHint = out.tasks.filter((t) => t.day != null).map((t) => t.name).join(', ');
  for (const t of out.tasks) {
    if (t.type !== 'html') {
      t.md = inlineMdAssets(t.src, t.name, out.files, t.warnings);
      out.stats.imgMissing += t.warnings.filter((w) => /không tìm thấy ảnh/.test(w)).length;
      continue;
    }
    const r = processHtml(t.src, t.name, out.files, t.warnings);
    t.html = r.html; t.missing = r.missing;
    out.stats.html++; out.stats.cssOk += r.stats.cssOk;
    out.stats.cssMissing += r.stats.cssMissing; out.stats.imgMissing += r.stats.imgMissing;
  }
  // day đã có → dùng lại tiêu đề của nó (vẫn sửa được, không xoá task/bài nộp cũ)
  out.title = state.days[out.day]?.title || '';
  if (out.files.some((x) => /\.css$/i.test(x.name)) && !out.tasks.some((t) => t.type === 'html')) {
    out.warns.push('Có file CSS nhưng không có file HTML nào trong lô — CSS chỉ ghép với task .html.');
  }
  return out;
}
function existingTasks(day) { return state.tasks[day] || []; }
function stageBadges() {
  const cur = existingTasks(staged.day);
  if (!cur.length) return '';
  const names = new Set(cur.map((t) => t.name));
  const willReplace = staged.tasks.filter((t) => names.has(t.name)).length;
  const willAdd = staged.tasks.length - willReplace;
  return `Day ${staged.day} đã có ${cur.length} file — `
    + [willAdd ? `thêm ${willAdd} file mới` : '', willReplace ? `thay ${willReplace} file trùng tên` : ''].filter(Boolean).join(', ')
    + ' (checklist và bài nộp cũ giữ nguyên)';
}
function renderStage() {
  const s = staged;
  $('stageDay').value = s.day;
  $('stageName').value = s.title;
  $('stageTitleErr').hidden = true; // chỉ hiện sau khi người dùng gõ rồi xoá trắng
  $('btnStageAccept').disabled = !s.title.trim();

  const nT = s.tasks.length, nR = s.reports.length;
  const ow = stageBadges();
  const owEl = $('stageOverwrite');
  owEl.hidden = !ow; if (ow) owEl.textContent = ow;
  const st = s.stats || {};
  $('stageNote').textContent =
    (nT + nR ? `${nT ? nT + ' file task' : ''}${nT && nR ? ' · ' : ''}${nR ? nR + ' file báo cáo' : ''}` : 'Không có file task/báo cáo nào trong lô.')
    + (st.html ? ` · ${st.html} file HTML` : '')
    + (st.cssOk ? ` · nhúng ${st.cssOk} stylesheet` : '')
    + (st.cssMissing ? ` · thiếu ${st.cssMissing} stylesheet` : '')
    + (st.imgMissing ? ` · thiếu ${st.imgMissing} ảnh` : '')
    + (s.dayHint ? ` — các file trỏ tới Day khác nhau (${s.dayHint}); cả lô task sẽ vào một Day, sửa ô Day nếu cần.` : '')
    + (s.warns.length ? ` — ${s.warns.length} cảnh báo: xem ghi chú tại từng file.` : '');

  const rows = [];
  for (const t of s.tasks) {
    const badge = t.type === 'html' ? 'Task .html' : 'Task .md';
    const warn = t.warnings.length ? `<div>${t.warnings.map((w) => `<p class="field-err">${esc(w)}</p>`).join('')}</div>` : '';
    rows.push(`<div class="stage-file"><div class="stage-head"><span class="name">${esc(t.name)}</span><span class="pill">${badge}</span></div>${warn}<div class="stage-prev" data-prev-t="${rows.length}"></div></div>`);
  }
  for (const r of s.reports) {
    const has = !!state.reports[r.day]?.subs?.length;
    const pill = has ? `<span class="pill">Báo cáo Day ${r.day} đã có — chỉ xem</span>` : `<span class="pill pos">Báo cáo Day ${r.day} — sẽ lưu</span>`;
    rows.push(`<div class="stage-file"><div class="stage-head"><span class="name">${esc(r.name)}</span>${pill}</div><div class="md stage-prev" data-prev-r="${rows.length - nT}"></div></div>`);
  }
  $('stageList').innerHTML = rows.join('');

  // preview: task .md + báo cáo render thẳng; task .html → iframe sandbox (dựng bằng DOM cho khỏi lo escape)
  $('stageList').querySelectorAll('[data-prev-t]').forEach((holder) => {
    const t = s.tasks[+holder.dataset.prevT];
    if (!t) return;
    if (t.type === 'html') {
      const f = document.createElement('iframe');
      f.className = 'stage-frame';
      f.sandbox = ''; f.title = 'Xem trước ' + t.name; f.srcdoc = t.html || t.src;
      holder.replaceWith(f);
    } else {
      holder.classList.add('md');
      holder.innerHTML = mdToHtml(t.md || t.src);
    }
  });
  $('stageList').querySelectorAll('[data-prev-r]').forEach((holder) => {
    const r = s.reports[+holder.dataset.prevR];
    if (r) holder.innerHTML = mdToHtml(r.md);
  });

  // dán CSS thủ công cho link thiếu (không tìm thấy trong các file đã chọn)
  const keys = [...new Set(s.tasks.flatMap((t) => t.missing || []))];
  $('stageCss').innerHTML = keys.map((k) =>
    `<div class="mcss"><label>CSS thủ công cho «${esc(k)}»</label><textarea data-mcss="${esc(k)}" spellcheck="false" placeholder="Dán toàn bộ nội dung file ${esc(k)} vào đây"></textarea></div>`).join('');
  $('stageCss').querySelectorAll('textarea[data-mcss]').forEach((ta) => {
    ta.value = s.manual[ta.dataset.mcss] || '';
  });
}
function acceptStaged() {
  if (!staged) return;
  const title = staged.title.trim();
  if (!title) { renderStage(); return; }
  flushDraft(); // chữ đang viết ở day cũ chưa qua 900ms
  const day = Math.max(1, +staged.day || nextDay());
  let nTask = 0, nAdd = 0, nReplace = 0;
  if (staged.tasks.length) {
    const next = existingTasks(day).slice();
    for (const t of staged.tasks) {
      if (t.type === 'html') t.html = applyManualCss(t.html, staged.manual);
      const rec = { name: t.name, type: t.type, src: t.src, md: t.md || null, html: t.html || null, warns: t.warnings || [], addedAt: Date.now() };
      const i = next.findIndex((x) => x.name === t.name);
      if (i >= 0) { rec.addedAt = next[i].addedAt || rec.addedAt; next[i] = rec; nReplace++; } // thay đúng file trùng tên
      else { next.push(rec); nAdd++; }
    }
    state.tasks[day] = next;
    state.days[day] = { title, updatedAt: Date.now() }; // đổi tiêu đề không xoá task/bài nộp
    nTask = staged.tasks.length;
    bg(() => pushDay(day)); bg(() => pushTaskFiles(day));
  }
  const repDays = [];
  for (const r of staged.reports) {
    const R = state.reports[r.day] ||= { subs: [], draft: null };
    if (!R.subs.length) { // không đè bài đã nộp
      const dm = r.md.match(/^-\s*Ngày:\s*(\d{4}-\d{2}-\d{2})/m);
      R.subs.push({ v: 1, md: r.md, ts: Date.now(), date: dm ? dm[1] : today(), at: nowHM() });
      repDays.push(r.day); bg(() => pushSub(r.day, R.subs[0]));
    }
  }
  staged = null;
  $('importModal').hidden = true;
  pickDay = nTask ? day : null; repLoadedDay = null; view.tIdx = 0;
  save(); renderAll();
  toast(nTask
    ? `Day ${day}: ${nAdd ? `thêm ${nAdd} file` : ''}${nAdd && nReplace ? ', ' : ''}${nReplace ? `thay ${nReplace} file` : ''} — ${title}`
    : repDays.length ? `Đã lưu báo cáo Day ${repDays.join(', ')}` : 'Không có gì mới để nhận');
}

/* ---------------- Turso — SQLite qua HTTP (v2/pipeline) ---------------- */
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
const qn = () => ({ type: 'null' });
function tsqlRows(result) {
  if (!result || !result.rows) return [];
  return result.rows.map((row) => Object.fromEntries((result.cols || []).map((c, i) => {
    const v = row[i] || { type: 'null' };
    return [c.name, v.type === 'integer' || v.type === 'float' ? Number(v.value) : v.type === 'null' ? null : v.value];
  })));
}
async function tursoBootstrap() {
  await tsql('CREATE TABLE IF NOT EXISTS days (day INTEGER PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  await tsql('CREATE TABLE IF NOT EXISTS taskfiles (day INTEGER NOT NULL, idx INTEGER NOT NULL, name TEXT, type TEXT, src TEXT NOT NULL, html TEXT, md TEXT, warns TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (day, idx))');
  await tsql('CREATE TABLE IF NOT EXISTS drafts (day INTEGER PRIMARY KEY, content TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  const names = tsqlRows(await tsql("SELECT name FROM sqlite_master WHERE type='table'")).map((x) => x.name);
  if (!names.includes('reports')) await tsql('CREATE TABLE reports (day INTEGER NOT NULL, v INTEGER NOT NULL, md TEXT NOT NULL, ts INTEGER NOT NULL, date TEXT, at TEXT, PRIMARY KEY (day, v))');
  if (!names.includes('checks')) await tsql('CREATE TABLE checks (day INTEGER NOT NULL, task INTEGER NOT NULL, idx INTEGER NOT NULL, done INTEGER NOT NULL, PRIMARY KEY (day, task, idx))');
  /* --- schema cũ → mới --- */
  let hasTfMd = false;
  try { await tsql('SELECT md, warns FROM taskfiles LIMIT 1'); hasTfMd = true; } catch { /* bảng cũ thiếu cột */ }
  if (!hasTfMd) {
    try { await tsql('ALTER TABLE taskfiles ADD COLUMN md TEXT'); } catch { /* đã có */ }
    try { await tsql('ALTER TABLE taskfiles ADD COLUMN warns TEXT'); } catch { /* đã có */ }
  }
  if (names.includes('tasks')) { // 1 task/day → taskfiles
    const old = tsqlRows(await tsql('SELECT day, content, updated_at FROM tasks'));
    await tsql('DROP TABLE tasks');
    for (const x of old) {
      await tsql('INSERT OR IGNORE INTO taskfiles (day, idx, name, type, src, html, md, warns, updated_at) VALUES (?, 0, ?, ?, ?, NULL, NULL, ?, ?)',
        [qi(x.day), qs('task.md'), qs('md'), qs(x.content), qs('[]'), qi(x.updated_at)]);
      await tsql('INSERT OR IGNORE INTO days (day, title, updated_at) VALUES (?, ?, ?)', [qi(x.day), qs('Day ' + x.day), qi(x.updated_at)]);
    }
  }
  let hasV = false;
  try { await tsql('SELECT v FROM reports LIMIT 1'); hasV = true; } catch { /* bảng schema cũ */ }
  if (!hasV) {
    const old = tsqlRows(await tsql('SELECT day, content, updated_at FROM reports'));
    await tsql('DROP TABLE reports');
    await tsql('CREATE TABLE reports (day INTEGER NOT NULL, v INTEGER NOT NULL, md TEXT NOT NULL, ts INTEGER NOT NULL, date TEXT, at TEXT, PRIMARY KEY (day, v))');
    for (const x of old) await tsql('INSERT OR IGNORE INTO reports (day, v, md, ts, date, at) VALUES (?, 1, ?, ?, ?, ?)',
      [qi(x.day), qs(x.content), qi(x.updated_at), qs(iso(new Date(x.updated_at))), qs('')]);
  }
  let hasTask = false;
  try { await tsql('SELECT task FROM checks LIMIT 1'); hasTask = true; } catch { /* bảng schema cũ */ }
  if (!hasTask) {
    const old = tsqlRows(await tsql('SELECT day, idx, done FROM checks'));
    await tsql('DROP TABLE checks');
    await tsql('CREATE TABLE checks (day INTEGER NOT NULL, task INTEGER NOT NULL, idx INTEGER NOT NULL, done INTEGER NOT NULL, PRIMARY KEY (day, task, idx))');
    for (const x of old) await tsql('INSERT OR IGNORE INTO checks (day, task, idx, done) VALUES (?, 0, ?, ?)', [qi(x.day), qi(x.idx), qi(x.done ? 1 : 0)]);
  }
}
const pushDay = (day) => {
  const d = state.days[day];
  return tsql('INSERT INTO days (day, title, updated_at) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at',
    [qi(day), qs(d.title), qi(d.updatedAt || Date.now())]);
};
const pushTaskFile = (day, idx, t) => tsql(
  'INSERT INTO taskfiles (day, idx, name, type, src, html, md, warns, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(day, idx) DO UPDATE SET name = excluded.name, type = excluded.type, src = excluded.src, html = excluded.html, md = excluded.md, warns = excluded.warns, updated_at = excluded.updated_at',
  [qi(day), qi(idx), qs(t.name || 'task.md'), qs(t.type || 'md'), qs(t.src), t.html ? qs(t.html) : qn(), t.md ? qs(t.md) : qn(), qs(JSON.stringify(t.warns || [])), qi(t.addedAt || Date.now())]);
const pushTaskFiles = async (day) => {
  await tsql('DELETE FROM taskfiles WHERE day = ?', [qi(day)]);
  const arr = state.tasks[day] || [];
  for (let i = 0; i < arr.length; i++) await pushTaskFile(day, i, arr[i]);
};
const pushSub = (day, s) => tsql(
  'INSERT INTO reports (day, v, md, ts, date, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(day, v) DO UPDATE SET md = excluded.md, ts = excluded.ts, date = excluded.date, at = excluded.at',
  [qi(day), qi(s.v), qs(s.md), qi(s.ts || Date.now()), qs(s.date || ''), qs(s.at || '')]);
const pushCheck = (day, task, idx, done) => tsql(
  'INSERT INTO checks (day, task, idx, done) VALUES (?, ?, ?, ?) ON CONFLICT(day, task, idx) DO UPDATE SET done = excluded.done',
  [qi(day), qi(task), qi(idx), qi(done ? 1 : 0)]);
const pushDraft = (day) => {
  const R = state.reports[day];
  if (!R?.draft) return Promise.resolve();
  return tsql('INSERT INTO drafts (day, content, updated_at) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at',
    [qi(day), qs(R.draft.md), qi(R.draft.savedAt || Date.now())]);
};
const clearDraftRemote = (day) => tsql('DELETE FROM drafts WHERE day = ?', [qi(day)]);

function setSyncStatus(msg) { const el = $('syncStatus'); if (el) el.textContent = msg; }
/* ghi nền: UI cập nhật local trước, lỗi chỉ hiện ở dòng trạng thái.
   Nhận thunk để chưa nối Turso thì không chạy gì (không tạo promise vô nghĩa). */
function bg(p) {
  const cfg = tursoCfg();
  if (!cfg.url || !cfg.token) return; // chế độ chỉ-trong-máy
  Promise.resolve(typeof p === 'function' ? p() : p)
    .then(() => setSyncStatus('Đã lưu Turso · ' + nowHM()))
    .catch((e) => setSyncStatus('Lỗi Turso: ' + e.message));
}

async function tursoPull() {
  const [d, tf, c, r, dr] = await Promise.all([
    tsql('SELECT day, title, updated_at FROM days'),
    tsql('SELECT day, idx, name, type, src, html, md, warns, updated_at FROM taskfiles'),
    tsql('SELECT day, task, idx, done FROM checks'),
    tsql('SELECT day, v, md, ts, date, at FROM reports'),
    tsql('SELECT day, content, updated_at FROM drafts'),
  ]);
  const days = {};
  for (const x of tsqlRows(d)) days[x.day] = { title: x.title, updatedAt: x.updated_at };
  const byDay = {};
  for (const x of tsqlRows(tf)) (byDay[x.day] ||= []).push(x);
  const tasks = {};
  for (const [k, arr] of Object.entries(byDay)) {
    tasks[k] = arr.sort((a, b) => a.idx - b.idx).map((x) => ({
      name: x.name || 'task.md', type: x.type || 'md', src: x.src || '', html: x.html || null, md: x.md || null,
      warns: (() => { try { return JSON.parse(x.warns || '[]'); } catch { return []; } })(),
      addedAt: x.updated_at,
    }));
  }
  const checks = {};
  for (const x of tsqlRows(c)) {
    const t = (checks[x.day] ||= {});
    (t[x.task] ||= [])[x.idx] = !!x.done;
  }
  const subsByDay = {};
  for (const x of tsqlRows(r)) {
    (subsByDay[x.day] ||= []).push({ v: x.v, md: x.md, ts: x.ts, date: x.date || iso(new Date(x.ts)), at: x.at || '' });
  }
  const reports = {};
  for (const [k, arr] of Object.entries(subsByDay)) {
    arr.sort((a, b) => a.v - b.v);
    const o = state.reports[k];
    reports[k] = { subs: o && (o.subs.at(-1)?.ts || 0) > (arr.at(-1)?.ts || 0) ? o.subs : arr, draft: null };
  }
  const drafts = {};
  for (const x of tsqlRows(dr)) drafts[x.day] = { md: x.content, savedAt: x.updated_at };
  /* gộp giữ bản mới hơn: day, task, bài nộp, nháp */
  for (const [k, nt] of Object.entries(days)) {
    const o = state.days[k];
    if (o && (o.updatedAt || 0) > (nt.updatedAt || 0)) days[k] = o;
  }
  for (const [k, arr] of Object.entries(tasks)) {
    const o = state.tasks[k];
    const stamp = (a) => Math.max(0, ...a.map((t) => t.addedAt || 0));
    if (o && stamp(o) > stamp(arr)) tasks[k] = o;
  }
  for (const [k, R] of Object.entries(reports)) {
    const o = state.reports[k];
    const cands = [o?.draft, drafts[k] ? { md: drafts[k].md, savedAt: drafts[k].savedAt } : null].filter(Boolean);
    R.draft = cands.sort((a, b) => b.savedAt - a.savedAt)[0] || null;
  }
  Object.assign(state, { days, tasks, checks, reports });
  save();
}
/* đẩy dữ liệu local lên (lần đầu kết nối / sau nhập backup) */
async function pushLocalNewer() {
  for (const d of Object.keys(state.days)) await pushDay(+d);
  for (const [d, arr] of Object.entries(state.tasks)) {
    for (let i = 0; i < arr.length; i++) await pushTaskFile(+d, i, arr[i]);
  }
  for (const [d, R] of Object.entries(state.reports)) {
    for (const s of R.subs) await pushSub(+d, s);
    if (R.draft) await pushDraft(+d);
  }
  for (const [d, tt] of Object.entries(state.checks)) {
    for (const [ti, arr] of Object.entries(tt)) {
      for (let i = 0; i < arr.length; i++) await pushCheck(+d, +ti, i, arr[i]);
    }
  }
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

/* ---------------- làm bài ---------------- */
let pickDay = null; // day đang mở; null = tự chọn day mới nhất chưa nộp
let repLoadedDay = null; // day đang nạp trong ô viết — đổi day mới nạp lại nội dung
const view = { tIdx: 0, mtab: 'task', scrolls: { task: 0, edit: 0 } };
function curDay() {
  const days = taskDays();
  if (!days.length) return null;
  if (pickDay != null && state.tasks[pickDay]?.length) return pickDay;
  pickDay = days.filter((d) => !state.reports[d]?.subs?.length).at(-1) ?? days.at(-1);
  return pickDay;
}
function calcStreak() {
  const dates = new Set();
  for (const R of Object.values(state.reports)) for (const s of R.subs || []) if (s.date) dates.add(s.date);
  const d = new Date();
  if (!dates.has(iso(d))) { d.setDate(d.getDate() - 1); if (!dates.has(iso(d))) return 0; }
  let n = 0;
  while (dates.has(iso(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function setSaveChip(txt, err) {
  const el = $('saveState'); if (!el) return;
  el.textContent = txt; el.classList.toggle('err', !!err);
}
function htmlTaskFrame(srcHtml) {
  const f = document.createElement('iframe');
  f.className = 'task-frame';
  f.setAttribute('sandbox', ''); // không script, không same-origin — đề chỉ cần hiển thị
  f.title = 'Nội dung task';
  f.srcdoc = srcHtml;
  return f;
}
function applyPanes() {
  const s = $('wsSplit'); if (!s) return;
  const mode = state.settings.panes || 'both';
  s.classList.toggle('panes-left', mode === 'left');
  s.classList.toggle('panes-right', mode === 'right');
  $('paneTask').classList.toggle('full', mode === 'left');
  $('paneEdit').classList.toggle('full', mode === 'right');
  $('restoreLeft').hidden = mode !== 'right';
  $('restoreRight').hidden = mode !== 'left';
  $('collapseLeft').hidden = mode !== 'both';
  $('collapseRight').hidden = mode !== 'both';
}
const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width:999px)').matches;
function applyMobileTab() {
  const s = $('wsSplit'), mt = $('mtabs');
  if (!s) return;
  const isN = narrow();
  mt.hidden = !isN;
  $('paneTask').classList.toggle('mobile-open', !isN || view.mtab === 'task');
  $('paneEdit').classList.toggle('mobile-open', !isN || view.mtab === 'edit');
  document.querySelectorAll('.mtab').forEach((b) => b.classList.toggle('on', b.dataset.pane === view.mtab));
  const pane = view.mtab === 'task' ? $('paneTask') : $('paneEdit');
  const sc = pane.querySelector('.pane-scroll');
  if (sc) sc.scrollTop = view.scrolls[view.mtab] || 0;
}
function renderWork() {
  const days = taskDays();
  const day = curDay();
  const split = $('wsSplit');
  const sel = $('dayPick');
  sel.innerHTML = days.length
    ? days.slice().reverse().map((d) => `<option value="${d}"${d === day ? ' selected' : ''}>Day ${d} — ${esc(dayTitle(d))}</option>`).join('')
    : '<option value="">—</option>';
  sel.disabled = !days.length;

  const streak = calcStreak();
  $('chipStreak').hidden = false;
  $('chipStreak').innerHTML = `Streak <b>${streak}</b> ngày`;

  if (!day) {
    $('wsTitle').textContent = 'Làm bài';
    $('wsName').textContent = '';
    $('chipCk').hidden = true; $('chipDone').hidden = true;
    split.hidden = true; $('wsEmpty').hidden = false;
    return;
  }
  $('wsEmpty').hidden = true;
  split.hidden = false;
  const R = state.reports[day] ||= { subs: [], draft: null };
  $('wsTitle').textContent = `Day ${day}`;
  $('wsName').textContent = dayTitle(day);
  const [dn, tot] = ckPair(day);
  const done = days.filter((d) => state.reports[d]?.subs?.length).length;
  $('chipCk').hidden = !tot;
  if (tot) $('chipCk').innerHTML = `Checklist <b>${dn}/${tot}</b>`;
  $('chipDone').hidden = false;
  $('chipDone').innerHTML = `<span><b>${done}</b>/${days.length} day nộp</span>`;

  /* trang đề */
  const list = state.tasks[day] || [];
  if (view.tIdx >= list.length) view.tIdx = 0;
  $('taskTabs').innerHTML = list.length > 1
    ? list.map((t, i) => `<button class="filetab${i === view.tIdx ? ' on' : ''}" data-tidx="${i}" type="button">${esc(t.name)}</button>`).join('')
    : '';
  const body = $('taskBody');
  body.innerHTML = '';
  const t = list[view.tIdx];
  if (t && t.type === 'html') {
    const wrap = document.createElement('div');
    wrap.className = 'frame-wrap';
    wrap.appendChild(htmlTaskFrame(t.html || t.src));
    body.appendChild(wrap);
  } else if (t) {
    body.innerHTML = `<div class="md">${mdToHtml(t.md || t.src)}</div>`;
  }
  const cks = (state.checks[day] || {})[view.tIdx] || [];
  body.querySelectorAll('input[data-ck]').forEach((inp) => {
    const k = +inp.dataset.ck;
    if (cks[k]) { inp.checked = true; inp.closest('.ck')?.classList.add('done'); }
  });

  /* trang vở */
  const ta = $('repText');
  ta.disabled = false;
  ta.setAttribute('aria-label', `Báo cáo Day ${day} (Markdown)`);
  if (repLoadedDay !== day) {
    repLoadedDay = day;
    ta.value = R.draft?.md ?? R.subs.at(-1)?.md ?? reportTemplate(day);
    $('repPrev').innerHTML = mdToHtml(ta.value);
  }
  const latest = R.subs.at(-1);
  $('subInfo').textContent = latest ? `Đã nộp v${latest.v} · ${latest.date} ${latest.at}` : 'Chưa nộp bài nào';
  if (R.draft) setSaveChip(`Nháp lưu ${new Date(R.draft.savedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`);
  else if (latest) setSaveChip(`Đã nộp v${latest.v} — viết thêm sẽ thành bản nháp mới`);
  else setSaveChip('Bản nháp: chưa có gì');

  split.style.setProperty('--split', state.settings.split);
  applyPanes(); applyMobileTab();
}

/* ---------------- báo cáo — danh sách phiên bản, cả hai bên đọc ---------------- */
function renderReports() {
  const days = taskDays().slice().sort((a, b) => b - a);
  const withSubs = days.filter((d) => state.reports[d]?.subs?.length).length;
  $('repListMeta').textContent = days.length ? `${withSubs}/${days.length} day đã nộp` : '';
  const list = $('repList');
  if (!days.length) {
    list.innerHTML = '<div class="empty">Chưa có task — chưa có gì để báo cáo.</div>';
    return;
  }
  let opened = false;
  list.innerHTML = days.map((d) => {
    const R = state.reports[d] ||= { subs: [], draft: null };
    const [dn, tot] = ckPair(d);
    const latest = R.subs.at(-1);
    const pill = latest
      ? `<span class="pill pos">Đã nộp v${latest.v}</span>`
      : R.draft ? '<span class="pill">Bản nháp</span>' : '<span class="pill">Chưa nộp</span>';
    const head = `<span class="d num">Day ${d}</span><span class="name">${esc(dayTitle(d))}</span><span class="fig num">${tot ? `${dn}<small>/${tot}</small>` : '—'}</span>${latest ? `<span class="meta when">${latest.date} ${latest.at}</span>` : ''}${pill}`;
    if (!latest) return `<div class="rep-item"><div class="rep-head">${head}</div>
      <div class="btnrow" style="margin:0 0 16px"><button class="btn" data-open-report="${d}">${R.draft ? 'Mở bản nháp' : 'Viết báo cáo'}</button></div></div>`;
    const isOpen = !opened;
    opened = true; // mở sẵn day mới nhất có bài cho người đọc
    const old = R.subs.slice(0, -1).reverse();
    const hist = old.length ? `<details class="ver"><summary>${old.length} phiên bản trước</summary>
      ${old.map((s) => `<details class="ver"><summary>v${s.v} · ${s.date || ''} ${s.at || ''}</summary><div class="md">${mdToHtml(s.md)}</div></details>`).join('')}</details>` : '';
    return `<details class="rep-item"${isOpen ? ' open' : ''}><summary>${head}</summary><div class="md">${mdToHtml(latest.md)}</div>${hist}</details>`;
  }).join('');
}

/* ---------------- report ---------------- */
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
let draftT, draftDirty = false;
/* đổi day / đóng trang khi còn chữ chưa qua 900ms → lưu ngay, không mất chữ */
function flushDraft() { if (draftDirty) { clearTimeout(draftT); saveDraftNow(); } }
function saveDraftNow() {
  const day = curDay(); if (day == null) return;
  const R = state.reports[day] ||= { subs: [], draft: null };
  try {
    R.draft = { md: $('repText').value, savedAt: Date.now() };
    save(); draftDirty = false;
    setSaveChip(`Đã lưu ${nowHM()}${tursoCfg().url && tursoCfg().token ? '' : ' · máy này'}`);
  } catch {
    setSaveChip('Không lưu được — bộ nhớ máy đầy? Xoá bớt day cũ ở Cài đặt.', true);
    return;
  }
  if (tursoCfg().url && tursoCfg().token) {
    pushDraft(day)
      .then(() => setSyncStatus('Turso · đã đồng bộ ' + nowHM()))
      .catch((e) => { setSyncStatus('Lỗi Turso: ' + e.message); setSaveChip(`Đã lưu ${nowHM()} · chưa đồng bộ`, true); });
  }
}
function submitReport() {
  const day = curDay(); if (day == null) return;
  const md = $('repText').value;
  if (!md.trim()) { toast('Chưa có nội dung để nộp'); return; }
  const R = state.reports[day] ||= { subs: [], draft: null };
  const v = R.subs.length + 1;
  const sub = { v, md, ts: Date.now(), date: today(), at: nowHM() };
  R.subs.push(sub);
  const hadDraft = !!R.draft;
  R.draft = null; draftDirty = false;
  save(); bg(() => pushSub(day, sub));
  if (hadDraft && tursoCfg().url && tursoCfg().token) bg(() => clearDraftRemote(day));
  setSaveChip(`Đã nộp v${v} — sửa tiếp sẽ lưu thành nháp mới`);
  $('subInfo').textContent = `Đã nộp v${v} · ${sub.date} ${sub.at}`;
  renderReports();
  toast(`Đã nộp Day ${day} (v${v}) — các phiên bản cũ giữ nguyên ở tab Báo cáo`);
}

/* ---------------- create task (cho người giao task) ---------------- */
let crAuto = true;
function createTemplate(n, title) {
  return `# Day ${n} — ${title || '<tiêu đề>'}

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

/* ---------------- wiring ---------------- */
function renderAll() {
  renderWork(); renderReports();
  const n = taskDays().filter((d) => state.reports[d]?.subs?.length).length;
  $('allRepCount').textContent = n ? `${n} day đã có báo cáo trong app.` : 'Chưa day nào có báo cáo.';
}
function init() {
  // điều hướng + hàng loại nút trong trang
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { e.preventDefault(); switchTab(tab.dataset.tab); return; }
    const orp = e.target.closest('[data-open-report]');
    if (orp) { flushDraft(); pickDay = +orp.dataset.openReport; repLoadedDay = null; view.tIdx = 0; switchTab('dash'); return; }
    const ft = e.target.closest('[data-tidx]');
    if (ft) { view.tIdx = +ft.dataset.tidx; renderWork(); return; }
    const mtb = e.target.closest('[data-pane]');
    if (mtb) {
      const cur = view.mtab === 'task' ? $('paneTask') : $('paneEdit');
      view.scrolls[cur.dataset.pane] = cur.querySelector('.pane-scroll').scrollTop;
      view.mtab = mtb.dataset.pane;
      applyMobileTab();
      return;
    }
  });
  $('menuBtn').onclick = () => $('sidebar').classList.add('open');
  $('menuClose').onclick = () => $('sidebar').classList.remove('open');

  // chọn day
  $('dayPick').addEventListener('change', (e) => {
    const v = +e.target.value;
    if (!state.tasks[v]?.length) return;
    flushDraft();
    pickDay = v; repLoadedDay = null; view.tIdx = 0;
    renderWork();
  });

  // gập / mở trang + kéo chia pane
  $('collapseLeft').onclick = () => { state.settings.panes = 'right'; save(); applyPanes(); };
  $('collapseRight').onclick = () => { state.settings.panes = 'left'; save(); applyPanes(); };
  $('restoreLeft').onclick = () => { state.settings.panes = 'both'; save(); applyPanes(); };
  $('restoreRight').onclick = () => { state.settings.panes = 'both'; save(); applyPanes(); };
  const split = $('wsSplit');
  $('gutter').addEventListener('pointerdown', (e) => {
    if (narrow()) return;
    e.preventDefault();
    $('gutter').setPointerCapture(e.pointerId);
    split.classList.add('dragging');
    const move = (ev) => {
      const r = split.getBoundingClientRect();
      let p = Math.round(((ev.clientX - r.left) / r.width) * 100);
      p = Math.min(78, Math.max(24, p));
      state.settings.split = p;
      split.style.setProperty('--split', p);
      $('splitNum').textContent = p + '%';
    };
    const up = (ev) => {
      $('gutter').removeEventListener('pointermove', move);
      $('gutter').removeEventListener('pointerup', up);
      $('gutter').removeEventListener('pointercancel', up);
      split.classList.remove('dragging');
      try { save(); } catch { /* bỏ qua */ }
    };
    move(e);
    $('gutter').addEventListener('pointermove', move);
    $('gutter').addEventListener('pointerup', up);
    $('gutter').addEventListener('pointercancel', up);
  });
  window.addEventListener('resize', () => { applyPanes(); applyMobileTab(); });

  // giao task (modal)
  const modal = $('assignModal');
  const closeAssign = () => { modal.hidden = true; };
  const openAssign = () => {
    const n = nextDay();
    $('crDay').value = n;
    $('crTitle').value = '';
    $('crTitleErr').hidden = true;
    $('crDayErr').hidden = true;
    $('crText').value = createTemplate(n); crAuto = true;
    renderCrPrev();
    modal.hidden = false;
    $('sidebar').classList.remove('open');
    $('crText').focus();
    $('crText').setSelectionRange(0, 0);
  };
  document.querySelectorAll('[data-assign]').forEach((b) => { b.onclick = openAssign; });
  $('assignClose').onclick = closeAssign;
  modal.addEventListener('click', (e) => { if (e.target === modal) closeAssign(); });

  // nhận file (nút + kéo thả toàn trang) → modal xem trước
  const im = $('importModal');
  const closeImport = () => { staged = null; im.hidden = true; };
  $('stageClose').onclick = $('stageCancel').onclick = closeImport;
  $('btnStageAccept').onclick = acceptStaged;
  im.addEventListener('click', (e) => { if (e.target === im) closeImport(); });
  $('stageDay').addEventListener('input', (e) => {
    if (!staged) return;
    const prevTitle = state.days[staged.day]?.title || '';
    staged.day = Math.max(1, +e.target.value || staged.day);
    const inherited = state.days[staged.day]?.title; // day đã có → dùng lại tiêu đề của nó
    if (inherited && (!staged.title.trim() || staged.title === prevTitle)) {
      staged.title = inherited;
      $('stageName').value = inherited;
      $('stageTitleErr').hidden = true;
      $('btnStageAccept').disabled = false;
    }
    const ow = stageBadges();
    const owEl = $('stageOverwrite');
    owEl.hidden = !ow; if (ow) owEl.textContent = ow;
  });
  $('stageName').addEventListener('input', (e) => {
    if (!staged) return;
    staged.title = e.target.value;
    $('stageTitleErr').hidden = !!staged.title.trim();
    $('btnStageAccept').disabled = !staged.title.trim();
  });
  $('stageCss').addEventListener('input', (e) => {
    const ta = e.target.closest('textarea[data-mcss]');
    if (ta && staged) staged.manual[ta.dataset.mcss] = ta.value;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!modal.hidden) closeAssign();
    if (!im.hidden) closeImport();
  });

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
      state = migrateState({ ...data, turso: { ...state.turso, pushed: false } });
      pickDay = null; repLoadedDay = null; view.tIdx = 0;
      save(); renderAll(); toast('Đã nhập backup');
    } catch { alert('File backup không hợp lệ.'); }
    e.target.value = '';
  };
  $('resetAll').onclick = () => {
    if (!confirm('Xoá TOÀN BỘ day, task, checklist, báo cáo, bản nháp — cả trên Turso nếu đã kết nối? Không hoàn tác được.')) return;
    state = migrateState({});
    pickDay = null; repLoadedDay = null; view.tIdx = 0;
    save(); renderAll();
    if (tursoCfg().url && tursoCfg().token) {
      bg(async () => { for (const t of ['days', 'taskfiles', 'checks', 'reports', 'drafts']) await tsql('DELETE FROM ' + t); });
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
      save(); setSyncStatus('Điền xong bấm "Kết nối & đồng bộ"');
    });
  }
  $('btnConnect').onclick = () => tursoConnect(true);
  setSyncStatus(tursoCfg().lastSync ? 'Đồng bộ lần cuối: ' + new Date(tursoCfg().lastSync).toLocaleString('vi-VN') : 'Chưa kết nối Turso');

  // checklist của trang đề
  $('taskBody').addEventListener('change', (e) => {
    const k = e.target.dataset.ck; if (k === undefined) return;
    const day = curDay(); if (day == null) return;
    const ti = view.tIdx;
    ((state.checks[day] ||= {})[ti] ||= [])[+k] = e.target.checked;
    e.target.closest('.ck')?.classList.toggle('done', e.target.checked);
    save(); bg(() => pushCheck(day, ti, +k, e.target.checked));
    const [dn, tot] = ckPair(day);
    if (tot) $('chipCk').innerHTML = `Checklist <b>${dn}/${tot}</b>`;
  });

  // trang vở: ngừng gõ là tự lưu (900ms) + xem trước (250ms)
  let deb;
  $('repText').addEventListener('input', () => {
    clearTimeout(deb); deb = setTimeout(() => { $('repPrev').innerHTML = mdToHtml($('repText').value); }, 250);
    setSaveChip('Đang lưu…'); draftDirty = true;
    clearTimeout(draftT); draftT = setTimeout(saveDraftNow, 900);
  });
  window.addEventListener('beforeunload', flushDraft);
  $('btnRefill').onclick = () => {
    const day = curDay(); if (day == null) return;
    const cur = $('repText').value;
    const tpl = reportTemplate(day);
    if (cur.trim() && cur !== tpl && !confirm('Điền mẫu sẽ thay nội dung đang viết. Bản nháp cũ vẫn nằm trong lịch sử nộp bài. Tiếp tục?')) return;
    $('repText').value = tpl;
    $('repPrev').innerHTML = mdToHtml(tpl);
    draftDirty = true;
    toast('Đã điền mẫu báo cáo');
  };
  $('btnPreview').onclick = () => {
    const w = $('repPrevWrap');
    const open = w.hidden;
    w.hidden = !open;
    $('btnPreview').setAttribute('aria-expanded', String(open));
    $('btnPreview').textContent = open ? 'Ẩn xem trước' : 'Xem trước';
    if (open) $('repPrev').innerHTML = mdToHtml($('repText').value);
  };
  $('btnSubmit').onclick = submitReport;
  $('btnCopy').onclick = () => copyText($('repText').value);
  $('btnDlMd').onclick = () => {
    const day = curDay(); if (day == null) return;
    saveDraftNow();
    download(`baocaoday${day}.md`, $('repText').value);
    toast(`Đã tạo baocaoday${day}.md — gửi file này cho bạn bạn`);
  };

  // giao task — nội dung
  $('crText').value = createTemplate(1); crAuto = true;
  $('crDay').addEventListener('input', () => {
    const n = Math.max(1, +$('crDay').value || 1);
    const dup = !!state.tasks[n]?.length;
    $('crDayErr').hidden = !dup;
    if (crAuto) { $('crText').value = createTemplate(n, $('crTitle').value.trim()); renderCrPrev(); }
  });
  $('crTitle').addEventListener('input', () => {
    $('crTitleErr').hidden = !!$('crTitle').value.trim();
    if (crAuto) { $('crText').value = createTemplate(Math.max(1, +$('crDay').value || 1), $('crTitle').value.trim()); renderCrPrev(); }
  });
  $('crText').addEventListener('input', () => { crAuto = false; renderCrPrev(); });
  // nạp sẵn file vào ô soạn (người giao task đã có nội dung ngoài app)
  $('crFileBtn').onclick = () => $('crFile').click();
  $('crFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const text = await f.text();
    const isHtml = /\.html?$/i.test(f.name) || /^\s*<(!doctype|html)/i.test(text);
    $('crText').value = isHtml ? htmlToMd(text) : text;
    crAuto = false; // nội dung thật, không tự dính template nữa
    const m = f.name.match(/day\s*(\d+)/i) || f.name.match(/(\d+)/);
    if (m) $('crDay').value = Math.max(1, +m[1]);
    renderCrPrev();
    e.target.value = '';
    toast(`Đã nạp ${f.name} — nhớ điền tiêu đề day rồi bấm Đăng task`);
  };
  $('btnCrPrev').onclick = renderCrPrev;
  $('btnCrDl').onclick = () => {
    const n = Math.max(1, +$('crDay').value || 1);
    download(`taskday${n}.md`, $('crText').value);
    toast(`Đã tải taskday${n}.md`);
  };
  $('btnCrSave').onclick = () => {
    const n = Math.max(1, +$('crDay').value || 1);
    const title = $('crTitle').value.trim();
    $('crTitleErr').hidden = !!title;
    $('crDayErr').hidden = !state.tasks[n]?.length;
    if (state.tasks[n]?.length) { $('crDayErr').scrollIntoView({ block: 'nearest' }); $('crDay').focus(); return; } // số day không được trùng
    if (!title) { $('crTitle').focus(); return; }
    state.tasks[n] = [{ name: 'task.md', type: 'md', src: $('crText').value, md: null, html: null, warns: [], addedAt: Date.now() }];
    state.days[n] = { title, updatedAt: Date.now() };
    delete state.checks[n];
    save(); bg(() => pushDay(n)); bg(() => pushTaskFiles(n));
    modal.hidden = true;
    pickDay = n; repLoadedDay = null; view.tIdx = 0;
    renderAll();
    toast(`Đã giao Day ${n} — ${title}`);
  };
  function renderCrPrev() { $('crPrev').innerHTML = mdToHtml($('crText').value); }
  renderCrPrev();

  // nút "Mở file .md" ở tab Báo cáo dùng chung ô chọn file với Làm bài
  $('repFileBtn').onclick = () => $('importFile').click();
  const dlAll = () => {
    const days = taskDays().filter((d) => state.reports[d]?.subs?.length);
    if (!days.length) { toast('Chưa có báo cáo nào'); return; }
    download(`baocao-day${days[0]}-den-day${days.at(-1)}.md`, days.map((d) => state.reports[d].subs.at(-1).md).join('\n\n---\n\n'));
    toast(`Đã tải ${days.length} báo cáo (bản mới nhất từng day) gộp một file`);
  };
  $('dlAllReports').onclick = dlAll;
  $('dlAllMd').onclick = dlAll;

  const TABS = ['dash', 'report', 'settings'];
  const hashTab = () => (location.hash.startsWith('#tab-') && TABS.includes(location.hash.slice(5)) ? location.hash.slice(5) : 'dash');
  switchTab(hashTab());
  window.addEventListener('hashchange', () => { // deep-link: /#tab-report mở thẳng màn Báo cáo
    switchTab(hashTab());
  });

  // có cấu hình Turso thì kéo dữ liệu về khi mở trang
  if (tursoCfg().url && tursoCfg().token) tursoConnect(false);
}
init();
