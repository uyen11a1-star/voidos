// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bootSystem } from './helpers-os.js';
import { Desktop } from '../src/desktop/desktop.js';
import { renderIcon } from '../src/desktop/icons.js';
import { STATIONS } from '../src/desktop/audio.js';

HTMLCanvasElement.prototype.getContext = () => null;
URL.createObjectURL = () => 'blob:fake'; URL.revokeObjectURL = () => {};
const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const ptr = (el, type) => el.dispatchEvent(new MouseEvent(type, { bubbles: true }));
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
const btn = (scope, text) => [...scope.querySelectorAll('button')].find((b) => b.textContent === text || b.title === text || b.getAttribute('aria-label') === text);

function fakeAudio() {
  const param = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = (x = {}) => ({ connect: (n) => n, disconnect() {}, ...x });
  const ctx = { currentTime: 0, sampleRate: 8000, destination: node(), resume: async () => {}, suspend: async () => {}, close() {},
    createGain: () => node({ gain: param() }), createOscillator: () => node({ frequency: param(), detune: param(), start() {}, stop() {} }),
    createBiquadFilter: () => node({ frequency: param(), Q: param() }), createBufferSource: () => node({ start() {}, stop() {} }),
    createConvolver: () => node(), createDynamicsCompressor: () => node(), createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }) };
  const el = { src: '', volume: 1, play: vi.fn(async () => {}), pause: vi.fn(), removeAttribute() { this.src = ''; } };
  return { createContext: () => ctx, createAudio: () => el, setTimer: () => 1, clearTimer: () => {}, urlFor: () => 'blob:song', revoke: () => {}, el };
}

let sys, root, desk, audioFake, openSpy;
async function mount(patch = {}) {
  if (desk) { desk.destroy(); desk = null; }
  if (Object.keys(patch).length) sys.call('sys.setConfig', patch);
  audioFake = fakeAudio();
  desk = new Desktop({ kernel: sys.kernel, root, hooks: { beep: vi.fn(), audio: audioFake, download: vi.fn(), processImage: async (f) => ({ bytes: new Uint8Array([1, 2, 3]), ext: f.name.endsWith('.png') ? 'png' : 'jpg' }) } });
  return desk;
}
beforeEach(async () => {
  sys = await bootSystem({ config: { lockscreen: false, resolution: '270x480' } });
  root = document.createElement('div'); document.body.append(root);
  openSpy = vi.fn(() => ({})); window.open = openSpy;
  await mount();
});
afterEach(() => { vi.useRealTimers(); desk?.destroy(); desk = null; root.remove(); });

describe('icons in the UI', () => {
  it('app icons are SVG tiles; unknown icons fall back to text', () => {
    expect(renderIcon('browser').querySelector('svg')).toBeTruthy();
    expect(renderIcon('🎲').textContent).toBe('🎲');
    expect(desk.iconsEl.querySelectorAll('.vo-icon svg').length).toBe(10);
    const w = desk.openApp('terminal');
    expect(w.el.querySelector('.win-icon svg')).toBeTruthy();
    expect(desk.taskbar.tasks.querySelector('.tb-ic svg')).toBeTruthy();
  });
});

