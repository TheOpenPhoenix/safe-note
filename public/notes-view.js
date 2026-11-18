import { renderMarkdown, toggleTaskAt } from './markdown.js';
import { state } from './state.js';
import { h, icon, mount, toast } from './dom.js';
import { openEditor } from './editor.js';
import { pull, pushNote, removeNote } from './sync.js';
import { isConflict } from './api.js';
import { paintSettings, showSettings } from './settings.js';
import { lock } from './session.js';

export function allLabels() {
  const s = new Set();
  for (const { data } of state.notes.values()) for (const l of data.labels) if (!data.trashed) s.add(l);
  return [...s].sort((a, b) => a.localeCompare(b));
}

function visible() {
  const { kind, label, q } = state.view;
  const needle = q.trim().toLowerCase();
  return [...state.notes.entries()]
    .filter(([, { data: d }]) => {
      if (kind === 'trash') return !!d.trashed;
      if (d.trashed) return false;
      if (kind === 'archive') {
        if (!d.archived) return false;
      } else if (d.archived) return false;
      if (kind === 'label' && !d.labels.includes(label)) return false;
      if (needle) {
        const hay = [d.title, d.body, ...d.labels].join('\n').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    })
    .sort((a, b) => b[1].data.edited - a[1].data.edited);
}

function card(id, d) {
  const el = h('div', {
    class: `n c${d.color}${d.pinned ? ' pinned' : ''}`,
    tabindex: 0,
    role: 'button',
    onclick: () => openEditor(id),
    onkeydown: (e) => {
      if (e.key === 'Enter') openEditor(id);
    },
  });
  if (d.pinned) el.append(h('span', { class: 'pin' }, icon('pin')));
  if (d.title) el.append(h('h3', {}, d.title));
  if (d.body)
    el.append(
      renderMarkdown(d.body, {
        onToggle: async (line) => {
          const entry = state.notes.get(id);
          if (!entry || state.view.kind === 'trash') return;
          const nd = structuredClone(entry.data);
          nd.body = toggleTaskAt(nd.body, line);
          try {
            await pushNote(id, nd);
          } catch (e) {
            toast(isConflict(e) ? 'Changed elsewhere. Reloading…' : e.message);
            await pull().catch(() => {});
          }
          renderGrid();
        },
      }),
    );
  if (d.labels.length)
    el.append(
      h(
        'div',
        { class: 'labels' },
        d.labels.map((l) => h('span', { class: 'chip' }, l)),
      ),
    );
  return el;
}

export function setView(v) {
  state.view = { q: state.view.q, ...v };
  render();
}

export function render() {
  if (!state.dek) return;
  const counts = { notes: 0, archive: 0 };
  for (const { data: d } of state.notes.values()) if (!d.trashed) counts[d.archived ? 'archive' : 'notes']++;
  const { kind, label } = state.view;
  const nav = (text, k, lab, count) =>
    h(
      'button',
      {
        class: 'nav' + (kind === k && label === lab ? ' on' : ''),
        onclick: () => {
          document.querySelector('.side')?.classList.remove('open');
          setView({ kind: k, label: lab });
        },
      },
      text,
      count != null ? h('small', {}, count) : null,
    );
  const search = h('input', {
    class: 'search',
    id: 'q',
    type: 'search',
    placeholder: 'Search notes',
    'aria-label': 'Search notes',
    value: state.view.q,
  });
  search.addEventListener('input', () => {
    state.view.q = search.value;
    if (state.view.kind === 'settings') {
      state.view = { q: search.value, kind: 'notes', label: null };
      render();
      const q = document.getElementById('q');
      q.focus();
      q.setSelectionRange(q.value.length, q.value.length);
      return;
    }
    renderGrid();
  });
  const side = h(
    'aside',
    { class: 'side' },
    h('div', { class: 'logo' }, icon('lock'), 'SafeNote'),
    search,
    nav('Notes', 'notes', null, counts.notes),
    nav('Archive', 'archive', null, counts.archive),
    nav('Trash', 'trash', null),
    allLabels().length ? h('div', { class: 'sec' }, 'Labels') : null,
    ...allLabels().map((l) => nav(l, 'label', l)),
    h('div', { style: 'flex:1' }),
    h(
      'button',
      {
        class: 'nav' + (kind === 'settings' ? ' on' : ''),
        onclick: () => {
          document.querySelector('.side')?.classList.remove('open');
          showSettings();
        },
      },
      icon('gear'),
      'Settings',
    ),
    h('button', { class: 'nav', onclick: lock }, icon('lock'), 'Lock now'),
  );
  const head = h(
    'div',
    { class: 'head' },
    h(
      'button',
      { class: 'ibtn menubtn', 'aria-label': 'Menu', onclick: () => side.classList.toggle('open') },
      icon('menu'),
    ),
  );
  const body = h('div', { class: 'main', id: 'main' });
  mount(
    h('div', { class: 'shell' }, side, h('div', { class: 'content' }, head, body)),
    kind === 'settings'
      ? null
      : h(
          'button',
          { class: 'fab', 'aria-label': 'New note', onclick: () => openEditor(null) },
          icon('plus'),
        ),
  );
  renderGrid();
}

function renderGrid() {
  const main = document.getElementById('main');
  if (!main) return;
  if (state.view.kind === 'settings') {
    if (!main.firstChild) paintSettings();
    return;
  }
  const list = visible();
  const { kind } = state.view;
  const out = [];
  if (kind === 'notes' || kind === 'label')
    out.push(
      h(
        'button',
        { class: 'capture', onclick: () => openEditor(null) },
        'Take a note…',
        h(
          'span',
          {
            title: 'New checklist',
            onclick: (e) => {
              e.stopPropagation();
              openEditor(null, { body: '- [ ] ' });
            },
          },
          '☑',
        ),
      ),
    );
  const pinned = list.filter(([, n]) => n.data.pinned),
    others = list.filter(([, n]) => !n.data.pinned);
  const grid = (items) =>
    h(
      'div',
      { class: 'grid' },
      items.map(([id, n]) => card(id, n.data)),
    );
  if (kind === 'trash')
    out.push(
      h('p', { class: 'sub' }, 'Notes in the trash are deleted for good after 30 days.'),
      h(
        'button',
        { class: 'btn ghost sm', style: 'align-self:flex-start', onclick: emptyTrash },
        'Empty trash',
      ),
    );
  if (pinned.length) out.push(h('div', {}, h('div', { class: 'sect' }, 'Pinned'), grid(pinned)));
  if (others.length)
    out.push(h('div', {}, pinned.length ? h('div', { class: 'sect' }, 'Others') : null, grid(others)));
  if (!list.length)
    out.push(
      h(
        'div',
        { class: 'empty' },
        state.view.q
          ? 'No notes match your search.'
          : kind === 'trash'
            ? 'Trash is empty.'
            : kind === 'archive'
              ? 'No archived notes.'
              : 'Your notes appear here. Take your first note above.',
      ),
    );
  main.replaceChildren(...out);
}

async function emptyTrash() {
  for (const [id, n] of [...state.notes]) if (n.data.trashed) await removeNote(id).catch(() => {});
  render();
}
