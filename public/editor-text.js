export function createTextTools(ta, onChange) {
  const lineBounds = () => {
    const v = ta.value,
      s = ta.selectionStart,
      e = ta.selectionEnd;
    const a0 = v.lastIndexOf('\n', s - 1) + 1;
    let b0 = v.indexOf('\n', e);
    if (b0 < 0) b0 = v.length;
    return [a0, b0];
  };
  const setText = (v, s, e = s) => {
    ta.value = v;
    ta.setSelectionRange(s, e);
    onChange();
  };
  function wrap(before, after, ph) {
    const v = ta.value,
      s = ta.selectionStart,
      e = ta.selectionEnd,
      sel = v.slice(s, e) || ph;
    setText(
      v.slice(0, s) + before + sel + after + v.slice(e),
      s + before.length,
      s + before.length + sel.length,
    );
  }
  function prefixLines(prefix) {
    const [a0, b0] = lineBounds(),
      v = ta.value,
      block = v.slice(a0, b0);
    const lines = block
      .split('\n')
      .map((l) =>
        l.startsWith(prefix)
          ? l.slice(prefix.length)
          : prefix + l.replace(/^(\s*)(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|#{1,6}\s+)/, '$1'),
      );
    const out = lines.join('\n');
    setText(v.slice(0, a0) + out + v.slice(b0), a0, a0 + out.length);
  }
  function numberLines() {
    const [a0, b0] = lineBounds(),
      v = ta.value;
    let n = 0;
    const out = v
      .slice(a0, b0)
      .split('\n')
      .map((l) => `${++n}. ${l.replace(/^(\s*)(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '$1')}`)
      .join('\n');
    setText(v.slice(0, a0) + out + v.slice(b0), a0, a0 + out.length);
  }
  function continueList() {
    const v = ta.value,
      pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) return false;
    const start = v.lastIndexOf('\n', pos - 1) + 1,
      line = v.slice(start, pos);
    const m = /^(\s*)([-*+]|(\d+)([.)]))\s+(\[[ xX]\]\s+)?(.*)$/.exec(line);
    if (!m) return false;
    if (m[6] === '') {
      setText(v.slice(0, start) + v.slice(pos), start);
      return true;
    }
    const marker = m[3] ? `${parseInt(m[3], 10) + 1}${m[4]}` : m[2];
    const ins = `\n${m[1]}${marker} ${m[5] ? '[ ] ' : ''}`;
    setText(v.slice(0, pos) + ins + v.slice(pos), pos + ins.length);
    return true;
  }
  function shiftList(outdent) {
    const [a0] = lineBounds(),
      v = ta.value;
    if (
      !/^\s*(?:[-*+]|\d+[.)])\s/.test(v.slice(a0, v.indexOf('\n', a0) < 0 ? v.length : v.indexOf('\n', a0)))
    )
      return false;
    const s = ta.selectionStart;
    if (outdent) {
      const m = /^( {1,2}|\t)/.exec(v.slice(a0));
      if (!m) return true;
      setText(v.slice(0, a0) + v.slice(a0 + m[0].length), Math.max(a0, s - m[0].length));
    } else setText(v.slice(0, a0) + '  ' + v.slice(a0), s + 2);
    return true;
  }
  return { wrap, prefixLines, numberLines, continueList, shiftList };
}
