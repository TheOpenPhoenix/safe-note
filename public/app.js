import * as C from './crypto.js';
import { renderMarkdown, toggleTaskAt } from './markdown.js';

const NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  pin: '<path d="M14 3l7 7-3 1-3 3 1 5-2 2-4-6-6 5 5-6-6-4 2-2 5 1 3-3z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  check: '<path d="M5 13l4 4L19 7"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
};
function icon(name) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'svg' + (name === 'pin' ? ' fill' : ''));
  s.setAttribute('aria-hidden', 'true');
  const t = document.createElementNS(NS, 'svg'); t.innerHTML = ICONS[name];
  s.append(...t.childNodes); return s;
}
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}
const root = document.getElementById('app');
const mount = (...n) => { root.replaceChildren(...n); };
let toastTimer;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast', role: 'status' }, msg); document.body.append(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 3500);
}

async function api(method, path, body) {
  const r = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || 'Request failed'); e.status = r.status; throw e; }
  return data;
}

const isConflict = (e) => e.status === 409;

const SETTINGS_ID = '_settings_';
const state = {
  dek: null, vault: null, seq: 0,
  notes: new Map(),
  settings: { autolock: 15, theme: 'system', zoom: 100 },
  view: { kind: 'notes', label: null, q: '' },
  poll: null, idle: null,
};
const COLORS = 7;
const normalize = (d) => {
  if (d.items) { d.body = d.items.map((i) => `- [${i.d ? 'x' : ' '}] ${i.t}`).join('\n'); }
  d.items = null; d.labels ||= []; d.body ||= ''; d.title ||= ''; return d;
};
const blankNote = () => ({ title: '', body: '', items: null, color: 0, pinned: false, archived: false, trashed: 0, labels: [], created: Date.now(), edited: Date.now() });

function applyZoom(z) {
  const n = Number(z); const pct = n >= 50 && n <= 300 ? n : 100;
  document.documentElement.style.zoom = pct === 100 ? '' : String(pct / 100);
}
function applyTheme(t) {
  const r = document.documentElement;
  if (t === 'light' || t === 'dark') r.dataset.theme = t; else delete r.dataset.theme;
}

function passwordField(id, label, extra = {}) {
  const input = h('input', { class: 'input', id, type: 'password', autocomplete: extra.auto || 'off', spellcheck: 'false' });
  const show = h('button', { type: 'button', class: 'btn ghost sm', onclick: () => { input.type = input.type === 'password' ? 'text' : 'password'; show.textContent = input.type === 'password' ? 'Show' : 'Hide'; } }, 'Show');
  return { input, el: h('label', { class: 'field', for: id }, label, h('div', { class: 'pwrow' }, input, show)) };
}
const mark = () => h('div', { class: 'mark' }, icon('lock'));

const MIN_PASSPHRASE = 10;
function passphraseProblem(a, b) {
  if (a.length < MIN_PASSPHRASE) return `Use at least ${MIN_PASSPHRASE} characters.`;
  return a === b ? '' : 'Passphrases do not match.';
}

function strength(p) {
  let s = Math.min(p.length, 24) * 3 + (/[a-z]/.test(p) ? 4 : 0) + (/[A-Z]/.test(p) ? 6 : 0) + (/\d/.test(p) ? 6 : 0) + (/[^A-Za-z0-9]/.test(p) ? 8 : 0);
  if (/\s/.test(p) && p.split(/\s+/).length >= 4) s += 20;
  return Math.max(0, Math.min(100, s));
}

async function boot() {
  mount(h('div', { class: 'center' }, h('p', {}, 'Loading…')));
  try {
    const v = await api('GET', '/api/vault');
    if (!v.exists) return showSetup();
    state.vault = v; showUnlock();
  } catch (e) {
    mount(h('div', { class: 'center' }, h('div', { class: 'panel' }, h('h2', {}, 'Cannot reach SafeNote'), h('p', {}, e.message), h('button', { class: 'btn', onclick: boot }, 'Try again'))));
  }
}

