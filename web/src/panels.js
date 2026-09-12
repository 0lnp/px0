// web/src/panels.js
import { $, $$, S, api } from './state.js';
import { layout, render } from './renderer.js';
import { updateStatus } from './status.js';
import { loadOutline } from './outline.js';
import { treeEl, openDirs, drawTree } from './tree.js';

export function showPanel(name) {
  document.body.classList.remove('side-hidden');
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
  $$('.rail-btn[data-panel]').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
  if (name === 'search') $('#q').focus();
  if (name === 'outline') { loadOutline(); $('#outline-filter').focus(); }
}

export function initPanels() {
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
    addEventListener('mouseup', () => { if (dragging) { dragging = false; rz.classList.remove('drag'); layout(); render(); } });
  })();
}
