import { BY_NAME } from '../instruction/instruction-set.js';
import { h } from '../desktop/dom.js';

const MNEMONICS = new Set(Object.keys(BY_NAME));
// One sticky regex, last alternative matches any character, so the scanner always advances.
const TOKEN = /\s+|;.*|"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])'?|\.?[A-Za-z_][A-Za-z0-9_]*:?|0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+|[\s\S]/y;

export function tokenizeLine(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(line);
    const s = m ? m[0] : line[i];
    let t = 'text';
    if (s[0] === ';') t = 'comment';
    else if (s[0] === '"' || s[0] === "'") t = 'string';
    else if (/^\.[A-Za-z_]/.test(s)) t = 'dir';
    else if (/^[A-Za-z_][A-Za-z0-9_]*:$/.test(s)) t = 'label';
    else if (/^R[0-7]$/i.test(s)) t = 'reg';
    else if (MNEMONICS.has(s.toUpperCase())) t = 'op';
    else if (/^(0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+)$/.test(s)) t = 'num';
    out.push({ t, s });
    i += s.length;
  }
  return out;
}

export function highlightToFragment(text) {
  const frag = document.createDocumentFragment();
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const { t, s } of tokenizeLine(line)) frag.append(t === 'text' ? s : h('span', { class: `hl-${t}`, text: s }));
    if (i < lines.length - 1) frag.append('\n');
  });
  return frag;
}
