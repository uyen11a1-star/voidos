// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bootSystem } from './helpers-os.js';
import { Desktop } from '../src/desktop/desktop.js';
import { onLongPress } from '../src/desktop/context-menu.js';
import { tokenizeLine } from '../src/applications/asm-highlight.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const ptr = (el, type, x = 0, y = 0) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
const type = (input, text) => { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); };
const key = (el, k, extra = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...extra }));

let sys, root, desk, hooks;
beforeEach(async () => {
  sys = await bootSystem();
  root = document.createElement('div');
  document.body.append(root);
  hooks = { download: vi.fn(), beep: vi.fn() };
  desk = new Desktop({ kernel: sys.kernel, root, hooks });
});
afterEach(() => { vi.useRealTimers(); desk?.destroy(); root.remove(); });

const btnByText = (scope, text) => [...scope.querySelectorAll('button')].find((b) => b.textContent === text || b.title === text || b.getAttribute('aria-label') === text);
// answer the modal currently on screen
async function answer(value, ok = true) {
  await tick();
  const m = desk.overlay.querySelector('.modal');
  if (value !== undefined) { const i = m.querySelector('input'); i.value = value; }
  click(ok ? m.querySelector('.btn.primary, .btn.danger:last-child') : [...m.querySelectorAll('.btn')][0]);
  await tick();
}
const winOf = (appId) => desk.wm.list().find((w) => w.appId === appId);

describe('desktop shell', () => {
  it('builds screen, taskbar, icons for every built-in app, and greets the user', () => {
    expect(root.classList.contains('vo-root')).toBe(true);
    expect(root.dataset.theme).toBe('gold');
    expect([...desk.iconsEl.querySelectorAll('.vo-icon-name')].map((e) => e.textContent)).toEqual(['Terminal', 'Tệp', 'Soạn thảo', 'Giám sát', 'Cài đặt']);
    expect(desk.toasts.textContent).toMatch(/Chào mừng/);
    expect(desk.taskbar.clock.textContent).toMatch(/\d/);
  });
  it('screen follows the configured resolution', () => {
    expect(desk.screen.style.width).toBe('270px');
    sys.call('sys.setConfig', { resolution: '360x640' });
    expect(desk.screen.style.width).toBe('360px');
    expect(desk.screen.style.height).toBe('640px');
  });
  it('theme change applies immediately', () => {
    sys.call('sys.setConfig', { theme: 'azure' });
    expect(root.dataset.theme).toBe('azure');
  });
  it('clock honours the 12/24h setting', () => {
    sys.call('sys.setConfig', { clock24: false });
    expect(desk.taskbar.clock.textContent).toMatch(/SA|CH|AM|PM/i);
  });
  it('drives the kernel scheduler while running', async () => {
    vi.useFakeTimers();
    const d2root = document.createElement('div'); document.body.append(d2root);
    const d2 = new Desktop({ kernel: sys.kernel, root: d2root });
    const spy = vi.spyOn(sys.kernel, 'tick');
    vi.advanceTimersByTime(110);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(4);
    d2.destroy(); d2root.remove(); vi.useRealTimers();
  });
  it('notifications: stack limit, auto-dismiss, error beeps', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 6; i++) desk.notify(`n${i}`, { ms: 1000 });
    expect(desk.toasts.children.length).toBe(4);
    desk.notify('boom', { level: 'error', ms: 500 });
    expect(hooks.beep).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1100);
    expect(desk.toasts.children.length).toBe(0);
    vi.useRealTimers();
  });
  it('toast text is never interpreted as HTML', () => {
    desk.notify('<img src=x onerror=alert(1)>');
    expect(desk.toasts.querySelector('img')).toBeNull();
  });
});