function showUnlock(useRecovery = false) {
  const err = h('div', { class: 'err', role: 'alert' });
  const pw = passwordField('secret', useRecovery ? 'Recovery key' : 'Passphrase', { auto: 'current-password' });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Unlock');
  const form = h('form', { class: 'panel', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true; btn.textContent = 'Unlocking…';
    try {
      const secret = pw.input.value;
      state.dek = useRecovery ? await C.unlockWithRecoveryKey(state.vault.key_blob, secret) : await C.unlockWithPassphrase(state.vault.key_blob, secret);
      await startApp();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Unlock'; pw.input.select(); }
  } },
    mark(), h('div', {}, h('h2', {}, 'Unlock your notes'), h('p', { class: 'sub' }, 'Your passphrase never leaves this browser.')),
    pw.el, err, btn,
    h('button', { type: 'button', class: 'linkbtn', onclick: () => showUnlock(!useRecovery) }, useRecovery ? 'Use passphrase instead' : 'Use recovery key instead'));
  mount(h('div', { class: 'center' }, form)); pw.input.focus();
}

function showSetup() {
  const err = h('div', { class: 'err', role: 'alert' });
  const p1 = passwordField('p1', 'Passphrase', { auto: 'new-password' });
  const p2 = passwordField('p2', 'Confirm passphrase', { auto: 'new-password' });
  const meter = h('div', { class: 'meter' }, h('b', {}));
  const tip = h('p', {}, 'Use 5 or more random words. This is the only thing protecting your notes.');
  p1.input.addEventListener('input', () => { const s = strength(p1.input.value); meter.firstChild.style.width = s + '%'; });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Create vault');
  const form = h('form', { class: 'panel', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    const problem = passphraseProblem(p1.input.value, p2.input.value);
    if (problem) return void (err.textContent = problem);
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const { blob, dek, recoveryKey } = await C.createVault(p1.input.value);
      showRecovery(recoveryKey, async () => {
        await api('PUT', '/api/vault', { key_blob: blob, expect_version: 0 });
        state.vault = { key_blob: blob, key_version: 1 }; state.dek = dek; await startApp();
      });
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Create vault'; }
  } }, mark(), h('div', {}, h('h2', {}, 'Create your vault'), h('p', {}, 'Pick a passphrase. Notes are encrypted here, before they are sent.')), p1.el, meter, tip, p2.el, err, btn);
  mount(h('div', { class: 'center' }, form)); p1.input.focus();
}

function showRecovery(key, onDone, message = 'If you forget your passphrase, this is the only way back in. We cannot reset it for you. Shown once.') {
  const lines = key.match(/(?:[A-Z2-7]{4}-?){1,4}/g).map((l) => l.replace(/-$/, ''));
  const ack = h('input', { type: 'checkbox', id: 'ack' });
  const btn = h('button', { class: 'btn', disabled: true }, 'Continue');
  ack.addEventListener('change', () => { btn.disabled = !ack.checked; });
  const err = h('div', { class: 'err' });
  btn.addEventListener('click', async () => { btn.disabled = true; try { await onDone(); } catch (e) { err.textContent = e.message; btn.disabled = false; } });
  const copy = h('button', { class: 'btn ghost', onclick: async () => { try { await navigator.clipboard.writeText(key); toast('Copied'); } catch { toast('Copy failed: select and copy the key'); } } }, 'Copy');
  const dl = h('button', { class: 'btn ghost', onclick: () => download('safenote-recovery-key.txt', `SafeNote recovery key\n\n${key}\n\nAnyone with this key can read your notes. Keep it private.\n`, 'text/plain') }, 'Download .txt');
  mount(h('div', { class: 'center' }, h('div', { class: 'panel' },
    h('h2', {}, 'Save your recovery key'), h('p', {}, message),
    h('div', { class: 'rk' }, lines.map((l, i) => [l, i < lines.length - 1 ? h('br') : null])),
    h('div', { class: 'pwrow' }, copy, dl),
    h('div', { class: 'warn' }, 'Anyone with this key can read your notes. Keep it in a password manager or on paper.'),
    h('label', { class: 'check', for: 'ack' }, ack, 'I saved my recovery key'), err, btn)));
}

