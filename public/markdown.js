
const INLINE = [
  ['code', /`([^`\n]+)`/],
  ['spoiler', /\|\|(?=\S)([\s\S]+?)\|\|(?:\{([^{}\n]{1,60})\})?/],
  ['link', /\[([^\]\n]+)\]\(([^)\s]+)\)/],
  ['strong', /\*\*(?=\S)([\s\S]+?)\*\*|(?<![A-Za-z0-9_])__(?=\S)([\s\S]+?)__(?![A-Za-z0-9_])/],
  ['del', /~~(?=\S)([\s\S]+?)~~/],
  ['em', /\*(?=\S)([^*\n]+?)\*|(?<![A-Za-z0-9_])_(?=\S)([^_\n]+?)_(?![A-Za-z0-9_])/],
  ['auto', /https?:\/\/[^\s<]*[^\s<.,;:!?)\]]/],
];
export function safeUrl(u) {
  try { const x = new URL(u, 'https://placeholder.invalid'); return ['http:', 'https:', 'mailto:'].includes(x.protocol) && /^(https?:|mailto:)/i.test(u) ? u : null; }
  catch { return null; }
}
export function parseInline(s) {
  const out = [];
  let rest = s;
  while (rest) {
    let best = null;
    for (const [type, re] of INLINE) {
      const m = re.exec(rest);
      if (m && (best === null || m.index < best.m.index)) best = { type, m };
    }
    if (!best) { pushText(out, rest); break; }
    const { type, m } = best;
    if (m.index > 0) pushText(out, rest.slice(0, m.index));
    const inner = m[1] ?? m[2];
    if (type === 'code') out.push({ t: 'code', text: inner });
    else if (type === 'link') {
      const href = safeUrl(m[2]);
      if (href) out.push({ t: 'link', href, kids: parseInline(m[1]) }); else pushText(out, m[0]);
    } else if (type === 'auto') out.push({ t: 'link', href: m[0], kids: [{ t: 'text', text: m[0] }] });
    else if (type === 'spoiler') out.push({ t: 'spoiler', kids: parseInline(inner), raw: inner, label: m[2]?.trim() || null });
    else out.push({ t: type, kids: parseInline(inner) });
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}
function pushText(out, text) {
  const parts = text.split('\n');
  parts.forEach((p, i) => { if (i) out.push({ t: 'br' }); if (p) out.push({ t: 'text', text: p }); });
}

const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const isBlank = (l) => !l.trim();
const FENCE_RE = /^\s{0,3}(```|~~~)\s*([\w+-]*)\s*$/;
const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const HEAD_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function splitRow(l) { return l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()); }
const indentOf = (s) => s.replace(/\t/g, '    ').match(/^ */)[0].length;

export function parseBlocks(lines, offset = 0) {
  const out = []; let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    let m = FENCE_RE.exec(line);
    if (m) {
      const fence = m[1], body = []; let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith(fence)) body.push(lines[j++]);
      out.push({ t: 'codeblock', text: body.join('\n'), lang: m[2] }); i = j + 1; continue;
    }
    if ((m = HEAD_RE.exec(line))) { out.push({ t: 'h', level: m[1].length, kids: parseInline(m[2]) }); i++; continue; }
    if (HR_RE.test(line)) { out.push({ t: 'hr' }); i++; continue; }
    if (/^\s{0,3}>/.test(line)) {
      const q = []; const start = i;
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) q.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
      out.push({ t: 'quote', kids: parseBlocks(q, offset + start) }); continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = splitRow(line), aligns = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : null));
      const rows = []; i += 2;
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
      out.push({ t: 'table', aligns, head: head.map(parseInline), rows: rows.map((r) => r.map(parseInline)) }); continue;
    }
    if (LIST_RE.test(line)) { const r = parseList(lines, i, offset); out.push(r.node); i = r.next; continue; }
    const para = []; const start = i;
    while (i < lines.length && !isBlank(lines[i]) && !FENCE_RE.test(lines[i]) && !HEAD_RE.test(lines[i]) && !HR_RE.test(lines[i]) && !/^\s{0,3}>/.test(lines[i]) && !(para.length && LIST_RE.test(lines[i]))) para.push(lines[i++]);
    out.push({ t: 'p', kids: parseInline(para.join('\n')), line: offset + start });
  }
  return out;
}

