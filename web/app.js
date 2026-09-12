'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const api = async (path, params) => {
  const u = new URL(path, location.origin);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== '') u.searchParams.set(k, v);
  const r = await fetch(u);
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
};
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? 'metaKey' : 'ctrlKey';

const LH = 20, CHUNK = 1000, OVERSCAN = 24;

const S = {
  meta: null,
  tabs: [],
  active: -1,
  hist: [], histIdx: -1,
  find: null,         // {q, ci, hits:[{line,n}], active}
  occ: null,          // word to highlight everywhere
  lastWord: '',
  at: null,           // {word, line, col} of the last click in the code area
  link: null,         // identifier currently underlined under a held modifier
  hover: null,        // identifier the hover card is describing
  hoverAnchor: null,  // where the card was opened, to cheaply detect leaving
  lsp: { servers: [], state: 'off', server: '' },
  gen: 0,
  chW: 7.8,
};

const vp = $('#viewport'), sizer = $('#sizer'), rowsEl = $('#rows'), editor = $('#editor');
const refmenu = $('#refmenu'), toastEl = $('#toast');
const doc_ = () => (S.active >= 0 ? S.tabs[S.active] : null);

let toastTimer = 0;
function showToast(accentText, text) {
  if (!toastEl) return;
  toastEl.innerHTML = (accentText ? '<span class="toast-accent">' + esc(accentText) + '</span> ' : '') + esc(text);
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2200);
}

async function copyToClipboard(text, notify = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
    showToast('✓', notify);
  } catch {
    // Fallback for non-https/restricted contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('✓', notify);
    } catch (err) {
      showToast('!', 'Failed to copy to clipboard');
    }
    document.body.removeChild(ta);
  }
}

/* ==========================================================================
   SECTION 1: VIRTUAL RENDERER & DOM RECYCLER
   - Renders only visible lines in the viewport (#rows) based on scroll position.
   - Reuses DOM row elements to maintain 60 FPS scrolling on large files.
   - Fetches chunks of syntax-highlighted HTML on-demand from /api/chunk.
   ========================================================================== */

function measure() {
  const m = $('#measure');
  m.textContent = 'x'.repeat(100);
  S.chW = m.getBoundingClientRect().width / 100 || 7.8;
}

function layout() {
  const d = doc_();
  if (!d) return;
  const digits = String(d.total).length;
  editor.style.setProperty('--gw', digits);
  const gutter = digits * S.chW + 30;
  const w = Math.max(vp.clientWidth, gutter + (d.maxCols + 4) * S.chW);
  sizer.style.height = (d.total * LH + Math.max(120, vp.clientHeight * 0.5)) + 'px';
  sizer.style.width = w + 'px';
  rowsEl.style.width = w + 'px';
}

let raf = 0;
function render() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; paint(); });
}

function paint() {
  const d = doc_();
  if (!d) return;
  const top = vp.scrollTop;
  const first = Math.max(0, Math.floor(top / LH) - OVERSCAN);
  const count = Math.ceil(vp.clientHeight / LH) + OVERSCAN * 2;
  const last = Math.min(d.total, first + count);
  ensureChunks(d, first, last);

  let html = '';
  for (let i = first; i < last; i++) {
    const n = i + 1;
    const body = d.lines[i];
    html += '<div class="row' + (n === d.cur ? ' cur' : '') + '" data-l="' + n + '">' +
      '<div class="g">' + n + '</div><div class="c">' + (body === undefined ? '' : body) + '</div></div>';
  }
  rowsEl.style.transform = 'translateY(' + (first * LH) + 'px)';
  rowsEl.innerHTML = html;
  decorate(first, last);
}

/* Decorations are applied to the ~60 live rows only, never to the whole file. */
function decorate(first, last) {
  const d = doc_();
  if (S.occ) {
    for (const row of rowsEl.children) markNodes($('.c', row), S.occ, true, 'occ');
  }
  if (S.link) {
    const row = rowFor(S.link.line);
    if (row) wrapRange($('.c', row), S.link.col, S.link.col + S.link.word.length, 'link');
  }
  if (S.find && S.find.hits.length) {
    const byLine = S.find.byLine;
    const act = S.find.hits[S.find.active];
    for (const row of rowsEl.children) {
      const n = +row.dataset.l;
      if (!byLine.has(n)) continue;
      const marks = markNodes($('.c', row), S.find.q, S.find.ci, 'mark');
      if (act && act.line === n && marks[act.n]) marks[act.n].classList.add('on');
    }
  }
  void first; void last;
}

/* Wrap every occurrence of needle inside el, walking text nodes so the
   pre-highlighted token markup is never disturbed. */
function markNodes(el, needle, caseSensitive, cls) {
  if (!el || !needle) return [];
  const out = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const texts = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
  for (const node of texts) {
    const raw = node.nodeValue;
    const hay = caseSensitive ? raw : raw.toLowerCase();
    const nd = caseSensitive ? needle : needle.toLowerCase();
    let i = hay.indexOf(nd), at = 0;
    if (i < 0) continue;
    const frag = document.createDocumentFragment();
    while (i >= 0) {
      if (i > at) frag.appendChild(document.createTextNode(raw.slice(at, i)));
      const mk = document.createElement(cls === 'mark' ? 'mark' : 'span');
      if (cls !== 'mark') mk.className = cls;
      mk.textContent = raw.slice(i, i + nd.length);
      frag.appendChild(mk);
      out.push(mk);
      at = i + nd.length;
      i = hay.indexOf(nd, at);
    }
    if (at < raw.length) frag.appendChild(document.createTextNode(raw.slice(at)));
    node.parentNode.replaceChild(frag, node);
  }
  return out;
}

/* Wrap the half-open character range [from, to) of el in a span. Unlike the
   needle search used for find, this targets one exact occurrence, which is what
   a position-based decoration needs. */
function wrapRange(el, from, to, cls) {
  if (!el || to <= from) return null;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  let at = 0, out = null;
  for (const node of nodes) {
    const len = node.nodeValue.length;
    const s = Math.max(from, at), e = Math.min(to, at + len);
    if (s < e) {
      const a = s - at, b = e - at;
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = node.nodeValue.slice(a, b);
      const frag = document.createDocumentFragment();
      if (a > 0) frag.appendChild(document.createTextNode(node.nodeValue.slice(0, a)));
      frag.appendChild(span);
      if (b < len) frag.appendChild(document.createTextNode(node.nodeValue.slice(b)));
      node.parentNode.replaceChild(frag, node);
      out = out || span;
    }
    at += len;
    if (at >= to) break;
  }
  return out;
}

function rowFor(line) {
  for (const r of rowsEl.children) if (+r.dataset.l === line) return r;
  return null;
}

function ensureChunks(d, first, last) {
  const c0 = Math.floor(first / CHUNK), c1 = Math.floor(Math.max(first, last - 1) / CHUNK);
  for (let c = c0; c <= c1; c++) {
    if (d.chunks.has(c) || d.pending.has(c)) continue;
    d.pending.add(c);
    const gen = d.gen;
    api('/api/file', { path: d.path, start: c * CHUNK, count: CHUNK })
      .then(j => {
        if (gen !== d.gen) return; // superseded by a background highlight swap
        for (let i = 0; i < j.lines.length; i++) d.lines[j.start + i] = j.lines[i];
        d.chunks.add(c); d.pending.delete(c);
        if (doc_() === d) render();
        if (j.refine) refineChunk(d, c);
      })
      .catch(() => d.pending.delete(c));
  }
}

/* A window whose surrounding context was too short to close a very long string
   or comment is served as "inexact". The server's full-file pass settles it a
   moment later, so come back for that chunk and swap in the corrected lines. */
function refineChunk(d, c, delay = 800, tries = 0) {
  if (tries === 0) {
    if (d.refining.has(c)) return;
    d.refining.add(c);
  }
  setTimeout(async () => {
    if (!S.tabs.includes(d) || tries > 6) { d.refining.delete(c); return; }
    let j;
    try { j = await api('/api/file', { path: d.path, start: c * CHUNK, count: CHUNK }); }
    catch { d.refining.delete(c); return; }
    if (!S.tabs.includes(d)) { d.refining.delete(c); return; }
    if (!j.exact) { refineChunk(d, c, Math.min(delay * 1.6, 5000), tries + 1); return; }
    d.refining.delete(c);
    let changed = false;
    for (let i = 0; i < j.lines.length; i++) {
      if (d.lines[j.start + i] !== j.lines[i]) { d.lines[j.start + i] = j.lines[i]; changed = true; }
    }
    if (changed && doc_() === d) render();
  }, delay);
}

