export const SETTINGS_ID = '_settings_';

export const state = {
  dek: null,
  vault: null,
  seq: 0,
  notes: new Map(),
  settings: { autolock: 15, theme: 'system', zoom: 100 },
  view: { kind: 'notes', label: null, q: '' },
  poll: null,
  idle: null,
};

export const COLORS = 7;

export const normalize = (d) => {
  if (d.items) {
    d.body = d.items.map((i) => `- [${i.d ? 'x' : ' '}] ${i.t}`).join('\n');
  }
  d.items = null;
  d.labels ||= [];
  d.body ||= '';
  d.title ||= '';
  return d;
};

export const blankNote = () => ({
  title: '',
  body: '',
  items: null,
  color: 0,
  pinned: false,
  archived: false,
  trashed: 0,
  labels: [],
  created: Date.now(),
  edited: Date.now(),
});

export function applyZoom(z) {
  const n = Number(z);
  const pct = n >= 50 && n <= 300 ? n : 100;
  document.documentElement.style.zoom = pct === 100 ? '' : String(pct / 100);
}

export function applyTheme(t) {
  const r = document.documentElement;
  if (t === 'light' || t === 'dark') r.dataset.theme = t;
  else delete r.dataset.theme;
}
