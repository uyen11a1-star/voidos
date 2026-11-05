import { h, clear } from '../desktop/dom.js';
import { isImageFile, imageExt, IMAGE_EXT } from '../desktop/image-utils.js';
import { fmtSize } from '../desktop/format.js';

const DIR = '/home/user/Pictures';

export function openPhotos(desktop) {
  const sys = desktop.sys;
  let urls = [], files = [], viewing = -1;
  const fail = (e) => desktop.notify(e.message ?? String(e), { level: 'error' });
  const grid = h('div', { class: 'ph-grid' });
  const viewer = h('div', { class: 'ph-viewer', hidden: true });
  const status = h('div', { class: 'ph-status' });

  const blobUrl = (f) => { const u = URL.createObjectURL(new Blob([sys('fs.readBytes', f.path)], { type: IMAGE_EXT[imageExt(f.name)] })); urls.push(u); return u; };
  const revokeAll = () => { for (const u of urls) URL.revokeObjectURL(u); urls = []; };

  function load() {
    try { files = sys('fs.list', DIR).filter((f) => f.type === 'file' && isImageFile(f.name)); } catch { files = []; }
  }

  function render() {
    revokeAll(); load(); clear(grid);
    if (!files.length) grid.append(h('div', { class: 'br-empty', text: 'Chưa có ảnh. Bấm "Nhập ảnh" để thêm từ điện thoại.' }));
    files.forEach((f, i) => grid.append(h('button', { class: 'ph-thumb', type: 'button', title: f.name, 'aria-label': f.name, onclick: () => view(i) }, h('img', { src: blobUrl(f), alt: f.name, loading: 'lazy' }))));
    status.textContent = `${files.length} ảnh`;
  }

  function view(i) {
    if (!files.length) { viewing = -1; viewer.hidden = true; return; }
    viewing = (i + files.length) % files.length;
    const f = files[viewing];
    clear(viewer);
    viewer.append(
      h('div', { class: 'ph-big' }, h('img', { src: blobUrl(f), alt: f.name })),
      h('div', { class: 'ph-cap', text: `${f.name} - ${fmtSize(f.size)}` }),
      h('div', { class: 'ph-actions' },
        h('button', { class: 'btn small', type: 'button', text: '‹', 'aria-label': 'Ảnh trước', onclick: () => view(viewing - 1) }),
        h('button', { class: 'btn small primary', type: 'button', text: 'Đặt làm hình nền', onclick: () => setWallpaper(f.path) }),
        h('button', { class: 'btn small danger', type: 'button', text: 'Xóa', onclick: () => remove(f) }),
        h('button', { class: 'btn small', type: 'button', text: 'Đóng', onclick: closeViewer }),
        h('button', { class: 'btn small', type: 'button', text: '›', 'aria-label': 'Ảnh sau', onclick: () => view(viewing + 1) })));
    viewer.hidden = false;
  }
  function closeViewer() { viewer.hidden = true; viewing = -1; render(); }

  function setWallpaper(path) {
    try { sys('sys.setConfig', { wallpaper: `file:${path}` }); desktop.notify('Đã đổi hình nền', { level: 'ok' }); } catch (e) { fail(e); }
  }
  async function remove(f) {
    if (!(await desktop.confirm({ message: `Xóa "${f.name}"?`, okText: 'Xóa', danger: true }))) return;
    try { sys('fs.remove', f.path); } catch (e) { return fail(e); }
    render();
    if (files.length) view(Math.min(viewing, files.length - 1)); else closeViewer();
  }

  async function importFiles(list) {
    if (!sys('fs.exists', DIR)) sys('fs.mkdir', DIR, { recursive: true });
    let n = 0;
    for (const f of list) {
      try {
        const { bytes, ext } = await desktop.processImage(f);
        const stem = (f.name.replace(/\.[^.]*$/, '') || 'anh').replace(/[\\/]/g, '_');
        let name = `${stem}.${ext}`;
        for (let i = 1; sys('fs.exists', `${DIR}/${name}`); i++) name = `${stem} (${i}).${ext}`;
        sys('fs.write', `${DIR}/${name}`, bytes);
        n++;
      } catch (e) { fail(e); }
    }
    if (n) desktop.notify(`Đã nhập ${n} ảnh`, { level: 'ok' });
    render();
  }

  const input = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  input.addEventListener('change', () => { importFiles([...input.files]); input.value = ''; });
  const content = h('div', { class: 'ph' },
    h('div', { class: 'ph-bar' }, h('button', { class: 'btn primary small', type: 'button', text: '＋ Nhập ảnh', onclick: () => input.click() }), input, h('button', { class: 'btn small', type: 'button', text: 'Làm mới', onclick: render })),
    h('div', { class: 'ph-main' }, grid, viewer), status);
  const win = desktop.wm.open({ appId: 'photos', title: 'Ảnh', icon: 'photos', content, width: 250, height: 330 });
  win.closers.push(revokeAll);
  win.api = { render, view, importFiles, setWallpaper, files: () => files, closeViewer };
  render();
  return win;
}