vp.addEventListener('scroll', render, { passive: true });
new ResizeObserver(() => { layout(); render(); }).observe(editor);

/* ==========================================================================
   SECTION 2: TABS & FILE OPENING LIFECYCLE
   - Manages open tab state (S.tabs, S.active), switching tabs, and closing tabs.
   - openFile(): Loads metadata from /api/file, activates/creates tab, and sets up chunks.
   - Handles URL hash synchronization (#path:line).
   ========================================================================== */

async function openFile(path, opts = {}) {
  const { line, push = true, col } = opts;
  let idx = S.tabs.findIndex(t => t.path === path);
  if (idx < 0) {
    let j;
    const start = line ? Math.max(0, Math.floor((line - 1) / CHUNK) * CHUNK) : 0;
    try {
      j = await api('/api/file', { path, start, count: CHUNK });
    } catch (e) {
      setStatusNote(path + ': ' + e.message);
      return;
    }
    if (j.image) {
      showImage(path);
      return;
    }
    const d = {
      path, name: path.split('/').pop(), lang: j.lang, total: j.total, maxCols: j.maxCols,
      size: j.size, lines: new Array(j.total), chunks: new Set([start / CHUNK]),
      pending: new Set(), refining: new Set(), scrollTop: 0, cur: line || 1,
      outline: null, gen: 0,
    };
    for (let i = 0; i < j.lines.length; i++) d.lines[j.start + i] = j.lines[i];
    d.lsp = j.lsp || { state: 'off', server: '' };
    S.tabs.push(d);
    idx = S.tabs.length - 1;
    if (j.refine) refineChunk(d, start / CHUNK);
  }
  const prev = doc_();
  if (prev && prev !== S.tabs[idx]) prev.scrollTop = vp.scrollTop;
  S.active = idx;
  const d = S.tabs[idx];

  $('#empty').hidden = true;
  hideImage();
  if (!S.at || S.at.path !== d.path) S.at = null;
  S.lsp.state = (d.lsp && d.lsp.state) || 'off';
  S.lsp.server = (d.lsp && d.lsp.server) || '';
  warmLSP(d);
  drawTabs(); drawCrumbs(); layout();

  if (line) { d.cur = line; centerLine(line); }
  else vp.scrollTop = d.scrollTop;
  render();
  updateStatus();
  if ($('#panel-outline').classList.contains('active')) loadOutline();
  if (push) pushHistory(path, line || d.cur, col);
}

function centerLine(n) {
  const y = (n - 1) * LH - Math.max(0, vp.clientHeight / 2 - LH * 2);
  vp.scrollTop = Math.max(0, y);
}

function closeTab(i) {
  S.tabs.splice(i, 1);
  if (S.tabs.length === 0) {
    S.active = -1;
    rowsEl.innerHTML = ''; sizer.style.height = '0px';
    $('#empty').hidden = false; $('#crumbs').innerHTML = '';
    drawTabs(); updateStatus();
    return;
  }
  S.active = Math.min(i, S.tabs.length - 1);
  const d = doc_();
  drawTabs(); drawCrumbs(); layout();
  vp.scrollTop = d.scrollTop; render(); updateStatus();
}

function drawTabs() {
  $('#tabs').innerHTML = S.tabs.map((t, i) =>
    '<div class="tab' + (i === S.active ? ' active' : '') + '" data-i="' + i + '" title="' + esc(t.path) + '">' +
    '<span class="tn">' + esc(t.name) + '</span><span class="x" data-close="' + i + '">&times;</span></div>').join('');
  const act = $('#tabs .tab.active');
  if (act) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

$('#tabs').addEventListener('click', e => {
  const x = e.target.closest('[data-close]');
  if (x) { closeTab(+x.dataset.close); return; }
  const t = e.target.closest('.tab');
  if (t) switchTab(+t.dataset.i);
});
$('#tabs').addEventListener('auxclick', e => {
  const t = e.target.closest('.tab');
  if (t && e.button === 1) { e.preventDefault(); closeTab(+t.dataset.i); }
});

function switchTab(i) {
  if (i === S.active || !S.tabs[i]) return;
  clearLink();
  const prev = doc_();
  if (prev) prev.scrollTop = vp.scrollTop;
  S.active = i;
  clearFind();
  S.at = null;
  S.lsp.state = (S.tabs[i].lsp && S.tabs[i].lsp.state) || 'off';
  S.lsp.server = (S.tabs[i].lsp && S.tabs[i].lsp.server) || '';
  warmLSP(S.tabs[i]);
  drawTabs(); drawCrumbs(); layout();
  vp.scrollTop = S.tabs[i].scrollTop;
  render(); updateStatus();
  if ($('#panel-outline').classList.contains('active')) loadOutline();
  pushHistory(S.tabs[i].path, S.tabs[i].cur);
}

function drawCrumbs() {
  const d = doc_();
  if (!d) { $('#crumbs').innerHTML = ''; return; }
  const parts = d.path.split('/');
  $('#crumbs').innerHTML = parts.map((p, i) =>
    i === parts.length - 1
      ? '<span>' + esc(p) + '</span>'
      : '<span class="cb" data-dir="' + esc(parts.slice(0, i + 1).join('/')) + '">' + esc(p) + '</span>'
  ).join('<span class="sep">/</span>');
}
$('#crumbs').addEventListener('click', e => {
  const c = e.target.closest('[data-dir]');
  if (c) { showPanel('files'); revealDir(c.dataset.dir); }
});

function showImage(path) {
  hideImage();
  const box = document.createElement('div');
  box.id = 'imgview';
  box.innerHTML = '<img src="/api/raw?path=' + encodeURIComponent(path) + '" alt="">';
  editor.appendChild(box);
  $('#empty').hidden = true;
}
function hideImage() { const b = $('#imgview'); if (b) b.remove(); }

/* ==========================================================================
   SECTION 3: NAVIGATION HISTORY (BACK / FORWARD)
   - Tracks cursor jump history (S.backStack, S.fwdStack).
   - Allows jumping back/forward across locations with Alt+Left / Alt+Right.
   ========================================================================== */

function pushHistory(path, line) {
  const top = S.hist[S.histIdx];
  if (top && top.path === path && Math.abs(top.line - line) < 2) return;
  S.hist = S.hist.slice(0, S.histIdx + 1);
  S.hist.push({ path, line });
  if (S.hist.length > 120) S.hist.shift();
  S.histIdx = S.hist.length - 1;
}
function go(delta) {
  const i = S.histIdx + delta;
  if (i < 0 || i >= S.hist.length) return;
  S.histIdx = i;
  const h = S.hist[i];
  openFile(h.path, { line: h.line, push: false });
}

/* ==========================================================================
   SECTION 4: STATUS BAR & NOTIFICATIONS
   - Updates bottom status indicators (#status): language, total lines, file size,
     cursor line/col, active LSP server state, and background indexing status.
   ========================================================================== */

function updateStatus() {
  const d = doc_();
  $('#st-lang').textContent = d ? d.lang : '';
  $('#st-lines').textContent = d ? d.total.toLocaleString() + ' lines' : '';
  $('#st-size').textContent = d ? fmtBytes(d.size) : '';
  $('#st-pos').textContent = d ? 'Ln ' + d.cur : '';
  if (S.meta) $('#st-index').textContent = S.meta.files.toLocaleString() + ' files · ' + S.meta.indexMs + 'ms';
  drawLspStatus();
}
function setStatusNote(msg) { $('#st-pos').textContent = msg; }
function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

/* ==========================================================================
   SECTION 5: CODE VIEWPORT INTERACTION & CURSOR POSITIONING
   - Mouse click / double click handling inside editor rows.
   - Sets active line cursor, highlights occurrences of selected word.
   - Modifier (Ctrl/Cmd) click intercepts: triggers Find References across workspace.
   ========================================================================== */

const WORD = /[A-Za-z0-9_$]/;

/* Returns {word, line, col} where col counts UTF-16 units from the start of the
   line, which is both what JS string indexes give us and what the server needs
   to place an LSP request. Walking text nodes keeps this correct even after
   find or occurrence marks have wrapped parts of the line. */
function wordAtPoint(x, y) {
  let node, off;
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (!p) return null;
    node = p.offsetNode; off = p.offset;
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (!r) return null;
    node = r.startContainer; off = r.startOffset;
  } else return null;
  if (!node || node.nodeType !== 3) return null;

  const code = node.parentElement && node.parentElement.closest('.c');
  const row = code && code.closest('.row');
  if (!code || !row) return null;

  let col = 0;
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n === node) { col += off; break; }
    col += n.nodeValue.length;
  }

  const full = code.textContent;
  let a = Math.min(col, full.length), b = a;
  while (a > 0 && WORD.test(full[a - 1])) a--;
  while (b < full.length && WORD.test(full[b])) b++;
  if (a === b) return null;
  const d = doc_();
  return { word: full.slice(a, b), line: +row.dataset.l, col: a, path: d && d.path };
}

