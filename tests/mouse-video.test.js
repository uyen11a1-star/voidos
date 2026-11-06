// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bootSystem } from './helpers-os.js';
import { Desktop } from '../src/desktop/desktop.js';

HTMLCanvasElement.prototype.getContext = () => null;
URL.createObjectURL = () => 'blob:fake'; URL.revokeObjectURL = () => {};
const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const ev = (el, type, x = 0, y = 0) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
const btn = (scope, text) => [...scope.querySelectorAll('button')].find((b) => b.textContent === text || b.title === text || b.getAttribute('aria-label') === text);
const KEY = 'AIzaSyA-1234567890abcdefghijklmnopqrs';
const OK = (items) => ({ ok: true, status: 200, json: async () => ({ items }) });
const VIDEOS = [
  { id: 'dQw4w9WgXcQ', snippet: { title: 'Bài &amp; hát &#39;hay&#39;', channelTitle: 'Kênh A', publishedAt: '2026-11-01T00:00:00Z' } },
  { id: 'abcdefghijk', snippet: { title: 'Video hai', channelTitle: 'Kênh B', publishedAt: '2026-10-01T00:00:00Z' } },
];

function fakeAudio() {
  const param = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = (x = {}) => ({ connect: (n) => n, disconnect() {}, ...x });
  const ctx = { currentTime: 0, sampleRate: 8000, destination: node(), resume: async () => {}, suspend: vi.fn(async () => {}), close() {},
    createGain: () => node({ gain: param() }), createOscillator: () => node({ frequency: param(), detune: param(), start() {}, stop() {} }),
    createBiquadFilter: () => node({ frequency: param(), Q: param() }), createBufferSource: () => node({ start() {}, stop() {} }),
    createConvolver: () => node(), createDynamicsCompressor: () => node(), createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }) };
  return { createContext: () => ctx, createAudio: () => ({ play: async () => {}, pause() {}, removeAttribute() {} }), setTimer: () => 1, clearTimer: () => {}, urlFor: () => 'blob:x', revoke: () => {} };
}

let sys, root, desk, fetchMock, openSpy;
async function mount(patch = {}, extra = {}) {
  desk?.destroy();
  if (Object.keys(patch).length) sys.call('sys.setConfig', patch);
  desk = new Desktop({ kernel: sys.kernel, root, hooks: { beep: vi.fn(), audio: fakeAudio(), fetch: fetchMock, ...extra } });
  return desk;
}
beforeEach(async () => {
  sys = await bootSystem({ config: { lockscreen: false, resolution: '270x480' } });
  root = document.createElement('div'); document.body.append(root);
  fetchMock = vi.fn(async () => OK(VIDEOS));
  openSpy = vi.fn(() => ({})); window.open = openSpy;
  await mount();
});
afterEach(() => { vi.useRealTimers(); desk?.destroy(); desk = null; root.remove(); delete document.elementsFromPoint; });

