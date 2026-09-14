// web/src/diff.js
// Unified-diff view of the open file, toggled with Cmd/Ctrl+D. It reuses the
// normal virtualized renderer by swapping the active doc's lines for the diff
// text (each +/- line pre-wrapped in a coloured span) and restoring them on
// toggle-off. No new renderer, "a rendering job and nothing more".
import { $, S, doc_, esc, api, CHUNK } from './state.js';
import { vp } from './ui.js';
import { render, layout } from './renderer.js';
import { setStatusNote } from './status.js';

// A chunk set covering the whole (in-memory) diff, so ensureChunks never fetches.
function diffChunks(total) {
  const s = new Set();
  for (let c = 0; c <= Math.floor(total / CHUNK); c++) s.add(c);
  return s;
}

export async function toggleDiff() {
  if (!S.meta?.git) return;
  const d = doc_();
  if (!d) return;
  if (d.diffSaved) { exitDiff(d); return; }
  let j;
  try { j = await api('/api/diff', { path: d.path }); }
  catch { setStatusNote('No diff'); return; }
  if (!j.available || !j.diff) { setStatusNote('No diff — clean file or not a git repo'); return; }
  enterDiff(d, j.diff);
}

function enterDiff(d, diff) {
  const raw = diff.split('\n');
  const lines = raw.map(l => {
    const c = l[0];
    const cls = c === '+' ? 'diff-add' : c === '-' ? 'diff-del' : c === '@' ? 'diff-hunk' : '';
    const body = esc(l);
    return cls ? '<span class="' + cls + '">' + body + '</span>' : body;
  });
  d.diffSaved = {
    lines: d.lines, total: d.total, maxCols: d.maxCols,
    chunks: d.chunks, pending: d.pending, cur: d.cur, scrollTop: vp.scrollTop,
  };
  d.lines = lines;
  d.total = lines.length;
  d.maxCols = raw.reduce((m, l) => Math.max(m, l.length), 0);
  d.chunks = diffChunks(lines.length);
  d.pending = new Set();
  d.cur = 1;
  d.gen++; // invalidate any in-flight /api/file fetch for the real file
  document.body.classList.add('diff-view');
  vp.scrollTop = 0;
  layout(); render();
  setStatusNote('diff view — ' + d.name + ' (press again to exit)');
}

function exitDiff(d) {
  const s = d.diffSaved;
  d.diffSaved = null;
  d.lines = s.lines; d.total = s.total; d.maxCols = s.maxCols;
  d.chunks = s.chunks; d.pending = s.pending; d.cur = s.cur;
  d.gen++;
  document.body.classList.remove('diff-view');
  layout();
  vp.scrollTop = s.scrollTop;
  render();
  setStatusNote('');
}
