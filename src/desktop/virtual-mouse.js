import { h, clamp } from './dom.js';

// A floating touchpad + on-screen cursor, so small targets can be hit precisely with a thumb.
// Dragging on the pad moves the cursor; a tap on the pad (or "Trái") clicks where the cursor is.
// It sends the same pointer/mouse events a real mouse would, to whatever is under the cursor.
// Web pages inside iframes are cross-origin and cannot receive them: touch those directly.
const PAD_W = 172, PAD_H = 146, TASKBAR = 36;
const FACTORS = [0.8, 1.2, 1.7, 2.4, 3.2];
const CURSOR = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 26" width="20" height="26" aria-hidden="true"><path d="M2 1.5v17.2l4.7-4 3 7.1 3.1-1.3-3-7 6-.3z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>';

export class VirtualMouse {
  constructor(desktop) {
    this.d = desktop;
    this.on = false; this.speed = 3; this.x = 40; this.y = 40; this.held = false; this.lastTap = { t: 0, x: 0, y: 0 }; this.lastNote = 0;
    this.px = 0; this.py = 0;

    this.cursor = h('div', { class: 'vm-cursor', hidden: true, 'aria-hidden': 'true' });
    const t = document.createElement('template'); t.innerHTML = CURSOR; this.cursor.append(t.content.firstElementChild);

    this.area = h('div', { class: 'vm-area', role: 'application', 'aria-label': 'Vùng di chuyển chuột' }, h('span', { text: 'Kéo để di chuyển · chạm để nhấp' }));
    this.strip = h('div', { class: 'vm-strip', 'aria-label': 'Cuộn trang' }, h('span', { text: '⇕' }));
    this.holdBtn = h('button', { class: 'vm-btn', type: 'button', text: 'Giữ', 'aria-pressed': 'false', title: 'Giữ nút trái để kéo thả', onclick: () => this.toggleHold() });
    this.handle = h('div', { class: 'vm-handle' }, h('span', { text: '⠿ Chuột ảo' }),
      h('button', { class: 'vm-x', type: 'button', 'aria-label': 'Tắt chuột ảo', text: '✕', onclick: () => desktop.setVirtualMouse(false), onpointerdown: (e) => e.stopPropagation() }));
    this.pad = h('div', { class: 'vm-pad', hidden: true, role: 'group', 'aria-label': 'Chuột ảo' }, this.handle,
      h('div', { class: 'vm-body' }, this.area, this.strip),
      h('div', { class: 'vm-btns' }, h('button', { class: 'vm-btn', type: 'button', text: 'Trái', onclick: () => this.click() }), this.holdBtn, h('button', { class: 'vm-btn', type: 'button', text: 'Phải', onclick: () => this.click({ button: 2 }) })));
    desktop.screen.append(this.cursor, this.pad);
    this._wireArea(); this._wireStrip(); this._wireHandle();
    this.fit(true);
  }

  get factor() { return FACTORS[this.speed - 1] ?? FACTORS[2]; }
  get bounds() { return this.d.size; }

  set(on, speed) {
    this.speed = speed || this.speed;
    if (on === this.on) return;
    this.on = on;
    this.cursor.hidden = this.pad.hidden = !on;
    if (!on && this.held) this.toggleHold();
  }

  // Keep pad and cursor inside the screen after the size changes.
  fit(initial = false) {
    const { w, h: hh } = this.bounds;
    if (initial) { this.px = w - PAD_W - 8; this.py = hh - TASKBAR - PAD_H - 8; this.x = w / 2; this.y = hh / 2; }
    this.px = clamp(this.px, 0, w - PAD_W); this.py = clamp(this.py, 0, hh - TASKBAR - PAD_H);
    this.x = clamp(this.x, 0, w - 1); this.y = clamp(this.y, 0, hh - 1);
    this._draw();
  }

  _draw() {
    this.cursor.style.transform = `translate(${this.x}px, ${this.y}px)`;
    Object.assign(this.pad.style, { left: `${this.px}px`, top: `${this.py}px` });
  }

  move(dx, dy) {
    const { w, h: hh } = this.bounds;
    this.x = clamp(this.x + dx, 0, w - 1); this.y = clamp(this.y + dy, 0, hh - 1);
    this._draw();
    if (this.held) this._fire(this.hit() ?? document.body, 'pointermove', { buttons: 1 }), this._fire(this.hit() ?? document.body, 'mousemove', { buttons: 1 });
  }

