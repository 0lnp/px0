// web/src/cursor.js
import { S, doc_, MOD, LH } from './state.js';
import { vp, rowsEl } from './ui.js';
import { paint, render } from './renderer.js';
import { updateStatus } from './status.js';
import { findReferences } from './lsp.js';

export const WORD = /[A-Za-z0-9_$]/;

/* Returns {word, line, col} where col counts UTF-16 units from the start of the
   line, which is both what JS string indexes give us and what the server needs
   to place an LSP request. Walking text nodes keeps this correct even after
   find or occurrence marks have wrapped parts of the line. */
export function wordAtPoint(x, y) {
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

export function moveCursor(delta) {
  const d = doc_(); if (!d) return;
  d.cur = Math.max(1, Math.min(d.total, d.cur + delta));
  const y = (d.cur - 1) * LH;
  if (y < vp.scrollTop) vp.scrollTop = y - LH;
  else if (y > vp.scrollTop + vp.clientHeight - LH * 2) vp.scrollTop = y - vp.clientHeight + LH * 3;
  render(); updateStatus();
}

export function initCursor() {
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
}
