import * as C from './crypto.js';
import { SETTINGS_ID, applyTheme, applyZoom, normalize, state } from './state.js';
import { api } from './api.js';
import { resetIdle } from './session.js';

async function decryptRow(r) {
  if (r.ct == null) return null;
  try {
    return await C.decryptNote(state.dek, r.id, r);
  } catch {
    return { _corrupt: true };
  }
}

export async function pull() {
  const res = await api('GET', `/api/notes?since=${state.seq}`);
  let changed = false;
  for (const r of res.notes) {
    const data = await decryptRow(r);
    if (r.id === SETTINGS_ID) {
      if (data && !data._corrupt) {
        state.settings = { ...state.settings, ...data };
        state.settingsSeq = r.seq;
        applyTheme(state.settings.theme);
        applyZoom(state.settings.zoom);
        resetIdle();
      }
      continue;
    }
    if (data === null) state.notes.delete(r.id);
    else if (!data._corrupt) state.notes.set(r.id, { seq: r.seq, data: normalize(data) });
    changed = true;
  }
  state.seq = res.seq;
  return changed;
}

export async function pushNote(id, data) {
  const entry = state.notes.get(id) || { seq: 0 };
  data.edited = Date.now();
  const { iv, ct } = await C.encryptNote(state.dek, id, data);
  const res = await api('PUT', `/api/notes/${id}`, { iv, ct, base_seq: entry.seq });
  state.notes.set(id, { seq: res.seq, data });
  state.seq = Math.max(state.seq, res.seq);
}

export async function removeNote(id) {
  const entry = state.notes.get(id);
  const res = await api('DELETE', `/api/notes/${id}?base_seq=${entry ? entry.seq : 0}`);
  state.notes.delete(id);
  state.seq = Math.max(state.seq, res.seq);
}

export async function updateSetting(key, value, apply, onError) {
  state.settings[key] = value;
  apply?.(value);
  try {
    await saveSettings();
  } catch (e) {
    onError(e);
  }
}

export const rememberLocally = (k, v) => {
  try {
    localStorage.setItem('safenote-' + k, v);
  } catch {}
};

let settingsQueue = Promise.resolve();

function saveSettings() {
  settingsQueue = settingsQueue
    .catch(() => {})
    .then(async () => {
      const { iv, ct } = await C.encryptNote(state.dek, SETTINGS_ID, state.settings);
      const res = await api('PUT', `/api/notes/${SETTINGS_ID}`, { iv, ct, base_seq: state.settingsSeq || 0 });
      state.settingsSeq = res.seq;
      state.seq = Math.max(state.seq, res.seq);
    });
  return settingsQueue;
}
