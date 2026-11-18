import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextTools } from '../public/editor-text.js';

function fakeTextarea(value, start = value.length, end = start) {
  const ta = {
    value,
    selectionStart: start,
    selectionEnd: end,
    setSelectionRange(s, e) {
      ta.selectionStart = s;
      ta.selectionEnd = e;
    },
  };
  return ta;
}

test('wrap surrounds the selection or inserts a placeholder', () => {
  const ta = fakeTextarea('hello world', 6, 11);
  createTextTools(ta, () => {}).wrap('**', '**', 'bold');
  assert.equal(ta.value, 'hello **world**');
  const empty = fakeTextarea('x', 1);
  createTextTools(empty, () => {}).wrap('*', '*', 'italic');
  assert.equal(empty.value, 'x*italic*');
});

test('Enter continues bullet, numbered and task lists; an empty item ends the list', () => {
  const bullet = fakeTextarea('- a');
  assert.equal(createTextTools(bullet, () => {}).continueList(), true);
  assert.equal(bullet.value, '- a\n- ');
  const numbered = fakeTextarea('1. a');
  createTextTools(numbered, () => {}).continueList();
  assert.equal(numbered.value, '1. a\n2. ');
  const task = fakeTextarea('- [x] a');
  createTextTools(task, () => {}).continueList();
  assert.equal(task.value, '- [x] a\n- [ ] ');
  const ended = fakeTextarea('- a\n- ');
  createTextTools(ended, () => {}).continueList();
  assert.equal(ended.value, '- a\n');
  assert.equal(createTextTools(fakeTextarea('plain'), () => {}).continueList(), false);
});

test('prefixLines toggles a prefix and replaces other list markers', () => {
  const ta = fakeTextarea('one\ntwo', 0, 7);
  const tools = createTextTools(ta, () => {});
  tools.prefixLines('- ');
  assert.equal(ta.value, '- one\n- two');
  tools.prefixLines('- ');
  assert.equal(ta.value, 'one\ntwo');
  const numbered = fakeTextarea('1. one', 0);
  createTextTools(numbered, () => {}).prefixLines('- [ ] ');
  assert.equal(numbered.value, '- [ ] one');
});

test('numberLines and Tab indent/outdent', () => {
  const ta = fakeTextarea('a\nb', 0, 3);
  createTextTools(ta, () => {}).numberLines();
  assert.equal(ta.value, '1. a\n2. b');
  const item = fakeTextarea('- a', 3);
  const tools = createTextTools(item, () => {});
  assert.equal(tools.shiftList(false), true);
  assert.equal(item.value, '  - a');
  tools.shiftList(true);
  assert.equal(item.value, '- a');
  assert.equal(createTextTools(fakeTextarea('plain'), () => {}).shiftList(false), false);
});

test('every edit notifies the caller', () => {
  let calls = 0;
  createTextTools(fakeTextarea('a'), () => calls++).wrap('*', '*', 'x');
  assert.equal(calls, 1);
});