describe('start menu', () => {
  it('opens, lists apps, filters, launches an app and closes', () => {
    click(desk.taskbar.startBtn);
    expect(desk.startMenu.el.hidden).toBe(false);
    expect(desk.startMenu.list.children.length).toBe(5);
    desk.startMenu.search.value = 'term'; desk.startMenu.render();
    expect(desk.startMenu.list.children.length).toBe(1);
    click(desk.startMenu.list.firstChild);
    expect(desk.startMenu.el.hidden).toBe(true);
    expect(winOf('terminal')).toBeTruthy();
  });
  it('closes when clicking elsewhere', () => {
    click(desk.taskbar.startBtn);
    ptr(desk.wall, 'pointerdown');
    expect(desk.startMenu.isOpen).toBe(false);
  });
  it('power buttons request shutdown / reboot through the kernel', () => {
    const seen = [];
    sys.events.on('power', (a) => seen.push(a));
    click(desk.taskbar.startBtn);
    click(btnByText(desk.startMenu.el, '⏻ Tắt máy'));
    click(btnByText(desk.startMenu.el, '↻ Khởi động lại'));
    expect(seen).toEqual(['shutdown', 'reboot']);
  });
  it('shows installed apps and can uninstall them', async () => {
    sys.call('sys.assemble', '/home/user/hello.asm', '/home/user/h.vx');
    sys.call('app.install', '/home/user/h.vx', 'hello', 'Xin chào');
    desk.startMenu.render();
    expect([...desk.startMenu.list.querySelectorAll('.start-item')].map((e) => e.textContent)).toContain('🧩Xin chào');
    expect([...desk.iconsEl.querySelectorAll('.vo-icon-name')].map((e) => e.textContent)).toContain('Xin chào');
    const p = desk.uninstall('hello');
    await answer(undefined, true);
    await p;
    expect(sys.call('app.list')).toEqual([]);
  });
});

describe('window manager', () => {
  it('opens several windows, focus raises the clicked one, taskbar mirrors them', () => {
    const a = desk.openApp('terminal'), b = desk.openApp('files');
    expect(desk.wm.list().length).toBe(2);
    expect(desk.wm.top()).toBe(b);
    expect(desk.taskbar.tasks.children.length).toBe(2);
    ptr(a.el, 'pointerdown');
    expect(desk.wm.top()).toBe(a);
    expect(a.el.classList.contains('focused')).toBe(true);
    expect(Number(a.el.style.zIndex)).toBeGreaterThan(Number(b.el.style.zIndex));
  });
  it('minimize hides, taskbar click restores; active task click minimizes', () => {
    const w = desk.openApp('terminal');
    desk.wm.minimize(w);
    expect(w.el.hidden).toBe(true);
    click(desk.taskbar.tasks.firstChild);
    expect(w.el.hidden).toBe(false);
    click(desk.taskbar.tasks.firstChild);
    expect(w.minimized).toBe(true);
  });
  it('maximize fills the screen above the taskbar and restores', () => {
    const w = desk.openApp('terminal');
    const before = { x: w.x, y: w.y, w: w.w, h: w.h };
    desk.wm.toggleMaximize(w);
    expect(w.el.style.width).toBe('270px');
    expect(w.el.style.height).toBe('444px'); // 480 - 36 taskbar
    desk.wm.toggleMaximize(w);
    expect(w.el.style.width).toBe(`${before.w}px`);
    expect(w.x).toBe(before.x);
  });
  it('drags by the title bar and stays on screen', () => {
    const w = desk.openApp('terminal');
    const x0 = w.x, y0 = w.y;
    ptr(w.el.querySelector('.win-title'), 'pointerdown', 100, 100);
    ptr(document, 'pointermove', 130, 120);
    expect(w.x).toBe(x0 + 30);
    expect(w.y).toBe(y0 + 20);
    ptr(document, 'pointermove', 9999, 9999);
    expect(w.x).toBeLessThanOrEqual(270 - 40);
    expect(w.y).toBeLessThanOrEqual(444 - 28);
    ptr(document, 'pointerup');
    ptr(document, 'pointermove', 0, 0); // no longer tracking
    expect(w.x).toBeLessThanOrEqual(230);
  });
  it('resizes from the corner within limits', () => {
    const w = desk.openApp('terminal');
    ptr(w.el.querySelector('.win-resize'), 'pointerdown', 0, 0);
    ptr(document, 'pointermove', -9999, -9999);
    expect(w.w).toBe(130); expect(w.h).toBe(90);
    ptr(document, 'pointerup');
  });
  it('close removes the window and runs its cleanup; veto keeps it open', async () => {
    const w = desk.openApp('terminal');
    const cleanup = vi.fn();
    w.closers.push(cleanup);
    w.onBeforeClose = () => false;
    expect(await desk.wm.close(w)).toBe(false);
    expect(desk.wm.list()).toContain(w);
    w.onBeforeClose = null;
    expect(await desk.wm.close(w)).toBe(true);
    expect(cleanup).toHaveBeenCalled();
    expect(root.contains(w.el)).toBe(false);
    expect(desk.taskbar.tasks.children.length).toBe(0);
  });
  it('window layout survives destroy + new desktop (session restore)', () => {
    const f = desk.openApp('files', { cwd: '/etc' });
    desk.wm.place(f, { x: 20, y: 30, w: 200, h: 150 });
    const m = desk.openApp('monitor'); desk.wm.minimize(m);
    desk.destroy();
    desk = new Desktop({ kernel: sys.kernel, root, hooks });
    const files = winOf('files'), mon = winOf('monitor');
    expect(files.getState()).toEqual({ cwd: '/etc' });
    expect([files.x, files.y, files.w, files.h]).toEqual([20, 30, 200, 150]);
    expect(mon.minimized).toBe(true);
    expect(desk.toasts.textContent).not.toMatch(/Chào mừng/);
  });
  it('a corrupt or hostile session file is ignored', () => {
    desk.destroy();
    sys.call('fs.write', '/etc/session.json', JSON.stringify({ version: 1, windows: [{ app: '__proto__' }, { app: 'rm -rf' }, null, 5] }));
    desk = new Desktop({ kernel: sys.kernel, root, hooks });
    expect(desk.wm.list().length).toBe(0);
    desk.destroy();
    sys.call('fs.write', '/etc/session.json', '{not json');
    desk = new Desktop({ kernel: sys.kernel, root, hooks });
    expect(desk.wm.list().length).toBe(0);
  });
});

