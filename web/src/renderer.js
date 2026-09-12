// web/src/renderer.js
import { $, S, doc_, api, LH, CHUNK, OVERSCAN } from './state.js';
import { vp, sizer, rowsEl, editor } from './ui.js';

export function measure() {
  const m = $('#measure');
  m.textContent = 'x'.repeat(100);
  S.chW = m.getBoundingClientRect().width / 100 || 7.8;
}

export function layout() {
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
export function render() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; paint(); });
}

export function paint() {
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
export function decorate(first, last) {
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
export function markNodes(el, needle, caseSensitive, cls) {
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
export function wrapRange(el, from, to, cls) {
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

export function rowFor(line) {
  for (const r of rowsEl.children) if (+r.dataset.l === line) return r;
  return null;
}

export function ensureChunks(d, first, last) {
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
export function refineChunk(d, c, delay = 800, tries = 0) {
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

export function initRenderer() {
  vp.addEventListener('scroll', render, { passive: true });
  new ResizeObserver(() => { layout(); render(); }).observe(editor);
}