function parseList(lines, start, offset) {
  const first = LIST_RE.exec(lines[start]);
  const baseIndent = indentOf(first[1]);
  const ordered = /\d/.test(first[2]);
  const items = []; let i = start;
  while (i < lines.length) {
    const m = LIST_RE.exec(lines[i]);
    if (!m) break;
    const ind = indentOf(m[1]);
    if (ind < baseIndent || (ind === baseIndent && /\d/.test(m[2]) !== ordered)) break;
    if (ind > baseIndent) break;
    let text = m[3]; let task = null;
    const tm = /^\[([ xX])\]\s+(.*)$/.exec(text) || (/^\[([ xX])\]$/.test(text) ? [null, text[1], ''] : null);
    if (tm) { task = tm[1].toLowerCase() === 'x'; text = tm[2]; }
    const item = { text, task, line: offset + i, kids: [] };
    i++;
    const nested = [];
    while (i < lines.length) {
      const l = lines[i];
      if (isBlank(l)) break;
      const lm = LIST_RE.exec(l);
      if (lm && indentOf(lm[1]) <= baseIndent) break;
      if (lm) { nested.push(l); i++; continue; }
      if (indentOf(l) > baseIndent && !nested.length) { item.text += '\n' + l.trim(); i++; continue; }
      if (indentOf(l) > baseIndent) { nested.push(l); i++; continue; }
      break;
    }
    if (nested.length) item.kids = parseBlocks(nested, offset + i - nested.length);
    items.push(item);
    if (i < lines.length && isBlank(lines[i]) && i + 1 < lines.length && LIST_RE.test(lines[i + 1]) && indentOf(LIST_RE.exec(lines[i + 1])[1]) === baseIndent && /\d/.test(LIST_RE.exec(lines[i + 1])[2]) === ordered) i++;
  }
  const startNum = ordered ? parseInt(first[2], 10) : null;
  return { node: { t: 'list', ordered, start: startNum, items: items.map((it) => ({ ...it, inline: parseInline(it.text) })) }, next: i };
}

export function parse(text) { return parseBlocks(text.replace(/\r\n?/g, '\n').split('\n')); }

export function toggleTaskAt(text, lineNo) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const l = lines[lineNo];
  if (l == null) return text;
  lines[lineNo] = l.replace(/^(\s*(?:[-*+]|\d{1,9}[.)])\s+)\[([ xX])\]/, (_, pre, c) => `${pre}[${c === ' ' ? 'x' : ' '}]`);
  return lines.join('\n');
}

