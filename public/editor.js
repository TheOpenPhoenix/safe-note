import { createTextTools } from './editor-text.js';
import * as C from './crypto.js';
import { renderMarkdown, toggleTaskAt } from './markdown.js';
import { COLORS, blankNote, state } from './state.js';
import { h, icon, toast } from './dom.js';
import { pull, pushNote, removeNote } from './sync.js';
import { isConflict } from './api.js';
import { allLabels, render } from './notes-view.js';

export function openEditor(existingId, init = {}) {
  const isNew = !existingId;
  const id = existingId || C.newId();
  const d = isNew ? blankNote() : structuredClone(state.notes.get(id).data);
  if (isNew && state.view.kind === 'label') d.labels = [state.view.label];
  if (isNew && init.body) d.body = init.body;
  state.editing = id;
  let dirty = false,
    timer = null,
    saving = Promise.resolve(),
    closed = false;
  const status = h('span', { class: 'status' });
  const setStatus = (t, ok) => status.replaceChildren(ok ? icon('check') : '', t);
  const empty = () =>
    !d.title.trim() && !d.body.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?$/gm, '').trim();
  let previewing = !isNew && !!d.body.trim();
  const save = () => {
    clearTimeout(timer);
    if (!dirty || (isNew && empty() && !state.notes.has(id))) return saving;
    dirty = false;
    setStatus('Encrypting…');
    saving = saving.then(async () => {
      try {
        await pushNote(id, structuredClone(d));
        setStatus('Encrypted & saved', true);
      } catch (e) {
        dirty = true;
        setStatus(isConflict(e) ? 'Changed elsewhere. Reload.' : 'Not saved: ' + e.message);
        if (isConflict(e)) await pull().catch(() => {});
      }
    });
    return saving;
  };
  const touch = () => {
    dirty = true;
    setStatus('Unsaved');
    clearTimeout(timer);
    timer = setTimeout(save, 1000);
  };

  const dim = h('div', {
    class: 'dim',
    onmousedown: (e) => {
      if (e.target === dim) close();
    },
  });
  const ed = h('div', { class: 'editor c' + d.color, role: 'dialog', 'aria-label': 'Note editor' });
  async function close() {
    if (closed) return;
    closed = true;
    await save();
    state.editing = null;
    dim.remove();
    render();
  }
  function paint() {
    ed.className = 'editor c' + d.color;
    const title = h('input', {
      class: 't',
      placeholder: 'Title',
      value: d.title,
      'aria-label': 'Title',
      oninput: (e) => {
        d.title = e.target.value;
        touch();
      },
    });
    let ta = null,
      content;
    const grow = () => {
      if (ta) {
        ta.style.height = 'auto';
        ta.style.height = Math.max(160, ta.scrollHeight) + 'px';
      }
    };
    const sync = () => {
      d.body = ta.value;
      touch();
      grow();
    };
    if (previewing) {
      content = h(
        'div',
        {
          class: 'preview',
          title: 'Click to edit',
          onclick: () => {
            previewing = false;
            paint();
            ta && ta.focus();
          },
        },
        d.body.trim()
          ? renderMarkdown(d.body, {
              onToggle: (line) => {
                d.body = toggleTaskAt(d.body, line);
                touch();
                paint();
              },
            })
          : h('p', { class: 'sub' }, 'Nothing to preview yet.'),
      );
    } else {
      ta = h('textarea', {
        class: 'b',
        placeholder: 'Take a note… (Markdown supported)',
        'aria-label': 'Note',
        spellcheck: 'true',
        oninput: sync,
      });
      ta.value = d.body;
      ta.addEventListener('keydown', (e) => {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.key.toLowerCase() === 'b') {
          e.preventDefault();
          tools.wrap('**', '**', 'bold');
        } else if (mod && e.key.toLowerCase() === 'i') {
          e.preventDefault();
          tools.wrap('*', '*', 'italic');
        } else if (e.key === 'Enter' && !mod && !e.shiftKey && tools.continueList()) e.preventDefault();
        else if (e.key === 'Tab' && tools.shiftList(e.shiftKey)) e.preventDefault();
      });
      content = ta;
    }
    const tools = ta && createTextTools(ta, sync);
    const tb = (label, title, fn) =>
      h(
        'button',
        {
          type: 'button',
          class: 'tb',
          title,
          'aria-label': title,
          disabled: previewing,
          onmousedown: (e) => e.preventDefault(),
          onclick: fn,
        },
        label,
      );
    const toolbar = h(
      'div',
      { class: 'mdbar', role: 'toolbar', 'aria-label': 'Formatting' },
      tb('H', 'Heading', () => tools.prefixLines('# ')),
      tb('B', 'Bold (Ctrl+B)', () => tools.wrap('**', '**', 'bold')),
      tb('I', 'Italic (Ctrl+I)', () => tools.wrap('*', '*', 'italic')),
      tb('S', 'Strikethrough', () => tools.wrap('~~', '~~', 'text')),
      tb('▮', 'Spoiler: ||secret|| or ||secret||{label}', () => tools.wrap('||', '||', 'secret')),
      tb('•', 'Bulleted list', () => tools.prefixLines('- ')),
      tb('1.', 'Numbered list', () => tools.numberLines()),
      tb('☑', 'Checklist', () => tools.prefixLines('- [ ] ')),
      tb('“', 'Quote', () => tools.prefixLines('> ')),
      tb('<>', 'Code', () => tools.wrap('`', '`', 'code')),
      tb('🔗', 'Link', () => tools.wrap('[', '](https://)', 'text')),
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          style: 'margin-left:auto',
          'aria-pressed': String(previewing),
          onclick: () => {
            previewing = !previewing;
            paint();
            if (!previewing && ta) ta.focus();
          },
        },
        previewing ? 'Edit' : 'Preview',
      ),
    );
    const labelIn = h('input', {
      class: 'labin',
      placeholder: '+ Label',
      list: 'labs',
      'aria-label': 'Add label',
      onkeydown: (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const v = labelIn.value.trim();
          if (v && !d.labels.includes(v)) {
            d.labels.push(v);
            touch();
            paint();
          }
        }
      },
    });
    const sw = h(
      'div',
      { class: 'swatches', role: 'group', 'aria-label': 'Colour' },
      [...Array(COLORS).keys()].map((c) =>
        h('button', {
          type: 'button',
          class: `sw c${c}${d.color === c ? ' sel' : ''}`,
          'aria-label': 'Colour ' + (c + 1),
          onclick: () => {
            d.color = c;
            touch();
            ed.className = 'editor c' + c;
            sw.querySelectorAll('.sw').forEach((b, i) => b.classList.toggle('sel', i === c));
          },
        }),
      ),
    );
    const mk = (text, fn, on) =>
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          'aria-pressed': on === undefined ? null : String(!!on),
          onclick: fn,
        },
        text,
      );
    ed.replaceChildren(
      h(
        'div',
        { style: 'display:flex;gap:8px;align-items:center' },
        title,
        h(
          'button',
          {
            type: 'button',
            class: 'ibtn',
            style: 'border:0;background:none',
            'aria-label': d.pinned ? 'Unpin' : 'Pin',
            'aria-pressed': String(d.pinned),
            onclick: () => {
              d.pinned = !d.pinned;
              touch();
              paint();
            },
          },
          h('span', { style: d.pinned ? 'color:var(--accent)' : 'color:var(--muted)' }, icon('pin')),
        ),
      ),
      toolbar,
      content,
      h(
        'div',
        { class: 'labels' },
        d.labels.map((l) =>
          h(
            'button',
            {
              type: 'button',
              class: 'chip',
              title: 'Remove label',
              onclick: () => {
                d.labels = d.labels.filter((x) => x !== l);
                touch();
                paint();
              },
            },
            l + ' ×',
          ),
        ),
        labelIn,
        h(
          'datalist',
          { id: 'labs' },
          allLabels().map((l) => h('option', { value: l })),
        ),
      ),
      sw,
      h(
        'div',
        { class: 'tools' },
        mk(d.archived ? 'Unarchive' : 'Archive', async () => {
          d.archived = !d.archived;
          dirty = true;
          await close();
        }),
        d.trashed
          ? mk('Restore', async () => {
              d.trashed = 0;
              dirty = true;
              await close();
            })
          : mk('Delete', async () => {
              if (isNew && !state.notes.has(id)) {
                dirty = false;
                return close();
              }
              d.trashed = Date.now();
              d.pinned = false;
              dirty = true;
              await close();
              toast('Moved to trash');
            }),
        d.trashed
          ? mk('Delete forever', async () => {
              dirty = false;
              closed = true;
              try {
                await removeNote(id);
              } catch (e) {
                toast(e.message);
              }
              state.editing = null;
              dim.remove();
              render();
            })
          : null,
        status,
        h('button', { type: 'button', class: 'btn sm', onclick: close }, 'Close'),
      ),
    );
    grow();
  }
  paint();
  dim.append(ed);
  document.body.append(dim);
  dim.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      close();
    }
  });
  (ed.querySelector('textarea') || ed.querySelector('.t')).focus();
}
