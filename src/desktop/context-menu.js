import { h } from './dom.js';

export function closeContextMenu(overlay) {
  overlay.querySelector('.ctx')?.dispatchEvent(new Event('ctx-close'));
}

// items: [{ label, action, danger? }, 'sep']. Positions are in screen (unscaled) pixels.
export function showContextMenu(overlay, { x, y, items, bounds }) {
  closeContextMenu(overlay);
  const menu = h('div', { class: 'ctx', role: 'menu' });
  const away = (e) => { if (!menu.contains(e.target)) close(); };
  function close() {
    menu.remove();
    document.removeEventListener('pointerdown', away, true);
  }
  menu.addEventListener('ctx-close', close);
  for (const it of items) {
    if (it === 'sep') { menu.append(h('div', { class: 'ctx-sep' })); continue; }
    menu.append(h('button', { class: `ctx-item${it.danger ? ' danger' : ''}`, type: 'button', role: 'menuitem', text: it.label, onclick: () => { close(); it.action(); } }));
  }
  const W = 160, H = items.length * 34 + 8;
  menu.style.left = `${Math.max(0, Math.min(x, bounds.w - W))}px`;
  menu.style.top = `${Math.max(0, Math.min(y, bounds.h - H))}px`;
  overlay.append(menu);
  document.addEventListener('pointerdown', away, true);
  return close;
}

// Long-press (touch) or right-click (mouse) -> handler(event). The click that ends a long press is swallowed.
export function onLongPress(el, handler, ms = 550) {
  let timer = null, sx = 0, sy = 0, fired = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  el.addEventListener('pointerdown', (e) => {
    fired = false;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    sx = e.clientX; sy = e.clientY;
    cancel();
    timer = setTimeout(() => { timer = null; fired = true; handler(e); }, ms);
  });
  el.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(t, cancel);
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    cancel();
    if (!fired) handler(e); // Android fires contextmenu after a long press: don't open twice
  });
  el.addEventListener('click', (e) => { if (fired) { fired = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
}
