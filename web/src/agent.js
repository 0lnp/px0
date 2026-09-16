// web/src/agent.js
import { $, esc, S, api, apiPost } from './state.js';
import { showToast } from './ui.js';
import { setStatusNote } from './status.js';
import { reloadOpenTabs } from './tabs.js';
import { drawTree, treeEl } from './tree.js';
import { setAgentHandler, hideSelectionBar } from './selbar.js';

/* px0 still does not write source files. This box composes an instruction and
   the range it is anchored to, hands both to a coding harness on this machine,
   and reloads whatever moved once that harness exits. Because px0 dispatched
   the run it knows when the work ended, so nothing here watches the filesystem.

   Harnesses are detected, not configured: the picker lists what is installed
   and the choice is remembered in the settings file. Detecting one is never
   enough to run it, so the first edit in a fresh install asks which to use. */

const box = $('#agentbox');
const input = $('#agent-input');
const refEl = $('#agent-ref');
const harnessBtn = $('#agent-harness');
const pickEl = $('#agent-pick');
const composeEl = $('#agent-compose');
const sendBtn = $('#agent-send');
const hintEl = $('.agent-hint');

let target = null;   // the selection the instruction is anchored to
let timer = null;    // poll timer of the run in flight, or null

const installed = () => (S.meta?.agents || []).filter(h => h.installed);
const chosen = () => (S.meta && S.meta.agent) || '';
const offerable = () => !!chosen() || installed().length > 0;
const refOf = ({ path, l1, l2 }) => path + ':' + (l1 === l2 ? l1 : l1 + '-' + l2);

/* The button ships hidden: only the workspace metadata knows whether any
   harness is installed, and that arrives after the modules are wired up. */
export function applyAgentMeta() {
  const btn = $('[data-sel="agent-edit"]');
  if (btn) btn.hidden = !offerable();
  if (harnessBtn) {
    harnessBtn.textContent = chosen() || 'choose harness';
    harnessBtn.disabled = !!(S.meta && S.meta.agentPinned);
    harnessBtn.title = S.meta && S.meta.agentPinned
      ? 'Fixed for this run by -agent'
      : 'Change the coding harness';
  }
}

export function openAgentEdit(info) {
  if (!offerable() || !info) return;
  if (timer) { showToast('!', 'An edit is already running'); return; }
  target = info;
  refEl.textContent = refOf(info);
  refEl.title = refOf(info);
  if (hintEl) {
    hintEl.textContent = info.fromDiff
      ? 'Editing uncommitted changes · Enter to send'
      : 'Enter to send, Esc to cancel';
  }
  input.value = '';
  box.hidden = false;
  // Nothing runs until a harness has been picked at least once.
  if (chosen()) showCompose(); else showPicker();
}

export function closeAgentEdit() {
  box.hidden = true;
  target = null;
}

function showCompose() {
  pickEl.hidden = true;
  composeEl.hidden = false;
  input.focus();
}

async function showPicker() {
  composeEl.hidden = true;
  pickEl.hidden = false;
  pickEl.innerHTML = '<div class="hint">Looking for coding harnesses…</div>';

  let list = S.meta?.agents || [];
  let settingsPath = '';
  // Re-scan, so a harness installed since startup shows up without a restart.
  try {
    const j = await api('/api/agent/harnesses');
    list = j.harnesses || [];
    settingsPath = j.settings || '';
    S.meta.agents = list;
    S.meta.agent = j.selected || '';
    S.meta.agentPinned = !!j.pinned;
  } catch (e) {
    pickEl.innerHTML = '<div class="hint">Could not look for harnesses: ' + esc(e.message) + '</div>';
    return;
  }

  const ready = list.filter(h => h.installed);
  if (!ready.length) {
    pickEl.innerHTML = '<div class="hint">No coding harness found. Install ' +
      list.map(h => '<b>' + esc(h.name) + '</b>').join(', ') +
      ' and make sure it is on PATH.</div>';
    return;
  }

  let html = '<div class="hint">This harness will edit files in this workspace.</div>';
  for (const h of ready) {
    html += '<button class="agent-opt' + (h.name === chosen() ? ' on' : '') + '" data-pick="' + esc(h.name) + '">' +
      '<span class="agent-opt-name">' + esc(h.name) + '</span>' +
      '<code class="agent-opt-cmd">' + esc(h.cmd) + '</code></button>';
  }
  if (settingsPath) html += '<div class="agent-note">Remembered in ' + esc(settingsPath) + '</div>';
  pickEl.innerHTML = html;

  pickEl.querySelectorAll('[data-pick]').forEach(b => {
    b.addEventListener('click', () => pick(b.dataset.pick));
  });
}