vp.addEventListener('mousedown', e => {
  const row = e.target.closest('.row');
  if (!row) return;
  const d = doc_(); if (!d) return;
  d.cur = +row.dataset.l;
  updateStatus();
  const w = wordAtPoint(e.clientX, e.clientY);
  if (e[MOD] && w) { e.preventDefault(); findReferences(w); return; }
  for (const r of rowsEl.children) r.classList.toggle('cur', +r.dataset.l === d.cur);
});

vp.addEventListener('dblclick', e => {
  const w = wordAtPoint(e.clientX, e.clientY);
  if (w) { S.at = w; S.lastWord = w.word; }
  S.occ = (w && w.word.length > 1) ? w.word : null;
  paint();
});

/* ==========================================================================
   SECTION 6: HOVERCARD & LSP TYPE/DOC TOOLTIPS
   - Debounced hover detection over tokens.
   - Calls /api/lsp/hover for signatures & documentation.
   - Renders quick-action buttons: Copy Ref, Copy for AI, and Find Usages.
   - Keeps hovercard open when pointer moves inside the card.
   ========================================================================== */

const hovercard = $('#hovercard');
const HOVER_DELAY = 380;   // rest time before the card opens
const HOVER_KEEP = 26;     // px the pointer may drift before the card closes
let hoverTimer = 0, hoverSeq = 0, moveRAF = 0, pendingMove = null, pointerAt = null;

const sameWord = (a, b) => !!a && !!b && a.line === b.line && a.col === b.col && a.word === b.word;

/* One mousemove handler drives both behaviours: with a modifier held the word
   becomes a link, without one it gets an info card after a short rest. */
vp.addEventListener('mousemove', e => {
  pointerAt = { x: e.clientX, y: e.clientY };
  pendingMove = { x: e.clientX, y: e.clientY, mod: e[MOD] };
  if (moveRAF) return;
  moveRAF = requestAnimationFrame(() => {
    moveRAF = 0;
    const m = pendingMove;
    pendingMove = null;
    if (m) onMove(m);
  });
});

/* Hit-testing a point costs a few milliseconds: it forces layout and walks the
   line's nodes. Far too much to spend on every animation frame, so it runs only
   when the modifier is actually held, or once the pointer has come to rest and
   the card is about to open. Everything on the hot path below is arithmetic. */
function onMove({ x, y, mod }) {
  if (mod) {
    const at = doc_() ? wordAtPoint(x, y) : null;
    if (!sameWord(at, S.link)) {
      S.link = at;
      vp.classList.toggle('linking', !!at);
      paint();
    }
    clearTimeout(hoverTimer);
    hideHover();
    return;
  }

  if (S.link) { S.link = null; vp.classList.remove('linking'); paint(); }

  // Dismiss an open card once the pointer has clearly left what it described.
  if (S.hoverAnchor) {
    if (!hovercard.hidden) {
      const rect = hovercard.getBoundingClientRect();
      if (x >= rect.left - 4 && x <= rect.right + 4 && y >= rect.top - 4 && y <= rect.bottom + 4) return;
    }
    const dx = x - S.hoverAnchor.x, dy = y - S.hoverAnchor.y;
    if (dx * dx + dy * dy > HOVER_KEEP * HOVER_KEEP) hideHover();
    else return; // still on the same word: nothing to do
  }

  if (S.lsp.state !== 'ready' && S.lsp.state !== 'indexing') return;
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => hoverAt(x, y), HOVER_DELAY);
}

function hoverAt(x, y) {
  const at = doc_() ? wordAtPoint(x, y) : null;
  if (at && at.word) showHover(at, x, y);
}

async function showHover(at, x, y) {
  const d = doc_();
  if (!d || at.path !== d.path) return;
  const seq = ++hoverSeq;
  let j;
  try { j = await api('/api/lsp/hover', { path: d.path, line: at.line, col: at.col, wait: 4000 }); }
  catch { return; }
  if (seq !== hoverSeq || doc_() !== d) return;   // the pointer moved on
  setLspState(j);
  if (!j || j.empty || (!j.signature && !j.doc)) return;

  S.hover = at;
  S.hoverAnchor = { x, y };
  const refPath = d.path + ':' + at.line;
  hovercard.innerHTML =
    (j.signature ? '<div class="sig">' + j.signature + '</div>' : '') +
    (j.doc ? '<div class="doc">' + esc(j.doc) + '</div>' : '') +
    '<div class="actions">' +
      '<button id="hc-copy-ref" title="Copy file and line reference"><span class="btn-icon">📋</span> Copy Ref</button>' +
      '<button id="hc-copy-ai" title="Copy snippet with file path for Claude Code / LLMs"><span class="btn-icon">🤖</span> Copy for AI</button>' +
      '<button id="hc-find-refs" title="Find all usages across codebase"><span class="btn-icon">🔍</span> Usages</button>' +
    '</div>' +
    '<div class="foot"><b>' + esc(j.server || 'lsp') + '</b>' +
    '<span>' + (isMac ? '⌘' : 'Ctrl') + '+click usages</span>' +
    '<span>Shift+F12 references</span></div>';

  const btnRef = hovercard.querySelector('#hc-copy-ref');
  const btnAi = hovercard.querySelector('#hc-copy-ai');
  const btnRefs = hovercard.querySelector('#hc-find-refs');

  if (btnRef) btnRef.onclick = (e) => {
    e.stopPropagation();
    copyToClipboard(refPath, 'Copied ' + refPath);
  };
  if (btnAi) btnAi.onclick = (e) => {
    e.stopPropagation();
    const lineText = d.lines[at.line - 1] || at.word || '';
    const ext = d.path.split('.').pop() || '';
    const text = '### Reference: ' + refPath + '\n```' + ext + '\n' + lineText + '\n```';
    copyToClipboard(text, 'Copied snippet for AI (' + refPath + ')');
  };
  if (btnRefs) btnRefs.onclick = (e) => {
    e.stopPropagation();
    hideHover();
    findReferences(at.word);
  };

  hovercard.hidden = false;
  placeHover(x, y);
}

/* Anchor below the pointer, flipping above or inward when that would overflow
   the editor. */
function placeHover(x, y) {
  const host = editor.getBoundingClientRect();
  const card = hovercard.getBoundingClientRect();
  let left = x - host.left + 6;
  let top = y - host.top + 20;
  if (left + card.width > host.width - 12) left = Math.max(8, host.width - card.width - 12);
  if (top + card.height > host.height - 8) {
    const above = y - host.top - card.height - 12;
    top = above > 8 ? above : Math.max(8, host.height - card.height - 8);
  }
  hovercard.style.left = left + 'px';
  hovercard.style.top = top + 'px';
}

function hideHover() {
  hoverSeq++;
  S.hover = null;
  S.hoverAnchor = null;
  if (!hovercard.hidden) { hovercard.hidden = true; hovercard.innerHTML = ''; }
}

function clearLink() {
  clearTimeout(hoverTimer);
  hideHover();
  if (S.link) { S.link = null; vp.classList.remove('linking'); paint(); }
}

vp.addEventListener('mouseleave', () => { pointerAt = null; clearLink(); });
vp.addEventListener('scroll', () => { clearTimeout(hoverTimer); hideHover(); hideRefMenu(); }, { passive: true });
vp.addEventListener('mousedown', (e) => {
  if (e.target.closest('#hovercard') || e.target.closest('#refmenu')) return;
  hideHover();
  hideRefMenu();
});

