// web/src/refmenu.js
import { doc_ } from './state.js';
import { vp, editor, refmenu, copyToClipboard } from './ui.js';
import { findReferences } from './lsp.js';

export function hideRefMenu() {
  if (refmenu && !refmenu.hidden) {
    refmenu.hidden = true;
    refmenu.innerHTML = '';
  }
}

export function getSelectedRangeInfo() {
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

export function updateSelectionMenu() {
  const info = getSelectedRangeInfo();
  if (!info || !info.text) {
    hideRefMenu();
    return;
  }

  const { text, l1, l2, rect, path } = info;
  const refPath = path + ':' + (l1 === l2 ? l1 : l1 + '-' + l2);

  refmenu.innerHTML =
    '<button id="rm-copy-ref" title="Copy file and line number">Copy Ref</button>' +
    '<button id="rm-copy-claude" title="Copy formatted code snippet for AI Agent / LLM harness">Copy for Agent</button>' +
    '<button id="rm-find-refs" title="Find all occurrences across workspace">Find Usages</button>';

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
    copyToClipboard(formatted, 'Copied snippet for Agent (' + refPath + ')');
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

export function initRefMenu() {
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
}
