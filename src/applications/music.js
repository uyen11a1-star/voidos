import { h, clear } from '../desktop/dom.js';
import { STATIONS, isAudioFile } from '../desktop/audio.js';
import { readAsBytes } from '../desktop/image-utils.js';
import { baseName, fmtSize } from '../desktop/format.js';

const DIR = '/home/user/Music';

export function openMusic(desktop) {
  const { audio, sys } = desktop;
  let tab = 'radio', volTimer = null;
  const fail = (e) => desktop.notify(e.message ?? String(e), { level: 'error' });

  const title = h('div', { class: 'mu-title' }), status = h('div', { class: 'mu-status' });
  const playBtn = h('button', { class: 'mu-play', type: 'button', 'aria-label': 'Phát / Tạm dừng', onclick: () => audio.toggle() });
  const ctl = (text, label, fn) => h('button', { class: 'mu-ctl', type: 'button', text, title: label, 'aria-label': label, onclick: fn });
  const vol = h('input', { type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Âm lượng nhạc', value: String(audio.info().volume) });
  vol.addEventListener('input', () => {
    audio.setVolume(Number(vol.value));
    clearTimeout(volTimer);
    volTimer = setTimeout(() => { try { sys('sys.setConfig', { musicVolume: Number(vol.value) }); } catch { /* not persisted */ } }, 600);
  });
  const body = h('div', { class: 'mu-body' });
  const tabBtn = (id, text) => h('button', { class: 'mu-tab', type: 'button', text, 'data-tab': id, onclick: () => { tab = id; render(); } });
  const tabs = h('div', { class: 'mu-tabs', role: 'tablist' }, tabBtn('radio', 'Nhạc nền'), tabBtn('library', 'Thư viện'), tabBtn('url', 'Phát URL'));

  function libraryFiles() {
    try { return sys('fs.list', DIR).filter((f) => f.type === 'file' && isAudioFile(f.name)); } catch { return []; }
  }

  async function importFiles(files) {
    if (!sys('fs.exists', DIR)) sys('fs.mkdir', DIR, { recursive: true });
    for (const f of files) {
      try {
        if (!isAudioFile(f.name)) throw new Error(`${f.name}: không phải file nhạc được hỗ trợ`);
        const dot = f.name.lastIndexOf('.'), stem = f.name.slice(0, dot).replace(/[\\/]/g, '_'), ext = f.name.slice(dot);
        let name = `${stem}${ext}`;
        for (let i = 1; sys('fs.exists', `${DIR}/${name}`); i++) name = `${stem} (${i})${ext}`;
        sys('fs.write', `${DIR}/${name}`, await readAsBytes(f));
        desktop.notify(`Đã thêm ${name} (${fmtSize(f.size)})`, { level: 'ok' });
      } catch (e) { fail(e); }
    }
    render();
  }

  function playFile(path) {
    audio.setQueue(libraryFiles().map((f) => f.path));
    audio.play({ type: 'file', path });
    remember({ type: 'file', path });
  }
  function remember(source) { try { sys('fs.write', '/home/user/.music.json', JSON.stringify({ source })); } catch { /* optional */ } }

  function renderNow() {
    const i = audio.info();
    title.textContent = i.title || 'Chưa phát gì';
    status.textContent = i.error ? `Lỗi: ${i.error}` : i.playing ? 'Đang phát' : i.source ? 'Tạm dừng' : 'Chọn một đài nhạc để bắt đầu';
    status.classList.toggle('err', !!i.error);
    playBtn.textContent = i.playing ? '⏸' : '▶';
    if (document.activeElement !== vol) vol.value = String(i.volume);
    for (const el of body.querySelectorAll('[data-src]')) el.classList.toggle('on', i.playing && el.dataset.src === JSON.stringify(i.source));
  }

  function render() {
    for (const b of tabs.children) b.classList.toggle('on', b.dataset.tab === tab);
    clear(body);
    if (tab === 'radio') {
      body.append(...STATIONS.map((s) => h('button', { class: 'mu-row', type: 'button', 'data-src': JSON.stringify({ type: 'gen', id: s.id }), onclick: () => { const src = { type: 'gen', id: s.id }; audio.play(src); remember(src); } },
        h('span', { class: 'mu-ic', text: '♪' }), h('span', { class: 'mu-name' }, h('b', { text: s.name }), h('small', { text: s.desc })))));
      body.append(h('label', { class: 'set-check mu-auto' }, (() => { const c = h('input', { type: 'checkbox' }); c.checked = !!desktop.config.musicAutoplay; c.addEventListener('change', () => { try { sys('sys.setConfig', { musicAutoplay: c.checked }); } catch (e) { fail(e); } }); return c; })(), h('span', { text: 'Tự phát nhạc khi mở máy (sau lần chạm đầu tiên)' })));
    } else if (tab === 'library') {
      const input = h('input', { type: 'file', accept: 'audio/*,.mp3,.m4a,.ogg,.wav,.flac,.opus,.aac', multiple: true, hidden: true });
      input.addEventListener('change', () => { importFiles([...input.files]); input.value = ''; });
      const files = libraryFiles();
      body.append(h('div', { class: 'mu-lib-bar' }, h('button', { class: 'btn primary', type: 'button', text: '＋ Nhập nhạc từ máy', onclick: () => input.click() }), input),
        h('p', { class: 'mu-hint', text: `Nhạc lưu trong ${DIR} trên ổ đĩa ảo, nên tốn dung lượng ổ (Cài đặt → Dung lượng ổ đĩa).` }));
      if (!files.length) body.append(h('div', { class: 'br-empty', text: 'Chưa có bài nào' }));
      for (const f of files) {
        body.append(h('div', { class: 'mu-row', 'data-src': JSON.stringify({ type: 'file', path: f.path }) },
          h('button', { class: 'mu-main', type: 'button', onclick: () => playFile(f.path) }, h('span', { class: 'mu-ic', text: '♫' }), h('span', { class: 'mu-name' }, h('b', { text: f.name }), h('small', { text: fmtSize(f.size) }))),
          h('button', { class: 'br-x', type: 'button', title: 'Xóa', 'aria-label': `Xóa ${f.name}`, text: '✕', onclick: () => { try { sys('fs.remove', f.path); } catch (e) { fail(e); } render(); } })));
      }
    } else {
      const input = h('input', { class: 'set-input', type: 'text', placeholder: 'https://… (link trực tiếp tới file nhạc hoặc radio)', autocapitalize: 'off', 'aria-label': 'Địa chỉ nhạc', onkeydown: (e) => { if (e.key === 'Enter') start(); } });
      const start = () => { const src = { type: 'url', url: input.value.trim() }; audio.play(src); remember(src); };
      body.append(h('div', { class: 'mu-url' }, input, h('button', { class: 'btn primary', type: 'button', text: 'Phát', onclick: start })),
        h('p', { class: 'mu-hint', text: 'Chỉ phát được link âm thanh trực tiếp (mp3, aac, ogg…). Trang web như YouTube cần dán vào Trình duyệt.' }));
    }
    renderNow();
  }

  const content = h('div', { class: 'mu' },
    h('div', { class: 'mu-now' }, title, status, h('div', { class: 'mu-bar' }, ctl('⏮', 'Bài trước', () => audio.prev()), playBtn, ctl('⏭', 'Bài sau', () => audio.next()), ctl('⏹', 'Dừng', () => audio.stop())), vol),
    tabs, body);
  const win = desktop.wm.open({ appId: 'music', title: 'Âm nhạc', icon: 'music', content, width: 250, height: 340 });
  const off = audio.on(renderNow);
  win.closers.push(() => { off(); clearTimeout(volTimer); }); // closing the window never stops the music
  win.api = { render, importFiles, playFile, setTab: (t) => { tab = t; render(); } };
  render();
  return win;
}
