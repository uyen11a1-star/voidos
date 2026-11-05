import { h } from '../desktop/dom.js';
import { baseName } from '../desktop/format.js';

const MAX_CHARS = 30000;

// A window for a bytecode program: its output on screen, a line of input to its stdin.
export function openProcessApp(desktop, { path, name = baseName(path) }) {
  let buf = '', pid = null, alive = true, win = null;
  const out = h('pre', { class: 'term-out' });
  const input = h('input', { class: 'term-in', type: 'text', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Nhập cho chương trình' });
  const write = (s) => { buf = (buf + s).slice(-MAX_CHARS); out.textContent = buf; out.scrollTop = out.scrollHeight; };
  try {
    pid = desktop.sys('proc.spawn', path, {
      onOutput: write,
      onExit: (r) => { alive = false; write(`\n[đã thoát: ${r.signal ?? r.exitCode}]\n`); if (win) desktop.wm.setTitle(win, `${name} (đã thoát)`); },
    });
  } catch (e) {
    desktop.notify(`Không chạy được ${name}: ${e.message}`, { level: 'error' });
    return null;
  }
  const send = () => {
    if (!alive) return;
    const line = input.value;
    input.value = '';
    write(`${line}\n`);
    try { desktop.sys('proc.stdin', pid, `${line}\n`); } catch { /* process just ended */ }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  const content = h('div', { class: 'term' }, out, h('div', { class: 'term-row' }, h('span', { class: 'term-prompt', text: '›' }), input));
  win = desktop.wm.open({ title: name, icon: 'program', content, width: 230, height: 240 });
  win.pid = pid;
  win.closers.push(() => { if (alive) { try { desktop.sys('proc.kill', pid); } catch { /* already gone */ } } });
  return win;
}
