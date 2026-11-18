import * as C from './crypto.js';
import { download, h, mark, mount, passwordField, toast } from './dom.js';
import { api } from './api.js';
import { state } from './state.js';
import { startApp } from './session.js';

const MIN_PASSPHRASE = 10;

export function passphraseProblem(a, b) {
  if (a.length < MIN_PASSPHRASE) return `Use at least ${MIN_PASSPHRASE} characters.`;
  return a === b ? '' : 'Passphrases do not match.';
}

function strength(p) {
  let s =
    Math.min(p.length, 24) * 3 +
    (/[a-z]/.test(p) ? 4 : 0) +
    (/[A-Z]/.test(p) ? 6 : 0) +
    (/\d/.test(p) ? 6 : 0) +
    (/[^A-Za-z0-9]/.test(p) ? 8 : 0);
  if (/\s/.test(p) && p.split(/\s+/).length >= 4) s += 20;
  return Math.max(0, Math.min(100, s));
}

export async function boot() {
  mount(h('div', { class: 'center' }, h('p', {}, 'Loading…')));
  try {
    const v = await api('GET', '/api/vault');
    if (!v.exists) return showSetup();
    state.vault = v;
    showUnlock();
  } catch (e) {
    mount(
      h(
        'div',
        { class: 'center' },
        h(
          'div',
          { class: 'panel' },
          h('h2', {}, 'Cannot reach SafeNote'),
          h('p', {}, e.message),
          h('button', { class: 'btn', onclick: boot }, 'Try again'),
        ),
      ),
    );
  }
}

function showUnlock(useRecovery = false) {
  const err = h('div', { class: 'err', role: 'alert' });
  const pw = passwordField('secret', useRecovery ? 'Recovery key' : 'Passphrase', {
    auto: 'current-password',
  });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Unlock');
  const form = h(
    'form',
    {
      class: 'panel',
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        btn.disabled = true;
        btn.textContent = 'Unlocking…';
        try {
          const secret = pw.input.value;
          state.dek = useRecovery
            ? await C.unlockWithRecoveryKey(state.vault.key_blob, secret)
            : await C.unlockWithPassphrase(state.vault.key_blob, secret);
          await startApp();
        } catch (ex) {
          err.textContent = ex.message;
          btn.disabled = false;
          btn.textContent = 'Unlock';
          pw.input.select();
        }
      },
    },
    mark(),
    h(
      'div',
      {},
      h('h2', {}, 'Unlock your notes'),
      h('p', { class: 'sub' }, 'Your passphrase never leaves this browser.'),
    ),
    pw.el,
    err,
    btn,
    h(
      'button',
      { type: 'button', class: 'linkbtn', onclick: () => showUnlock(!useRecovery) },
      useRecovery ? 'Use passphrase instead' : 'Use recovery key instead',
    ),
  );
  mount(h('div', { class: 'center' }, form));
  pw.input.focus();
}

function showSetup() {
  const err = h('div', { class: 'err', role: 'alert' });
  const p1 = passwordField('p1', 'Passphrase', { auto: 'new-password' });
  const p2 = passwordField('p2', 'Confirm passphrase', { auto: 'new-password' });
  const meter = h('div', { class: 'meter' }, h('b', {}));
  const tip = h('p', {}, 'Use 5 or more random words. This is the only thing protecting your notes.');
  p1.input.addEventListener('input', () => {
    const s = strength(p1.input.value);
    meter.firstChild.style.width = s + '%';
  });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Create vault');
  const form = h(
    'form',
    {
      class: 'panel',
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        const problem = passphraseProblem(p1.input.value, p2.input.value);
        if (problem) return void (err.textContent = problem);
        btn.disabled = true;
        btn.textContent = 'Creating…';
        try {
          const { blob, dek, recoveryKey } = await C.createVault(p1.input.value);
          showRecovery(recoveryKey, async () => {
            await api('PUT', '/api/vault', { key_blob: blob, expect_version: 0 });
            state.vault = { key_blob: blob, key_version: 1 };
            state.dek = dek;
            await startApp();
          });
        } catch (ex) {
          err.textContent = ex.message;
          btn.disabled = false;
          btn.textContent = 'Create vault';
        }
      },
    },
    mark(),
    h(
      'div',
      {},
      h('h2', {}, 'Create your vault'),
      h('p', {}, 'Pick a passphrase. Notes are encrypted here, before they are sent.'),
    ),
    p1.el,
    meter,
    tip,
    p2.el,
    err,
    btn,
  );
  mount(h('div', { class: 'center' }, form));
  p1.input.focus();
}

export function showRecovery(
  key,
  onDone,
  message = 'If you forget your passphrase, this is the only way back in. We cannot reset it for you. Shown once.',
) {
  const lines = key.match(/(?:[A-Z2-7]{4}-?){1,4}/g).map((l) => l.replace(/-$/, ''));
  const ack = h('input', { type: 'checkbox', id: 'ack' });
  const btn = h('button', { class: 'btn', disabled: true }, 'Continue');
  ack.addEventListener('change', () => {
    btn.disabled = !ack.checked;
  });
  const err = h('div', { class: 'err' });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await onDone();
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
    }
  });
  const copy = h(
    'button',
    {
      class: 'btn ghost',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(key);
          toast('Copied');
        } catch {
          toast('Copy failed: select and copy the key');
        }
      },
    },
    'Copy',
  );
  const dl = h(
    'button',
    {
      class: 'btn ghost',
      onclick: () =>
        download(
          'safenote-recovery-key.txt',
          `SafeNote recovery key\n\n${key}\n\nAnyone with this key can read your notes. Keep it private.\n`,
          'text/plain',
        ),
    },
    'Download .txt',
  );
  mount(
    h(
      'div',
      { class: 'center' },
      h(
        'div',
        { class: 'panel' },
        h('h2', {}, 'Save your recovery key'),
        h('p', {}, message),
        h(
          'div',
          { class: 'rk' },
          lines.map((l, i) => [l, i < lines.length - 1 ? h('br') : null]),
        ),
        h('div', { class: 'pwrow' }, copy, dl),
        h(
          'div',
          { class: 'warn' },
          'Anyone with this key can read your notes. Keep it in a password manager or on paper.',
        ),
        h('label', { class: 'check', for: 'ack' }, ack, 'I saved my recovery key'),
        err,
        btn,
      ),
    ),
  );
}