async function pick(name) {
  try {
    const j = await apiPost('/api/agent/select', { name });
    S.meta.agent = j.selected || '';
    S.meta.agents = j.harnesses || S.meta.agents;
    S.meta.agentPinned = !!j.pinned;
  } catch (e) {
    showToast('!', e.message);
    return;
  }
  applyAgentMeta();
  showToast('✓', 'Edits will run through ' + name);
  showCompose();
}

async function submit() {
  const instruction = input.value.trim();
  if (!instruction || !target) return;
  const params = { path: target.path, l1: target.l1, l2: target.l2, instruction };
  /* The uncommitted-work guard exists to make invisible changes visible. In the
     diff view they are on screen and are the reason the user is here, so the
     composer says so in place of a confirm on every single edit. */
  if (target.fromDiff) params.force = 1;

  try {
    await apiPost('/api/agent/edit', params);
  } catch (e) {
    /* The harness rewrites in place and px0 has no undo of its own, so the
       server refuses once when the file holds work that was never committed. */
    if (!/uncommitted/.test(e.message) || !confirm(e.message + '\n\nRun the edit anyway?')) {
      showToast('!', e.message);
      return;
    }
    try {
      await apiPost('/api/agent/edit', { ...params, force: 1 });
    } catch (e2) {
      showToast('!', e2.message);
      return;
    }
  }

  closeAgentEdit();
  hideSelectionBar();
  setStatusNote('Editing with ' + chosen() + '...');
  timer = setTimeout(tick, 400);
}

async function tick() {
  let j;
  try {
    j = await api('/api/agent/job');
  } catch (e) {
    timer = null;
    setStatusNote('');
    showToast('!', e.message);
    return;
  }

  if (j.running) {
    setStatusNote('Editing with ' + j.harness + '... ' + Math.round((j.ms || 0) / 1000) + 's');
    timer = setTimeout(tick, 600);
    return;
  }

  timer = null;
  await finish(j);
}

async function finish(j) {
  setStatusNote('');
  if (j.error) showToast('!', (j.harness || 'agent') + ': ' + j.error);

  /* Without git px0 cannot tell what the harness touched, so an empty list
     means "unknown" rather than "nothing" and everything is reloaded. */
  const changed = j.changed || [];
  if (!changed.length && j.tracked !== false) {
    if (!j.error) showToast('✓', 'Finished with no file changes');
    return;
  }

  /* Reload in the order the data depends on: the index first, so the tree and
     git badges agree with disk, then the open tabs, which keep their scroll,
     cursor and diff view across the swap. */
  try {
    await api('/api/reindex');
    await reloadOpenTabs();
    await drawTree('', treeEl, 0);
  } catch (e) {
    showToast('!', 'Edited, but the reload failed: ' + e.message);
    return;
  }

  showToast('✓', !changed.length ? 'Reloaded the workspace'
    : changed.length === 1 ? 'Updated ' + changed[0]
      : 'Updated ' + changed.length + ' files');
}

export function initAgent() {
  if (!box) return;
  setAgentHandler(openAgentEdit);

  sendBtn.addEventListener('click', submit);
  harnessBtn.addEventListener('click', () => {
    if (!harnessBtn.disabled) showPicker();
  });

  /* The composer swallows every key while it is open. Nothing typed into an
     instruction should also fire a viewport shortcut. */
  box.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      closeAgentEdit();
    } else if (e.key === 'Enter' && !e.shiftKey && !composeEl.hidden) {
      e.preventDefault();
      submit();
    }
  });
}
