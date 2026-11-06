import { h, clear } from './dom.js';
import { WindowManager } from './window-manager.js';
import { Taskbar, TASKBAR_H } from './taskbar.js';
import { StartMenu } from './start-menu.js';
import { showPrompt, showConfirm } from './dialogs.js';
import { showContextMenu, onLongPress } from './context-menu.js';
import { BUILTIN_APPS } from './apps.js';
import { openProcessApp } from '../applications/process-app.js';
import { AudioService, STATIONS } from './audio.js';
import { renderWallpaper, drawCover, DEFAULT_WALLPAPER } from './wallpaper.js';
import { processImageFile, imageExt, IMAGE_EXT, isImageFile } from './image-utils.js';
import { renderIcon } from './icons.js';
import { VirtualMouse } from './virtual-mouse.js';

const SESSION = '/etc/session.json';
const MUSIC_STATE = '/home/user/.music.json';
const TIP_MARK = '/etc/.tip-resolution';
const SCHEDULER_MS = 25;
const WALL_PIXEL_CAP = 1_300_000;

const loadImage = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Không đọc được ảnh'));
  img.src = url;
});

// Only accept music sources we know how to play (the saved file could be edited by anyone).
function cleanSource(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.type === 'gen' && STATIONS.some((x) => x.id === s.id)) return { type: 'gen', id: s.id };
  if (s.type === 'file' && typeof s.path === 'string' && s.path.startsWith('/')) return { type: 'file', path: s.path };
  if (s.type === 'url' && typeof s.url === 'string' && /^https?:\/\//i.test(s.url)) return { type: 'url', url: s.url };
  return null;
}