/* The modifier can be pressed or released without the pointer moving, and the
   underline has to follow. */
addEventListener('keydown', e => {
  if ((e.key === 'Control' || e.key === 'Meta') && pointerAt) onMove({ ...pointerAt, mod: true });
});
addEventListener('keyup', e => {
  if (e.key === 'Control' || e.key === 'Meta') clearLink();
});


/* ==========================================================================
   SECTION 7: SELECTION REFERENCE MENU (#refmenu) & AI HARNESS INTEGRATION
   - Triggered when text or multiple lines are selected in the editor.
   - Floating action pill positioned centered above selection.
   - Actions:
       1) Copy Ref: "path/to/file.ext:10-25" (concise line reference)
       2) Copy for Claude: Formatted markdown code block with file path header
       3) Find Usages: Searches all occurrences of selected symbol
   ========================================================================== */

function hideRefMenu() {
  if (refmenu && !refmenu.hidden) {
    refmenu.hidden = true;
    refmenu.innerHTML = '';
  }
}

function getSelectedRangeInfo() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const d = doc_();
  if (!d) return null;

  const range = sel.getRangeAt(0);
  // Ensure selection intersects viewport/editor
  if (!vp.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== vp) {
    return null;
  }

  const text = sel.toString().trim();
  if (!text) return null;

  // Find start and end line rows
  let startEl = range.startContainer;
  if (startEl.nodeType !== 1) startEl = startEl.parentElement;
  let endEl = range.endContainer;
  if (endEl.nodeType !== 1) endEl = endEl.parentElement;

  const startRow = startEl ? startEl.closest('.row') : null;
  const endRow = endEl ? endEl.closest('.row') : null;

  let l1 = d.cur || 1, l2 = d.cur || 1;
  if (startRow && startRow.dataset.l) l1 = +startRow.dataset.l;
  if (endRow && endRow.dataset.l) l2 = +endRow.dataset.l;

  if (l1 > l2) { const tmp = l1; l1 = l2; l2 = tmp; }

  const rect = range.getBoundingClientRect();
  return { text, l1, l2, rect, path: d.path };
}

function updateSelectionMenu() {
  const info = getSelectedRangeInfo();
  if (!info || !info.text) {
    hideRefMenu();
    return;
  }

  const { text, l1, l2, rect, path } = info;
  const refPath = path + ':' + (l1 === l2 ? l1 : l1 + '-' + l2);

  refmenu.innerHTML =
    '<button id="rm-copy-ref" title="Copy file and line number"><span class="btn-icon">📋</span> Copy Ref</button>' +
    '<button id="rm-copy-claude" title="Copy formatted code snippet for Claude Code / LLM harness"><span class="btn-icon">🤖</span> Copy for Claude</button>' +
    '<button id="rm-find-refs" title="Find all occurrences across workspace"><span class="btn-icon">🔍</span> Find Usages</button>';

  const btnRef = refmenu.querySelector('#rm-copy-ref');
  const btnClaude = refmenu.querySelector('#rm-copy-claude');
  const btnFind = refmenu.querySelector('#rm-find-refs');

  if (btnRef) btnRef.onclick = (e) => {
    e.stopPropagation();
    copyToClipboard(refPath, 'Copied ' + refPath);
    hideRefMenu();
  };

  if (btnClaude) btnClaude.onclick = (e) => {
    e.stopPropagation();
    const ext = path.split('.').pop() || '';
    const formatted = '### Reference: ' + refPath + '\n```' + ext + '\n' + text + '\n```';
    copyToClipboard(formatted, 'Copied snippet for Claude (' + refPath + ')');
    hideRefMenu();
  };

  if (btnFind) btnFind.onclick = (e) => {
    e.stopPropagation();
    hideRefMenu();
    const q = text.split(/\s+/)[0] || text;
    findReferences(q);
  };

  // Position the floating refmenu centered directly above selection
  const edRect = editor.getBoundingClientRect();
  refmenu.hidden = false;
  const mRect = refmenu.getBoundingClientRect();

  let left = rect.left - edRect.left + (rect.width - mRect.width) / 2;
  left = Math.max(10, Math.min(edRect.width - mRect.width - 10, left));

  let top = rect.top - edRect.top - mRect.height - 8;
  if (top < 10) {
    // If overflowing above, flip below selection
    top = rect.bottom - edRect.top + 8;
  }

  refmenu.style.left = left + 'px';
  refmenu.style.top = top + 'px';
}

document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) {
    hideRefMenu();
  }
});

vp.addEventListener('mouseup', () => {
  setTimeout(updateSelectionMenu, 20);
});

vp.addEventListener('keyup', (e) => {
  if (e.shiftKey) setTimeout(updateSelectionMenu, 20);
});

/* ==========================================================================
   SECTION 8: SYMBOL DEFINITIONS & REFERENCES (LSP + REGEX FALLBACK)
   - gotoDefinition(): Queries LSP definition with fallback to text search.
   - findReferences(): Queries LSP references with fallback to whole-word search.
   - Results presented in search panel or directly jumped if single match.
   ========================================================================== */

/* Language servers answer precisely but can take a long time to wake up, while
   the regex index answers in milliseconds and is always there. So: use the
   server when it is actually ready, fall back to text matching when it is not,
   and never let a slow server block the jump. */

/* A language server answers about a position, not a name. Only a position we
   actually measured in the current file may be sent to it; a bare word (from
   the palette, say) has no column and would make the server confidently answer
   about whatever happens to sit at column 0. Those go to the text index. */
function positionNow(word) {
  const d = doc_();
  if (!d) return null;
  if (S.at && S.at.word && S.at.path === d.path) return S.at;
  if (word) return { word, line: d.cur, col: 0, imprecise: true };
  return null;
}

function canAskServer(at) {
  return !at.imprecise && (S.lsp.state === 'ready' || S.lsp.state === 'indexing');
}

function setLspState(j) {
  if (!j || !j.state) return;
  S.lsp.state = j.state;
  S.lsp.server = j.server || S.lsp.server;
  drawLspStatus();
}

function drawLspStatus() {
  const el = $('#st-lsp');
  const { state, server } = S.lsp;
  if (!server || state === 'off') { el.textContent = ''; el.removeAttribute('data-state'); return; }
  el.dataset.state = state;
  el.textContent = state === 'ready' ? server : server + ' ' + state;
}

/* Opening a file starts its language server, if there is one, and follows it
   until it is up. Without this the first hover would find the server still
   "starting" and quietly do nothing, with no way for the state to advance. */
async function warmLSP(d, tries = 0) {
  if (!d.lsp || d.lsp.state === 'off' || d.lsp.state === 'ready' || d.lsp.state === 'failed') return;
  if (tries > 20) return;
  let j;
  try { j = await api('/api/lsp/warm', { path: d.path, wait: tries === 0 ? 1 : 1200 }); }
  catch { return; }
  if (!S.tabs.includes(d)) return;
  d.lsp = { state: j.state, server: j.server };
  if (doc_() === d) setLspState(j);
  if (j.state === 'starting' || j.state === 'indexing') {
    setTimeout(() => warmLSP(d, tries + 1), 900);
  }
}

async function lspCall(kind, at, waitMs) {
  const d = doc_();
  if (!d) return null;
  try {
    const j = await api('/api/lsp/' + kind, { path: d.path, line: at.line, col: at.col, wait: waitMs });
    setLspState(j);
    return j;
  } catch { return null; }
}

async function gotoDefinition(arg) {
  const d = doc_();
  const at = (arg && arg.word) ? arg : positionNow(typeof arg === 'string' ? arg : S.lastWord);
  if (!d || !at) return;

  if (canAskServer(at)) {
    setStatusNote('definition of ' + at.word + '…');
    const j = await lspCall('def', at, S.lsp.state === 'ready' ? 5000 : 20000);
    updateStatus();
    if (j && j.hits && j.hits.length) { acceptHits(at.word, j.hits, j.server, 'definition'); return; }
  } else if (!at.imprecise && S.lsp.state === 'starting') {
    // Kick the server awake for next time, but do not wait on it.
    lspCall('def', at, 60000).then(j => {
      if (j && j.hits && j.hits.length) showHits(at.word, j.hits, j.server, 'definition');
    });
  }

  setStatusNote('searching for ' + at.word + '…');
  let rx;
  try { rx = await api('/api/def', { sym: at.word, path: d.path }); }
  catch (e) { setStatusNote(e.message); return; }
  updateStatus();
  if (rx.lsp) setLspState(rx.lsp);

  if (!rx.defs || !rx.defs.length) {
    showPanel('search');
    $('#q').value = at.word; $('#o-word').classList.add('on'); runSearch();
    return;
  }
  acceptHits(at.word, rx.defs, null, 'definition', rx.refCount);
}

