// web/src/shortcuts.js
import { $, $$, esc, S, doc_, isMac, MOD, LH } from './state.js';
import { vp, sizer } from './ui.js';
import { layout, render, paint, toggleWordWrap, toggleLineNumbers } from './renderer.js';
import { updateStatus } from './status.js';
import { closeTab, switchTab } from './tabs.js';
import { go } from './history.js';
import { clearLink, hovercard } from './hover.js';
import { openFind, clearFind, findbar } from './find.js';
import { gotoDefinition, findReferences } from './lsp.js';
import { showPanel } from './panels.js';
import { showRightInspector, hideRightInspector } from './inspector.js';
import { overlay, openPalette, closePalette } from './palette.js';
import { moveCursor } from './cursor.js';

export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('lide.theme', next); } catch {}
}

export const SHORTCUTS = [
  ['Ctrl K', 'Quick search / palette'], ['Ctrl P', 'Go to file'],
  ['Ctrl Shift P', 'Command palette'], ['Ctrl Shift O', 'Go to symbol'],
  ['Ctrl Shift F', 'Search in files'], ['Ctrl F', 'Find in file'],
  ['Ctrl G', 'Go to line'], ['Alt Z', 'Toggle word wrap'],
  ['Enter / Shift Enter', 'Next / previous match'],
  ['F12 or Ctrl Click', 'Go to definition'], ['Shift F12', 'Find all references'],
  ['Ctrl J', 'Toggle right inspector (Symbols/Refs)'],
  ['Alt ←  /  Alt →', 'Navigate back / forward'], ['Ctrl B', 'Toggle sidebar'],
  ['Ctrl W / Alt W', 'Close tab'], ['Ctrl Tab', 'Next tab'],
  ['Alt 1 … 9', 'Select tab'], ['Double click', 'Highlight all occurrences'],
  ['Ctrl Home / End', 'Top / bottom of file'], ['Esc', 'Dismiss'],
];

export function showHelp() {
  const h = $('#helpsheet');
  const ver = S.meta?.version ? ` <span class="help-version">v${esc(S.meta.version)}</span>` : '';
  h.innerHTML = '<div class="help-card"><div class="help-header"><h2>Keyboard Shortcuts</h2>' + ver + '</div><dl class="help-grid">' +
    SHORTCUTS.map(([k, v]) =>
      '<dt>' + k.split(' ').map(x => '<kbd>' + esc(x.replace('Ctrl', isMac ? '⌘' : 'Ctrl')) + '</kbd>').join('') + '</dt>' +
      '<dd>' + esc(v) + '</dd>').join('') + '</dl></div>';
  h.hidden = false;
}

export const inField = el => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');

export function initShortcuts() {
  $('#btn-theme')?.addEventListener('click', toggleTheme);
  $('#btn-help')?.addEventListener('click', showHelp);
  $('#st-ver')?.addEventListener('click', showHelp);
  $('#helpsheet').addEventListener('click', () => { $('#helpsheet').hidden = true; });

  // Footer quick action buttons
  $('#footer-actions')?.addEventListener('click', e => {
    const btn = e.target.closest('.footer-btn');
    if (!btn) return;
    const act = btn.dataset.action;
    if (act === 'quick-open') openPalette('file');
    else if (act === 'search') { showPanel('search'); $('#q').select(); }
    else if (act === 'symbols') openPalette('symbol');
    else if (act === 'find') openFind(S.lastWord);
    else if (act === 'goto') openPalette('line');
    else if (act === 'wrap') toggleWordWrap();
    else if (act === 'line-numbers') toggleLineNumbers();
    else if (act === 'palette') openPalette('command');
    else if (act === 'help') showHelp();
  });

  addEventListener('keydown', e => {
    const mod = e[MOD];

    if (e.key === 'Escape') {
      if (!overlay.hidden) { closePalette(); return; }
      if (!$('#helpsheet').hidden) { $('#helpsheet').hidden = true; return; }
      if (!hovercard.hidden) { clearLink(); return; }
      if (!findbar.hidden) { clearFind(); return; }
      if (!document.body.classList.contains('right-hidden')) { hideRightInspector(); return; }
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

    if (mod && (e.key === 'j' || e.key === 'J')) {
      e.preventDefault();
      if (document.body.classList.contains('right-hidden')) showRightInspector('refs');
      else hideRightInspector();
      return;
    }

    if (mod && e.shiftKey && (e.key === 'P' || e.key === 'p')) { e.preventDefault(); openPalette('command'); return; }
    if (mod && e.shiftKey && (e.key === 'O' || e.key === 'o')) { e.preventDefault(); showRightInspector('symbols'); return; }
    if (mod && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); showPanel('search'); $('#q').select(); return; }
    if (mod && !e.shiftKey && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); openPalette('file'); return; }
    if (mod && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); openPalette('line'); return; }
    if (mod && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); openFind(S.lastWord); return; }
    if (mod && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); document.body.classList.toggle('side-hidden'); layout(); render(); return; }
    if ((mod || e.altKey) && (e.key === 'w' || e.key === 'W')) {
      e.preventDefault();
      e.stopPropagation();
      if (S.active >= 0) closeTab(S.active);
      return;
    }
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
    if (e.altKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      toggleWordWrap();
      return;
    }

    if (e.altKey && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      toggleLineNumbers();
      return;
    }

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
  }, { capture: true });

  // When files are open, prompt before accidentally closing the browser window/tab
  // (e.g. if the browser intercepts Ctrl+W before JavaScript).
  window.addEventListener('beforeunload', e => {
    if (S.tabs.length > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}
