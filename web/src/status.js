// web/src/status.js
import { $, S, doc_ } from './state.js';

export function updateStatus() {
  const d = doc_();
  $('#st-lang').textContent = d ? d.lang : '';
  $('#st-lines').textContent = d ? d.total.toLocaleString() + ' lines' : '';
  $('#st-size').textContent = d ? fmtBytes(d.size) : '';
  $('#st-pos').textContent = d ? 'Ln ' + d.cur : '';
  if (S.meta) $('#st-index').textContent = S.meta.files.toLocaleString() + ' files · ' + S.meta.indexMs + 'ms';
  drawLspStatus();
}

export function setStatusNote(msg) {
  $('#st-pos').textContent = msg;
}

export function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

export function setLspState(j) {
  if (!j || !j.state) return;
  S.lsp.state = j.state;
  S.lsp.server = j.server || S.lsp.server;
  drawLspStatus();
}

export function drawLspStatus() {
  const el = $('#st-lsp');
  const { state, server } = S.lsp;
  if (!server || state === 'off') { el.textContent = ''; el.removeAttribute('data-state'); return; }
  el.dataset.state = state;
  el.textContent = state === 'ready' ? server : server + ' ' + state;
}