async function findReferences(arg) {
  const d = doc_();
  const at = (arg && arg.word) ? arg : positionNow(typeof arg === 'string' ? arg : S.lastWord);
  if (!d || !at) return;

  if (canAskServer(at)) {
    setStatusNote('references to ' + at.word + '…');
    const j = await lspCall('refs', at, 30000);
    updateStatus();
    if (j && j.hits && j.hits.length) {
      showHits(at.word, j.hits, j.server, 'reference');
      return;
    }
  }
  // No server, or it had nothing: a whole-word search is the honest fallback.
  showPanel('search');
  $('#q').value = at.word;
  $('#o-word').classList.add('on');
  $('#o-case').classList.add('on');
  runSearch();
}

function acceptHits(word, hits, server, noun, refCount) {
  if (hits.length === 1) {
    const h = hits[0];
    openFile(h.path, { line: h.line });
    flashFind(h.mid || word);
    setStatusNote(server ? server + ' · ' + h.path + ':' + h.line : h.path + ':' + h.line);
    return;
  }
  showHits(word, hits, server, noun, refCount);
}

function showHits(word, hits, server, noun, refCount) {
  const n = hits.length;
  let head = n + ' ' + noun + (n === 1 ? '' : 's') + ' of "' + word + '"';
  head += server ? '  ·  ' + server : '  ·  text match, no language server';
  if (refCount) head += '  ·  ' + refCount + ' other references';
  renderResults({ results: groupHits(hits), files: 0, total: n, header: head, exact: !!server });
  showPanel('search');
}

function groupHits(hits) {
  const byPath = new Map();
  for (const h of hits) {
    if (!byPath.has(h.path)) byPath.set(h.path, { path: h.path, ext: h.ext, matches: [] });
    byPath.get(h.path).matches.push(h);
  }
  return [...byPath.values()];
}

function flashFind(q) {
  const d = doc_();
  if (!d || !q) return;
  S.find = { q, ci: true, hits: [{ line: d.cur, n: 0 }], byLine: new Set([d.cur]), active: 0 };
  setTimeout(paint, 0);
}

/* ==========================================================================
   SECTION 9: EXPLORER FILE TREE
   - Renders recursive directory tree under #tree.
   - Lazy folder expansion with arrow toggles; opens files on click.
   - Re-index button triggers /api/reindex.
   ========================================================================== */

const treeEl = $('#tree');
const openDirs = new Set();

async function drawTree(dir, container, depth) {
  let j;
  try { j = await api('/api/tree', { dir }); } catch { return; }
  container.innerHTML = j.children.map(c => {
    const pad = 8 + depth * 12;
    if (c.dir) {
      return '<div class="tw"><div class="tr dir" data-dir="' + esc(c.path) + '" style="padding-left:' + pad + 'px">' +
        '<span class="ar"></span><span class="nm">' + esc(c.name) + '</span></div>' +
        '<div class="kids" data-kids="' + esc(c.path) + '"></div></div>';
    }
    return '<div class="tr file" data-file="' + esc(c.path) + '" style="padding-left:' + (pad + 12) + 'px">' +
      '<span class="ic" data-t="' + fileKind(c.name) + '"></span><span class="nm">' + esc(c.name) + '</span></div>';
  }).join('');
}

/* A colour family per file kind, drawn in CSS. Emoji or icon fonts would be at
   the mercy of whatever the viewer has installed. */
const FILE_KIND = {
  go: 'code', js: 'code', mjs: 'code', cjs: 'code', ts: 'code', tsx: 'code', jsx: 'code',
  py: 'code', rb: 'code', rs: 'code', java: 'code', kt: 'code', c: 'code', h: 'code',
  cc: 'code', cpp: 'code', hpp: 'code', cs: 'code', php: 'code', swift: 'code',
  lua: 'code', ex: 'code', exs: 'code', scala: 'code', dart: 'code', sh: 'code',
  bash: 'code', zsh: 'code', sql: 'code',
  json: 'data', yaml: 'data', yml: 'data', toml: 'data', ini: 'data', xml: 'data',
  csv: 'data', env: 'data', lock: 'data', mod: 'data', sum: 'data',
  md: 'doc', markdown: 'doc', txt: 'doc', rst: 'doc', adoc: 'doc',
  html: 'web', htm: 'web', css: 'web', scss: 'web', less: 'web', svg: 'web', vue: 'web',
  png: 'img', jpg: 'img', jpeg: 'img', gif: 'img', webp: 'img', ico: 'img', avif: 'img',
};
function fileKind(name) {
  const i = name.lastIndexOf('.');
  return (i > 0 && FILE_KIND[name.slice(i + 1).toLowerCase()]) || 'other';
}

treeEl.addEventListener('click', async e => {
  const dirRow = e.target.closest('[data-dir]');
  if (dirRow) {
    const path = dirRow.dataset.dir;
    const kids = treeEl.querySelector('[data-kids="' + CSS.escape(path) + '"]');
    const open = dirRow.classList.toggle('open');
    kids.classList.toggle('open', open);
    if (open) {
      openDirs.add(path);
      if (!kids.dataset.loaded) {
        kids.dataset.loaded = '1';
        await drawTree(path, kids, path.split('/').length);
      }
    } else openDirs.delete(path);
    return;
  }
  const f = e.target.closest('[data-file]');
  if (f) {
    $$('.tr.sel', treeEl).forEach(x => x.classList.remove('sel'));
    f.classList.add('sel');
    openFile(f.dataset.file);
  }
});

/* Expand the tree down to dir and scroll it into view. */
async function revealDir(dir) {
  const parts = dir.split('/');
  for (let i = 0; i < parts.length; i++) {
    const p = parts.slice(0, i + 1).join('/');
    const row = treeEl.querySelector('[data-dir="' + CSS.escape(p) + '"]');
    if (!row) break;
    if (!row.classList.contains('open')) row.click();
    await new Promise(r => setTimeout(r, 30));
  }
  const last = treeEl.querySelector('[data-dir="' + CSS.escape(dir) + '"]');
  if (last) last.scrollIntoView({ block: 'center' });
}

async function revealFile(path) {
  const dir = path.slice(0, path.lastIndexOf('/'));
  if (dir) await revealDir(dir);
  const row = treeEl.querySelector('[data-file="' + CSS.escape(path) + '"]');
  if (row) {
    $$('.tr.sel', treeEl).forEach(x => x.classList.remove('sel'));
    row.classList.add('sel');
    row.scrollIntoView({ block: 'center' });
  }
}

/* ==========================================================================
   SECTION 10: WORKSPACE SEARCH PANEL
   - Fast full-text regex & literal search across the entire project.
   - Options for match case, whole word, regex mode, and file glob filters.
   - Displays matches grouped by file with clickable jump targets.
   ========================================================================== */

const resultsEl = $('#results');
let lastResults = null;

const runSearch = debounce(async () => {
  const q = $('#q').value;
  if (!q.trim()) { resultsEl.innerHTML = ''; return; }
  resultsEl.innerHTML = '<div class="hint">searching…</div>';
  const params = {
    q, glob: $('#glob').value,
    case: $('#o-case').classList.contains('on') ? 1 : '',
    word: $('#o-word').classList.contains('on') ? 1 : '',
    re: $('#o-re').classList.contains('on') ? 1 : '',
  };
  try {
    const j = await api('/api/search', params);
    renderResults(j);
  } catch (e) {
    resultsEl.innerHTML = '<div class="hint">' + esc(e.message) + '</div>';
  }
}, 160);

