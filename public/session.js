import { state } from './state.js';
import { pull, removeNote } from './sync.js';
import { render } from './notes-view.js';
import { boot } from './auth.js';

export async function startApp() {
  state.notes.clear();
  state.seq = 0;
  await pull();
  for (const [id, n] of state.notes)
    if (n.data.trashed && Date.now() - n.data.trashed > 30 * 864e5) removeNote(id).catch(() => {});
  render();
  clearInterval(state.poll);
  state.poll = setInterval(() => {
    if (state.dek && !document.hidden && !state.editing)
      pull()
        .then((c) => c && state.view.kind !== 'settings' && render())
        .catch(() => {});
  }, 30000);
  resetIdle();
}

export function resetIdle() {
  clearTimeout(state.idle);
  const mins = Number(state.settings.autolock);
  if (state.dek && mins > 0) state.idle = setTimeout(lock, mins * 60000);
}

export function lock() {
  state.dek = null;
  state.notes.clear();
  state.seq = 0;
  state.settingsSeq = 0;
  state.editing = null;
  state.view = { kind: 'notes', label: null, q: '' };
  state.settings = { autolock: 15, theme: state.settings.theme, zoom: state.settings.zoom };
  clearInterval(state.poll);
  clearTimeout(state.idle);
  document.querySelector('.dim')?.remove();
  boot();
}
