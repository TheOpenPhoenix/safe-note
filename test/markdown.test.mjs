import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, parseInline, safeUrl, toggleTaskAt, spoilerSecret } from '../public/markdown.js';

const types = (a) => a.map((n) => n.t);

test('headings, paragraphs, hr, line breaks', () => {
  const ast = parse('# Title\nhello\nworld\n\n---\n\n## Sub');
  assert.deepEqual(types(ast), ['h', 'p', 'hr', 'h']);
  assert.equal(ast[0].level, 1);
  assert.deepEqual(types(ast[1].kids), ['text', 'br', 'text']);
});

test('inline formatting', () => {
  const k = parseInline('a **b** *c* ~~d~~ `e` _f_');
  assert.deepEqual(
    types(k).filter((t) => t !== 'text'),
    ['strong', 'em', 'del', 'code', 'em'],
  );
  assert.equal(parseInline('snake_case_word')[0].t, 'text', 'underscores inside words are not emphasis');
  assert.equal(parseInline('2 * 3 * 4')[0].t, 'text');
  assert.equal(
    parseInline('window.__xss=1 and __init__.py')[0].t,
    'text',
    'double underscores inside words are literal',
  );
  assert.equal(parseInline('__bold__')[0].t, 'strong');
});

test('links: only http, https, mailto; no javascript:', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('JaVaScRiPt:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,x'), null);
  assert.equal(safeUrl('//evil.example'), null);
  assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeUrl('mailto:a@b.co'), 'mailto:a@b.co');
  const bad = parseInline('[x](javascript:alert(1))');
  assert.ok(bad.every((n) => n.t !== 'link'));
  const good = parseInline('see [docs](https://example.com) and https://example.org/x.');
  assert.deepEqual(
    good.filter((n) => n.t === 'link').map((n) => n.href),
    ['https://example.com', 'https://example.org/x'],
  );
});

test('raw HTML stays text', () => {
  const ast = parse('<img src=x onerror=alert(1)> <script>x</script>');
  assert.equal(ast[0].t, 'p');
  assert.ok(ast[0].kids.every((n) => n.t === 'text' || n.t === 'br'));
});

test('lists: unordered, ordered, nested, tasks', () => {
  const ast = parse('- a\n- b\n  - c\n  - d\n\n1. one\n2. two\n\n- [ ] todo\n- [x] done');
  assert.deepEqual(types(ast), ['list', 'list', 'list']);
  assert.equal(ast[0].items.length, 2);
  assert.equal(ast[0].items[1].kids[0].t, 'list');
  assert.equal(ast[0].items[1].kids[0].items.length, 2);
  assert.equal(ast[1].ordered, true);
  assert.deepEqual(
    ast[2].items.map((i) => i.task),
    [false, true],
  );
});

test('task toggling edits the right source line, including nested', () => {
  const src = 'intro\n\n- [ ] one\n- [x] two\n  - [ ] nested';
  const ast = parse(src);
  const items = ast[1].items;
  assert.equal(toggleTaskAt(src, items[0].line), 'intro\n\n- [x] one\n- [x] two\n  - [ ] nested');
  assert.equal(toggleTaskAt(src, items[1].line).split('\n')[3], '- [ ] two');
  const nested = items[1].kids[0].items[0];
  assert.equal(toggleTaskAt(src, nested.line).split('\n')[4], '  - [x] nested');
  assert.equal(toggleTaskAt('plain text', 0), 'plain text');
});

test('code blocks keep content verbatim', () => {
  const ast = parse('```js\nconst a = *1*;\n- not a list\n```\nafter');
  assert.deepEqual(types(ast), ['codeblock', 'p']);
  assert.equal(ast[0].text, 'const a = *1*;\n- not a list');
});

test('blockquote and table', () => {
  const ast = parse('> quote\n> more\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n| 3 | 4 |');
  assert.deepEqual(types(ast), ['quote', 'table']);
  assert.deepEqual(ast[1].aligns, [null, 'center']);
  assert.equal(ast[1].rows.length, 2);
});

test('spoilers', () => {
  const k = parseInline('before ||secret **bold**|| after');
  assert.deepEqual(types(k), ['text', 'spoiler', 'text']);
  assert.deepEqual(types(k[1].kids), ['text', 'strong']);
  assert.equal(parseInline('a || b || c')[0].t, 'text', 'spaces inside do not make a spoiler');
  assert.deepEqual(types(parseInline('||two\nlines||')), ['spoiler']);
  assert.deepEqual(types(parseInline('`||code||`')), ['code']);
});

test('spoiler copy text is exactly what was typed', () => {
  const k = parseInline('||p*ss_w**rd!||');
  assert.equal(k[0].t, 'spoiler');
  assert.equal(k[0].raw, 'p*ss_w**rd!');
  assert.equal(spoilerSecret('p*ss_w**rd!'), 'p*ss_w**rd!');
  assert.equal(spoilerSecret('`a*b*c`'), 'a*b*c', 'a single code span copies its contents');
  assert.equal(spoilerSecret('x `y` z'), 'x `y` z');
});

test('spoiler labels', () => {
  const k = parseInline('pw: ||hunter2||{Users Password} done');
  assert.deepEqual(types(k), ['text', 'spoiler', 'text']);
  assert.equal(k[1].label, 'Users Password');
  assert.equal(k[1].raw, 'hunter2');
  assert.equal(k[2].text, ' done');
  assert.equal(parseInline('||x||')[0].label, null);
  assert.equal(
    parseInline('||x|| {not a label}')[0].label,
    null,
    'a space before braces means it is plain text',
  );
});