function renderResults(j) {
  lastResults = j;
  if (!j.results || !j.results.length) {
    resultsEl.innerHTML = '<div class="hint">No results.</div>';
    return;
  }
  const head = j.header || (j.total.toLocaleString() + ' result' + (j.total === 1 ? '' : 's') +
    ' in ' + j.files.toLocaleString() + ' file' + (j.files === 1 ? '' : 's') + (j.truncated ? ' (truncated)' : ''));
  let html = '<div class="hint">' + esc(head) + '</div>';
  for (const f of j.results) {
    html += '<div class="rfile" data-toggle="' + esc(f.path) + '" title="' + esc(f.path) + '">' +
      '<span class="ar">&#9660;</span>' +
      (f.ext ? '<span class="ext">ext</span>' : '') +
      '<span class="fp">' + esc(displayPath(f.path)) + '</span>' +
      '<span class="cnt">' + f.matches.length + '</span></div>' +
      '<div data-group="' + esc(f.path) + '">';
    for (const m of f.matches) {
      html += '<div class="rline" data-p="' + esc(f.path) + '" data-n="' + m.line + '">' +
        '<span class="rn">' + m.line + '</span><span class="rt">' +
        esc(m.pre) + '<mark>' + esc(m.mid) + '</mark>' + esc(m.post) + '</span></div>';
    }
    html += '</div>';
  }
  resultsEl.innerHTML = html;
}

/* External results carry an absolute path, which is far too long for the
   panel. Show enough of the tail to identify the file. */
function displayPath(p) {
  if (p.length <= 48) return p;
  const parts = p.split('/');
  return '…/' + parts.slice(-3).join('/');
}

resultsEl.addEventListener('click', e => {
  const t = e.target.closest('[data-toggle]');
  if (t) {
    const g = resultsEl.querySelector('[data-group="' + CSS.escape(t.dataset.toggle) + '"]');
    const hidden = g.style.display === 'none';
    g.style.display = hidden ? '' : 'none';
    $('.ar', t).innerHTML = hidden ? '&#9660;' : '&#9654;';
    return;
  }
  const r = e.target.closest('.rline');
  if (r) {
    $$('.rline.sel', resultsEl).forEach(x => x.classList.remove('sel'));
    r.classList.add('sel');
    openFile(r.dataset.p, { line: +r.dataset.n });
    const q = $('#q').value;
    if (q) flashFind(q);
  }
});

$('#q').addEventListener('input', runSearch);
$('#glob').addEventListener('input', runSearch);
$$('.opt').forEach(b => b.addEventListener('click', () => { b.classList.toggle('on'); runSearch(); }));
$('#q').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); const f = $('.rline', resultsEl); if (f) f.click(); }
});

/* ==========================================================================
   SECTION 11: SYMBOL OUTLINE
   - Queries LSP document symbols via /api/lsp/outline.
   - Displays filterable list of functions, structs, interfaces, methods, etc.
   ========================================================================== */

async function loadOutline() {
  const d = doc_();
  const el = $('#outline');
  if (!d) { el.innerHTML = '<div class="hint">No file open.</div>'; return; }
  if (!d.outline) {
    try { d.outline = (await api('/api/outline', { path: d.path })).symbols || []; }
    catch { d.outline = []; }
  }
  drawOutline();
  upgradeOutline(d);
}

/* A language server's document symbols beat regex on every axis, so swap them
   in whenever one answers. Panel only: this never moves the viewport. */
async function upgradeOutline(d) {
  if (d.outlineLSP || S.lsp.state === 'off' || S.lsp.state === 'failed') return;
  d.outlineLSP = true;
  let j;
  try { j = await api('/api/lsp/symbols', { path: d.path, wait: 20000 }); }
  catch { d.outlineLSP = false; return; }
  setLspState(j);
  if (!j.symbols || !j.symbols.length) { d.outlineLSP = false; return; }
  d.outline = j.symbols;
  d.outlineSource = j.server;
  if (doc_() === d && $('#panel-outline').classList.contains('active')) drawOutline();
}

function drawOutline() {
  const d = doc_();
  const el = $('#outline');
  if (!d || !d.outline) return;
  const f = $('#outline-filter').value.toLowerCase();
  const syms = f ? d.outline.filter(s => s.name.toLowerCase().includes(f)) : d.outline;
  if (!syms.length) { el.innerHTML = '<div class="hint">No symbols found.</div>'; return; }
  const base = Math.min(...syms.map(s => s.indent));
  el.innerHTML = (d.outlineSource ? '<div class="hint"><span class="src">' + esc(d.outlineSource) + '</span> · ' + syms.length + ' symbols</div>' : '') +
    syms.map(s =>
    '<div class="sym" data-n="' + s.line + '" style="padding-left:' + (10 + Math.min(s.indent - base, 16) * 5) + 'px">' +
    '<span class="kd" data-k="' + esc(s.kind) + '">' + esc(kindLabel(s.kind)) + '</span>' +
    '<span class="sn">' + esc(s.name) + '</span><span class="sl">' + s.line + '</span></div>').join('');
}

const KIND_LABEL = {
  func: 'fn', method: 'fn', fn: 'fn', def: 'fn', defp: 'fn', defmacro: 'mac',
  class: 'cls', struct: 'str', interface: 'int', trait: 'trt', impl: 'impl',
  type: 'typ', typealias: 'typ', enum: 'enm', record: 'rec', object: 'obj',
  const: 'cst', var: 'var', let: 'var', val: 'var',
  module: 'mod', mod: 'mod', namespace: 'ns', defmodule: 'mod', package: 'pkg',
  macro: 'mac', extension: 'ext', protocol: 'int', union: 'uni',
  heading: 'h', sym: '·',
};
function kindLabel(k) { return KIND_LABEL[k] || k.slice(0, 3); }

$('#outline').addEventListener('click', e => {
  const s = e.target.closest('.sym');
  if (!s) return;
  $$('.sym.sel').forEach(x => x.classList.remove('sel'));
  s.classList.add('sel');
  const d = doc_(); if (!d) return;
  d.cur = +s.dataset.n; centerLine(d.cur); render(); updateStatus();
  pushHistory(d.path, d.cur);
});
$('#outline-filter').addEventListener('input', drawOutline);

/* ==========================================================================
   SECTION 12: SIDEBAR PANEL SWITCHING & RESIZING
   - Handles switching between Files, Search, and Outline panels.
   - Implements draggable sidebar splitter divider (#resizer).
   ========================================================================== */

function showPanel(name) {
  document.body.classList.remove('side-hidden');
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
  $$('.rail-btn[data-panel]').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
  if (name === 'search') $('#q').focus();
  if (name === 'outline') { loadOutline(); $('#outline-filter').focus(); }
}
$$('.rail-btn[data-panel]').forEach(b => b.addEventListener('click', () => {
  const on = b.classList.contains('active') && !document.body.classList.contains('side-hidden');
  if (on) document.body.classList.add('side-hidden');
  else showPanel(b.dataset.panel);
}));

$('#btn-reindex').addEventListener('click', async () => {
  $('#st-index').textContent = 'reindexing…';
  const j = await api('/api/reindex');
  S.meta.files = j.files; S.meta.indexMs = j.indexMs;
  treeEl.innerHTML = ''; openDirs.clear();
  await drawTree('', treeEl, 0);
  updateStatus();
});

/* sidebar resize */
(() => {
  const rz = $('#resizer'); let dragging = false;
  rz.addEventListener('mousedown', e => { dragging = true; rz.classList.add('drag'); e.preventDefault(); });
  addEventListener('mousemove', e => {
    if (!dragging) return;
    $('#side').style.width = Math.max(170, Math.min(620, e.clientX - 46)) + 'px';
  });
  addEventListener('mouseup', () => { dragging = false; rz.classList.remove('drag'); layout(); render(); });
})();

/* ==========================================================================
   SECTION 13: FIND IN CURRENT FILE (Ctrl+F)
   - In-buffer search bar overlay (#findbar).
   - Real-time match counting, Next/Prev match navigation (Enter / Shift+Enter).
   ========================================================================== */

const findbar = $('#findbar'), findInput = $('#find-input');

function openFind(seed) {
  if (!doc_()) return;
  findbar.hidden = false;
  if (seed) findInput.value = seed;
  findInput.focus(); findInput.select();
  if (findInput.value) runFind();
}
function clearFind() {
  findbar.hidden = true;
  S.find = null;
  $('#find-count').textContent = '0';
  $('#minimap-hits').innerHTML = '';
  paint();
}

