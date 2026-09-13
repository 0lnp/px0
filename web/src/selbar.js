// web/src/selbar.js
import { $, doc_ } from './state.js';
import { vp, copyToClipboard } from './ui.js';
import { findReferences } from './lsp.js';
import { fitStatus } from './status.js';

/* While code is selected, the left of the status bar trades its navigation
   buttons for actions on the selection, and hands them back once the selection
   is gone. Unlike a floating menu it never covers code, and its buttons stay put. */

const status = $('#status');
const refEl = $('#sel-ref');
const statsEl = $('#sel-stats');

// e.code, not e.key: Option+letter types a symbol on macOS.
export const SEL_KEYS = { KeyC: 'copy-ref', KeyA: 'copy-agent', KeyU: 'usages' };

let current = null;   // the selection the bar is showing, or null when it is not

export function getSelectedRangeInfo() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const d = doc_();
  if (!d) return null;

  const range = sel.getRangeAt(0);
  if (!vp.contains(range.commonAncestorContainer)) return null;

  const text = sel.toString().trim();
  if (!text) return null;

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

  return { text, l1, l2, path: d.path };
}

const refOf = ({ path, l1, l2 }) => path + ':' + (l1 === l2 ? l1 : l1 + '-' + l2);

function showSelectionBar(info) {
  current = info;
  const ref = refOf(info);
  const lines = info.l2 - info.l1 + 1;
  refEl.textContent = ref;
  refEl.title = ref;
  statsEl.textContent = (lines === 1 ? '1 line' : lines + ' lines') + ' · ' +
    info.text.length.toLocaleString() + ' chars';
  status.classList.add('selecting');
  fitStatus();
}

export function hideSelectionBar() {
  if (!current) return;
  current = null;
  status.classList.remove('selecting');
  fitStatus();
}

export function updateSelectionBar() {
  const info = getSelectedRangeInfo();
  if (info) showSelectionBar(info); else hideSelectionBar();
}

/* Runs one of the bar's actions on the current selection. Returns false when the
   bar is not showing, so a shortcut can fall through to the browser. */
export function runSelectionAction(act) {
  if (!current) return false;
  const { text, path } = current;
  const ref = refOf(current);
  if (act === 'copy-ref') {
    copyToClipboard(ref, 'Copied ' + ref);
  } else if (act === 'copy-agent') {
    const ext = path.split('.').pop() || '';
    copyToClipboard('### Reference: ' + ref + '\n```' + ext + '\n' + text + '\n```', 'Copied snippet for Agent (' + ref + ')');
  } else if (act === 'usages') {
    findReferences(text.split(/\s+/)[0] || text);
  } else {
    return false;
  }
  return true;
}

export function initSelectionBar() {
  /* Enter only once the gesture is over: swapping the footer mid-drag flickers.
     Once showing, follow the selection as it changes, and leave when it collapses
     or moves out of the editor. Listening on the document catches a drag that
     is released outside the viewport. */
  document.addEventListener('mouseup', () => setTimeout(updateSelectionBar, 20));
  vp.addEventListener('keyup', e => { if (e.shiftKey) setTimeout(updateSelectionBar, 20); });
  document.addEventListener('selectionchange', () => { if (current) updateSelectionBar(); });

  const bar = $('#footer-sel');
  // Pressing a button must not clear the selection it is about to act on.
  bar.addEventListener('mousedown', e => e.preventDefault());
  bar.addEventListener('click', e => {
    const btn = e.target.closest('[data-sel]');
    if (btn) runSelectionAction(btn.dataset.sel);
  });
}
