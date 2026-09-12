// web/src/main.js
import { $, S, api, isMac } from './state.js';
import { measure, layout, render, initRenderer, updateEditorOptionControls } from './renderer.js';
import { initTabs } from './tabs.js';
import { initCursor } from './cursor.js';
import { initHover } from './hover.js';
import { initRefMenu } from './refmenu.js';
import { drawTree, treeEl, initTree } from './tree.js';
import { initSearch } from './search.js';
import { initOutline } from './outline.js';
import { initPanels } from './panels.js';
import { initInspector } from './inspector.js';
import { initFind } from './find.js';
import { initPalette } from './palette.js';
import { initShortcuts } from './shortcuts.js';
import { updateStatus, initMetrics, updateMetricsDisplay } from './status.js';

// Initialize all subsystems
initRenderer();
initTabs();
initCursor();
initHover();
initRefMenu();
initTree();
initSearch();
initOutline();
initPanels();
initInspector();
initFind();
initPalette();
initShortcuts();
initMetrics();

// Bootstrap application lifecycle
(async function boot() {
  try {
    const t = localStorage.getItem('px0.theme');
    if (t) document.documentElement.dataset.theme = t;

    // Restore word wrap (default ON)
    const wrapPref = localStorage.getItem('px0.wrap');
    S.wrap = wrapPref !== null ? wrapPref === 'true' : true;
    document.body.classList.toggle('word-wrap', S.wrap);

    // Restore line numbers (default ON)
    const linesPref = localStorage.getItem('px0.lineNumbers');
    S.lineNumbers = linesPref !== null ? linesPref === 'true' : true;
    document.body.classList.toggle('hide-lines', !S.lineNumbers);

    updateEditorOptionControls();
  } catch {}

  if (isMac) {
    document.querySelectorAll('.mod-key').forEach(el => el.textContent = '⌘');
  }

  measure();
  S.meta = await api('/api/meta');
  if (S.meta.metrics) updateMetricsDisplay(S.meta.metrics);
  document.title = S.meta.name + ' - px0';
  $('#root-name').textContent = S.meta.name;
  $('#root-name').title = S.meta.root;
  if (S.meta.version) {
    const emptyVerEl = $('#empty-ver');
    if (emptyVerEl) emptyVerEl.textContent = 'v' + S.meta.version;
  }
  updateStatus();
  await drawTree('', treeEl, 0);

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { measure(); layout(); render(); });
  }

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
      } catch {
        clearInterval(timer);
      }
    }, 150);
  }
})();