describe('wallpaper, widget and screen size', () => {
  it('applies the configured wallpaper and switches it live', () => {
    expect(desk.wall.dataset.wallpaper).toBe('gen:voidgold');
    sys.call('sys.setConfig', { wallpaper: 'gen:aurora' });
    expect(desk.wall.dataset.wallpaper).toBe('gen:aurora');
  });
  it('rejects malformed wallpaper settings', () => {
    for (const bad of ['gen:../x', 'http://evil/x.png', 'file:relative', 'gen:', 5, 'gen:' + 'a'.repeat(40)]) expect(() => sys.call('sys.setConfig', { wallpaper: bad })).toThrow();
  });
  it('a missing/unreadable photo wallpaper falls back with a warning', async () => {
    await mount();
    desk.hooks.loadImage = () => Promise.reject(new Error('x'));
    sys.call('fs.write', '/home/user/p.png', new Uint8Array([1]));
    sys.call('sys.setConfig', { wallpaper: 'file:/home/user/p.png' });
    await vi.waitFor(() => expect(desk.toasts.textContent).toMatch(/dùng hình mặc định/));
    sys.call('sys.setConfig', { wallpaper: 'file:/home/user/missing.png' });
    await vi.waitFor(() => expect(desk.toasts.textContent).toMatch(/dùng hình mặc định/));
  });
  it('shows a clock and date widget on the desktop', () => {
    expect(desk.wTime.textContent).toMatch(/\d/);
    expect(desk.wDate.textContent.length).toBeGreaterThan(3);
  });
  it('"auto" resolution makes the desktop exactly as big as its window and follows resizes', () => {
    sys.call('sys.setConfig', { resolution: 'auto' });
    expect(desk.size).toEqual({ w: 360, h: 640 }); // no layout in jsdom: sensible default
    Object.defineProperty(root, 'clientWidth', { value: 412, configurable: true });
    Object.defineProperty(root, 'clientHeight', { value: 880, configurable: true });
    window.dispatchEvent(new Event('resize'));
    expect(desk.size).toEqual({ w: 412, h: 880 });
    expect(desk.scale).toBe(1);
    const w = desk.openApp('terminal');
    desk.wm.toggleMaximize(w);
    expect(w.el.style.width).toBe('412px');
    expect(w.el.style.height).toBe('844px'); // 880 - taskbar
  });
  it('fixed resolutions are scaled to fit and centred', () => {
    Object.defineProperty(root, 'clientWidth', { value: 540, configurable: true });
    Object.defineProperty(root, 'clientHeight', { value: 1000, configurable: true });
    window.dispatchEvent(new Event('resize'));
    expect(desk.scale).toBe(2); // 270x480 -> 540x960
    expect(desk.screen.style.top).toBe('20px');
  });
  it('one-time tip about the old small default resolution', async () => {
    sys.call('fs.remove', '/etc/.tip-resolution'); // the shared beforeEach mount already used the first showing
    await mount();
    expect(desk.toasts.textContent).toMatch(/Tự động/);
    await mount();
    expect(desk.toasts.textContent).not.toMatch(/Tự động/); // shown once
  });
});

describe('lock screen', () => {
  it('locks at start when enabled, unlocks by tap or Enter, greets afterwards', async () => {
    await mount({ lockscreen: true });
    expect(desk.locked).toBe(true);
    expect(desk.lockEl.textContent).toMatch(/Chạm hoặc nhấn Enter/);
    expect(desk.toasts.textContent).not.toMatch(/Chào mừng/);
    click(desk.lockEl);
    expect(desk.locked).toBe(false);
    expect(desk.toasts.textContent).toMatch(/Chào mừng/);
    desk.lock(); key(desk.lockEl, 'Enter');
    expect(desk.locked).toBe(false);
  });
  it('can be locked again from the Start menu and wallpaper menu', () => {
    click(desk.taskbar.startBtn);
    click(btn(desk.startMenu.el, '🔒 Khóa màn hình'));
    expect(desk.locked).toBe(true);
    expect(desk.startMenu.isOpen).toBe(false);
    click(desk.lockEl);
    ptr(desk.wall, 'contextmenu');
    click(btn(desk.overlay.querySelector('.ctx'), 'Khóa màn hình'));
    expect(desk.locked).toBe(true);
  });
});

