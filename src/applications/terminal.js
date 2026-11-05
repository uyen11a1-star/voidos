import { h } from '../desktop/dom.js';
import { Shell } from './shell.js';

const MAX_CHARS = 30000;

export function openTerminal(desktop, state = {}) {
  let buf = '';
  const out = h('pre', { class: 'term-out' });
  const label = h('span', { class: 'term-prompt' });
  const input = h('input', { class: 'term-in', type: 'text', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'send', 'aria-label': 'Dòng lệnh' });
  const write = (s) => { buf = (buf + s).slice(-MAX_CHARS); out.textContent = buf; out.scrollTop = out.scrollHeight; };
  const sh = new Shell(desktop.sys, { write, clear: () => { buf = ''; out.textContent = ''; }, prompt: () => showPrompt() });
  function showPrompt() { label.textContent = sh.fg === null ? `${sh.cwd} $` : '›'; }
  if (typeof state.cwd === 'string') { try { if (desktop.sys('fs.stat', state.cwd).type === 'dir') sh.cwd = state.cwd; } catch { /* folder is gone */ } }

  let hi = 0;
  const submit = () => {
    const line = input.value;
    input.value = '';
    write(`${sh.fg === null ? `${sh.cwd} $ ` : ''}${line}\n`);
    sh.exec(line);
    hi = sh.history.length;
    showPrompt();
  };
  const hist = (d) => {
    hi = Math.min(Math.max(hi + d, 0), sh.history.length);
    input.value = sh.history[hi] ?? '';
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
    else if (e.key === 'ArrowUp') { e.preventDefault(); hist(-1); } else if (e.key === 'ArrowDown') { e.preventDefault(); hist(1); } else if (e.key === 'c' && e.ctrlKey) { e.preventDefault(); sh.interrupt(); }
  });
  const btn = (text, title, fn) => h('button', { class: 'btn small', type: 'button', title, 'aria-label': title, text, onclick: fn });
  const content = h('div', { class: 'term' }, out,
    h('div', { class: 'term-row' }, label, input),
    h('div', { class: 'term-keys' }, btn('↑', 'Lệnh trước', () => hist(-1)), btn('↓', 'Lệnh sau', () => hist(1)), btn('^C', 'Dừng chương trình', () => sh.interrupt()), btn('Enter', 'Chạy', submit)));
  write(`VoidOS ${desktop.sys('sys.info').version} - gõ help để xem lệnh\n`);
  showPrompt();
  const win = desktop.wm.open({ appId: 'terminal', title: 'Terminal', icon: 'terminal', content, width: 250, height: 320 });
  win.getState = () => ({ cwd: sh.cwd });
  win.closers.push(() => sh.interrupt());
  win.shell = sh;
  win.input = input;
  input.focus?.();
  return win;
}
