import { applyTheme, applyZoom, state } from './state.js';
import { resetIdle } from './session.js';
import { boot } from './auth.js';

['pointerdown', 'keydown', 'scroll'].forEach((ev) =>
  addEventListener(ev, () => state.dek && resetIdle(), { passive: true }),
);

try {
  const t = localStorage.getItem('safenote-theme');
  if (t) applyTheme(t);
  const z = localStorage.getItem('safenote-zoom');
  if (z) {
    state.settings.zoom = Number(z);
    applyZoom(z);
  }
} catch {}

boot();