describe('context menu & long press', () => {
  it('right click on the wallpaper opens a menu that launches apps', () => {
    ptr(desk.wall, 'contextmenu', 10, 10);
    const menu = desk.overlay.querySelector('.ctx');
    expect(menu).toBeTruthy();
    click(btnByText(menu, 'Mở Terminal'));
    expect(winOf('terminal')).toBeTruthy();
    expect(desk.overlay.querySelector('.ctx')).toBeNull();
  });
  it('clicking elsewhere dismisses the menu', () => {
    desk.menu({ x: 5, y: 5 }, [{ label: 'x', action: () => {} }]);
    ptr(document.body, 'pointerdown');
    expect(desk.overlay.querySelector('.ctx')).toBeNull();
  });
  it('long press fires once, ignores movement, and swallows the trailing click', () => {
    vi.useFakeTimers();
    const el = document.createElement('div'); document.body.append(el);
    const fired = vi.fn(), clicked = vi.fn();
    onLongPress(el, fired);
    el.addEventListener('click', clicked);
    ptr(el, 'pointerdown', 0, 0); vi.advanceTimersByTime(600); ptr(el, 'pointerup'); click(el);
    expect(fired).toHaveBeenCalledTimes(1);
    expect(clicked).not.toHaveBeenCalled();
    ptr(el, 'pointerdown', 0, 0); ptr(el, 'pointermove', 50, 50); vi.advanceTimersByTime(600);
    expect(fired).toHaveBeenCalledTimes(1); // moved: cancelled
    ptr(el, 'pointerup'); click(el);
    expect(clicked).toHaveBeenCalledTimes(1); // normal tap still works
    el.remove(); vi.useRealTimers();
  });
});