// The VoidOS desktop: wallpaper, widgets, icons, windows, taskbar, start menu, lock screen, notifications.
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
    this.size = { w: 360, h: 640 };
    this.config = this.sys('sys.config');
    this.audio = new AudioService({ readBytes: (p) => this.sys('fs.readBytes', p), volume: this.config.musicVolume, ...(hooks.audio ?? {}) });
    this._build();
    this.applyConfig(this.config, true);
    this.unsubs.push(kernel.events.on('config:change', ({ config }) => this.applyConfig(config)));
    this.unsubs.push(kernel.events.on('apps:change', () => this.refreshApps()));
    this.unsubs.push(this.audio.on((info) => this.taskbar.setMusic(info)));
    this._loop = setInterval(() => this._tick(), SCHEDULER_MS);
    this._clockTimer = setInterval(() => this._tickClock(), 1000);
    this._welcome = !this.restoreSession();
    this._resolutionTip();
    this._armAutoplay();
    if (this.config.lockscreen) this.lock(); else this._greet();
  }

  // ---------- construction ----------
  _build() {
    const { root } = this;
    root.classList.add('vo-root');
    clear(root);
    this.wallCanvas = h('canvas', { class: 'vo-wall-canvas', 'aria-hidden': 'true' });
    this.wall = h('div', { class: 'vo-wall' }, this.wallCanvas);
    this.wTime = h('div', { class: 'w-time' });
    this.wDate = h('div', { class: 'w-date' });
    this.widget = h('div', { class: 'vo-widget' }, this.wTime, this.wDate);
    this.iconsEl = h('div', { class: 'vo-icons' });
    this.layer = h('div', { class: 'vo-windows' });
    this.toasts = h('div', { class: 'vo-toasts', 'aria-live': 'polite' });
    this.overlay = h('div', { class: 'vo-overlay' });
    this.lockTime = h('div', { class: 'lk-time' });
    this.lockDate = h('div', { class: 'lk-date' });
    this.lockEl = h('div', { class: 'vo-lock', hidden: true, tabindex: '0', role: 'dialog', 'aria-label': 'Màn hình khóa' },
      this.lockTime, this.lockDate, h('div', { class: 'lk-hint', text: 'Chạm hoặc nhấn Enter để mở khóa' }));
    this.lockEl.addEventListener('click', () => this.unlock());
    this.lockEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.unlock(); } });
    this.screen = h('div', { class: 'vo-screen' });
    this.wm = new WindowManager({
      layer: this.layer,
      bounds: () => ({ w: this.size.w, h: this.size.h - TASKBAR_H }),
      scale: () => this.scale,
      onChange: (kind) => this._onWindowsChange(kind),
    });
    this.taskbar = new Taskbar(this);
    this.startMenu = new StartMenu(this);
    this.screen.append(this.wall, this.widget, this.iconsEl, this.layer, this.startMenu.el, this.taskbar.el, this.toasts, this.overlay, this.lockEl);
    root.append(this.screen);
    this.mouse = new VirtualMouse(this); // above everything, even the lock screen
    onLongPress(this.wall, (e) => this.menu(e, [
      { label: 'Mở Trình duyệt', action: () => this.openApp('browser') }, { label: 'Mở Terminal', action: () => this.openApp('terminal') },
      { label: 'Mở Tệp', action: () => this.openApp('files') }, { label: 'Đổi hình nền…', action: () => this.openApp('settings') },
      'sep', { label: 'Khóa màn hình', action: () => this.lock() }, { label: 'Làm mới', action: () => this.refreshApps() },
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

  applyConfig(cfg, force = false) {
    const prev = force ? {} : this.config;
    this.config = cfg;
    this.root.dataset.theme = cfg.theme;
    this._fit();
    this.applyWallpaper();
    if (prev.musicVolume !== cfg.musicVolume) this.audio.setVolume(cfg.musicVolume);
    this.mouse.set(!!cfg.virtualMouse, cfg.mouseSpeed);
    this.taskbar.setMouse(!!cfg.virtualMouse);
    this.startMenu.render();
    this._tickClock();
  }

  // 'auto' = the desktop is exactly as big as the window (like a real PC); otherwise a fixed
  // logical resolution that is scaled to fit.
  _fit() {
    const aw = this.root.clientWidth, ah = this.root.clientHeight;
    let w, hh, scale = 1, left = 0, top = 0;
    if (this.config.resolution === 'auto') {
      const vw = aw > 0 ? aw : 360, vh = ah > 0 ? ah : 640;
      // "UI size": bigger buttons and text on the same screen, but never so big that fewer than 240x320 logical pixels remain
      scale = Math.min((this.config.uiZoom ?? 100) / 100, vw / 240, vh / 320);
      w = vw / scale; hh = vh / scale;
    } else {
      [w, hh] = String(this.config.resolution).split('x').map(Number);
      if (aw > 0 && ah > 0) { scale = Math.min(aw / w, ah / hh); left = (aw - w * scale) / 2; top = (ah - hh * scale) / 2; }
    }
    const next = { w: Math.round(w), h: Math.round(hh) };
    const changed = next.w !== this.size.w || next.h !== this.size.h || scale !== this.scale;
    this.size = next; this.scale = scale;
    Object.assign(this.screen.style, { width: `${next.w}px`, height: `${next.h}px`, transform: scale === 1 ? '' : `scale(${scale})`, left: `${left}px`, top: `${top}px` });
    this.wm.fit();
    this.mouse?.fit();
    if (changed && this.wall) { clearTimeout(this._wallTimer); this._wallTimer = setTimeout(() => this.applyWallpaper(), 150); }
  }

  applyWallpaper() {
    const cfg = this.config.wallpaper ?? DEFAULT_WALLPAPER;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    let pw = Math.round(this.size.w * this.scale * dpr), ph = Math.round(this.size.h * this.scale * dpr);
    if (pw * ph > WALL_PIXEL_CAP) { const k = Math.sqrt(WALL_PIXEL_CAP / (pw * ph)); pw = Math.round(pw * k); ph = Math.round(ph * k); }
    pw = Math.max(64, pw); ph = Math.max(64, ph);
    const key = `${cfg}|${pw}x${ph}`;
    if (key === this._wallKey) return;
    this._wallKey = key;
    this.wall.dataset.wallpaper = cfg;
    if (cfg.startsWith('file:')) this._wallpaperFromFile(cfg.slice(5), pw, ph, key);
    else renderWallpaper(cfg.slice(4), this.wallCanvas, pw, ph);
  }

  async _wallpaperFromFile(path, pw, ph, key) {
    let url = null;
    try {
      const ext = imageExt(path);
      if (!IMAGE_EXT[ext]) throw new Error('not an image');
      url = URL.createObjectURL(new Blob([this.sys('fs.readBytes', path)], { type: IMAGE_EXT[ext] }));
      const img = await (this.hooks.loadImage ?? loadImage)(url);
      if (key === this._wallKey) drawCover(this.wallCanvas, img, pw, ph);
    } catch {
      if (key !== this._wallKey) return;
      this._wallKey = '';
      this.notify('Không đọc được ảnh nền, dùng hình mặc định', { level: 'warn' });
      renderWallpaper('voidgold', this.wallCanvas, pw, ph);
    } finally { if (url) URL.revokeObjectURL(url); }
  }

  _tick() {
    try { this.kernel.tick(); } catch (e) {
      if (!this._tickFailed) { this._tickFailed = true; this.notify(`Lỗi bộ lập lịch: ${e.message}`, { level: 'error' }); }
    }
  }

  _tickClock() {
    const d = new Date(this.kernel.clock());
    const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: !this.config.clock24 });
    const date = d.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' });
    this.taskbar.clock.textContent = time;
    this.wTime.textContent = this.lockTime.textContent = time;
    this.wDate.textContent = this.lockDate.textContent = date;
  }

  setVirtualMouse(on) {
    try { this.sys('sys.setConfig', { virtualMouse: !!on }); } catch (e) { this.notify(e.message, { level: 'error' }); }
  }

  // ---------- lock screen ----------
  lock() {
    this.startMenu.close();
    this._tickClock();
    this.lockEl.hidden = false;
    this.lockEl.focus?.();
  }

  unlock() {
    if (this.lockEl.hidden) return;
    this.lockEl.hidden = true;
    this._greet();
  }

  get locked() { return !this.lockEl.hidden; }

  _greet() {
    if (!this._welcome) return;
    this._welcome = false;
    this.notify('Chào mừng đến VoidOS! Bấm ◆ để mở menu.', { level: 'info' });
  }

  _resolutionTip() {
    try {
      if (this.config.resolution !== '270x480' || this.sys('fs.exists', TIP_MARK)) return;
      this.sys('fs.write', TIP_MARK, '1');
      this.notify('Mẹo: Cài đặt → Độ phân giải → "Tự động" để desktop vừa khít màn hình.', { level: 'info', ms: 7000 });
    } catch { /* tips are optional */ }
  }

  // ---------- music ----------
  savedMusic() {
    try { return cleanSource(JSON.parse(this.sys('fs.read', MUSIC_STATE)).source); } catch { return null; }
  }

  toggleMusic() { return this.audio.toggle(this.savedMusic() ?? { type: 'gen', id: STATIONS[0].id }); }

  // Browsers only allow sound after a user gesture: start at the first tap if "autoplay" is on.
  _armAutoplay() {
    if (!this.config.musicAutoplay) return;
    this._autoplay = () => { this.root.removeEventListener('pointerdown', this._autoplay, true); this._autoplay = null; if (!this.audio.info().source) this.toggleMusic(); };
    this.root.addEventListener('pointerdown', this._autoplay, true);
  }

  // ---------- apps ----------
  installed() { try { return this.sys('app.list'); } catch { return []; } }

  allApps() {
    return [...BUILTIN_APPS.map(({ id, name, icon }) => ({ id, name, icon })), ...this.installed().map((a) => ({ id: a.id, name: a.name ?? a.id, icon: 'program', installed: true }))];
  }

  refreshApps() {
    clear(this.iconsEl);
    for (const app of this.allApps()) {
      const b = h('button', { class: 'vo-icon', type: 'button', title: app.name, onclick: () => this.openApp(app.id) }, renderIcon(app.icon, 'vo-icon-img'), h('span', { class: 'vo-icon-name', text: app.name }));
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

  processImage(file) { return (this.hooks.processImage ?? processImageFile)(file); }
  isImage(path) { return isImageFile(path); }

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
    clearInterval(this._loop); clearInterval(this._clockTimer); clearTimeout(this._wallTimer);
    if (this._autoplay) this.root.removeEventListener('pointerdown', this._autoplay, true);
    for (const u of this.unsubs) u();
    this.ro?.disconnect();
    window.removeEventListener('resize', this._onResize);
    this.audio.dispose();
    this.mouse.destroy();
    this.wm.closeAll();
    clear(this.root);
    this.root.classList.remove('vo-root');
    this.root.removeAttribute('data-theme');
  }
}