const runFind = debounce(async () => {
  const d = doc_(); if (!d) return;
  const q = findInput.value;
  if (!q) { S.find = null; $('#find-count').textContent = '0'; $('#minimap-hits').innerHTML = ''; paint(); return; }
  let j;
  try { j = await api('/api/search', { q, glob: d.path }); } catch { return; }
  const f = (j.results || []).find(r => r.path === d.path);
  const hits = [];
  if (f) {
    let prevLine = -1, n = 0;
    for (const m of f.matches) {
      n = m.line === prevLine ? n + 1 : 0;
      prevLine = m.line;
      hits.push({ line: m.line, n });
    }
  }
  S.find = { q, ci: false, hits, byLine: new Set(hits.map(h => h.line)), active: hits.length ? 0 : -1 };
  $('#find-count').textContent = hits.length ? '1 / ' + hits.length : 'no results';
  drawMinimap(hits, d.total);
  if (hits.length) jumpToHit(0); else paint();
}, 140);

function drawMinimap(hits, total) {
  const mm = $('#minimap-hits');
  if (!hits.length) { mm.innerHTML = ''; return; }
  const seen = new Set();
  mm.innerHTML = hits.filter(h => !seen.has(h.line) && seen.add(h.line))
    .map(h => '<i style="top:' + ((h.line - 1) / total * 100).toFixed(3) + '%"></i>').join('');
}

function jumpToHit(i) {
  const d = doc_(); if (!d || !S.find || !S.find.hits.length) return;
  const n = S.find.hits.length;
  S.find.active = ((i % n) + n) % n;
  const h = S.find.hits[S.find.active];
  d.cur = h.line;
  const y = (h.line - 1) * LH;
  if (y < vp.scrollTop + LH * 2 || y > vp.scrollTop + vp.clientHeight - LH * 3) centerLine(h.line);
  $('#find-count').textContent = (S.find.active + 1) + ' / ' + n;
  render(); updateStatus();
}

findInput.addEventListener('input', runFind);
findInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); jumpToHit(S.find ? S.find.active + (e.shiftKey ? -1 : 1) : 0); }
  if (e.key === 'Escape') { clearFind(); vp.focus(); }
});
$('#find-next').addEventListener('click', () => jumpToHit(S.find ? S.find.active + 1 : 0));
$('#find-prev').addEventListener('click', () => jumpToHit(S.find ? S.find.active - 1 : 0));
$('#find-close').addEventListener('click', clearFind);
$('#minimap-hits').addEventListener('click', e => {
  const r = $('#minimap-hits').getBoundingClientRect();
  const d = doc_(); if (!d) return;
  centerLine(Math.round((e.clientY - r.top) / r.height * d.total));
  render();
});

/* ==========================================================================
   SECTION 14: COMMAND & FUZZY PALETTES (Cmd+K / Ctrl+P)
   - Universal quick-open overlay modal (#overlay).
   - Modes:
       - 'file' (Ctrl+P): Fuzzy file finder
       - 'symbol' (Ctrl+Shift+O): Workspace symbol search
       - 'command' (Ctrl+Shift+P): Actionable commands
       - 'line' (Ctrl+G): Go to line number
   ========================================================================== */

const overlay = $('#overlay'), palInput = $('#pal'), palList = $('#pal-list');
let pal = null;

const COMMANDS = [
  { name: 'Go to File…', run: () => openPalette('file') },
  { name: 'Go to Symbol in File…', run: () => openPalette('symbol') },
  { name: 'Go to Line…', run: () => openPalette('line') },
  { name: 'Search in Files', run: () => showPanel('search') },
  { name: 'Find in Current File', run: () => openFind(S.lastWord) },
  { name: 'Go to Definition', run: () => gotoDefinition() },
  { name: 'Find All References', run: () => findReferences() },
  { name: 'Reveal Active File in Explorer', run: () => { const d = doc_(); if (d) { showPanel('files'); revealFile(d.path); } } },
  { name: 'Toggle Sidebar', run: () => document.body.classList.toggle('side-hidden') },
  { name: 'Toggle Theme', run: toggleTheme },
  { name: 'Re-index Workspace', run: () => $('#btn-reindex').click() },
  { name: 'Close Tab', run: () => { if (S.active >= 0) closeTab(S.active); } },
  { name: 'Close All Tabs', run: () => { while (S.tabs.length) closeTab(0); } },
  { name: 'Keyboard Shortcuts', run: showHelp },
];

const PAL_MODES = {
  file: { tag: 'File', hint: 'Type to fuzzy-match any file. Prefix : for a line, @ for a symbol, > for a command.' },
  symbol: { tag: 'Symbol', hint: 'Symbols in the active file.' },
  line: { tag: 'Line', hint: 'Enter a line number.' },
  command: { tag: 'Command', hint: '' },
};

function openPalette(mode, seed) {
  pal = { mode, items: [], sel: 0 };
  overlay.hidden = false;
  palInput.value = seed !== undefined ? seed : ({ symbol: '@', line: ':', command: '>' }[mode] || '');
  $('#pal-mode').textContent = PAL_MODES[mode].tag;
  $('#pal-hint').textContent = PAL_MODES[mode].hint;
  palInput.focus();
  palInput.setSelectionRange(palInput.value.length, palInput.value.length);
  refreshPalette();
}
function closePalette() { overlay.hidden = true; pal = null; }

const refreshPalette = debounce(async () => {
  if (!pal) return;
  let raw = palInput.value;
  let mode = 'file';
  if (raw.startsWith('>')) { mode = 'command'; raw = raw.slice(1); }
  else if (raw.startsWith('@')) { mode = 'symbol'; raw = raw.slice(1); }
  else if (raw.startsWith(':')) { mode = 'line'; raw = raw.slice(1); }
  pal.mode = mode;
  $('#pal-mode').textContent = PAL_MODES[mode].tag;
  $('#pal-hint').textContent = PAL_MODES[mode].hint;
  const q = raw.trim();

  if (mode === 'line') {
    const d = doc_();
    const n = parseInt(q, 10);
    pal.items = (d && n > 0) ? [{ kind: 'line', n: Math.min(n, d.total), label: 'Line ' + Math.min(n, d.total), sub: d.path }] : [];
  } else if (mode === 'command') {
    const lq = q.toLowerCase();
    pal.items = COMMANDS.filter(c => c.name.toLowerCase().includes(lq)).map(c => ({ kind: 'cmd', cmd: c, label: c.name, sub: '' }));
  } else if (mode === 'symbol') {
    const d = doc_();
    if (d && !d.outline) { try { d.outline = (await api('/api/outline', { path: d.path })).symbols || []; } catch { d.outline = []; } }
    const lq = q.toLowerCase();
    pal.items = ((d && d.outline) || []).filter(s => !lq || s.name.toLowerCase().includes(lq))
      .slice(0, 400).map(s => ({ kind: 'sym', n: s.line, label: s.name, sub: s.kind, right: String(s.line) }));
  } else {
    let j;
    try { j = await api('/api/find', { q, limit: 120 }); } catch { return; }
    pal.items = j.results.map(r => {
      const cut = r.path.length - r.name.length;
      return {
        kind: 'file', path: r.path,
        label: fuzzyHTML(r.path.slice(cut), (r.pos || []).filter(p => p >= cut).map(p => p - cut)),
        sub: fuzzyHTML(r.path.slice(0, Math.max(0, cut - 1)), (r.pos || []).filter(p => p < cut)),
        raw: true,
      };
    });
  }
  pal.sel = 0;
  drawPalette();
}, 40);

function fuzzyHTML(text, pos) {
  if (!pos || !pos.length) return esc(text);
  const set = new Set(pos);
  let out = '', open = false;
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    if (hit && !open) { out += '<b>'; open = true; }
    if (!hit && open) { out += '</b>'; open = false; }
    out += esc(text[i]);
  }
  return out + (open ? '</b>' : '');
}

function drawPalette() {
  if (!pal) return;
  if (!pal.items.length) { palList.innerHTML = '<div class="pi"><span class="pp">No matches</span></div>'; return; }
  palList.innerHTML = pal.items.map((it, i) =>
    '<div class="pi' + (i === pal.sel ? ' sel' : '') + '" data-i="' + i + '">' +
    '<span class="pn">' + (it.raw ? it.label : esc(it.label)) + '</span>' +
    '<span class="pp">' + (it.raw ? it.sub : esc(it.sub || '')) + '</span>' +
    (it.right ? '<span class="pr">' + esc(it.right) + '</span>' : '') + '</div>').join('');
  const s = palList.children[pal.sel];
  if (s) s.scrollIntoView({ block: 'nearest' });
}