describe('Terminal', () => {
  const run = (w, line) => { w.input.value = line; key(w.input, 'Enter'); };
  it('runs real commands against the kernel and keeps history', () => {
    const w = desk.openApp('terminal');
    const out = w.el.querySelector('.term-out');
    run(w, 'mkdir proj'); run(w, 'cd proj'); run(w, 'echo "hi there" > a.txt'); run(w, 'cat a.txt'); run(w, 'pwd');
    expect(out.textContent).toContain('hi there');
    expect(out.textContent).toContain('/home/user/proj\n');
    expect(sys.call('fs.read', '/home/user/proj/a.txt')).toBe('hi there\n');
    key(w.input, 'ArrowUp');
    expect(w.input.value).toBe('pwd');
    expect(w.getState()).toEqual({ cwd: '/home/user/proj' });
  });
  it('unknown commands and errors are reported, not thrown', () => {
    const w = desk.openApp('terminal');
    run(w, 'nope'); run(w, 'cat /missing');
    const t = w.el.querySelector('.term-out').textContent;
    expect(t).toMatch(/nope: command not found/);
    expect(t).toMatch(/cat: .*No such file/);
  });
  it('runs a bytecode program, feeds stdin, ^C stops it', () => {
    const w = desk.openApp('terminal');
    run(w, 'asm echo.asm e.vx'); run(w, 'run e.vx');
    expect(w.shell.fg).not.toBeNull();
    run(w, 'a');
    sys.kernel.runUntilIdle(5);
    expect(w.el.querySelector('.term-out').textContent).toMatch(/a\n/);
    click(btnByText(w.el, 'Dừng chương trình'));
    expect(w.shell.fg).toBeNull();
    expect(sys.kernel.list().length).toBe(0);
  });
  it('closing the window kills a running program', async () => {
    const w = desk.openApp('terminal');
    run(w, 'asm echo.asm e.vx'); run(w, 'run e.vx');
    expect(sys.kernel.list().length).toBe(1);
    await desk.wm.close(w);
    expect(sys.kernel.list().length).toBe(0);
  });
  it('output buffer is capped', () => {
    const w = desk.openApp('terminal');
    for (let i = 0; i < 40; i++) w.shell.write('x'.repeat(2000));
    expect(w.el.querySelector('.term-out').textContent.length).toBeLessThanOrEqual(30000);
  });
  it('terminal can power off the machine (event reaches the host)', () => {
    const seen = []; sys.events.on('power', (a) => seen.push(a));
    const w = desk.openApp('terminal'); run(w, 'reboot'); run(w, 'shutdown');
    expect(seen).toEqual(['reboot', 'shutdown']);
  });
});

describe('File Manager', () => {
  const rows = (w) => [...w.el.querySelectorAll('.fm-row .fm-name')].map((e) => e.textContent);
  it('lists the real directory and navigates', () => {
    const w = desk.openApp('files');
    expect(rows(w)).toContain('welcome.txt');
    w.api.go('/bin');
    expect(rows(w)).toContain('fib.vx');
    click(btnByText(w.el, 'Lên một cấp'));
    expect(w.el.querySelector('.fm-path').value).toBe('/');
    expect(w.getState()).toEqual({ cwd: '/' });
  });
  it('creates a folder and a file; refuses to overwrite and to use bad names', async () => {
    const w = desk.openApp('files');
    w.api.newFolder(); await answer('docs');
    w.api.newFile(); await answer('n.txt');
    expect(sys.call('fs.stat', '/home/user/docs').type).toBe('dir');
    expect(sys.call('fs.exists', '/home/user/n.txt')).toBe(true);
    sys.call('fs.write', '/home/user/n.txt', 'keep me');
    w.api.newFile(); await answer('n.txt');
    expect(sys.call('fs.read', '/home/user/n.txt')).toBe('keep me');
    expect(desk.toasts.textContent).toMatch(/Đã tồn tại/);
    w.api.newFolder(); await answer('a/b');
    expect(sys.call('fs.exists', '/home/user/a')).toBe(false);
  });
  it('renames, copies (unique name), cuts+pastes and deletes', async () => {
    const w = desk.openApp('files');
    sys.call('fs.write', '/home/user/x.txt', 'X'); sys.call('fs.mkdir', '/home/user/d'); w.api.render();
    w.api.select('/home/user/x.txt'); w.api.rename(); await answer('y.txt');
    expect(sys.call('fs.exists', '/home/user/y.txt')).toBe(true);
    w.api.select('/home/user/y.txt'); w.api.copyOrCut('copy'); w.api.paste();
    expect(sys.call('fs.read', '/home/user/y (1).txt')).toBe('X');
    w.api.select('/home/user/y (1).txt'); w.api.copyOrCut('cut'); w.api.go('/home/user/d'); w.api.paste();
    expect(sys.call('fs.exists', '/home/user/d/y (1).txt')).toBe(true);
    expect(sys.call('fs.exists', '/home/user/y (1).txt')).toBe(false);
    w.api.go('/home/user'); w.api.select('/home/user/d'); w.api.remove(); await answer(undefined, true);
    expect(sys.call('fs.exists', '/home/user/d')).toBe(false);
  });
  it('cancelling a delete keeps the file; system folders are protected', async () => {
    const w = desk.openApp('files');
    w.api.go('/'); w.api.select('/etc'); w.api.remove();
    expect(desk.overlay.querySelector('.modal')).toBeNull();
    expect(desk.toasts.textContent).toMatch(/được bảo vệ/);
    w.api.go('/home/user'); w.api.select('/home/user/welcome.txt'); w.api.remove(); await answer(undefined, false);
    expect(sys.call('fs.exists', '/home/user/welcome.txt')).toBe(true);
  });
  it('tap selects, second tap opens (folder / text file in the editor)', async () => {
    const w = desk.openApp('files');
    const row = (n) => [...w.el.querySelectorAll('.fm-row')].find((r) => r.querySelector('.fm-name').textContent === n);
    click(row('welcome.txt'));
    expect(row('welcome.txt').classList.contains('sel')).toBe(true);
    click(row('welcome.txt'));
    await tick();
    const ed = winOf('editor');
    expect(ed.api.path).toBe('/home/user/welcome.txt');
    expect(ed.api.textarea.value).toMatch(/Chào mừng/);
  });
  it('long press menu offers install for bytecode and installs it', () => {
    const w = desk.openApp('files');
    w.api.go('/bin');
    ptr([...w.el.querySelectorAll('.fm-row')].find((r) => r.textContent.includes('fib.vx')), 'contextmenu', 5, 5);
    click(btnByText(desk.overlay.querySelector('.ctx'), 'Cài đặt thành ứng dụng'));
    expect(sys.call('app.list').map((a) => a.id)).toContain('fib');
  });
  it('file names render as text, never markup', () => {
    sys.call('fs.write', '/home/user/<img src=x onerror=1>.txt', '');
    const w = desk.openApp('files');
    expect(w.el.querySelector('.fm-list img')).toBeNull();
    expect(w.el.querySelector('.fm-list').textContent).toContain('<img src=x onerror=1>.txt');
  });
});