function download(name, text, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function decryptRow(r) {
  if (r.ct == null) return null;
  try { return await C.decryptNote(state.dek, r.id, r); } catch { return { _corrupt: true }; }
}
async function pull() {
  const res = await api('GET', `/api/notes?since=${state.seq}`);
  let changed = false;
  for (const r of res.notes) {
    const data = await decryptRow(r);
    if (r.id === SETTINGS_ID) { if (data && !data._corrupt) { state.settings = { ...state.settings, ...data }; state.settingsSeq = r.seq; applyTheme(state.settings.theme); applyZoom(state.settings.zoom); resetIdle(); } continue; }
    if (data === null) state.notes.delete(r.id); else if (!data._corrupt) state.notes.set(r.id, { seq: r.seq, data: normalize(data) });
    changed = true;
  }
  state.seq = res.seq; return changed;
}
async function pushNote(id, data) {
  const entry = state.notes.get(id) || { seq: 0 };
  data.edited = Date.now();
  const { iv, ct } = await C.encryptNote(state.dek, id, data);
  const res = await api('PUT', `/api/notes/${id}`, { iv, ct, base_seq: entry.seq });
  state.notes.set(id, { seq: res.seq, data }); state.seq = Math.max(state.seq, res.seq);
}
async function removeNote(id) {
  const entry = state.notes.get(id);
  const res = await api('DELETE', `/api/notes/${id}?base_seq=${entry ? entry.seq : 0}`);
  state.notes.delete(id); state.seq = Math.max(state.seq, res.seq);
}
async function updateSetting(key, value, apply, onError) {
  state.settings[key] = value;
  apply?.(value);
  try { await saveSettings(); } catch (e) { onError(e); }
}
const rememberLocally = (k, v) => { try { localStorage.setItem('safenote-' + k, v); } catch {} };

let settingsQueue = Promise.resolve();
function saveSettings() {
  settingsQueue = settingsQueue.catch(() => {}).then(async () => {
    const { iv, ct } = await C.encryptNote(state.dek, SETTINGS_ID, state.settings);
    const res = await api('PUT', `/api/notes/${SETTINGS_ID}`, { iv, ct, base_seq: state.settingsSeq || 0 });
    state.settingsSeq = res.seq; state.seq = Math.max(state.seq, res.seq);
  });
  return settingsQueue;
}

async function startApp() {
  state.notes.clear(); state.seq = 0;
  await pull();
  for (const [id, n] of state.notes) if (n.data.trashed && Date.now() - n.data.trashed > 30 * 864e5) removeNote(id).catch(() => {});
  render();
  clearInterval(state.poll);
  state.poll = setInterval(() => { if (state.dek && !document.hidden && !state.editing) pull().then((c) => c && state.view.kind !== 'settings' && render()).catch(() => {}); }, 30000);
  resetIdle();
}

function resetIdle() {
  clearTimeout(state.idle);
  const mins = Number(state.settings.autolock);
  if (state.dek && mins > 0) state.idle = setTimeout(lock, mins * 60000);
}
['pointerdown', 'keydown', 'scroll'].forEach((ev) => addEventListener(ev, () => state.dek && resetIdle(), { passive: true }));
export function lock() {
  state.dek = null; state.notes.clear(); state.seq = 0; state.settingsSeq = 0; state.editing = null;
  state.view = { kind: 'notes', label: null, q: '' };
  state.settings = { autolock: 15, theme: state.settings.theme, zoom: state.settings.zoom };
  clearInterval(state.poll); clearTimeout(state.idle);
  document.querySelector('.dim')?.remove();
  boot();
}

function allLabels() { const s = new Set(); for (const { data } of state.notes.values()) for (const l of data.labels) if (!data.trashed) s.add(l); return [...s].sort((a, b) => a.localeCompare(b)); }
function visible() {
  const { kind, label, q } = state.view; const needle = q.trim().toLowerCase();
  return [...state.notes.entries()].filter(([, { data: d }]) => {
    if (kind === 'trash') return !!d.trashed;
    if (d.trashed) return false;
    if (kind === 'archive') { if (!d.archived) return false; }
    else if (d.archived) return false;
    if (kind === 'label' && !d.labels.includes(label)) return false;
    if (needle) { const hay = [d.title, d.body, ...d.labels].join('\n').toLowerCase(); if (!hay.includes(needle)) return false; }
    return true;
  }).sort((a, b) => b[1].data.edited - a[1].data.edited);
}
function card(id, d) {
  const el = h('div', { class: `n c${d.color}${d.pinned ? ' pinned' : ''}`, tabindex: 0, role: 'button', onclick: () => openEditor(id), onkeydown: (e) => { if (e.key === 'Enter') openEditor(id); } });
  if (d.pinned) el.append(h('span', { class: 'pin' }, icon('pin')));
  if (d.title) el.append(h('h3', {}, d.title));
  if (d.body) el.append(renderMarkdown(d.body, { onToggle: async (line) => {
    const entry = state.notes.get(id); if (!entry || state.view.kind === 'trash') return;
    const nd = structuredClone(entry.data); nd.body = toggleTaskAt(nd.body, line);
    try { await pushNote(id, nd); } catch (e) { toast(isConflict(e) ? 'Changed elsewhere. Reloading…' : e.message); await pull().catch(() => {}); }
    renderGrid();
  } }));
  if (d.labels.length) el.append(h('div', { class: 'labels' }, d.labels.map((l) => h('span', { class: 'chip' }, l))));
  return el;
}
function setView(v) { state.view = { q: state.view.q, ...v }; render(); }

function render() {
  if (!state.dek) return;
  const counts = { notes: 0, archive: 0 };
  for (const { data: d } of state.notes.values()) if (!d.trashed) counts[d.archived ? 'archive' : 'notes']++;
  const { kind, label } = state.view;
  const nav = (text, k, lab, count) => h('button', { class: 'nav' + (kind === k && label === lab ? ' on' : ''), onclick: () => { document.querySelector('.side')?.classList.remove('open'); setView({ kind: k, label: lab }); } }, text, count != null ? h('small', {}, count) : null);
  const search = h('input', { class: 'search', id: 'q', type: 'search', placeholder: 'Search notes', 'aria-label': 'Search notes', value: state.view.q });
  search.addEventListener('input', () => {
    state.view.q = search.value;
    if (state.view.kind === 'settings') { state.view = { q: search.value, kind: 'notes', label: null }; render(); const q = document.getElementById('q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); return; }
    renderGrid();
  });
  const side = h('aside', { class: 'side' },
    h('div', { class: 'logo' }, icon('lock'), 'SafeNote'),
    search,
    nav('Notes', 'notes', null, counts.notes), nav('Archive', 'archive', null, counts.archive), nav('Trash', 'trash', null),
    allLabels().length ? h('div', { class: 'sec' }, 'Labels') : null,
    ...allLabels().map((l) => nav(l, 'label', l)),
    h('div', { style: 'flex:1' }),
    h('button', { class: 'nav' + (kind === 'settings' ? ' on' : ''), onclick: () => { document.querySelector('.side')?.classList.remove('open'); showSettings(); } }, icon('gear'), 'Settings'),
    h('button', { class: 'nav', onclick: lock }, icon('lock'), 'Lock now'));
  const head = h('div', { class: 'head' },
    h('button', { class: 'ibtn menubtn', 'aria-label': 'Menu', onclick: () => side.classList.toggle('open') }, icon('menu')));
  const body = h('div', { class: 'main', id: 'main' });
  mount(h('div', { class: 'shell' }, side, h('div', { class: 'content' }, head, body)),
    kind === 'settings' ? null : h('button', { class: 'fab', 'aria-label': 'New note', onclick: () => openEditor(null) }, icon('plus')));
  renderGrid();
}

function renderGrid() {
  const main = document.getElementById('main'); if (!main) return;
  if (state.view.kind === 'settings') { if (!main.firstChild) paintSettings(); return; }
  const list = visible(); const { kind } = state.view; const out = [];
  if (kind === 'notes' || kind === 'label') out.push(h('button', { class: 'capture', onclick: () => openEditor(null) }, 'Take a note…', h('span', { title: 'New checklist', onclick: (e) => { e.stopPropagation(); openEditor(null, { body: '- [ ] ' }); } }, '☑')));
  const pinned = list.filter(([, n]) => n.data.pinned), others = list.filter(([, n]) => !n.data.pinned);
  const grid = (items) => h('div', { class: 'grid' }, items.map(([id, n]) => card(id, n.data)));
  if (kind === 'trash') out.push(h('p', { class: 'sub' }, 'Notes in the trash are deleted for good after 30 days.'), h('button', { class: 'btn ghost sm', style: 'align-self:flex-start', onclick: emptyTrash }, 'Empty trash'));
  if (pinned.length) out.push(h('div', {}, h('div', { class: 'sect' }, 'Pinned'), grid(pinned)));
  if (others.length) out.push(h('div', {}, pinned.length ? h('div', { class: 'sect' }, 'Others') : null, grid(others)));
  if (!list.length) out.push(h('div', { class: 'empty' }, state.view.q ? 'No notes match your search.' : kind === 'trash' ? 'Trash is empty.' : kind === 'archive' ? 'No archived notes.' : 'Your notes appear here. Take your first note above.'));
  main.replaceChildren(...out);
}
async function emptyTrash() { for (const [id, n] of [...state.notes]) if (n.data.trashed) await removeNote(id).catch(() => {}); render(); }

function openEditor(existingId, init = {}) {
  const isNew = !existingId; const id = existingId || C.newId();
  const d = isNew ? blankNote() : structuredClone(state.notes.get(id).data);
  if (isNew && state.view.kind === 'label') d.labels = [state.view.label];
  if (isNew && init.body) d.body = init.body;
  state.editing = id;
  let dirty = false, timer = null, saving = Promise.resolve(), closed = false;
  const status = h('span', { class: 'status' });
  const setStatus = (t, ok) => status.replaceChildren(ok ? icon('check') : '', t);
  const empty = () => !d.title.trim() && !d.body.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?$/gm, '').trim();
  let previewing = !isNew && !!d.body.trim();
  const save = () => {
    clearTimeout(timer); if (!dirty || (isNew && empty() && !state.notes.has(id))) return saving;
    dirty = false; setStatus('Encrypting…');
    saving = saving.then(async () => {
      try { await pushNote(id, structuredClone(d)); setStatus('Encrypted & saved', true); }
      catch (e) { dirty = true; setStatus(isConflict(e) ? 'Changed elsewhere. Reload.' : 'Not saved: ' + e.message); if (isConflict(e)) await pull().catch(() => {}); }
    });
    return saving;
  };
  const touch = () => { dirty = true; setStatus('Unsaved'); clearTimeout(timer); timer = setTimeout(save, 1000); };

  const dim = h('div', { class: 'dim', onmousedown: (e) => { if (e.target === dim) close(); } });
  const ed = h('div', { class: 'editor c' + d.color, role: 'dialog', 'aria-label': 'Note editor' });
  async function close() { if (closed) return; closed = true; await save(); state.editing = null; dim.remove(); render(); }
  function paint() {
    ed.className = 'editor c' + d.color;
    const title = h('input', { class: 't', placeholder: 'Title', value: d.title, 'aria-label': 'Title', oninput: (e) => { d.title = e.target.value; touch(); } });
    let ta = null, content;
    const grow = () => { if (ta) { ta.style.height = 'auto'; ta.style.height = Math.max(160, ta.scrollHeight) + 'px'; } };
    const sync = () => { d.body = ta.value; touch(); grow(); };
    if (previewing) {
      content = h('div', { class: 'preview', title: 'Click to edit', onclick: () => { previewing = false; paint(); ta && ta.focus(); } },
        d.body.trim() ? renderMarkdown(d.body, { onToggle: (line) => { d.body = toggleTaskAt(d.body, line); touch(); paint(); } }) : h('p', { class: 'sub' }, 'Nothing to preview yet.'));
    } else {
      ta = h('textarea', { class: 'b', placeholder: 'Take a note… (Markdown supported)', 'aria-label': 'Note', spellcheck: 'true', oninput: sync });
      ta.value = d.body;
      ta.addEventListener('keydown', (e) => {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); wrap('**', '**', 'bold'); }
        else if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); wrap('*', '*', 'italic'); }
        else if (e.key === 'Enter' && !mod && !e.shiftKey && continueList()) e.preventDefault();
        else if (e.key === 'Tab' && shiftList(e.shiftKey)) e.preventDefault();
      });
      content = ta;
    }
    const lineBounds = () => { const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd; const a0 = v.lastIndexOf('\n', s - 1) + 1; let b0 = v.indexOf('\n', e); if (b0 < 0) b0 = v.length; return [a0, b0]; };
    const setText = (v, s, e = s) => { ta.value = v; ta.setSelectionRange(s, e); sync(); };
    function wrap(before, after, ph) {
      const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd, sel = v.slice(s, e) || ph;
      setText(v.slice(0, s) + before + sel + after + v.slice(e), s + before.length, s + before.length + sel.length);
    }
    function prefixLines(prefix) {
      const [a0, b0] = lineBounds(), v = ta.value, block = v.slice(a0, b0);
      const lines = block.split('\n').map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : prefix + l.replace(/^(\s*)(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|#{1,6}\s+)/, '$1')));
      const out = lines.join('\n'); setText(v.slice(0, a0) + out + v.slice(b0), a0, a0 + out.length);
    }
    function numberLines() {
      const [a0, b0] = lineBounds(), v = ta.value; let n = 0;
      const out = v.slice(a0, b0).split('\n').map((l) => `${++n}. ${l.replace(/^(\s*)(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '$1')}`).join('\n');
      setText(v.slice(0, a0) + out + v.slice(b0), a0, a0 + out.length);
    }
    function continueList() {
      const v = ta.value, pos = ta.selectionStart; if (pos !== ta.selectionEnd) return false;
      const start = v.lastIndexOf('\n', pos - 1) + 1, line = v.slice(start, pos);
      const m = /^(\s*)([-*+]|(\d+)([.)]))\s+(\[[ xX]\]\s+)?(.*)$/.exec(line); if (!m) return false;
      if (m[6] === '' ) { setText(v.slice(0, start) + v.slice(pos), start); return true; }
      const marker = m[3] ? `${parseInt(m[3], 10) + 1}${m[4]}` : m[2];
      const ins = `\n${m[1]}${marker} ${m[5] ? '[ ] ' : ''}`;
      setText(v.slice(0, pos) + ins + v.slice(pos), pos + ins.length); return true;
    }
    function shiftList(outdent) {
      const [a0] = lineBounds(), v = ta.value; if (!/^\s*(?:[-*+]|\d+[.)])\s/.test(v.slice(a0, v.indexOf('\n', a0) < 0 ? v.length : v.indexOf('\n', a0)))) return false;
      const s = ta.selectionStart;
      if (outdent) { const m = /^( {1,2}|\t)/.exec(v.slice(a0)); if (!m) return true; setText(v.slice(0, a0) + v.slice(a0 + m[0].length), Math.max(a0, s - m[0].length)); }
      else setText(v.slice(0, a0) + '  ' + v.slice(a0), s + 2);
      return true;
    }
    const tb = (label, title, fn) => h('button', { type: 'button', class: 'tb', title, 'aria-label': title, disabled: previewing, onmousedown: (e) => e.preventDefault(), onclick: fn }, label);
    const toolbar = h('div', { class: 'mdbar', role: 'toolbar', 'aria-label': 'Formatting' },
      tb('H', 'Heading', () => prefixLines('# ')), tb('B', 'Bold (Ctrl+B)', () => wrap('**', '**', 'bold')), tb('I', 'Italic (Ctrl+I)', () => wrap('*', '*', 'italic')),
      tb('S', 'Strikethrough', () => wrap('~~', '~~', 'text')), tb('▮', 'Spoiler: ||secret|| or ||secret||{label}', () => wrap('||', '||', 'secret')), tb('•', 'Bulleted list', () => prefixLines('- ')), tb('1.', 'Numbered list', numberLines),
      tb('☑', 'Checklist', () => prefixLines('- [ ] ')), tb('“', 'Quote', () => prefixLines('> ')), tb('<>', 'Code', () => wrap('`', '`', 'code')),
      tb('🔗', 'Link', () => wrap('[', '](https://)', 'text')),
      h('button', { type: 'button', class: 'chip', style: 'margin-left:auto', 'aria-pressed': String(previewing), onclick: () => { previewing = !previewing; paint(); if (!previewing && ta) ta.focus(); } }, previewing ? 'Edit' : 'Preview'));
    const labelIn = h('input', { class: 'labin', placeholder: '+ Label', list: 'labs', 'aria-label': 'Add label', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); const v = labelIn.value.trim(); if (v && !d.labels.includes(v)) { d.labels.push(v); touch(); paint(); } } } });
    const sw = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Colour' }, [...Array(COLORS).keys()].map((c) => h('button', { type: 'button', class: `sw c${c}${d.color === c ? ' sel' : ''}`, 'aria-label': 'Colour ' + (c + 1), onclick: () => { d.color = c; touch(); ed.className = 'editor c' + c; sw.querySelectorAll('.sw').forEach((b, i) => b.classList.toggle('sel', i === c)); } })));
    const mk = (text, fn, on) => h('button', { type: 'button', class: 'chip', 'aria-pressed': on === undefined ? null : String(!!on), onclick: fn }, text);
    ed.replaceChildren(
      h('div', { style: 'display:flex;gap:8px;align-items:center' }, title, h('button', { type: 'button', class: 'ibtn', style: 'border:0;background:none', 'aria-label': d.pinned ? 'Unpin' : 'Pin', 'aria-pressed': String(d.pinned), onclick: () => { d.pinned = !d.pinned; touch(); paint(); } }, h('span', { style: d.pinned ? 'color:var(--accent)' : 'color:var(--muted)' }, icon('pin')))),
      toolbar,
      content,
      h('div', { class: 'labels' }, d.labels.map((l) => h('button', { type: 'button', class: 'chip', title: 'Remove label', onclick: () => { d.labels = d.labels.filter((x) => x !== l); touch(); paint(); } }, l + ' ×')), labelIn,
        h('datalist', { id: 'labs' }, allLabels().map((l) => h('option', { value: l })))),
      sw,
      h('div', { class: 'tools' },
        mk(d.archived ? 'Unarchive' : 'Archive', async () => { d.archived = !d.archived; dirty = true; await close(); }),
        d.trashed ? mk('Restore', async () => { d.trashed = 0; dirty = true; await close(); }) : mk('Delete', async () => { if (isNew && !state.notes.has(id)) { dirty = false; return close(); } d.trashed = Date.now(); d.pinned = false; dirty = true; await close(); toast('Moved to trash'); }),
        d.trashed ? mk('Delete forever', async () => { dirty = false; closed = true; try { await removeNote(id); } catch (e) { toast(e.message); } state.editing = null; dim.remove(); render(); }) : null,
        status, h('button', { type: 'button', class: 'btn sm', onclick: close }, 'Close')));
    grow();
  }
  paint(); dim.append(ed); document.body.append(dim);
  dim.addEventListener('keydown', (e) => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); close(); } });
  (ed.querySelector('textarea') || ed.querySelector('.t')).focus();
}