describe('virtual mouse', () => {
  const on = (speed) => { sys.call('sys.setConfig', { virtualMouse: true, ...(speed ? { mouseSpeed: speed } : {}) }); return desk.mouse; };
  const target = (tag = 'button') => { const el = document.createElement(tag); document.body.append(el); desk.hooks.hitTest = () => el; return el; };
  const drag = (vm, from, to) => { ev(vm.area, 'pointerdown', from[0], from[1]); ev(document, 'pointermove', to[0], to[1]); ev(document, 'pointerup', to[0], to[1]); };
  const tap = (vm) => { ev(vm.area, 'pointerdown', 50, 50); ev(document, 'pointerup', 50, 50); };

  it('the tray button turns it on and off and remembers the choice', () => {
    expect(desk.mouse.pad.hidden).toBe(true);
    click(desk.taskbar.mouse);
    expect(desk.mouse.pad.hidden).toBe(false);
    expect(desk.mouse.cursor.hidden).toBe(false);
    expect(desk.taskbar.mouse.getAttribute('aria-pressed')).toBe('true');
    expect(sys.call('sys.config').virtualMouse).toBe(true);
    click(desk.taskbar.mouse);
    expect(desk.mouse.pad.hidden).toBe(true);
    expect(sys.call('sys.config').virtualMouse).toBe(false);
  });
  it('it is already on after a restart when it was left on', async () => {
    on();
    await mount();
    expect(desk.mouse.pad.hidden).toBe(false);
  });
  it('dragging the pad moves the cursor by distance x speed, and never leaves the screen', () => {
    const vm = on(3);
    const { x, y } = vm;
    drag(vm, [100, 100], [130, 120]);
    expect(vm.x).toBeCloseTo(x + 30 * 1.7); expect(vm.y).toBeCloseTo(y + 20 * 1.7);
    drag(vm, [0, 0], [9999, 9999]);
    expect(vm.x).toBe(269); expect(vm.y).toBe(479);
    drag(vm, [0, 0], [-9999, -9999]);
    expect([vm.x, vm.y]).toEqual([0, 0]);
    expect(vm.cursor.style.transform).toBe('translate(0px, 0px)');
  });
  it('speed 1..5 scales the movement; the screen scale is compensated', () => {
    let vm = on(1); let s = vm.x; drag(vm, [0, 0], [10, 0]); expect(vm.x - s).toBeCloseTo(8);
    vm = on(5); s = vm.x; sys.call('sys.setConfig', { mouseSpeed: 5 }); drag(vm, [0, 0], [10, 0]); expect(vm.x - s).toBeCloseTo(32);
    desk.scale = 2; s = vm.x; drag(vm, [0, 0], [10, 0]); expect(vm.x - s).toBeCloseTo(16); // 10 screen px = 5 logical px
  });
  it('a tap on the pad clicks what is under the cursor, with the full mouse event sequence', () => {
    const vm = on();
    const el = target();
    const seen = [];
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.addEventListener(t, (e) => seen.push([t, e.clientX, e.clientY, e.button]));
    tap(vm);
    expect(seen.map((s) => s[0])).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
    expect(seen[4][1]).toBe(vm.x); expect(seen[4][2]).toBe(vm.y);
  });
  it('moving the finger or holding too long is not a tap', () => {
    vi.useFakeTimers();
    const vm = on();
    const el = target(); const clicked = vi.fn(); el.addEventListener('click', clicked);
    drag(vm, [0, 0], [40, 0]);
    ev(vm.area, 'pointerdown', 5, 5); vi.advanceTimersByTime(600); ev(document, 'pointerup', 5, 5);
    expect(clicked).not.toHaveBeenCalled();
  });
  it('"Trái" clicks, "Phải" opens the context menu (no click)', () => {
    const vm = on();
    const el = target();
    const seen = [];
    for (const t of ['click', 'contextmenu']) el.addEventListener(t, (e) => seen.push([t, e.button]));
    click(btn(vm.pad, 'Trái'));
    click(btn(vm.pad, 'Phải'));
    expect(seen).toEqual([['click', 0], ['contextmenu', 2]]);
  });
  it('right click really opens the desktop menu through the pad', () => {
    const vm = on();
    desk.hooks.hitTest = () => desk.wall;
    click(btn(vm.pad, 'Phải'));
    expect(desk.overlay.querySelector('.ctx')).toBeTruthy();
    click(btn(desk.overlay.querySelector('.ctx'), 'Mở Terminal'));
    expect(desk.wm.list().some((w) => w.appId === 'terminal')).toBe(true);
  });
  it('two quick taps are a double click (maximizes a window by its title bar)', () => {
    const vm = on();
    const w = desk.openApp('terminal');
    desk.hooks.hitTest = () => w.el.querySelector('.win-title');
    tap(vm); tap(vm);
    expect(w.maximized).toBe(true);
  });
  it('text boxes get focus (so the keyboard appears) and checkboxes toggle', () => {
    const vm = on();
    const input = target('input');
    tap(vm);
    expect(document.activeElement).toBe(input);
    const cb = target('input'); cb.type = 'checkbox';
    tap(vm);
    expect(cb.checked).toBe(true);
    tap(vm);
    expect(cb.checked).toBe(false);
  });
  it('"Giữ" + moving drags a window; releasing drops it', () => {
    const vm = on();
    const w = desk.openApp('terminal');
    desk.hooks.hitTest = () => w.el.querySelector('.win-title');
    const { x, y } = w;
    click(btn(vm.pad, 'Giữ'));
    expect(vm.held).toBe(true);
    expect(btn(vm.pad, 'Giữ').getAttribute('aria-pressed')).toBe('true');
    vm.move(30, 20);
    expect([w.x, w.y]).toEqual([x + 30, y + 20]);
    click(btn(vm.pad, 'Giữ'));
    vm.move(50, 50);
    expect([w.x, w.y]).toEqual([x + 30, y + 20]); // dropped: no longer following
    expect(vm.held).toBe(false);
  });
  it('the scroll strip scrolls the scrollable thing under the cursor', () => {
    const vm = on();
    const box = document.createElement('div'); box.style.overflowY = 'auto';
    Object.defineProperty(box, 'scrollHeight', { value: 1000 }); Object.defineProperty(box, 'clientHeight', { value: 100 });
    const inner = document.createElement('p'); box.append(inner); document.body.append(box);
    desk.hooks.hitTest = () => inner;
    ev(vm.strip, 'pointerdown', 0, 100); ev(document, 'pointermove', 0, 50); ev(document, 'pointerup', 0, 50); // finger up = content moves up
    expect(box.scrollTop).toBe(100);
    ev(vm.strip, 'pointerdown', 0, 0); ev(document, 'pointermove', 0, 20); ev(document, 'pointerup', 0, 20);
    expect(box.scrollTop).toBe(60);
    box.remove();
  });
  it('web pages in frames cannot take the virtual mouse: it says so once', () => {
    const vm = on();
    const frame = document.createElement('iframe'); document.body.append(frame);
    desk.hooks.hitTest = () => frame;
    click(btn(vm.pad, 'Trái')); click(btn(vm.pad, 'Trái'));
    expect([...desk.toasts.children].filter((t) => /chạm trực tiếp/.test(t.textContent)).length).toBe(1);
    frame.remove();
  });
  it('the cursor and pad are never the click target (default hit test skips them)', () => {
    const vm = on();
    const real = document.createElement('button'); document.body.append(real);
    document.elementsFromPoint = () => [vm.cursor, vm.pad.querySelector('button'), real];
    delete desk.hooks.hitTest;
    expect(vm.hit()).toBe(real);
    real.remove();
  });
  it('the pad can be dragged by its handle, stays on screen, and ✕ turns the mouse off', () => {
    const vm = on();
    const { px, py } = vm;
    ev(vm.handle, 'pointerdown', 100, 100); ev(document, 'pointermove', 80, 70); ev(document, 'pointerup', 80, 70);
    expect([vm.px, vm.py]).toEqual([px - 20, py - 30]);
    ev(vm.handle, 'pointerdown', 0, 0); ev(document, 'pointermove', -9999, -9999); ev(document, 'pointerup');
    expect([vm.px, vm.py]).toEqual([0, 0]);
    click(btn(vm.pad, 'Tắt chuột ảo'));
    expect(vm.pad.hidden).toBe(true);
    expect(sys.call('sys.config').virtualMouse).toBe(false);
  });
  it('turning it off while "Giữ" is on releases the button', () => {
    const vm = on();
    const el = target(); const up = vi.fn(); el.addEventListener('mouseup', up);
    click(btn(vm.pad, 'Giữ'));
    sys.call('sys.setConfig', { virtualMouse: false });
    expect(up).toHaveBeenCalledTimes(1);
    expect(vm.held).toBe(false);
  });
  it('pad and cursor are pulled back inside when the screen gets smaller', () => {
    sys.call('sys.setConfig', { resolution: '720x1280' });
    const vm = on();
    vm.move(9999, 9999); vm.px = 700; vm.py = 1200; vm.fit();
    sys.call('sys.setConfig', { resolution: '270x480' });
    expect(vm.x).toBeLessThanOrEqual(269); expect(vm.y).toBeLessThanOrEqual(479);
    expect(vm.px).toBeLessThanOrEqual(270 - 172); expect(vm.py).toBeLessThanOrEqual(480 - 36 - 146);
  });
  it('mouse settings reject nonsense', () => {
    for (const bad of [{ mouseSpeed: 0 }, { mouseSpeed: 6 }, { mouseSpeed: 2.5 }, { virtualMouse: 'yes' }, { uiZoom: 50 }, { uiZoom: 400 }, { youtubeKey: 'x y z' }, { youtubeKey: 'short' }]) expect(() => sys.call('sys.setConfig', bad)).toThrow();
  });
});