describe('Text Editor', () => {
  it('opens, edits, saves to the real filesystem and clears the dirty mark', async () => {
    const w = desk.openApp('editor', { path: '/home/user/welcome.txt' });
    await tick();
    const { textarea } = w.api;
    type(textarea, 'new text');
    expect(w.api.dirty).toBe(true);
    expect(w.title).toMatch(/•/);
    await w.api.save();
    expect(sys.call('fs.read', '/home/user/welcome.txt')).toBe('new text');
    expect(w.api.dirty).toBe(false);
  });
  it('autosaves a draft and offers to restore it; saving removes the draft', async () => {
    vi.useFakeTimers();
    let w = desk.openApp('editor', { path: '/home/user/welcome.txt' });
    await vi.advanceTimersByTimeAsync(0);
    type(w.api.textarea, 'unsaved work');
    await vi.advanceTimersByTimeAsync(900);
    expect(sys.call('fs.list', '/tmp/.drafts').length).toBe(1);
    await desk.wm.close(w, { force: true });
    w = desk.openApp('editor', { path: '/home/user/welcome.txt' });
    await vi.advanceTimersByTimeAsync(0);
    expect(desk.overlay.querySelector('.modal-msg').textContent).toMatch(/bản nháp/);
    vi.useRealTimers();
    await answer(undefined, true);
    expect(w.api.textarea.value).toBe('unsaved work');
    await w.api.save();
    expect(sys.call('fs.list', '/tmp/.drafts').length).toBe(0);
  });
  it('closing with unsaved changes asks first', async () => {
    const w = desk.openApp('editor', { path: '/home/user/welcome.txt' });
    await tick();
    type(w.api.textarea, 'x');
    const p = desk.wm.close(w);
    await answer(undefined, false);
    expect(await p).toBe(false);
    const p2 = desk.wm.close(w);
    await answer(undefined, true);
    expect(await p2).toBe(true);
  });
  it('Save As asks for a path, confirms overwrite', async () => {
    const w = desk.openApp('editor');
    type(w.api.textarea, 'hello');
    const p = w.api.save();
    await answer('/home/user/new.txt');
    expect(await p).toBe(true);
    expect(sys.call('fs.read', '/home/user/new.txt')).toBe('hello');
    const q = w.api.saveAs();
    await answer('/home/user/welcome.txt');
    await answer(undefined, false); // refuse overwrite
    expect(await q).toBe(false);
    expect(sys.call('fs.read', '/home/user/welcome.txt')).toMatch(/Chào mừng/);
  });
  it('refuses binary files', async () => {
    const w = desk.openApp('editor');
    expect(await w.api.load('/bin/fib.vx')).toBe(false);
    expect(desk.toasts.textContent).toMatch(/nhị phân/);
  });
  it('highlights assembly (tokens) and only for .asm', async () => {
    const w = desk.openApp('editor', { path: '/home/user/hello.asm' });
    await tick();
    expect(w.el.querySelector('.ed-hl .hl-op').textContent).toBe('MOVI');
    expect(w.el.querySelector('.ed-hl .hl-label')).toBeTruthy();
    expect(w.api.textarea.classList.contains('hl-on')).toBe(true);
    await w.api.load('/home/user/welcome.txt');
    expect(w.api.textarea.classList.contains('hl-on')).toBe(false);
  });
  it('compiles and runs an .asm file; shows assembler errors', async () => {
    const w = desk.openApp('editor', { path: '/home/user/hello.asm' });
    await tick();
    await w.api.run();
    expect(sys.call('fs.exists', '/home/user/hello.vx')).toBe(true);
    const pw = [...desk.wm.list()].find((x) => !x.appId);
    sys.kernel.runUntilIdle(50);
    expect(pw.el.querySelector('.term-out').textContent).toContain('Xin chào VoidOS!');
    type(w.api.textarea, 'FOO R1\nJMP nowhere');
    const p = w.api.build();
    await tick();
    expect(desk.overlay.querySelector('.modal-msg').textContent).toMatch(/line 1: Unknown instruction "FOO"[\s\S]*line 2: Undefined symbol/);
    await answer(undefined, true);
    expect(await p).toBeNull();
  });
  it('Tab inserts spaces instead of leaving the field', async () => {
    const w = desk.openApp('editor');
    const ta = w.api.textarea; ta.value = 'ab'; ta.setSelectionRange(1, 1);
    key(ta, 'Tab');
    expect(ta.value).toBe('a    b');
  });
});

