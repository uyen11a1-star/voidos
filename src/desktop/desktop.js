import { h, clear } from './dom.js';
import { WindowManager } from './window-manager.js';
import { Taskbar, TASKBAR_H } from './taskbar.js';
import { StartMenu } from './start-menu.js';
import { showPrompt, showConfirm } from './dialogs.js';
import { showContextMenu, onLongPress } from './context-menu.js';
import { BUILTIN_APPS } from './apps.js';
import { openProcessApp } from '../applications/process-app.js';

const SESSION = '/etc/session.json';
const SCHEDULER_MS = 25;

// The VoidOS desktop: wallpaper, icons, windows, taskbar, start menu, notifications, dialogs.
// It talks to the system only through kernel.call (the same syscalls the shell uses).
export class Desktop {
  constructor({ kernel, root, hooks = {} }) {
    this.kernel = kernel;
    this.root = root;
    this.hooks = hooks;
    this.sys = (name, ...args) => kernel.call(name, ...args);
    this.clipboard = null;
    this.unsubs = [];
    this.scale = 1;
    this.size = { w: 270, h: 480 };
    this.config = this.sys('sys.config');
    this._build();
    this.applyConfig(this.config);
    this.unsubs.push(kernel.events.on('config:change', ({ config }) => this.applyConfig(config)));
    this.unsubs.push(kernel.events.on('apps:change', () => this.refreshApps()));
    this._loop = setInterval(() => this._tick(), SCHEDULER_MS);
    this._clockTimer = setInterval(() => this._tickClock(), 1000);
    if (!this.restoreSession()) this.notify('Chào mừng đến VoidOS! Bấm ◆ để mở menu.', { level: 'info' });
  }

