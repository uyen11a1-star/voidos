import { h, clear } from '../desktop/dom.js';
import { keyOk, trendingUrl, searchUrl, detailsUrl, parseVideos, apiError, embedUrl, watchUrl, thumbUrl, timeAgo, videoIdFrom, VIDEO_ID } from './video-api.js';

const DIR = '/home/user/.video', FAV = `${DIR}/favorites.json`, HIST = `${DIR}/history.json`;
const SANDBOX = 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation';
const TABS = [['home', 'Trang chủ'], ['fav', 'Yêu thích'], ['hist', 'Lịch sử']];

// YouTube inside VoidOS: home feed and search through the YouTube Data API (the user's own free key),
// playback through YouTube's official embedded player. Favorites and history live on the virtual disk.
export function openVideo(desktop, state = {}) {
  const sys = desktop.sys;
  const doFetch = desktop.hooks.fetch ?? ((...a) => fetch(...a));
  const validEntry = (e) => e && typeof e.id === 'string' && VIDEO_ID.test(e.id) && typeof e.title === 'string';
  const readList = (p) => { try { const v = JSON.parse(sys('fs.read', p)); return Array.isArray(v) ? v.filter(validEntry).slice(0, 200) : []; } catch { return []; } };
  const writeList = (p, v) => { try { if (!sys('fs.exists', DIR)) sys('fs.mkdir', DIR, { recursive: true }); sys('fs.write', p, JSON.stringify(v)); } catch { /* disk full: still plays */ } };
  let favorites = readList(FAV), history = readList(HIST);
  let tab = TABS.some(([id]) => id === state.tab) ? state.tab : 'home';
  let feed = [], feedKind = '', status = '', busy = false, playing = null, win = null, token = 0;
  const key = () => sys('sys.config').youtubeKey ?? '';

  const body = h('div', { class: 'vd-body' });
  const search = h('input', { class: 'vd-search', type: 'text', placeholder: 'Tìm video hoặc dán link YouTube', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Tìm video', onkeydown: (e) => { if (e.key === 'Enter') submit(); } });
  const tabsEl = h('div', { class: 'vd-tabs', role: 'tablist' });

  async function request(url) {
    let res;
    try { res = await doFetch(url); } catch { throw new Error('Không có mạng hoặc bị chặn kết nối tới YouTube'); }
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(apiError(res.status, json));
    return json;
  }

  async function load(kind, url, label) {
    const mine = ++token;
    busy = true; status = ''; feedKind = label; render();
    try { const v = parseVideos(await request(url)); if (mine !== token) return; feed = v; if (!v.length) status = 'Không có kết quả'; } catch (e) { if (mine !== token) return; feed = []; status = e.message; }
    busy = false; render();
  }

  const home = () => (keyOk(key()) ? load('home', trendingUrl(key()), 'Đang thịnh hành tại Việt Nam') : (feed = [], render()));

  function submit() {
    const text = search.value.trim();
    if (!text) return;
    const id = videoIdFrom(text);
    if (id) { search.value = ''; return play({ id, title: 'Video YouTube', channel: '' }); }
    if (!keyOk(key())) { tab = 'home'; status = 'Cần API key để tìm kiếm. Dán link video thì vẫn xem được.'; return render(); }
    tab = 'home'; playing = null;
    return load('search', searchUrl(key(), text), `Kết quả cho "${text}"`);
  }

  async function play(v, { autoplay = true } = {}) {
    if (!VIDEO_ID.test(v.id)) return;
    playing = v;
    if (autoplay) {
      desktop.audio.pause(); // the background music steps aside
      history = [v, ...history.filter((x) => x.id !== v.id)].slice(0, 50);
      writeList(HIST, history);
    }
    render(autoplay);
    if (v.title === 'Video YouTube' && keyOk(key())) { // pasted link: fetch the real title (1 quota unit)
      try { const [d] = parseVideos(await request(detailsUrl(key(), v.id))); if (d && playing?.id === v.id) { playing = { ...v, title: d.title, channel: d.channel, published: d.published }; render(false); } } catch { /* title is optional */ }
    }
  }

  const isFav = (id) => favorites.some((f) => f.id === id);
  function toggleFav(v) {
    favorites = isFav(v.id) ? favorites.filter((f) => f.id !== v.id) : [{ id: v.id, title: v.title, channel: v.channel }, ...favorites].slice(0, 200);
    writeList(FAV, favorites);
    render(false);
  }

  const card = (v) => h('button', { class: 'vd-card', type: 'button', onclick: () => play(v) },
    h('span', { class: 'vd-thumb' }, h('img', { src: thumbUrl(v.id), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })),
    h('span', { class: 'vd-info' }, h('b', { text: v.title }), h('small', { text: [v.channel, timeAgo(v.published)].filter(Boolean).join(' · ') })));

  function setup() {
    const input = h('input', { class: 'set-input', type: 'text', placeholder: 'Dán API key (bắt đầu bằng AIza…)', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'YouTube API key' });
    const saveKey = () => {
      try { sys('sys.setConfig', { youtubeKey: input.value.trim() }); desktop.notify('Đã lưu API key', { level: 'ok' }); home(); } catch (e) { desktop.notify('API key không đúng định dạng', { level: 'error' }); }
    };
    return h('div', { class: 'vd-setup' },
      h('h3', { text: 'Kết nối YouTube' }),
      h('p', { text: 'Để hiện video thịnh hành và tìm kiếm, VoidOS dùng YouTube Data API với key miễn phí của riêng mày (Google cho khoảng 100 lượt tìm kiếm mỗi ngày):' }),
      h('ol', {}, ['Vào console.cloud.google.com, tạo một project.', 'Mục APIs & Services → Library: bật "YouTube Data API v3".', 'Credentials → Create credentials → API key.', 'Nên giới hạn key theo HTTP referrer (địa chỉ web VoidOS của mày).', 'Dán key vào đây (hoặc Cài đặt → Hệ thống).'].map((t) => h('li', { text: t }))),
      input, h('button', { class: 'btn primary', type: 'button', text: 'Lưu key', onclick: saveKey }),
      h('p', { class: 'vd-hint', text: 'Chưa có key vẫn xem được: dán link YouTube vào ô tìm kiếm ở trên. Key lưu trên ổ đĩa ảo và nằm trong bản sao lưu.' }));
  }

  function player(v) {
    const open = () => { const w = window.open(watchUrl(v.id), '_blank', 'noopener,noreferrer'); if (!w) desktop.notify('Trình duyệt chặn cửa sổ mới', { level: 'warn' }); };
    return h('div', { class: 'vd-player' },
      h('div', { class: 'vd-frame' }, h('iframe', { class: 'vd-iframe', src: embedUrl(v.id, { autoplay: playing.autoplay !== false }), title: v.title, sandbox: SANDBOX, referrerpolicy: 'strict-origin-when-cross-origin', allow: 'autoplay; fullscreen; picture-in-picture; encrypted-media', allowfullscreen: true })),
      h('div', { class: 'vd-meta' }, h('b', { text: v.title }), h('small', { text: [v.channel, timeAgo(v.published)].filter(Boolean).join(' · ') })),
      h('div', { class: 'vd-actions' },
        h('button', { class: 'btn small', type: 'button', text: '← Quay lại', onclick: () => { playing = null; render(); } }),
        h('button', { class: `btn small${isFav(v.id) ? ' primary' : ''}`, type: 'button', text: isFav(v.id) ? '♥ Đã thích' : '♡ Yêu thích', 'aria-pressed': String(isFav(v.id)), onclick: () => toggleFav(v) }),
        h('button', { class: 'btn small', type: 'button', text: 'Mở trên YouTube ↗', onclick: open })),
      h('p', { class: 'vd-hint', text: 'Một số video không cho phát ngoài YouTube, khi đó hãy bấm "Mở trên YouTube".' }));
  }

  function render(fresh = true) {
    clear(tabsEl);
    for (const [id, name] of TABS) tabsEl.append(h('button', { class: `vd-tab${tab === id && !playing ? ' on' : ''}`, type: 'button', role: 'tab', text: name, onclick: () => { tab = id; playing = null; render(); if (id === 'home' && !feed.length && keyOk(key())) home(); } }));
    if (playing) { if (fresh || !body.querySelector('iframe')) { clear(body); body.append(player(playing)); } else { const p = body.querySelector('.vd-player'); p.replaceWith(player(playing)); } return; }
    clear(body);
    const list = tab === 'fav' ? favorites : tab === 'hist' ? history : feed;
    if (tab === 'home' && !keyOk(key()) && !busy) body.append(setup());
    if (tab === 'home' && feedKind && keyOk(key())) body.append(h('div', { class: 'vd-head', text: feedKind }));
    if (busy) body.append(h('div', { class: 'vd-note', text: 'Đang tải…' }));
    if (status) body.append(h('div', { class: 'vd-note err', text: status }));
    if (tab !== 'home' && !list.length) body.append(h('div', { class: 'br-empty', text: tab === 'fav' ? 'Chưa có video yêu thích' : 'Chưa xem video nào' }));
    if (tab === 'hist' && list.length) body.append(h('button', { class: 'btn small', type: 'button', text: 'Xóa lịch sử', onclick: () => { history = []; writeList(HIST, history); render(); } }));
    if (!busy) body.append(h('div', { class: 'vd-grid' }, list.map(card)));
  }

  const content = h('div', { class: 'vd' }, h('div', { class: 'vd-bar' }, search, h('button', { class: 'btn primary small', type: 'button', text: 'Tìm', onclick: submit })), tabsEl, body);
  win = desktop.wm.open({ appId: 'video', title: 'Video', icon: 'video', content, width: 320, height: 440, maximized: true });
  win.closers.push(() => { token++; body.replaceChildren(); }); // closing drops the player, so the video stops at once
  win.getState = () => ({ tab, id: playing?.id ?? null });
  win.api = { submit, play, toggleFav, home, favorites: () => favorites, history: () => history, feed: () => feed, search, current: () => playing };
  render();
  if (typeof state.id === 'string' && VIDEO_ID.test(state.id)) { playing = { id: state.id, title: 'Video YouTube', channel: '', autoplay: false }; render(); } else if (tab === 'home') home();
  return win;
}