describe('asm highlighter', () => {
  it('classifies tokens and never loops on odd characters', () => {
    const t = (s) => tokenizeLine(s).filter((x) => x.t !== 'text').map((x) => `${x.t}:${x.s}`);
    expect(t('loop: MOVI R1, 0x10 ; go')).toEqual(['label:loop:', 'op:MOVI', 'reg:R1', 'num:0x10', 'comment:; go']);
    expect(t('.string "a;b"')).toEqual(['dir:.string', 'string:"a;b"']);
    expect(tokenizeLine('a\rb\u2028c').map((x) => x.s).join('')).toBe('a\rb\u2028c');
    expect(tokenizeLine('"unterminated').length).toBe(1);
    expect(t("MOVI R0, '\\n'")).toContain("string:'\\n'");
  });
});

describe('System Monitor', () => {
  it('shows real kernel numbers and kills a process', () => {
    const pid = sys.call('proc.spawn', '/bin/echo.vx', {});
    const w = desk.openApp('monitor');
    sys.kernel.tick();
    w.refresh();
    expect(w.el.textContent).toContain('echo.vx');
    expect(w.el.querySelector('.bar-fill.ram').style.width).not.toBe('0%');
    click(btnByText(w.el, 'Kết thúc echo.vx'));
    expect(sys.kernel.list().length).toBe(0);
    expect(w.el.textContent).toMatch(/Không có tiến trình/);
    expect(pid).toBeGreaterThan(0);
  });
  it('the CPU history sparkline has one point per sample and the timer stops on close', async () => {
    vi.useFakeTimers();
    const w = desk.openApp('monitor');
    vi.advanceTimersByTime(3100);
    expect(w.el.querySelector('polyline').getAttribute('points').split(' ').length).toBe(4);
    const poly = w.el.querySelector('polyline');
    await desk.wm.close(w);
    vi.advanceTimersByTime(5000);
    expect(poly.getAttribute('points').split(' ').length).toBe(4); // refresh timer stopped
  });
});