  // ---------- construction ----------
  _build() {
    const { root } = this;
    root.classList.add('vo-root');
    clear(root);
    this.wall = h('div', { class: 'vo-wall' });
    this.iconsEl = h('div', { class: 'vo-icons' });
    this.layer = h('div', { class: 'vo-windows' });
    this.toasts = h('div', { class: 'vo-toasts', 'aria-live': 'polite' });
    this.overlay = h('div', { class: 'vo-overlay' });
    this.screen = h('div', { class: 'vo-screen' });
    this.wm = new WindowManager({
      layer: this.layer,
      bounds: () => ({ w: this.size.w, h: this.size.h - TASKBAR_H }),
      scale: () => this.scale,
      onChange: (kind) => this._onWindowsChange(kind),
    });
    this.taskbar = new Taskbar(this);
    this.startMenu = new StartMenu(this);
    this.screen.append(this.wall, this.iconsEl, this.layer, this.startMenu.el, this.taskbar.el, this.toasts, this.overlay);
    root.append(this.screen);
    onLongPress(this.wall, (e) => this.menu(e, [
      { label: 'Mở Terminal', action: () => this.openApp('terminal') }, { label: 'Mở Tệp', action: () => this.openApp('files') },
      { label: 'Cài đặt', action: () => this.openApp('settings') }, 'sep', { label: 'Làm mới', action: () => this.refreshApps() },
    ]));
    this.screen.addEventListener('pointerdown', (e) => {
      if (this.startMenu.isOpen && !this.startMenu.el.contains(e.target) && !this.taskbar.startBtn.contains(e.target)) this.startMenu.close();
    }, true);
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.startMenu.close(); });
    this._onResize = () => this._fit();
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined') { this.ro = new ResizeObserver(this._onResize); this.ro.observe(root); }
    this.refreshApps();
  }

  applyConfig(cfg) {
    this.config = cfg;
    this.root.dataset.theme = cfg.theme;
    this._fit();
    this.startMenu.render();
    this._tickClock();
  }

  // The screen has a fixed logical resolution (Settings) and is scaled to fit the window.
  _fit() {
    const [w, hh] = String(this.config.resolution).split('x').map(Number);
    this.size = { w, h: hh };
    const aw = this.root.clientWidth, ah = this.root.clientHeight;
    this.scale = aw > 0 && ah > 0 ? Math.min(aw / w, ah / hh) : 1;
    Object.assign(this.screen.style, {
      width: `${w}px`, height: `${hh}px`, transform: `scale(${this.scale})`,
      left: `${aw > 0 ? (aw - w * this.scale) / 2 : 0}px`, top: `${ah > 0 ? (ah - hh * this.scale) / 2 : 0}px`,
    });
    this.wm.fit();
  }

  _tick() {
    try { this.kernel.tick(); } catch (e) {
      if (!this._tickFailed) { this._tickFailed = true; this.notify(`Lỗi bộ lập lịch: ${e.message}`, { level: 'error' }); }
    }
  }

  _tickClock() {
    const t = new Date(this.kernel.clock()).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: !this.config.clock24 });
    this.taskbar.clock.textContent = t;
  }

  // ---------- apps ----------
  installed() { try { return this.sys('app.list'); } catch { return []; } }

  allApps() {
    return [...BUILTIN_APPS.map(({ id, name, icon }) => ({ id, name, icon })), ...this.installed().map((a) => ({ id: a.id, name: a.name ?? a.id, icon: '🧩', installed: true }))];
  }

  refreshApps() {
    clear(this.iconsEl);
    for (const app of this.allApps()) {
      const b = h('button', { class: 'vo-icon', type: 'button', title: app.name, onclick: () => this.openApp(app.id) }, h('span', { class: 'vo-icon-img', text: app.icon }), h('span', { class: 'vo-icon-name', text: app.name }));
      if (app.installed) onLongPress(b, (e) => this.menu(e, [{ label: 'Gỡ cài đặt', danger: true, action: () => this.uninstall(app.id) }]));
      this.iconsEl.append(b);
    }
    this.startMenu.render();
  }

  openApp(id, state = {}) {
    const builtin = BUILTIN_APPS.find((a) => a.id === id);
    if (builtin) { this.startMenu.close(); return builtin.open(this, state); }
    const inst = this.installed().find((a) => a.id === id);
    if (inst) return this.runProgram(inst.path, inst.name);
    this.notify(`Không tìm thấy ứng dụng "${id}"`, { level: 'error' });
    return null;
  }

  runProgram(path, name) { return openProcessApp(this, { path, name }); }

  install(path) {
    try { const r = this.sys('app.install', path); this.notify(`Đã cài "${r.id}" (mở từ menu Start)`, { level: 'ok' }); } catch (e) { this.notify(e.message, { level: 'error' }); }
  }

  async uninstall(id) {
    if (!(await this.confirm({ message: `Gỡ cài đặt "${id}"?`, okText: 'Gỡ', danger: true }))) return;
    try { this.sys('app.uninstall', id); this.notify(`Đã gỡ "${id}"`, { level: 'ok' }); } catch (e) { this.notify(e.message, { level: 'error' }); }
  }

  // ---------- UI services ----------
  toScreen(e) {
    const r = this.screen.getBoundingClientRect();
    return { x: ((e.clientX ?? 0) - r.left) / this.scale, y: ((e.clientY ?? 0) - r.top) / this.scale };
  }

  menu(at, items) {
    const p = at && at.clientX !== undefined ? this.toScreen(at) : { x: at?.x ?? 10, y: at?.y ?? 10 };
    return showContextMenu(this.overlay, { ...p, items, bounds: { w: this.size.w, h: this.size.h } });
  }

  prompt(opts) { return showPrompt(this.overlay, opts); }
  confirm(opts) { return showConfirm(this.overlay, opts); }

  notify(text, { level = 'info', ms = 4000 } = {}) {
    const t = h('div', { class: `toast ${level}`, role: 'status', text, onclick: () => t.remove() });
    this.toasts.append(t);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
    if (ms > 0) setTimeout(() => t.remove(), ms);
    if (level === 'error' || level === 'warn') (this.hooks.beep ?? (() => this._beep()))();
    return t;
  }

  _beep() {
    const vol = this.config.volume ?? 0;
    if (!vol || typeof AudioContext === 'undefined') return;
    try {
      this._ac ??= new AudioContext();
      const o = this._ac.createOscillator(), g = this._ac.createGain();
      o.frequency.value = 660; g.gain.value = (vol / 100) * 0.12;
      o.connect(g); g.connect(this._ac.destination);
      o.start(); o.stop(this._ac.currentTime + 0.09);
    } catch { /* audio is optional */ }
  }

  download(name, text) {
    if (this.hooks.download) { this.hooks.download(name, text); return; }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // ---------- session (window layout survives reloads) ----------
  _onWindowsChange(kind) {
    this.taskbar.update();
    if (kind === 'title') return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveSession(), 700);
  }

  saveSession() {
    clearTimeout(this._saveTimer);
    const windows = this.wm.list().filter((w) => w.appId).map((w) => ({ app: w.appId, x: w.x, y: w.y, w: w.w, h: w.h, max: w.maximized, min: w.minimized, state: w.getState?.() ?? null }));
    try { this.sys('fs.write', SESSION, JSON.stringify({ version: 1, windows })); } catch { /* a full disk must not break the desktop */ }
  }

  restoreSession() {
    let s;
    try { s = JSON.parse(this.sys('fs.read', SESSION)); } catch { return false; }
    if (!s || s.version !== 1 || !Array.isArray(s.windows)) return false;
    const known = new Set(BUILTIN_APPS.map((a) => a.id));
    let n = 0;
    for (const w of s.windows.slice(0, 12)) {
      if (!w || !known.has(w.app)) continue; // never trust the file: only known built-in apps
      const win = this.openApp(w.app, w.state && typeof w.state === 'object' ? w.state : {});
      if (!win) continue;
      n++;
      this.wm.place(win, { x: w.x, y: w.y, w: w.w, h: w.h, maximized: w.max });
      if (w.min) this.wm.minimize(win);
    }
    return n > 0;
  }

  destroy() {
    this.saveSession();
    clearInterval(this._loop); clearInterval(this._clockTimer);
    for (const u of this.unsubs) u();
    this.ro?.disconnect();
    window.removeEventListener('resize', this._onResize);
    this.wm.closeAll();
    clear(this.root);
    this.root.classList.remove('vo-root');
    this.root.removeAttribute('data-theme');
  }
}