describe('music: tray button, app, autoplay', () => {
  it('tray button starts the saved/default station and shows play state', async () => {
    expect(desk.taskbar.music.textContent).toBe('♪');
    click(desk.taskbar.music);
    await vi.waitFor(() => expect(desk.audio.info().playing).toBe(true));
    expect(desk.taskbar.music.textContent).toBe('⏸');
    expect(desk.taskbar.music.title).toMatch(/Đang phát: Ambient Void/);
    click(desk.taskbar.music);
    await vi.waitFor(() => expect(desk.audio.info().playing).toBe(false));
    expect(desk.taskbar.music.textContent).toBe('♪');
  });
  it('music app: picks a station, remembers it, closing the window does not stop the music', async () => {
    const w = desk.openApp('music');
    expect(w.el.querySelectorAll('.mu-row').length).toBe(STATIONS.length);
    click([...w.el.querySelectorAll('.mu-row')][1]);
    await vi.waitFor(() => expect(desk.audio.info().title).toBe(STATIONS[1].name));
    expect(JSON.parse(sys.call('fs.read', '/home/user/.music.json')).source).toEqual({ type: 'gen', id: STATIONS[1].id });
    expect(w.el.querySelector('.mu-status').textContent).toBe('Đang phát');
    expect(w.el.querySelector('.mu-row.on')).toBeTruthy();
    await desk.wm.close(w);
    expect(desk.audio.info().playing).toBe(true);
  });
  it('library: imports songs to the virtual disk, rejects non-audio, plays and deletes', async () => {
    const w = desk.openApp('music');
    w.api.setTab('library');
    await w.api.importFiles([new File([new Uint8Array(100)], 'song.mp3', { type: 'audio/mpeg' }), new File([new Uint8Array(10)], 'notes.txt'), new File([new Uint8Array(5)], 'song.mp3')]);
    expect(sys.call('fs.list', '/home/user/Music').map((f) => f.name).sort()).toEqual(['song (1).mp3', 'song.mp3']);
    expect(desk.toasts.textContent).toMatch(/notes.txt: không phải file nhạc/);
    click(w.el.querySelector('.mu-main'));
    await vi.waitFor(() => expect(desk.audio.info().title).toBe('song (1).mp3'));
    click(btn(w.el, 'Xóa song (1).mp3'));
    expect(sys.call('fs.exists', '/home/user/Music/song (1).mp3')).toBe(false);
  });
  it('library shows the quota error when the disk is full', async () => {
    const w = desk.openApp('music');
    sys.call('sys.setConfig', { quotaKB: 1024 });
    await w.api.importFiles([new File([new Uint8Array(2 * 1024 * 1024)], 'big.mp3')]);
    expect(desk.toasts.textContent).toMatch(/quota|ENOSPC|full|space/i);
  });
  it('URL tab shows a clear error for unsupported links', async () => {
    const w = desk.openApp('music');
    w.api.setTab('url');
    w.el.querySelector('.mu-url input').value = 'javascript:alert(1)';
    click(btn(w.el, 'Phát'));
    await vi.waitFor(() => expect(w.el.querySelector('.mu-status').textContent).toMatch(/Chỉ phát được http/));
  });
  it('volume slider changes the level at once and saves it a moment later', async () => {
    const w = desk.openApp('music');
    vi.useFakeTimers();
    const v = w.el.querySelector('input[type=range]');
    v.value = '77'; v.dispatchEvent(new Event('input'));
    expect(desk.audio.info().volume).toBe(77);
    expect(sys.call('sys.config').musicVolume).toBe(40);
    vi.advanceTimersByTime(700);
    expect(sys.call('sys.config').musicVolume).toBe(77);
  });
  it('autoplay: starts at the first tap, with the saved source, only if enabled', async () => {
    sys.call('fs.write', '/home/user/.music.json', JSON.stringify({ source: { type: 'gen', id: 'rain' } }));
    await mount({ musicAutoplay: true });
    expect(desk.audio.info().playing).toBe(false);
    ptr(root, 'pointerdown');
    await vi.waitFor(() => expect(desk.audio.info().title).toBe('Mưa đêm'));
    await mount({ musicAutoplay: false });
    ptr(root, 'pointerdown'); await tick();
    expect(desk.audio.info().playing).toBe(false);
  });
  it('a tampered music state file cannot start anything unexpected', async () => {
    for (const bad of [{ type: 'file', path: 'relative' }, { type: 'url', url: 'javascript:1' }, { type: 'gen', id: '__proto__' }, 'x', null]) {
      sys.call('fs.write', '/home/user/.music.json', JSON.stringify({ source: bad }));
      expect(desk.savedMusic()).toBeNull();
    }
  });
});

