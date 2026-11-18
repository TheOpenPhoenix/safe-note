const NS = 'http://www.w3.org/2000/svg';

const ICONS = {
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  pin: '<path d="M14 3l7 7-3 1-3 3 1 5-2 2-4-6-6 5 5-6-6-4 2-2 5 1 3-3z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  check: '<path d="M5 13l4 4L19 7"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
};

export function icon(name) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'svg' + (name === 'pin' ? ' fill' : ''));
  s.setAttribute('aria-hidden', 'true');
  const t = document.createElementNS(NS, 'svg');
  t.innerHTML = ICONS[name];
  s.append(...t.childNodes);
  return s;
}

export function h(tag, props = {}, ...kids) {
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
  for (const k of kids.flat(Infinity))
    if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}

const root = document.getElementById('app');

export const mount = (...n) => {
  root.replaceChildren(...n);
};

let toastTimer;

export function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3500);
}

export function passwordField(id, label, extra = {}) {
  const input = h('input', {
    class: 'input',
    id,
    type: 'password',
    autocomplete: extra.auto || 'off',
    spellcheck: 'false',
  });
  const show = h(
    'button',
    {
      type: 'button',
      class: 'btn ghost sm',
      onclick: () => {
        input.type = input.type === 'password' ? 'text' : 'password';
        show.textContent = input.type === 'password' ? 'Show' : 'Hide';
      },
    },
    'Show',
  );
  return {
    input,
    el: h('label', { class: 'field', for: id }, label, h('div', { class: 'pwrow' }, input, show)),
  };
}

export const mark = () => h('div', { class: 'mark' }, icon('lock'));

export function download(name, text, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