describe('Settings', () => {
  it('applies theme/resolution/hostname through sys.setConfig and persists them', async () => {
    const w = desk.openApp('settings');
    const f = w.api.fields;
    f.theme.value = 'violet'; f.res.value = '360x640'; f.host.value = 'mymachine'; f.vol.value = '20';
    await w.api.apply();
    expect(root.dataset.theme).toBe('violet');
    expect(desk.screen.style.width).toBe('360px');
    const saved = JSON.parse(sys.call('fs.read', '/etc/config.json'));
    expect(saved).toMatchObject({ theme: 'violet', resolution: '360x640', hostname: 'mymachine', volume: 20 });
    expect(w.api.banner.hidden).toBe(true);
  });
  it('RAM change asks for a reboot; invalid input is rejected with a message', async () => {
    const w = desk.openApp('settings');
    w.api.fields.ram.value = '2048';
    await w.api.apply();
    expect(w.api.banner.hidden).toBe(false);
    w.api.fields.host.value = 'bad name!';
    await w.api.apply();
    expect(desk.toasts.textContent).toMatch(/Invalid value for "hostname"/);
  });
  it('no changes -> friendly message, nothing written', async () => {
    const w = desk.openApp('settings');
    await w.api.apply();
    expect(desk.toasts.textContent).toMatch(/Không có thay đổi/);
  });
  it('shows machine information from the kernel', () => {
    const w = desk.openApp('settings');
    expect(w.el.querySelector('.set-info').textContent).toMatch(/VoidOS/);
    expect(w.el.querySelector('.set-info').textContent).toMatch(/VoidCPU 16-bit/);
  });
  it('backup export -> change data -> import restores it and reboots', async () => {
    const w = desk.openApp('settings');
    sys.call('fs.write', '/home/user/precious.txt', 'important');
    w.api.exportBackup();
    expect(hooks.download).toHaveBeenCalledTimes(1);
    const [name, text] = hooks.download.mock.calls[0];
    expect(name).toMatch(/^voidos-backup-\d{8}-\d{4}\.json$/);
    sys.call('fs.remove', '/home/user/precious.txt');
    const seen = []; sys.events.on('power', (a) => seen.push(a));
    const p = w.api.importBackup(text);
    await answer(undefined, true);
    expect(await p).toBe(true);
    expect(sys.call('fs.read', '/home/user/precious.txt')).toBe('important');
    expect(seen).toEqual(['reboot']);
  });
  it('a bad or cancelled backup import changes nothing', async () => {
    const w = desk.openApp('settings');
    const p = w.api.importBackup('{"format":"other"}');
    await answer(undefined, true);
    expect(await p).toBe(false);
    expect(desk.toasts.textContent).toMatch(/not a VoidOS backup/);
    const q = w.api.importBackup('{}');
    await answer(undefined, false);
    expect(await q).toBe(false);
    expect(sys.call('fs.exists', '/home/user/welcome.txt')).toBe(true);
  });
});

describe('integration', () => {
  it('destroy stops timers, frees DOM and leaves the kernel usable', () => {
    const w = desk.openApp('terminal');
    w.shell.exec('asm echo.asm e.vx'); w.shell.exec('run e.vx');
    desk.destroy();
    expect(root.children.length).toBe(0);
    expect(sys.kernel.list().length).toBe(0);
    desk = new Desktop({ kernel: sys.kernel, root, hooks });
    expect(desk.wm.list().length).toBe(1); // terminal restored from the session
  });
  it('a program that crashes reports the fault inside its window and frees memory', () => {
    const before = sys.kernel.memStats().usedFrames;
    sys.call('fs.write', '/home/user/bad.asm', 'LOAD R0, [0x5000]\nHALT\n');
    sys.call('sys.assemble', '/home/user/bad.asm', '/home/user/bad.vx');
    const w = desk.runProgram('/home/user/bad.vx');
    sys.kernel.runUntilIdle(5);
    expect(w.el.querySelector('.term-out').textContent).toMatch(/PAGE_FAULT/);
    expect(w.title).toMatch(/đã thoát/);
    expect(sys.kernel.memStats().usedFrames).toBe(before);
  });
  it('unknown app id and corrupt executables give a notification, not an exception', () => {
    expect(desk.openApp('nope')).toBeNull();
    sys.call('fs.write', '/home/user/junk.vx', 'garbage');
    expect(desk.runProgram('/home/user/junk.vx')).toBeNull();
    expect(desk.toasts.textContent).toMatch(/Không chạy được/);
  });
});
