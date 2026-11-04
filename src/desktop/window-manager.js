import { h, clamp } from './dom.js';

export const TITLE_H = 28;
const MIN_W = 130, MIN_H = 90;
let nextId = 1;

// Windows: open/close/focus/minimize/maximize, drag by title bar, resize by the corner handle.
// bounds() = usable area (screen minus taskbar) in unscaled pixels; scale() = CSS scale of the screen.
export class WindowManager {
  constructor({ layer, bounds, scale = () => 1, onChange = () => {} }) {
    Object.assign(this, { layer, bounds, scale, onChange });
    this.wins = []; // back to front
  }

  list() { return [...this.wins]; }
  top() { return [...this.wins].reverse().find((w) => !w.minimized) ?? null; }

  open({ appId = null, title, icon = '', content, width = 230, height = 300, x, y }) {
    const b = this.bounds();
    const w = Math.min(width, b.w), hh = Math.min(height, b.h);
    const n = this.wins.length % 6;
    const win = {
      id: nextId++, appId, title, icon, w, h: hh, x: x ?? Math.min(6 + n * 14, Math.max(0, b.w - w)), y: y ?? Math.min(6 + n * 14, Math.max(0, b.h - hh)),
      minimized: false, maximized: false, closers: [], getState: null, onBeforeClose: null, el: null, titleEl: null,
    };
    const btn = (label, text, fn) => h('button', { class: 'win-btn', type: 'button', title: label, 'aria-label': label, text, onclick: fn, onpointerdown: (e) => e.stopPropagation() });
    win.titleEl = h('span', { class: 'win-name', text: title });
    win.el = h('div', { class: 'win', role: 'dialog', 'aria-label': title, dataset: { id: win.id } },
      h('div', { class: 'win-title', onpointerdown: (e) => this._drag(win, e), ondblclick: () => this.toggleMaximize(win) },
        h('span', { class: 'win-icon', text: icon }), win.titleEl,
        btn('Thu nhỏ', '–', () => this.minimize(win)), btn('Phóng to', '□', () => this.toggleMaximize(win)), btn('Đóng', '✕', () => this.close(win))),
      h('div', { class: 'win-body' }, content),
      h('div', { class: 'win-resize', onpointerdown: (e) => this._resize(win, e) }));
    win.el.addEventListener('pointerdown', () => { if (this.top() !== win) this.focus(win); }, true);
    this.wins.push(win);
    this._geometry(win);
    this.layer.append(win.el);
    this._restack();
    this.onChange('open', win);
    return win;
  }

  setTitle(win, title) {
    win.title = title;
    win.titleEl.textContent = title;
    this.onChange('title', win);
  }

  focus(win) {
    if (!this.wins.includes(win)) return;
    win.minimized = false;
    win.el.hidden = false;
    this.wins.splice(this.wins.indexOf(win), 1);
    this.wins.push(win);
    this._restack();
    this.onChange('focus', win);
  }

  minimize(win) {
    win.minimized = true;
    win.el.hidden = true;
    this._restack();
    this.onChange('minimize', win);
  }

  toggleMaximize(win) {
    win.maximized = !win.maximized;
    this._geometry(win);
    this.focus(win);
    this.onChange('maximize', win);
  }

  // Resolves true when closed; an app can veto through win.onBeforeClose() (e.g. unsaved changes).
  async close(win, { force = false } = {}) {
    if (!this.wins.includes(win)) return true;
    if (!force && win.onBeforeClose && (await win.onBeforeClose()) === false) return false;
    if (!this.wins.includes(win)) return true;
    for (const fn of win.closers) { try { fn(); } catch { /* a broken app must not block closing */ } }
    win.el.remove();
    this.wins.splice(this.wins.indexOf(win), 1);
    this._restack();
    this.onChange('close', win);
    return true;
  }

  closeAll() { for (const w of [...this.wins]) this.close(w, { force: true }); }

  // Apply a saved geometry (session restore).
  place(win, g) {
    for (const k of ['x', 'y', 'w', 'h']) if (Number.isFinite(g[k])) win[k] = g[k];
    win.maximized = !!g.maximized;
    this._geometry(win);
  }

  // Re-clamp everything after a resolution change.
  fit() { for (const w of this.wins) this._geometry(w); }

  _restack() {
    const top = this.top();
    this.wins.forEach((w, i) => { w.el.style.zIndex = String(i + 1); w.el.classList.toggle('focused', w === top); });
  }

  _geometry(win) {
    const b = this.bounds();
    if (win.maximized) Object.assign(win.view ??= {}, { x: 0, y: 0, w: b.w, h: b.h });
    else {
      win.w = clamp(win.w, MIN_W, b.w); win.h = clamp(win.h, MIN_H, b.h);
      win.x = clamp(win.x, 40 - win.w, b.w - 40); win.y = clamp(win.y, 0, b.h - TITLE_H);
      win.view = { x: win.x, y: win.y, w: win.w, h: win.h };
    }
    const v = win.view;
    Object.assign(win.el.style, { left: `${v.x}px`, top: `${v.y}px`, width: `${v.w}px`, height: `${v.h}px` });
    win.el.classList.toggle('maximized', win.maximized);
  }

  _track(e, onMove) {
    const s = this.scale(), px = e.clientX, py = e.clientY;
    const move = (ev) => onMove((ev.clientX - px) / s, (ev.clientY - py) / s);
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      this.onChange('geometry');
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  }

  _drag(win, e) {
    if (win.maximized || (e.button ?? 0) > 0) return;
    const { x, y } = win;
    this._track(e, (dx, dy) => { win.x = x + dx; win.y = y + dy; this._geometry(win); });
  }

  _resize(win, e) {
    if (win.maximized) return;
    e.stopPropagation();
    const { w, h: hh } = win;
    this._track(e, (dx, dy) => { win.w = w + dx; win.h = hh + dy; this._geometry(win); });
  }
}