function showSettings() { setView({ kind: 'settings', label: null }); }
function paintSettings() {
  const err = h('div', { class: 'err', role: 'alert' });
  const showErr = (e) => { err.textContent = e.message; };
  const sel = (idv, opts, cur, on) => { const s = h('select', { id: idv }, opts.map(([v, t]) => h('option', { value: v, selected: String(v) === String(cur) }, t))); s.addEventListener('change', () => on(s.value)); return s; };
  const row = (title, sub, ctl) => h('div', { class: 'row' }, h('div', {}, h('b', {}, title), h('small', {}, sub)), ctl);
  const btn = (t, fn) => h('button', { class: 'btn ghost sm', onclick: fn }, t);

  const changePass = () => {
    const cur = passwordField('cp0', 'Current passphrase', { auto: 'current-password' }), n1 = passwordField('cp1', 'New passphrase', { auto: 'new-password' }), n2 = passwordField('cp2', 'Confirm new passphrase', { auto: 'new-password' });
    const e2 = h('div', { class: 'err' });
    const go = h('button', { class: 'btn sm', onclick: async () => {
      e2.textContent = '';
      const problem = passphraseProblem(n1.input.value, n2.input.value);
      if (problem) return void (e2.textContent = problem);
      try {
        const fresh = await api('GET', '/api/vault');
        const blob = await C.rewrapPassphrase(fresh.key_blob, { passphrase: cur.input.value }, n1.input.value);
        const r = await api('PUT', '/api/vault', { key_blob: blob, expect_version: fresh.key_version });
        state.vault = { key_blob: blob, key_version: r.key_version }; toast('Passphrase changed'); showSettings();
      } catch (ex) { e2.textContent = ex.message; }
    } }, 'Change passphrase');
    box.replaceChildren(h('div', { class: 'row formrow' }, cur.el, n1.el, n2.el, e2, h('div', { class: 'pwrow' }, go, btn('Cancel', showSettings))));
  };
  const newRecovery = () => {
    const cur = passwordField('nr0', 'Current passphrase', { auto: 'current-password' }); const e2 = h('div', { class: 'err' });
    const go = h('button', { class: 'btn sm', onclick: async () => {
      try {
        const fresh = await api('GET', '/api/vault');
        const { blob, recoveryKey } = await C.rotateRecoveryKey(fresh.key_blob, cur.input.value);
        showRecovery(recoveryKey, async () => { const r = await api('PUT', '/api/vault', { key_blob: blob, expect_version: fresh.key_version }); state.vault = { key_blob: blob, key_version: r.key_version }; toast('New recovery key saved'); showSettings(); }, 'Your old recovery key stops working once you continue.');
      } catch (ex) { e2.textContent = ex.message; }
    } }, 'Create new key');
    box.replaceChildren(h('div', { class: 'row formrow' }, cur.el, e2, h('div', { class: 'pwrow' }, go, btn('Cancel', showSettings))));
  };
  const exportEnc = async () => {
    const all = await api('GET', '/api/notes?since=0'); const v = await api('GET', '/api/vault');
    download('safenote-encrypted-backup.json', JSON.stringify({ app: 'safenote', version: 1, key_blob: v.key_blob, notes: all.notes }, null, 1), 'application/json');
  };
  let confirmPlain = false, delArmed = false;
  const exportPlain = () => {
    if (!confirmPlain) { confirmPlain = true; toast('Press again to export unencrypted notes'); setTimeout(() => { confirmPlain = false; }, 5000); return; }
    confirmPlain = false;
    download('safenote-notes.json', JSON.stringify([...state.notes.values()].map((n) => n.data), null, 1), 'application/json');
  };
  const deleteAcct = btn('Delete account', async () => {
    if (!delArmed) { delArmed = true; deleteAcct.textContent = 'Press again to confirm'; return; }
    try { await api('DELETE', '/api/account'); lock(); toast('Account deleted'); } catch (e) { err.textContent = e.message; }
  });
  const box = h('div', { class: 'set' },
    h('h2', {}, 'Settings'),
    h('div', { class: 'sect' }, 'Security'),
    row('Change passphrase', 'Re-wraps your key. Notes are not re-encrypted.', btn('Change', changePass)),
    row('Generate new recovery key', 'Old recovery key stops working.', btn('Create', newRecovery)),
    row('Auto-lock', 'Lock after this much idle time.', sel('autolock', [[0, 'Never'], [5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour']], state.settings.autolock, (v) => updateSetting('autolock', Number(v), resetIdle, showErr))),
    h('div', { class: 'sect' }, 'Data'),
    row('Export encrypted backup', 'JSON you can restore with your passphrase.', btn('Export', exportEnc)),
    row('Export decrypted notes', 'Plain text. Handle with care.', btn('Export', exportPlain)),
    h('div', { class: 'sect' }, 'Appearance'),
    row('Theme', 'System, light or dark', sel('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], state.settings.theme, (v) => updateSetting('theme', v, (t) => { applyTheme(t); rememberLocally('theme', t); }, showErr))),
    row('Zoom', 'Scale the whole interface. Ctrl and + or - in your browser works too.', sel('zoom', [[75, '75%'], [90, '90%'], [100, '100%'], [110, '110%'], [125, '125%'], [150, '150%'], [175, '175%'], [200, '200%']], state.settings.zoom || 100, (v) => updateSetting('zoom', Number(v), (z) => { applyZoom(z); rememberLocally('zoom', z); }, showErr))),
    err,
    h('div', { class: 'danger' }, h('div', { class: 'sect' }, 'Danger zone'),
      h('div', { class: 'row' }, h('div', {}, h('b', {}, 'Delete account'), h('small', {}, 'Removes your vault and every note from the server. This cannot be undone.')), deleteAcct)));
  document.getElementById('main').replaceChildren(box);
}

try { const t = localStorage.getItem('safenote-theme'); if (t) applyTheme(t); const z = localStorage.getItem('safenote-zoom'); if (z) { state.settings.zoom = Number(z); applyZoom(z); } } catch {}
boot();