export function spoilerSecret(raw) {
  const m = /^`([^`]+)`$/.exec(raw.trim());
  return m ? m[1] : raw;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    try {
      const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.append(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch { return false; }
  }
}
const SVG_NS = 'http://www.w3.org/2000/svg';
function copyIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: '14', height: '14', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  const r = document.createElementNS(SVG_NS, 'rect'); for (const [k, v] of Object.entries({ x: '9', y: '9', width: '11', height: '11', rx: '2' })) r.setAttribute(k, v);
  const pth = document.createElementNS(SVG_NS, 'path'); pth.setAttribute('d', 'M5 15V6a2 2 0 0 1 2-2h9');
  svg.append(r, pth); return svg;
}

function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) { if (v == null) continue; if (k === 'class') e.className = v; else e.setAttribute(k, v); }
  for (const k of kids.flat(Infinity)) if (k != null) e.append(k);
  return e;
}
function inlineDom(nodes) {
  return nodes.map((n) => {
    switch (n.t) {
      case 'text': return document.createTextNode(n.text);
      case 'br': return document.createElement('br');
      case 'code': return el('code', {}, n.text);
      case 'strong': return el('strong', {}, inlineDom(n.kids));
      case 'em': return el('em', {}, inlineDom(n.kids));
      case 'del': return el('del', {}, inlineDom(n.kids));
      case 'spoiler': {
        const inner = el('span', { class: 'spoiler-text', 'aria-hidden': 'true' }, inlineDom(n.kids));
        const hiddenName = n.label ? `Hidden: ${n.label}. Press to reveal.` : 'Hidden spoiler. Press to reveal.';
        const sp = el('span', { class: 'spoiler' + (n.label ? ' labeled' : ''), role: 'button', tabindex: '0', 'aria-label': hiddenName },
          n.label ? el('span', { class: 'spoiler-label', 'aria-hidden': 'true' }, n.label) : null, inner);
        const flip = (e) => {
          e.preventDefault(); e.stopPropagation();
          const shown = sp.classList.toggle('revealed');
          inner.setAttribute('aria-hidden', String(!shown));
          sp.setAttribute('aria-label', shown ? 'Spoiler revealed. Press to hide.' : hiddenName);
        };
        sp.addEventListener('click', flip);
        sp.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') flip(e); });
        const btn = el('button', { type: 'button', class: 'spoiler-copy', title: 'Copy without revealing', 'aria-label': 'Copy hidden text' }, copyIcon());
        btn.addEventListener('click', async (e) => {
          e.preventDefault(); e.stopPropagation();
          const ok = await copyText(spoilerSecret(n.raw));
          btn.classList.toggle('copied', ok); btn.classList.toggle('failed', !ok);
          btn.title = ok ? 'Copied' : 'Copy failed'; btn.setAttribute('aria-label', btn.title);
          setTimeout(() => { btn.classList.remove('copied', 'failed'); btn.title = 'Copy without revealing'; btn.setAttribute('aria-label', 'Copy hidden text'); }, 1500);
        });
        btn.addEventListener('keydown', (e) => e.stopPropagation());
        return el('span', { class: 'spoiler-wrap' }, sp, btn);
      }
      case 'link': { const a = el('a', { href: n.href, target: '_blank', rel: 'noopener noreferrer nofollow' }, inlineDom(n.kids)); a.addEventListener('click', (e) => e.stopPropagation()); return a; }
      default: return document.createTextNode('');
    }
  });
}
function blocksDom(blocks, opts) {
  return blocks.map((b) => {
    switch (b.t) {
      case 'h': return el('h' + Math.min(6, b.level + 1), { class: 'md-h' }, inlineDom(b.kids));
      case 'p': return el('p', {}, inlineDom(b.kids));
      case 'hr': return el('hr');
      case 'codeblock': return el('pre', {}, el('code', {}, b.text));
      case 'quote': return el('blockquote', {}, blocksDom(b.kids, opts));
      case 'list': {
        const l = el(b.ordered ? 'ol' : 'ul', { class: b.items.some((i) => i.task !== null) ? 'tasks' : null });
        if (b.ordered && b.start && b.start !== 1) l.setAttribute('start', String(b.start));
        for (const it of b.items) {
          const li = el('li', { class: it.task === null ? null : 'task' + (it.task ? ' done' : '') });
          if (it.task !== null) {
            const cb = el('input', { type: 'checkbox', 'aria-label': 'Toggle task' });
            cb.checked = it.task; cb.disabled = !opts.onToggle;
            cb.addEventListener('click', (e) => e.stopPropagation());
            cb.addEventListener('change', () => opts.onToggle && opts.onToggle(it.line));
            li.append(cb);
          }
          li.append(el('span', {}, inlineDom(it.inline)), ...blocksDom(it.kids, opts));
          l.append(li);
        }
        return l;
      }
      case 'table': {
        const cell = (tag, c, i) => { const e = el(tag, {}, inlineDom(c)); if (b.aligns[i]) e.style.textAlign = b.aligns[i]; return e; };
        return el('div', { class: 'md-table' }, el('table', {},
          el('thead', {}, el('tr', {}, b.head.map((c, i) => cell('th', c, i)))),
          el('tbody', {}, b.rows.map((r) => el('tr', {}, r.map((c, i) => cell('td', c, i)))))));
      }
      default: return document.createTextNode('');
    }
  });
}
export function renderMarkdown(text, opts = {}) {
  let blocks = parse(text || '');
  if (opts.maxBlocks) blocks = blocks.slice(0, opts.maxBlocks);
  return el('div', { class: 'md' }, blocksDom(blocks, opts));
}
