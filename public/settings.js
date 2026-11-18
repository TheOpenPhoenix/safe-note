import * as C from './crypto.js';
import { setView } from './notes-view.js';
import { download, h, passwordField, toast } from './dom.js';
import { passphraseProblem, showRecovery } from './auth.js';
import { api } from './api.js';
import { applyTheme, applyZoom, state } from './state.js';
import { lock, resetIdle } from './session.js';
import { rememberLocally, updateSetting } from './sync.js';

export function showSettings() {
  setView({ kind: 'settings', label: null });
}

export function paintSettings() {
  const err = h('div', { class: 'err', role: 'alert' });
  const showErr = (e) => {
    err.textContent = e.message;
  };
  const sel = (idv, opts, cur, on) => {
    const s = h(
      'select',
      { id: idv },
      opts.map(([v, t]) => h('option', { value: v, selected: String(v) === String(cur) }, t)),
    );
    s.addEventListener('change', () => on(s.value));
    return s;
  };
  const row = (title, sub, ctl) =>
    h('div', { class: 'row' }, h('div', {}, h('b', {}, title), h('small', {}, sub)), ctl);
  const btn = (t, fn) => h('button', { class: 'btn ghost sm', onclick: fn }, t);

  const changePass = () => {
    const cur = passwordField('cp0', 'Current passphrase', { auto: 'current-password' }),
      n1 = passwordField('cp1', 'New passphrase', { auto: 'new-password' }),
      n2 = passwordField('cp2', 'Confirm new passphrase', { auto: 'new-password' });
    const e2 = h('div', { class: 'err' });
    const go = h(
      'button',
      {
        class: 'btn sm',
        onclick: async () => {
          e2.textContent = '';
          const problem = passphraseProblem(n1.input.value, n2.input.value);
          if (problem) return void (e2.textContent = problem);
          try {
            const fresh = await api('GET', '/api/vault');
            const blob = await C.rewrapPassphrase(
              fresh.key_blob,
              { passphrase: cur.input.value },
              n1.input.value,
            );
            const r = await api('PUT', '/api/vault', { key_blob: blob, expect_version: fresh.key_version });
            state.vault = { key_blob: blob, key_version: r.key_version };
            toast('Passphrase changed');
            showSettings();
          } catch (ex) {
            e2.textContent = ex.message;
          }
        },
      },
      'Change passphrase',
    );
    box.replaceChildren(
      h(
        'div',
        { class: 'row formrow' },
        cur.el,
        n1.el,
        n2.el,
        e2,
        h('div', { class: 'pwrow' }, go, btn('Cancel', showSettings)),
      ),
    );
  };
  const newRecovery = () => {
    const cur = passwordField('nr0', 'Current passphrase', { auto: 'current-password' });
    const e2 = h('div', { class: 'err' });
    const go = h(
      'button',
      {
        class: 'btn sm',
        onclick: async () => {
          try {
            const fresh = await api('GET', '/api/vault');
            const { blob, recoveryKey } = await C.rotateRecoveryKey(fresh.key_blob, cur.input.value);
            showRecovery(
              recoveryKey,
              async () => {
                const r = await api('PUT', '/api/vault', {
                  key_blob: blob,
                  expect_version: fresh.key_version,
                });
                state.vault = { key_blob: blob, key_version: r.key_version };
                toast('New recovery key saved');
                showSettings();
              },
              'Your old recovery key stops working once you continue.',
            );
          } catch (ex) {
            e2.textContent = ex.message;
          }
        },
      },
      'Create new key',
    );
    box.replaceChildren(
      h(
        'div',
        { class: 'row formrow' },
        cur.el,
        e2,
        h('div', { class: 'pwrow' }, go, btn('Cancel', showSettings)),
      ),
    );
  };
  const exportEnc = async () => {
    const all = await api('GET', '/api/notes?since=0');
    const v = await api('GET', '/api/vault');
    download(
      'safenote-encrypted-backup.json',
      JSON.stringify({ app: 'safenote', version: 1, key_blob: v.key_blob, notes: all.notes }, null, 1),
      'application/json',
    );
  };
  let confirmPlain = false,
    delArmed = false;
  const exportPlain = () => {
    if (!confirmPlain) {
      confirmPlain = true;
      toast('Press again to export unencrypted notes');
      setTimeout(() => {
        confirmPlain = false;
      }, 5000);
      return;
    }
    confirmPlain = false;
    download(
      'safenote-notes.json',
      JSON.stringify(
        [...state.notes.values()].map((n) => n.data),
        null,
        1,
      ),
      'application/json',
    );
  };
  const deleteAcct = btn('Delete account', async () => {
    if (!delArmed) {
      delArmed = true;
      deleteAcct.textContent = 'Press again to confirm';
      return;
    }
    try {
      await api('DELETE', '/api/account');
      lock();
      toast('Account deleted');
    } catch (e) {
      err.textContent = e.message;
    }
  });
  const box = h(
    'div',
    { class: 'set' },
    h('h2', {}, 'Settings'),
    h('div', { class: 'sect' }, 'Security'),
    row('Change passphrase', 'Re-wraps your key. Notes are not re-encrypted.', btn('Change', changePass)),
    row('Generate new recovery key', 'Old recovery key stops working.', btn('Create', newRecovery)),
    row(
      'Auto-lock',
      'Lock after this much idle time.',
      sel(
        'autolock',
        [
          [0, 'Never'],
          [5, '5 minutes'],
          [10, '10 minutes'],
          [15, '15 minutes'],
          [30, '30 minutes'],
          [60, '1 hour'],
        ],
        state.settings.autolock,
        (v) => updateSetting('autolock', Number(v), resetIdle, showErr),
      ),
    ),
    h('div', { class: 'sect' }, 'Data'),
    row('Export encrypted backup', 'JSON you can restore with your passphrase.', btn('Export', exportEnc)),
    row('Export decrypted notes', 'Plain text. Handle with care.', btn('Export', exportPlain)),
    h('div', { class: 'sect' }, 'Appearance'),
    row(
      'Theme',
      'System, light or dark',
      sel(
        'theme',
        [
          ['system', 'System'],
          ['light', 'Light'],
          ['dark', 'Dark'],
        ],
        state.settings.theme,
        (v) =>
          updateSetting(
            'theme',
            v,
            (t) => {
              applyTheme(t);
              rememberLocally('theme', t);
            },
            showErr,
          ),
      ),
    ),
    row(
      'Zoom',
      'Scale the whole interface. Ctrl and + or - in your browser works too.',
      sel(
        'zoom',
        [
          [75, '75%'],
          [90, '90%'],
          [100, '100%'],
          [110, '110%'],
          [125, '125%'],
          [150, '150%'],
          [175, '175%'],
          [200, '200%'],
        ],
        state.settings.zoom || 100,
        (v) =>
          updateSetting(
            'zoom',
            Number(v),
            (z) => {
              applyZoom(z);
              rememberLocally('zoom', z);
            },
            showErr,
          ),
      ),
    ),
    err,
    h(
      'div',
      { class: 'danger' },
      h('div', { class: 'sect' }, 'Danger zone'),
      h(
        'div',
        { class: 'row' },
        h(
          'div',
          {},
          h('b', {}, 'Delete account'),
          h('small', {}, 'Removes your vault and every note from the server. This cannot be undone.'),
        ),
        deleteAcct,
      ),
    ),
  );
  document.getElementById('main').replaceChildren(box);
}