describe('UI size (zoom) for easier tapping', () => {
  it('in Auto mode a bigger UI size makes everything larger on the same screen', () => {
    Object.defineProperty(root, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(root, 'clientHeight', { value: 1600, configurable: true });
    sys.call('sys.setConfig', { resolution: 'auto', uiZoom: 100 });
    expect(desk.size).toEqual({ w: 800, h: 1600 });
    expect(desk.screen.style.transform).toBe('');
    sys.call('sys.setConfig', { uiZoom: 200 });
    expect(desk.size).toEqual({ w: 400, h: 800 });
    expect(desk.scale).toBe(2);
    expect(desk.screen.style.transform).toBe('scale(2)');
    expect(desk.screen.style.left).toBe('0px');
    const w = desk.openApp('terminal'); desk.wm.toggleMaximize(w);
    expect(w.el.style.width).toBe('400px'); // windows follow the smaller logical screen
    ev(w.el.querySelector('.win-title'), 'pointerdown', 0, 0); ev(document, 'pointermove', 20, 0); ev(document, 'pointerup');
  });
  it('a zoom that would not fit is reduced so the desktop never spills outside the window', () => {
    Object.defineProperty(root, 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty(root, 'clientHeight', { value: 800, configurable: true });
    sys.call('sys.setConfig', { resolution: 'auto', uiZoom: 250 });
    expect(desk.size.w).toBeGreaterThanOrEqual(240);
    expect(desk.size.h).toBeGreaterThanOrEqual(320);
    expect(desk.size.w * desk.scale).toBeLessThanOrEqual(400.5);
    expect(desk.size.h * desk.scale).toBeLessThanOrEqual(800.5);
  });
  it('Settings offers the zoom, mouse and API key fields and saves them', async () => {
    const w = desk.openApp('settings');
    const f = w.api.fields;
    f.zoom.value = '150'; f.mouse.checked = true; f.speed.value = '5'; f.ytKey.value = KEY;
    await w.api.apply();
    expect(sys.call('sys.config')).toMatchObject({ uiZoom: 150, virtualMouse: true, mouseSpeed: 5, youtubeKey: KEY });
    expect(desk.mouse.pad.hidden).toBe(false);
    f.ytKey.value = 'bad key';
    await w.api.apply();
    expect(desk.toasts.textContent).toMatch(/Invalid value for "youtubeKey"/);
    expect(sys.call('sys.config').youtubeKey).toBe(KEY);
  });
});

describe('Video (YouTube) app', () => {
  const frame = (w) => w.el.querySelector('iframe');
  const open = (state) => desk.openApp('video', state);

  it('without a key it explains how to get one, but pasting a link still plays', async () => {
    const w = open();
    expect(w.maximized).toBe(true);
    expect(w.el.querySelector('.vd-setup').textContent).toMatch(/YouTube Data API v3/);
    expect(fetchMock).not.toHaveBeenCalled();
    w.api.search.value = 'https://youtu.be/dQw4w9WgXcQ';
    w.api.submit();
    const f = frame(w);
    expect(f.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&playsinline=1&rel=0');
    expect(f.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
    expect(f.getAttribute('sandbox')).toContain('allow-scripts');
    expect(f.getAttribute('sandbox')).not.toContain('allow-top-navigation');
    expect(f.getAttribute('allow')).toContain('fullscreen');
    expect(JSON.parse(sys.call('fs.read', '/home/user/.video/history.json'))[0].id).toBe('dQw4w9WgXcQ');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('the background music steps aside when a video starts', async () => {
    await desk.audio.play({ type: 'gen', id: 'rain' });
    expect(desk.audio.info().playing).toBe(true);
    const w = open();
    w.api.play({ id: 'dQw4w9WgXcQ', title: 'x', channel: '' });
    await vi.waitFor(() => expect(desk.audio.info().playing).toBe(false));
  });
  it('saving a key loads the trending feed (the cheap 1-unit call) as cards with decoded titles', async () => {
    const w = open();
    w.el.querySelector('.vd-setup input').value = KEY;
    click(btn(w.el, 'Lưu key'));
    await vi.waitFor(() => expect(w.el.querySelectorAll('.vd-card').length).toBe(2));
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe('/youtube/v3/videos');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ chart: 'mostPopular', regionCode: 'VN', key: KEY });
    expect(w.el.querySelector('.vd-card b').textContent).toBe("Bài & hát 'hay'");
    expect(w.el.querySelector('.vd-card img').getAttribute('src')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg');
    expect(w.el.querySelector('.vd-head').textContent).toMatch(/thịnh hành/);
    click(w.el.querySelector('.vd-card'));
    expect(frame(w).getAttribute('src')).toContain('/embed/dQw4w9WgXcQ');
    click(btn(w.el, '← Quay lại'));
    expect(w.el.querySelectorAll('.vd-card').length).toBe(2);
  });
  it('searching sends the text as one parameter and shows the results', async () => {
    sys.call('sys.setConfig', { youtubeKey: KEY });
    const w = open();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)); // home feed
    w.api.search.value = 'nhạc & lofi #1';
    w.api.submit();
    await vi.waitFor(() => expect(w.el.querySelector('.vd-head')?.textContent).toMatch(/Kết quả cho "nhạc & lofi #1"/));
    const u = new URL(fetchMock.mock.calls[1][0]);
    expect(u.pathname).toBe('/youtube/v3/search');
    expect(u.searchParams.get('q')).toBe('nhạc & lofi #1');
    expect(u.searchParams.get('type')).toBe('video');
  });
  it('search without a key says so and makes no request', () => {
    const w = open();
    w.api.search.value = 'mèo';
    w.api.submit();
    expect(w.el.textContent).toMatch(/Cần API key để tìm kiếm/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('explains quota, key and network problems in plain words', async () => {
    sys.call('sys.setConfig', { youtubeKey: KEY });
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: { errors: [{ reason: 'quotaExceeded' }] } }) });
    const w = open();
    await vi.waitFor(() => expect(w.el.querySelector('.vd-note.err')?.textContent).toMatch(/Hết lượt dùng/));
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { errors: [{ reason: 'keyInvalid' }] } }) });
    w.api.home();
    await vi.waitFor(() => expect(w.el.querySelector('.vd-note.err')?.textContent).toMatch(/không đúng/));
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    w.api.home();
    await vi.waitFor(() => expect(w.el.querySelector('.vd-note.err')?.textContent).toMatch(/Không có mạng/));
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('not json'); } });
    w.api.home();
    await vi.waitFor(() => expect(w.el.querySelector('.vd-note.err')?.textContent).toMatch(/Không có kết quả/));
  });
  it('a bad key typed in the setup panel is refused', () => {
    const w = open();
    w.el.querySelector('.vd-setup input').value = 'not a key';
    click(btn(w.el, 'Lưu key'));
    expect(desk.toasts.textContent).toMatch(/không đúng định dạng/);
    expect(sys.call('sys.config').youtubeKey).toBe('');
  });
  it('an old, slow answer never overwrites a newer one', async () => {
    sys.call('sys.setConfig', { youtubeKey: KEY });
    let first; fetchMock.mockImplementationOnce(() => new Promise((r) => { first = r; }));
    const w = open(); // slow home request in flight
    fetchMock.mockResolvedValueOnce(OK([{ id: 'zzzzzzzzzzz', snippet: { title: 'Mới nhất' } }]));
    w.api.search.value = 'x'; w.api.submit();
    await vi.waitFor(() => expect(w.el.querySelector('.vd-card b')?.textContent).toBe('Mới nhất'));
    first(OK(VIDEOS)); await tick(); await tick();
    expect(w.el.querySelector('.vd-card b').textContent).toBe('Mới nhất');
    expect(w.el.querySelectorAll('.vd-card').length).toBe(1);
  });
  it('favorites: toggle in the player, listed in its tab, kept after reopening; junk in the file is ignored', async () => {
    let w = open();
    w.api.play({ id: 'dQw4w9WgXcQ', title: 'Hay', channel: 'K' });
    click(btn(w.el, '♡ Yêu thích'));
    expect(btn(w.el, '♥ Đã thích').getAttribute('aria-pressed')).toBe('true');
    expect(frame(w)).toBeTruthy(); // toggling does not restart the video
    desk.wm.close(w, { force: true });
    sys.call('fs.write', '/home/user/.video/favorites.json', JSON.stringify([...JSON.parse(sys.call('fs.read', '/home/user/.video/favorites.json')), { id: '<script>', title: 'x' }, null, { id: 5 }]));
    w = open({ tab: 'fav' });
    expect(w.api.favorites().map((f) => f.id)).toEqual(['dQw4w9WgXcQ']);
    expect(w.el.querySelectorAll('.vd-card').length).toBe(1);
    click(w.el.querySelector('.vd-card'));
    click(btn(w.el, '♥ Đã thích'));
    expect(w.api.favorites()).toEqual([]);
  });
  it('history lists what was watched and can be cleared', () => {
    const w = open();
    w.api.play({ id: 'dQw4w9WgXcQ', title: 'A', channel: '' }); w.api.play({ id: 'abcdefghijk', title: 'B', channel: '' }); w.api.play({ id: 'dQw4w9WgXcQ', title: 'A', channel: '' });
    expect(w.api.history().map((h) => h.title)).toEqual(['A', 'B']); // newest first, no duplicates
    click(btn(w.el, 'Lịch sử'));
    expect(w.el.querySelectorAll('.vd-card').length).toBe(2);
    click(btn(w.el, 'Xóa lịch sử'));
    expect(w.api.history()).toEqual([]);
  });
  it('restoring a saved session shows the player without autoplay or a new history entry', () => {
    const w = open({ tab: 'home', id: 'dQw4w9WgXcQ' });
    expect(frame(w).getAttribute('src')).toContain('autoplay=0');
    expect(w.api.history()).toEqual([]);
    expect(w.getState()).toEqual({ tab: 'home', id: 'dQw4w9WgXcQ' });
    const bad = open({ tab: 'evil', id: '"><script>' });
    expect(frame(bad)).toBeNull();
    expect(bad.getState().tab).toBe('home');
  });
  it('closing the window removes the player so the video stops at once', async () => {
    const w = open();
    w.api.play({ id: 'dQw4w9WgXcQ', title: 'A', channel: '' });
    const f = frame(w);
    await desk.wm.close(w);
    expect(f.isConnected).toBe(false);
  });
  it('"Mở trên YouTube" opens the real watch page; a blocked popup is reported', () => {
    const w = open();
    w.api.play({ id: 'dQw4w9WgXcQ', title: 'A', channel: '' });
    click(btn(w.el, 'Mở trên YouTube ↗'));
    expect(openSpy).toHaveBeenCalledWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ', '_blank', 'noopener,noreferrer');
    openSpy.mockReturnValue(null);
    click(btn(w.el, 'Mở trên YouTube ↗'));
    expect(desk.toasts.textContent).toMatch(/chặn cửa sổ mới/);
  });
  it('a pasted link gets its real title when a key is available', async () => {
    sys.call('sys.setConfig', { youtubeKey: KEY });
    fetchMock.mockResolvedValue(OK([{ id: 'dQw4w9WgXcQ', snippet: { title: 'Tiêu đề thật', channelTitle: 'Kênh thật' } }]));
    const w = open();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    w.api.search.value = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'; w.api.submit();
    await vi.waitFor(() => expect(w.el.querySelector('.vd-meta b')?.textContent).toBe('Tiêu đề thật'));
    expect(new URL(fetchMock.mock.calls.at(-1)[0]).searchParams.get('id')).toBe('dQw4w9WgXcQ');
  });
  it('the browser home page sends YouTube to this app instead of an outside tab', () => {
    const b = desk.openApp('browser');
    const tile = [...b.el.querySelectorAll('.tile')].find((t) => t.textContent.includes('YouTube'));
    expect(tile.textContent).not.toContain('↗');
    click(tile);
    expect(desk.wm.list().some((w) => w.appId === 'video')).toBe(true);
    expect(openSpy).not.toHaveBeenCalled();
  });
});