function movePalette(delta) {
  if (!pal || !pal.items.length) return;
  pal.sel = (pal.sel + delta + pal.items.length) % pal.items.length;
  drawPalette();
}

function acceptPalette() {
  if (!pal || !pal.items.length) return;
  const it = pal.items[pal.sel];
  closePalette();
  if (it.kind === 'file') openFile(it.path);
  else if (it.kind === 'sym' || it.kind === 'line') {
    const d = doc_(); if (!d) return;
    d.cur = it.n; centerLine(it.n); render(); updateStatus(); pushHistory(d.path, it.n);
  } else if (it.kind === 'cmd') it.cmd.run();
}

palInput.addEventListener('input', refreshPalette);
palInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { e.preventDefault(); movePalette(1); }
  else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { e.preventDefault(); movePalette(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); acceptPalette(); }
  else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  else if (e.key === 'Tab') { e.preventDefault(); movePalette(e.shiftKey ? -1 : 1); }
});
palList.addEventListener('click', e => {
  const p = e.target.closest('.pi');
  if (p && p.dataset.i !== undefined) { pal.sel = +p.dataset.i; acceptPalette(); }
});
overlay.addEventListener('mousedown', e => { if (e.target === overlay) closePalette(); });

/* ==========================================================================
   SECTION 15: THEME & HELP OVERLAY
   - Dark / Light theme toggle with localStorage persistence.
   - Help cheatsheet overlay (#helpsheet) showing keyboard shortcuts.
   ========================================================================== */

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('lide.theme', next); } catch {}
}
$('#btn-theme').addEventListener('click', toggleTheme);

const SHORTCUTS = [
  ['Ctrl K', 'Quick search / palette'], ['Ctrl P', 'Go to file'],
  ['Ctrl Shift P', 'Command palette'], ['Ctrl Shift O', 'Go to symbol'],
  ['Ctrl Shift F', 'Search in files'], ['Ctrl F', 'Find in file'],
  ['Ctrl G', 'Go to line'], ['Enter / Shift Enter', 'Next / previous match'],
  ['F12 or Ctrl Click', 'Go to definition'], ['Shift F12', 'Find all references'],
  ['Alt ←  /  Alt →', 'Navigate back / forward'], ['Ctrl B', 'Toggle sidebar'],
  ['Ctrl W', 'Close tab'], ['Ctrl Tab', 'Next tab'],
  ['Alt 1 … 9', 'Select tab'], ['Double click', 'Highlight all occurrences'],
  ['Ctrl Home / End', 'Top / bottom of file'], ['Esc', 'Dismiss'],
];
function showHelp() {
  const h = $('#helpsheet');
  h.innerHTML = '<div class="help-card"><h2>Keyboard Shortcuts</h2><dl class="help-grid">' +
    SHORTCUTS.map(([k, v]) =>
      '<dt>' + k.split(' ').map(x => '<kbd>' + esc(x.replace('Ctrl', isMac ? '⌘' : 'Ctrl')) + '</kbd>').join('') + '</dt>' +
      '<dd>' + esc(v) + '</dd>').join('') + '</dl></div>';
  h.hidden = false;
}
$('#btn-help').addEventListener('click', showHelp);
$('#helpsheet').addEventListener('click', () => { $('#helpsheet').hidden = true; });

/* ==========================================================================
   SECTION 16: GLOBAL KEYBOARD SHORTCUTS
   - Intercepts Cmd+K, Ctrl+P, Ctrl+F, Ctrl+B, F12, Shift+F12, Esc, etc.
   ========================================================================== */

const inField = el => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');

addEventListener('keydown', e => {
  const mod = e[MOD];

  if (e.key === 'Escape') {
    if (!overlay.hidden) { closePalette(); return; }
    if (!$('#helpsheet').hidden) { $('#helpsheet').hidden = true; return; }
    if (!hovercard.hidden) { clearLink(); return; }
    if (!findbar.hidden) { clearFind(); return; }
    if (S.occ) { S.occ = null; paint(); return; }
    if (inField(document.activeElement)) document.activeElement.blur();
    return;
  }

  // Universal Quick Open / Command Palette: Cmd+K / Ctrl+K
  if (mod && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    openPalette(e.shiftKey ? 'command' : 'file');
    return;
  }

  if (mod && e.shiftKey && (e.key === 'P' || e.key === 'p')) { e.preventDefault(); openPalette('command'); return; }
  if (mod && e.shiftKey && (e.key === 'O' || e.key === 'o')) { e.preventDefault(); openPalette('symbol'); return; }
  if (mod && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); showPanel('search'); $('#q').select(); return; }
  if (mod && !e.shiftKey && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); openPalette('file'); return; }
  if (mod && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); openPalette('line'); return; }
  if (mod && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); openFind(S.lastWord); return; }
  if (mod && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); document.body.classList.toggle('side-hidden'); layout(); render(); return; }
  if (mod && (e.key === 'w' || e.key === 'W')) { e.preventDefault(); if (S.active >= 0) closeTab(S.active); return; }
  if (e.key === 'F12') {
    e.preventDefault();
    if (e.shiftKey) findReferences(); else gotoDefinition();
    return;
  }
  if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); go(-1); return; }
  if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); go(1); return; }
  if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault();
    if (S.tabs.length > 1) switchTab((S.active + (e.shiftKey ? -1 : 1) + S.tabs.length) % S.tabs.length);
    return;
  }
  if (e.altKey && /^[1-9]$/.test(e.key)) { e.preventDefault(); switchTab(+e.key - 1); return; }

  if (inField(document.activeElement)) return;

  if (e.key === '?') { e.preventDefault(); showHelp(); return; }
  const d = doc_();
  if (!d) return;
  if (mod && e.key === 'Home') { e.preventDefault(); vp.scrollTop = 0; d.cur = 1; render(); updateStatus(); return; }
  if (mod && e.key === 'End') { e.preventDefault(); vp.scrollTop = sizer.offsetHeight; d.cur = d.total; render(); updateStatus(); return; }
  if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); moveCursor(1); return; }
  if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); moveCursor(-1); return; }
  if (e.key === 'PageDown') { e.preventDefault(); moveCursor(Math.floor(vp.clientHeight / LH) - 2); return; }
  if (e.key === 'PageUp') { e.preventDefault(); moveCursor(-(Math.floor(vp.clientHeight / LH) - 2)); return; }
});

function moveCursor(delta) {
  const d = doc_(); if (!d) return;
  d.cur = Math.max(1, Math.min(d.total, d.cur + delta));
  const y = (d.cur - 1) * LH;
  if (y < vp.scrollTop) vp.scrollTop = y - LH;
  else if (y > vp.scrollTop + vp.clientHeight - LH * 2) vp.scrollTop = y - vp.clientHeight + LH * 3;
  render(); updateStatus();
}

/* ==========================================================================
   SECTION 17: BOOTSTRAP / INITIALIZATION
   - Measures font metrics, loads /api/meta, draws file tree, restores saved theme,
     and monitors background indexer completion.
   ========================================================================== */

(async function boot() {
  try { const t = localStorage.getItem('lide.theme'); if (t) document.documentElement.dataset.theme = t; } catch {}
  if (isMac) {
    document.querySelectorAll('.mod-key').forEach(el => el.textContent = '⌘');
  }
  measure();
  S.meta = await api('/api/meta');
  document.title = S.meta.name + ' — lide';
  $('#root-name').textContent = S.meta.name;
  $('#root-name').title = S.meta.root;
  updateStatus();
  await drawTree('', treeEl, 0);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measure(); layout(); render(); });

  // If the background indexer was still running when the UI loaded, poll briefly
  // until complete to update the total file count and index time in the status bar.
  if (S.meta && !S.meta.ready) {
    const timer = setInterval(async () => {
      try {
        const m = await api('/api/meta');
        if (m.ready) {
          clearInterval(timer);
          S.meta = m;
          updateStatus();
        }
      } catch { clearInterval(timer); }
    }, 150);
  }
})();
