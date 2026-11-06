import { h, clear } from '../desktop/dom.js';
import { resolveInput, ENGINES, QUICK_LINKS, hostOf, isEmbedFriendly } from './url-utils.js';
import { IMAGE_EXT, imageExt, bytesToDataUrl } from '../desktop/image-utils.js';
import { baseName } from '../desktop/format.js';

const DIR = '/home/user/.browser', BM = `${DIR}/bookmarks.json`, HIST = `${DIR}/history.json`;
const MAX_TABS = 6, MAX_HIST = 200, MAX_LOCAL = 2 * 1024 * 1024;
const WEB_SANDBOX = 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation';
const LOCAL_SANDBOX = 'allow-scripts allow-forms allow-modals'; // no allow-same-origin: local pages cannot touch the OS page
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const PAGE_TITLES = { newtab: 'Tab mới', bookmarks: 'Dấu trang', history: 'Lịch sử' };

const targetKey = (t) => (t.type === 'void' ? `void://${t.page}` : t.type === 'file' ? `vfs://${t.path}` : t.url);

export function openBrowser(desktop, state = {}) {
  const sys = desktop.sys;
  const validEntry = (e) => e && typeof e.title === 'string' && typeof e.key === 'string' && ['web', 'file'].includes(resolveInput(e.key).type);
  const readList = (p) => { try { const v = JSON.parse(sys('fs.read', p)); return Array.isArray(v) ? v.filter(validEntry).slice(0, MAX_HIST) : []; } catch { return []; } };
  const writeList = (p, v) => { try { if (!sys('fs.exists', DIR)) sys('fs.mkdir', DIR, { recursive: true }); sys('fs.write', p, JSON.stringify(v)); } catch { /* disk full: the browser keeps working */ } };
  let bookmarks = readList(BM), history = readList(HIST);
  let engine = ENGINES.some((e) => e.id === state.engine) ? state.engine : 'wikipedia';
  const tabs = [];
  let active = null, win = null;

  const view = h('div', { class: 'br-view' });
  const tabsEl = h('div', { class: 'br-tabs' });
  const note = h('div', { class: 'br-note', hidden: true });
  const omni = h('input', { class: 'br-omni', type: 'text', inputmode: 'url', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', placeholder: 'Tìm kiếm hoặc nhập địa chỉ', 'aria-label': 'Thanh địa chỉ', onkeydown: (e) => { if (e.key === 'Enter') go(omni.value); }, onfocus: (e) => e.target.select?.() });
  const btn = (text, title, fn, cls = '') => h('button', { class: `br-btn ${cls}`, type: 'button', title, 'aria-label': title, text, onclick: fn });
  const backBtn = btn('◀', 'Quay lại', () => step(-1)), fwdBtn = btn('▶', 'Tiến', () => step(1)), starBtn = btn('☆', 'Đánh dấu trang', () => toggleBookmark());

  // ---------- rendering of one target into a tab pane ----------
  function frame(src, extra) {
    return h('iframe', { class: 'br-frame', referrerpolicy: 'no-referrer', allow: 'autoplay; fullscreen; picture-in-picture; encrypted-media', title: 'Nội dung trang', ...extra });
  }

  function localDoc(path) {
    const bytes = sys('fs.readBytes', path);
    if (bytes.length > MAX_LOCAL) throw new Error('Tệp quá lớn để mở (tối đa 2 MB)');
    const ext = imageExt(path);
    if (IMAGE_EXT[ext] && ext !== 'svg') return { doc: `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111;display:flex;justify-content:center"><img style="max-width:100%;height:auto" src="${bytesToDataUrl(bytes, IMAGE_EXT[ext])}">`, title: baseName(path) };
    const text = new TextDecoder().decode(bytes);
    if (ext === 'html' || ext === 'htm') return { doc: text, title: /<title[^>]*>([^<]{0,80})/i.exec(text)?.[1]?.trim() || baseName(path) };
    return { doc: `<!doctype html><meta charset="utf-8"><body style="margin:8px;background:#0b0b0d;color:#e6e6ea"><pre style="white-space:pre-wrap;word-break:break-word;font:13px/1.45 ui-monospace,monospace">${esc(text)}</pre>`, title: baseName(path) };
  }

  function voidPage(page) {
    const go2 = (key) => go(key);
    const list = (items, onRemove) => h('div', { class: 'br-list' }, items.length ? items.map((e) => h('div', { class: 'br-item' },
      h('button', { class: 'br-link', type: 'button', onclick: () => go2(e.key) }, h('b', { text: e.title }), h('span', { text: e.key })),
      onRemove ? h('button', { class: 'br-x', type: 'button', title: 'Xóa', 'aria-label': `Xóa ${e.title}`, text: '✕', onclick: () => onRemove(e) }) : null)) : [h('div', { class: 'br-empty', text: 'Chưa có gì ở đây' })]);
    if (page === 'bookmarks') return h('div', { class: 'br-page' }, h('h2', { text: 'Dấu trang' }), list(bookmarks, (e) => { bookmarks = bookmarks.filter((b) => b !== e); writeList(BM, bookmarks); refreshPane(); }));
    if (page === 'history') {
      return h('div', { class: 'br-page' }, h('h2', { text: 'Lịch sử' }),
        h('button', { class: 'btn small', type: 'button', text: 'Xóa tất cả', onclick: () => { history = []; writeList(HIST, history); refreshPane(); } }), list(history));
    }
    // new tab page
    const input = h('input', { class: 'br-search', type: 'text', placeholder: 'Tìm trên Wikipedia hoặc nhập địa chỉ', autocapitalize: 'off', 'aria-label': 'Tìm kiếm', onkeydown: (e) => { if (e.key === 'Enter') go2(input.value); } });
    return h('div', { class: 'br-page br-new' },
      h('div', { class: 'br-logo', text: 'Void Browser' }),
      h('div', { class: 'br-searchbox' }, input, h('button', { class: 'btn primary', type: 'button', text: 'Đi', onclick: () => go2(input.value) })),
      h('div', { class: 'br-chips' }, ENGINES.map((e) => h('button', { class: `chip${e.id === engine ? ' on' : ''}`, type: 'button', text: e.framable ? e.name : `${e.name} ↗`, title: e.framable ? 'Hiện trong trình duyệt' : 'Mở ở tab ngoài của điện thoại', onclick: () => { engine = e.id; refreshPane(); } }))),
      h('div', { class: 'br-tiles' }, QUICK_LINKS.map((q) => h('button', { class: 'tile', type: 'button', onclick: () => (q.app ? desktop.openApp(q.app) : q.embed ? go2(q.url) : openExternal(q.url)) }, h('span', { class: 'tile-ic', text: q.title[0] }), h('span', { text: q.embed || q.app ? q.title : `${q.title} ↗` })))),
      h('p', { class: 'br-hint', text: 'YouTube đã có app Video riêng trong VoidOS. Trang có ↗ sẽ mở ở tab ngoài vì chúng không cho nhúng vào trình duyệt này.' }),
      bookmarks.length ? h('h3', { text: 'Dấu trang' }) : null, bookmarks.length ? list(bookmarks.slice(0, 6)) : null);
  }

  function renderTarget(tab, t) {
    clear(tab.pane);
    if (t.type === 'void') tab.pane.append(voidPage(t.page));
    else if (t.type === 'file') { const { doc } = localDoc(t.path); tab.pane.append(frame(null, { sandbox: LOCAL_SANDBOX, srcdoc: doc })); } else tab.pane.append(frame(null, { sandbox: WEB_SANDBOX, src: t.url, referrerpolicy: t.embed ? 'strict-origin-when-cross-origin' : 'no-referrer' })); // YouTube refuses embeds that send no referrer (error 153)
  }

  function titleOf(t) {
    if (t.type === 'void') return PAGE_TITLES[t.page];
    if (t.type === 'file') { try { return localDoc(t.path).title; } catch { return baseName(t.path); } }
    return hostOf(t.url);
  }

  function openExternal(url) {
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    desktop.notify(w ? 'Đã mở ở tab ngoài' : 'Trình duyệt chặn cửa sổ mới, hãy cho phép popup', { level: w ? 'info' : 'warn' });
  }

  // ---------- navigation ----------
  function show(tab, t, push) {
    try { renderTarget(tab, t); } catch (e) { desktop.notify(e.message, { level: 'error' }); return false; }
    const entry = { ...t, title: titleOf(t) };
    if (push) { tab.hist.splice(tab.idx + 1); tab.hist.push(entry); tab.idx = tab.hist.length - 1; }
    tab.title = entry.title;
    if (t.type !== 'void') {
      const key = targetKey(t);
      history = [{ key, title: entry.title }, ...history.filter((e) => e.key !== key)].slice(0, MAX_HIST);
      writeList(HIST, history);
    }
    chrome();
    return true;
  }

  function go(input) {
    if (!active) return false;
    const t = resolveInput(input, engine);
    if (t.type === 'invalid') { desktop.notify(t.message, { level: 'error' }); return false; }
    if (t.type === 'external') { openExternal(t.url); return true; }
    return show(active, t, true);
  }

  function step(d) {
    const t = active, i = t.idx + d;
    if (i < 0 || i >= t.hist.length) return;
    t.idx = i;
    renderTarget(t, t.hist[i]);
    t.title = t.hist[i].title;
    chrome();
  }

  const current = () => (active && active.idx >= 0 ? active.hist[active.idx] : null);
  const refreshPane = () => { const c = current(); if (c) { renderTarget(active, c); chrome(); } };

  function toggleBookmark() {
    const c = current();
    if (!c || c.type === 'void') return desktop.notify('Trang này không thể đánh dấu', { level: 'info' });
    const key = targetKey(c);
    if (bookmarks.some((b) => b.key === key)) bookmarks = bookmarks.filter((b) => b.key !== key);
    else bookmarks = [{ key, title: c.title }, ...bookmarks].slice(0, 100);
    writeList(BM, bookmarks);
    chrome();
  }

  function chrome() {
    const c = current();
    omni.value = !c || (c.type === 'void' && c.page === 'newtab') ? '' : targetKey(c);
    backBtn.disabled = !active || active.idx <= 0;
    fwdBtn.disabled = !active || active.idx >= active.hist.length - 1;
    const marked = !!c && c.type !== 'void' && bookmarks.some((b) => b.key === targetKey(c));
    starBtn.textContent = marked ? '★' : '☆';
    starBtn.classList.toggle('on', marked);
    const showNote = !!c && c.type === 'web' && !isEmbedFriendly(c.url);
    note.hidden = !showNote;
    clear(note);
    if (showNote) note.append('Trang trống hoặc báo "từ chối kết nối"? Nhiều trang không cho nhúng. ', h('button', { class: 'btn small', type: 'button', text: 'Mở ngoài ↗', onclick: () => openExternal(c.url) }));
    clear(tabsEl);
    for (const tab of tabs) {
      tabsEl.append(h('div', { class: `br-tab${tab === active ? ' on' : ''}`, role: 'tab', 'aria-selected': tab === active },
        h('button', { class: 'br-tab-t', type: 'button', text: tab.title, title: tab.title, onclick: () => activate(tab) }),
        h('button', { class: 'br-tab-x', type: 'button', title: 'Đóng tab', 'aria-label': `Đóng tab ${tab.title}`, text: '✕', onclick: () => closeTab(tab) })));
    }
    tabsEl.append(btn('+', 'Tab mới', () => newTab(), 'br-plus'));
    for (const tab of tabs) tab.pane.hidden = tab !== active;
    if (win) desktop.wm.setTitle(win, `Trình duyệt${active ? ` - ${active.title}` : ''}`);
  }

  function activate(tab) { active = tab; chrome(); }

  function newTab(input = '') {
    if (tabs.length >= MAX_TABS) { desktop.notify(`Tối đa ${MAX_TABS} tab`, { level: 'warn' }); return null; }
    const tab = { id: tabs.length + Date.now(), hist: [], idx: -1, title: 'Tab mới', pane: h('div', { class: 'br-pane' }) };
    view.append(tab.pane);
    tabs.push(tab);
    active = tab;
    const t = resolveInput(input, engine);
    if (t.type === 'invalid' || t.type === 'external') { desktop.notify(t.message ?? 'Mở ở tab ngoài', { level: 'error' }); show(tab, { type: 'void', page: 'newtab' }, true); } else if (!show(tab, t, true)) show(tab, { type: 'void', page: 'newtab' }, true);
    return tab;
  }

  function closeTab(tab) {
    const i = tabs.indexOf(tab);
    if (i < 0) return;
    tab.pane.remove(); // dropping the iframe stops the page (and any video) immediately
    tabs.splice(i, 1);
    if (!tabs.length) { desktop.wm.close(win); return; }
    if (active === tab) active = tabs[Math.min(i, tabs.length - 1)];
    chrome();
  }

  const menu = (e) => {
    const r = e.currentTarget.getBoundingClientRect?.();
    desktop.menu(r ? { clientX: r.left, clientY: r.bottom } : { x: 10, y: 60 }, [
      { label: 'Tab mới', action: () => newTab() },
      { label: 'Dấu trang', action: () => go('void://bookmarks') }, { label: 'Lịch sử', action: () => go('void://history') },
      'sep', ...ENGINES.map((en) => ({ label: `${en.id === engine ? '✓ ' : ''}Tìm bằng ${en.name}${en.framable ? '' : ' (tab ngoài)'}`, action: () => { engine = en.id; refreshPane(); } })),
      'sep', { label: 'Mở trang này ở tab ngoài', action: () => { const c = current(); if (c?.type === 'web') openExternal(c.url); else desktop.notify('Chỉ mở ngoài được trang web', { level: 'info' }); } },
    ]);
  };

  const content = h('div', { class: 'br' }, tabsEl,
    h('div', { class: 'br-bar' }, backBtn, fwdBtn, btn('⟳', 'Tải lại', () => refreshPane()), btn('⌂', 'Trang chủ', () => go('void://newtab')), omni, starBtn, btn('⋮', 'Menu', menu)),
    note, view);
  win = desktop.wm.open({ appId: 'browser', title: 'Trình duyệt', icon: 'browser', content, width: 300, height: 420, maximized: true });
  win.closers.push(() => { for (const t of tabs) t.pane.replaceChildren(); });
  win.getState = () => ({ tabs: tabs.map((t) => { const c = t.hist[t.idx]; return c ? targetKey(c) : ''; }).filter(Boolean), active: Math.max(0, tabs.indexOf(active)), engine });
  win.api = { go, newTab, closeTab, step, toggleBookmark, tabs, current, omni, bookmarks: () => bookmarks, history: () => history, engine: () => engine };

  const initial = (Array.isArray(state.tabs) ? state.tabs : []).filter((x) => typeof x === 'string').slice(0, MAX_TABS);
  if (typeof state.url === 'string') initial.unshift(state.url);
  if (!initial.length) newTab();
  for (const u of initial) { const t = resolveInput(u, engine); if (t.type === 'web' || t.type === 'file' || t.type === 'void') newTab(u); }
  if (!tabs.length) newTab();
  if (Number.isInteger(state.active) && tabs[state.active]) activate(tabs[state.active]);
  return win;
}