  // ----- finding and poking the element under the cursor -----
  _client() {
    const r = this.d.screen.getBoundingClientRect();
    return { x: r.left + this.x * this.d.scale, y: r.top + this.y * this.d.scale };
  }
  _owned(el) { return this.pad.contains(el) || this.cursor.contains(el); }
  hit() {
    const { x, y } = this._client();
    if (this.d.hooks.hitTest) return this.d.hooks.hitTest(x, y);
    const stack = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [];
    return stack.find((el) => !this._owned(el)) ?? null;
  }
  _fire(el, type, init = {}) {
    const { x, y } = this._client();
    const isPointer = type.startsWith('pointer') && typeof PointerEvent === 'function';
    const Ctor = isPointer ? PointerEvent : MouseEvent;
    const extra = isPointer ? { pointerId: 1, pointerType: 'mouse', isPrimary: true } : {};
    el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, ...extra, ...init }));
  }
  _focusFor(el) {
    const f = el.closest?.('input, textarea, select, button, a[href], [tabindex]');
    if (!f || typeof f.focus !== 'function') return;
    f.focus();
    if (f.tagName === 'SELECT') { try { f.showPicker?.(); } catch { /* the picker needs a user gesture; the tap on the pad is one */ } }
  }

  click({ button = 0 } = {}) {
    const el = this.hit();
    if (!el) return false;
    if (el.tagName === 'IFRAME' && Date.now() - this.lastNote > 10000) {
      this.lastNote = Date.now();
      this.d.notify('Trang web trong khung nhận chạm trực tiếp, không nhận chuột ảo', { level: 'info' });
    }
    const b = { button, buttons: button === 2 ? 2 : 1 };
    this._fire(el, 'pointerdown', b); this._fire(el, 'mousedown', b);
    if (button === 0) this._focusFor(el);
    this._fire(el, 'pointerup', { button, buttons: 0 }); this._fire(el, 'mouseup', { button, buttons: 0 });
    this._fire(el, button === 2 ? 'contextmenu' : 'click', { button, buttons: 0 });
    return true;
  }

  toggleHold() {
    const el = this.hit() ?? document.body;
    if (!this.held) { this.held = true; this._fire(el, 'pointerdown', { buttons: 1 }); this._fire(el, 'mousedown', { buttons: 1 }); } else {
      this.held = false; this._fire(el, 'pointerup', { buttons: 0 }); this._fire(el, 'mouseup', { buttons: 0 });
    }
    this.holdBtn.setAttribute('aria-pressed', String(this.held));
    this.holdBtn.classList.toggle('on', this.held);
  }

  scroll(dy) {
    let n = this.hit();
    while (n && n !== document.body && n !== document.documentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight) { n.scrollTop += dy; return n; }
      n = n.parentElement;
    }
    return null;
  }

  tap() {
    const now = Date.now();
    const dbl = now - this.lastTap.t < 380 && Math.hypot(this.x - this.lastTap.x, this.y - this.lastTap.y) < 12;
    this.click();
    if (dbl) { const el = this.hit(); if (el) this._fire(el, 'dblclick'); }
    this.lastTap = { t: dbl ? 0 : now, x: this.x, y: this.y };
  }

  // ----- gestures on the pad -----
  _track(e, onMove, onEnd) {
    const s = this.d.scale || 1, sx = e.clientX, sy = e.clientY;
    let lx = sx, ly = sy;
    const move = (ev) => { onMove((ev.clientX - lx) / s, (ev.clientY - ly) / s, Math.hypot(ev.clientX - sx, ev.clientY - sy)); lx = ev.clientX; ly = ev.clientY; };
    const up = (ev) => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up); onEnd?.(ev); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
  }

  _wireArea() {
    this.area.addEventListener('pointerdown', (e) => {
      e.preventDefault?.();
      const t0 = Date.now();
      let moved = false;
      this._track(e, (dx, dy, dist) => { if (dist > 6) moved = true; if (moved) this.move(dx * this.factor, dy * this.factor); }, (ev) => {
        if (ev.type === 'pointerup' && !moved && Date.now() - t0 < 350) this.tap();
      });
    });
  }

  _wireStrip() {
    this.strip.addEventListener('pointerdown', (e) => { e.preventDefault?.(); this._track(e, (dx, dy) => this.scroll(-dy * 2)); });
  }

  _wireHandle() {
    this.handle.addEventListener('pointerdown', (e) => {
      const { px, py } = this;
      let ox = 0, oy = 0;
      this._track(e, (dx, dy) => { ox += dx; oy += dy; const { w, h: hh } = this.bounds; this.px = clamp(px + ox, 0, w - PAD_W); this.py = clamp(py + oy, 0, hh - TASKBAR - PAD_H); this._draw(); });
    });
  }

  destroy() { if (this.held) this.toggleHold(); this.cursor.remove(); this.pad.remove(); }
}