describe('browser', () => {
  const frame = (w) => w.el.querySelector('iframe');
  it('opens maximized with a new-tab page (search box, quick links)', () => {
    const w = desk.openApp('browser');
    expect(w.maximized).toBe(true);
    expect(w.el.querySelector('.br-logo').textContent).toBe('Void Browser');
    expect(w.el.querySelectorAll('.tile').length).toBe(6);
    expect(w.api.omni.value).toBe('');
  });
  it('typing a site loads it in a sandboxed iframe with no referrer and no top navigation', () => {
    const w = desk.openApp('browser');
    w.api.go('example.com/page');
    const f = frame(w);
    expect(f.getAttribute('src')).toBe('https://example.com/page');
    expect(f.getAttribute('referrerpolicy')).toBe('no-referrer');
    const sb = f.getAttribute('sandbox');
    expect(sb).toContain('allow-scripts');
    expect(sb).not.toContain('allow-top-navigation'); // a page cannot hijack VoidOS
    expect(w.api.omni.value).toBe('https://example.com/page');
    expect(w.el.querySelector('.br-note').hidden).toBe(false);
    expect(w.title).toMatch(/example.com/);
  });
  it('Wikipedia search and embeds show no "blocked" warning; YouTube links become the embed player', () => {
    const w = desk.openApp('browser');
    w.api.go('hà nội');
    expect(frame(w).getAttribute('src')).toMatch(/^https:\/\/vi\.wikipedia\.org\/w\/index\.php\?search=/);
    expect(w.el.querySelector('.br-note').hidden).toBe(true);
    w.api.go('https://youtu.be/dQw4w9WgXcQ');
    expect(frame(w).getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(frame(w).getAttribute('allow')).toContain('fullscreen');
    expect(frame(w).getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin'); // YouTube answers error 153 to no-referrer embeds
    w.api.go('example.org');
    expect(frame(w).getAttribute('referrerpolicy')).toBe('no-referrer'); // other sites still get none
  });
  it('engines that cannot be framed open a real tab instead; dangerous input is refused', () => {
    const w = desk.openApp('browser');
    w.el.querySelector('.chip:nth-child(2)').click(); // Google
    expect(w.api.engine()).toBe('google');
    w.api.go('thời tiết');
    expect(openSpy).toHaveBeenCalledWith('https://www.google.com/search?q=th%E1%BB%9Di%20ti%E1%BA%BFt', '_blank', 'noopener,noreferrer');
    expect(frame(w)).toBeNull();
    expect(w.api.go('javascript:alert(1)')).toBe(false);
    expect(desk.toasts.textContent).toMatch(/không được hỗ trợ/);
    expect(w.api.go('https://google.com@evil.com')).toBe(false);
    expect(frame(w)).toBeNull();
  });
  it('popup blocked -> tells the user', () => {
    openSpy.mockReturnValue(null);
    const w = desk.openApp('browser');
    w.api.go('void://newtab');
    w.el.querySelector('.tile:nth-child(3)').click(); // Google: opens a real tab
    expect(desk.toasts.textContent).toMatch(/chặn cửa sổ mới/);
  });
  it('tabs: open, switch, close (frame removed), limit of 6, last tab closes the window', async () => {
    const w = desk.openApp('browser');
    w.api.go('a.example.com');
    w.api.newTab('b.example.com');
    expect(w.api.tabs.length).toBe(2);
    expect(w.el.querySelectorAll('iframe').length).toBe(2);
    expect(w.el.querySelectorAll('.br-pane:not([hidden])').length).toBe(1);
    click(w.el.querySelector('.br-tab-t'));
    expect(w.api.omni.value).toBe('https://a.example.com/');
    w.api.closeTab(w.api.tabs[0]);
    expect(w.el.querySelectorAll('iframe').length).toBe(1);
    for (let i = 0; i < 8; i++) w.api.newTab();
    expect(w.api.tabs.length).toBe(6);
    expect(desk.toasts.textContent).toMatch(/Tối đa 6 tab/);
    while (w.api.tabs.length) w.api.closeTab(w.api.tabs[0]);
    await tick();
    expect(desk.wm.list()).not.toContain(w);
  });
  it('back / forward follow the pages opened from the address bar', () => {
    const w = desk.openApp('browser');
    w.api.go('one.example.com'); w.api.go('two.example.com');
    click(btn(w.el, 'Quay lại'));
    expect(frame(w).getAttribute('src')).toBe('https://one.example.com/');
    click(btn(w.el, 'Tiến'));
    expect(frame(w).getAttribute('src')).toBe('https://two.example.com/');
    expect(btn(w.el, 'Tiến').disabled).toBe(true);
    click(btn(w.el, 'Quay lại')); w.api.go('three.example.com'); // new navigation drops the forward branch
    expect(btn(w.el, 'Tiến').disabled).toBe(true);
  });
  it('bookmarks and history are stored on the virtual disk and survive reopening', () => {
    let w = desk.openApp('browser');
    w.api.go('keep.example.com');
    click(btn(w.el, 'Đánh dấu trang'));
    expect(btn(w.el, 'Đánh dấu trang').textContent).toBe('★');
    expect(JSON.parse(sys.call('fs.read', '/home/user/.browser/bookmarks.json'))[0].key).toBe('https://keep.example.com/');
    expect(JSON.parse(sys.call('fs.read', '/home/user/.browser/history.json'))[0].key).toBe('https://keep.example.com/');
    desk.wm.close(w, { force: true });
    w = desk.openApp('browser');
    expect(w.api.bookmarks().length).toBe(1);
    w.api.go('void://bookmarks');
    expect(w.el.querySelector('.br-link').textContent).toContain('keep.example.com');
    click(btn(w.el, 'Xóa keep.example.com'));
    expect(w.api.bookmarks().length).toBe(0);
    w.api.go('void://history');
    expect(w.el.querySelector('.br-link')).toBeTruthy();
    click(btn(w.el, 'Xóa tất cả'));
    expect(w.api.history().length).toBe(0);
  });
  it('corrupt bookmark/history files are ignored', () => {
    sys.call('fs.mkdir', '/home/user/.browser', { recursive: true });
    sys.call('fs.write', '/home/user/.browser/bookmarks.json', JSON.stringify([{ key: 'javascript:alert(1)', title: 'x' }, { key: 5 }, null, { key: 'https://ok.com/', title: 'ok' }]));
    sys.call('fs.write', '/home/user/.browser/history.json', '{not json');
    const w = desk.openApp('browser');
    expect(w.api.bookmarks().map((b) => b.key)).toEqual(['https://ok.com/']);
    expect(w.api.history()).toEqual([]);
  });
  it('local pages from the virtual disk run in a sandbox WITHOUT access to the OS page', () => {
    sys.call('fs.write', '/home/user/site.html', '<!doctype html><title>Trang của tao</title><h1>Xin chào</h1><script>1</script>');
    const w = desk.openApp('browser', { url: 'vfs:///home/user/site.html' });
    const f = frame(w);
    expect(f.getAttribute('srcdoc')).toContain('Xin chào');
    expect(f.getAttribute('sandbox')).toContain('allow-scripts');
    expect(f.getAttribute('sandbox')).not.toContain('allow-same-origin'); // opaque origin: cannot read VoidOS storage
    expect(f.hasAttribute('src')).toBe(false);
    expect(w.title).toMatch(/Trang của tao/);
  });
  it('local text is escaped, images are inlined, big files and missing files are refused', () => {
    sys.call('fs.write', '/home/user/n.txt', '<script>alert(1)</script> & more');
    sys.call('fs.write', '/home/user/p.png', new Uint8Array([137, 80, 78, 71]));
    sys.call('fs.write', '/home/user/huge.html', new Uint8Array(2 * 1024 * 1024 + 1));
    const w = desk.openApp('browser');
    w.api.go('/home/user/n.txt');
    expect(frame(w).getAttribute('srcdoc')).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; more');
    w.api.go('/home/user/p.png');
    expect(frame(w).getAttribute('srcdoc')).toContain('data:image/png;base64,');
    expect(w.api.go('/home/user/huge.html')).toBe(false);
    expect(desk.toasts.textContent).toMatch(/quá lớn/);
    expect(w.api.go('/home/user/none.html')).toBe(false);
  });
  it('session restore reopens tabs, and ignores hostile saved tabs', () => {
    let w = desk.openApp('browser');
    w.api.go('first.example.com'); w.api.newTab('second.example.com');
    const state = w.getState();
    expect(state).toMatchObject({ tabs: ['https://first.example.com/', 'https://second.example.com/'], engine: 'wikipedia' });
    desk.wm.close(w, { force: true });
    w = desk.openApp('browser', state);
    expect(w.api.tabs.length).toBe(2);
    desk.wm.close(w, { force: true });
    w = desk.openApp('browser', { tabs: ['javascript:alert(1)', 'data:text/html,x', 5, null, 'https://ok.example.com'], engine: 'evil', active: 99 });
    expect(w.api.tabs.map((t) => t.hist[0].url)).toEqual(['https://ok.example.com/']);
    expect(w.api.engine()).toBe('wikipedia');
  });
  it('closing the window drops every frame (stops videos and scripts)', async () => {
    const w = desk.openApp('browser');
    w.api.go('x.example.com');
    const f = frame(w);
    await desk.wm.close(w);
    expect(f.isConnected).toBe(false);
  });
});

describe('photos', () => {
  it('imports photos (resized by the processor), shows thumbnails and a viewer', async () => {
    const w = desk.openApp('photos');
    expect(w.el.textContent).toMatch(/Chưa có ảnh/);
    await w.api.importFiles([new File([new Uint8Array(9)], 'a.png', { type: 'image/png' }), new File([new Uint8Array(9)], 'b.jpg', { type: 'image/jpeg' }), new File([new Uint8Array(9)], 'a.png', { type: 'image/png' })]);
    expect(sys.call('fs.list', '/home/user/Pictures').map((f) => f.name).sort()).toEqual(['a (1).png', 'a.png', 'b.jpg']);
    expect(w.el.querySelectorAll('.ph-thumb').length).toBe(3);
    click(w.el.querySelector('.ph-thumb'));
    expect(w.el.querySelector('.ph-viewer').hidden).toBe(false);
    click(btn(w.el, 'Ảnh sau'));
    expect(w.el.querySelector('.ph-cap').textContent).toMatch(/a \(1\)\.png|a\.png|b\.jpg/);
  });
  it('sets a photo as the wallpaper and deletes with confirmation', async () => {
    const w = desk.openApp('photos');
    await w.api.importFiles([new File([new Uint8Array(9)], 'x.png', { type: 'image/png' })]);
    w.api.view(0);
    click(btn(w.el, 'Đặt làm hình nền'));
    expect(sys.call('sys.config').wallpaper).toBe('file:/home/user/Pictures/x.png');
    click(btn(w.el, 'Xóa'));
    await tick(); click(desk.overlay.querySelector('.btn.danger'));
    await tick();
    expect(sys.call('fs.exists', '/home/user/Pictures/x.png')).toBe(false);
    expect(w.el.querySelector('.ph-viewer').hidden).toBe(true);
  });
  it('a failing import reports the reason and keeps going', async () => {
    desk.hooks.processImage = async (f) => { if (f.name === 'bad.png') throw new Error('bad.png: hỏng'); return { bytes: new Uint8Array([1]), ext: 'png' }; };
    const w = desk.openApp('photos');
    await w.api.importFiles([new File([new Uint8Array(1)], 'bad.png'), new File([new Uint8Array(1)], 'ok.png')]);
    expect(desk.toasts.textContent).toMatch(/hỏng/);
    expect(sys.call('fs.list', '/home/user/Pictures').length).toBe(1);
  });
});

describe('calculator', () => {
  const run = (w, keys) => { for (const k of keys) w.api.press(k); return w.api.state(); };
  it('computes with precedence and shows a live preview', () => {
    const w = desk.openApp('calculator');
    expect(run(w, ['7', '+', '8', '×', '2']).result).toBe('23');
    expect(run(w, ['=']).expr).toBe('23');
    expect(run(w, ['+', '1', '=']).result).toBe('24'); // operator continues from the answer
    expect(run(w, ['5']).expr).toBe('5'); // a digit after = starts over
  });
  it('errors are friendly; C and backspace work', () => {
    const w = desk.openApp('calculator');
    expect(run(w, ['1', '÷', '0', '=']).error).toBe('Chia cho 0');
    expect(w.el.querySelector('.ca-res').textContent).toBe('Chia cho 0');
    expect(run(w, ['C']).expr).toBe('');
    expect(run(w, ['1', '2', '⌫']).expr).toBe('1');
    expect(run(w, ['C', '(', '=']).error).toMatch(/chưa đầy đủ/);
    expect(run(w, ['C', '1', '(', '=']).error).toMatch(/không hợp lệ/); // no implicit multiplication
  });
  it('keyboard input', () => {
    const w = desk.openApp('calculator');
    const c = w.el.querySelector('.ca');
    for (const k of ['2', '*', '3', '+', '4']) key(c, k);
    key(c, 'Enter');
    expect(w.api.state().expr).toBe('10');
    key(c, 'Escape');
    expect(w.api.state().expr).toBe('');
  });
  it('limits expression length', () => {
    const w = desk.openApp('calculator');
    for (let i = 0; i < 150; i++) w.api.press('1');
    expect(w.api.state().expr.length).toBe(100);
  });
});

describe('settings: look & feel', () => {
  it('wallpaper gallery applies a picture instantly and marks it', () => {
    const w = desk.openApp('settings');
    expect(w.api.gallery.children.length).toBe(9); // 8 + "my photos"
    click(w.api.gallery.querySelector('[data-id=city]'));
    expect(sys.call('sys.config').wallpaper).toBe('gen:city');
    expect(w.api.gallery.querySelector('[data-id=city]').classList.contains('on')).toBe(true);
    click(w.api.gallery.querySelector('.mine'));
    expect(desk.wm.list().some((x) => x.appId === 'photos')).toBe(true);
  });
  it('offers the automatic resolution and the lock screen switch', async () => {
    const w = desk.openApp('settings');
    expect([...w.api.fields.res.options].map((o) => o.value)).toContain('auto');
    w.api.fields.res.value = 'auto'; w.api.fields.lock.checked = true;
    await w.api.apply();
    expect(sys.call('sys.config')).toMatchObject({ resolution: 'auto', lockscreen: true });
  });
});

describe('file manager integration', () => {
  it('opens web pages and photos in the browser, songs in the player', async () => {
    sys.call('fs.write', '/home/user/page.html', '<h1>x</h1>');
    sys.call('fs.write', '/home/user/song.mp3', new Uint8Array([1, 2]));
    sys.call('fs.write', '/home/user/pic.jpg', new Uint8Array([1, 2]));
    const w = desk.openApp('files');
    const row = (n) => [...w.el.querySelectorAll('.fm-row')].find((r) => r.querySelector('.fm-name').textContent === n);
    click(row('page.html')); click(row('page.html'));
    const br = desk.wm.list().find((x) => x.appId === 'browser');
    expect(br.api.omni.value).toBe('vfs:///home/user/page.html');
    click(row('pic.jpg')); click(row('pic.jpg'));
    click(row('song.mp3')); click(row('song.mp3'));
    await vi.waitFor(() => expect(desk.audio.info().title).toBe('song.mp3'));
  });
});

describe('big picture', () => {
  it('every built-in app opens, restores from the saved session and closes without errors', async () => {
    const ids = ['browser', 'video', 'files', 'music', 'photos', 'terminal', 'editor', 'calculator', 'monitor', 'settings'];
    for (const id of ids) expect(desk.openApp(id)).toBeTruthy();
    expect(desk.wm.list().length).toBe(10);
    await mount(); // destroys the old desktop first (saving the session), then restores it
    expect(desk.wm.list().map((w) => w.appId).sort()).toEqual([...ids].sort());
    desk.wm.closeAll();
    expect(desk.wm.list().length).toBe(0);
  });
  it('the music keeps one tray button state across window changes', async () => {
    desk.openApp('music');
    click(desk.taskbar.music);
    await vi.waitFor(() => expect(desk.taskbar.music.classList.contains('playing')).toBe(true));
    desk.wm.closeAll();
    expect(desk.taskbar.music.classList.contains('playing')).toBe(true);
  });
});
