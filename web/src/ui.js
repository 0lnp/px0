// web/src/ui.js
import { $, esc } from './state.js';

export const vp = $('#viewport');
export const sizer = $('#sizer');
export const rowsEl = $('#rows');
export const editor = $('#editor');
export const refmenu = $('#refmenu');
export const toastEl = $('#toast');

let toastTimer = 0;
export function showToast(accentText, text) {
  if (!toastEl) return;
  toastEl.innerHTML = (accentText ? '<span class="toast-accent">' + esc(accentText) + '</span> ' : '') + esc(text);
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2200);
}

export async function copyToClipboard(text, notify = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
    showToast('✓', notify);
  } catch {
    // Fallback for non-https/restricted contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('✓', notify);
    } catch (err) {
      showToast('!', 'Failed to copy to clipboard');
    }
    document.body.removeChild(ta);
  }
}
