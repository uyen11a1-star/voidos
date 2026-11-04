import { h, clear } from '../desktop/dom.js';
import { onLongPress } from '../desktop/context-menu.js';
import { normalizePath } from '../os/filesystem.js';
import { fmtSize, fmtTime, baseName, dirName, PROTECTED } from '../desktop/format.js';

const iconFor = (it) => (it.type === 'dir' ? '📁' : /\.vx$/i.test(it.name) ? '⚙️' : /\.asm$/i.test(it.name) ? '📝' : '📄');

export function openFileManager(desktop, state = {}) {
  const sys = desktop.sys;
  const isDir = (p) => { try { return sys('fs.stat', p).type === 'dir'; } catch { return false; } };
  let cwd = typeof state.cwd === 'string' && isDir(state.cwd) ? state.cwd : '/home/user';
  let selected = null;
  let win = null;

  const fail = (e) => desktop.notify(e.message ?? String(e), { level: 'error' });
  const child = (name) => `${cwd === '/' ? '' : cwd}/${name}`;
  const validName = (n) => typeof n === 'string' && n.trim() !== '' && !n.includes('/') && n !== '.' && n !== '..';
  const uniqueName = (name) => {
    if (!sys('fs.exists', child(name))) return name;
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    for (let i = 1; ; i++) { const n = `${stem} (${i})${ext}`; if (!sys('fs.exists', child(n))) return n; }
  };
  const guard = (path) => { if (PROTECTED.includes(path)) { desktop.notify('Thư mục hệ thống được bảo vệ', { level: 'error' }); return false; } return true; };

  const pathInput = h('input', { class: 'fm-path', type: 'text', 'aria-label': 'Đường dẫn', autocapitalize: 'off', spellcheck: 'false', onkeydown: (e) => { if (e.key === 'Enter') go(pathInput.value); } });
  const list = h('div', { class: 'fm-list' });
  const status = h('div', { class: 'fm-status' });

  function go(p) {
    const target = normalizePath(p, cwd);
    if (!isDir(target)) { desktop.notify(`Không phải thư mục: ${target}`, { level: 'error' }); pathInput.value = cwd; return; }
    cwd = target; selected = null; render();
  }

  function render() {
    let items = [];
    try { items = sys('fs.list', cwd); } catch (e) { fail(e); cwd = '/'; items = sys('fs.list', '/'); }
    pathInput.value = cwd;
    if (win) { desktop.wm.setTitle(win, `Tệp - ${baseName(cwd)}`); }
    if (selected && !items.some((i) => i.path === selected)) selected = null;
    clear(list);
    if (!items.length) list.append(h('div', { class: 'fm-empty', text: 'Thư mục trống' }));
    for (const it of items) {
      const row = h('div', { class: `fm-row${it.path === selected ? ' sel' : ''}`, role: 'option', 'aria-selected': it.path === selected, dataset: { path: it.path }, onclick: () => rowClick(it) },
        h('span', { class: 'fm-icon', text: iconFor(it) }), h('span', { class: 'fm-name', text: it.name }),
        h('span', { class: 'fm-meta', text: it.type === 'dir' ? `${it.entries} mục` : fmtSize(it.size) }));
      onLongPress(row, (e) => { selected = it.path; render(); desktop.menu(e, menuFor(it)); });
      list.append(row);
    }
    const u = sys('fs.usage');
    status.textContent = `${items.length} mục | còn trống ${fmtSize(u.free)}${desktop.clipboard ? ` | clipboard: ${baseName(desktop.clipboard.path)} (${desktop.clipboard.mode === 'cut' ? 'cắt' : 'chép'})` : ''}`;
  }

  function rowClick(it) {
    if (selected === it.path) open(it);
    else { selected = it.path; render(); }
  }

  function open(it) {
    if (it.type === 'dir') go(it.path);
    else if (/\.vx$/i.test(it.name)) desktop.runProgram(it.path);
    else desktop.openApp('editor', { path: it.path });
  }

  const current = () => (selected ? sys('fs.stat', selected) : null);
  const needSel = () => { if (!selected) { desktop.notify('Hãy chọn một mục trước', { level: 'info' }); return null; } return selected; };

  async function newFolder() {
    const name = await desktop.prompt({ title: 'Thư mục mới', label: 'Tên thư mục' });
    if (name === null) return;
    if (!validName(name)) return desktop.notify('Tên không hợp lệ (không được chứa /)', { level: 'error' });
    try { sys('fs.mkdir', child(name.trim())); } catch (e) { fail(e); }
    render();
  }
  async function newFile() {
    const name = await desktop.prompt({ title: 'Tệp mới', label: 'Tên tệp' });
    if (name === null) return;
    if (!validName(name)) return desktop.notify('Tên không hợp lệ (không được chứa /)', { level: 'error' });
    try {
      if (sys('fs.exists', child(name.trim()))) throw new Error(`Đã tồn tại: ${name.trim()}`); // never overwrite silently
      sys('fs.write', child(name.trim()), '');
    } catch (e) { fail(e); }
    render();
  }
  async function rename() {
    const p = needSel(); if (!p || !guard(p)) return;
    const name = await desktop.prompt({ title: 'Đổi tên', label: 'Tên mới', value: baseName(p) });
    if (name === null || name === baseName(p)) return;
    if (!validName(name)) return desktop.notify('Tên không hợp lệ (không được chứa /)', { level: 'error' });
    try { sys('fs.rename', p, `${dirName(p) === '/' ? '' : dirName(p)}/${name.trim()}`); selected = null; } catch (e) { fail(e); }
    render();
  }
  function copyOrCut(mode) {
    const p = needSel(); if (!p) return;
    if (mode === 'cut' && !guard(p)) return;
    desktop.clipboard = { path: p, mode };
    render();
  }
  function paste() {
    const c = desktop.clipboard;
    if (!c) return desktop.notify('Clipboard trống', { level: 'info' });
    try {
      if (!sys('fs.exists', c.path)) throw new Error('Mục nguồn không còn tồn tại');
      const dest = child(uniqueName(baseName(c.path)));
      if (c.mode === 'copy') sys('fs.copy', c.path, dest, { recursive: true });
      else { if (dirName(c.path) !== cwd) sys('fs.move', c.path, dest); desktop.clipboard = null; }
    } catch (e) { fail(e); }
    render();
  }
  async function remove() {
    const p = needSel(); if (!p || !guard(p)) return;
    if (!(await desktop.confirm({ message: `Xóa "${baseName(p)}"? Không thể hoàn tác.`, okText: 'Xóa', danger: true }))) return;
    try { sys('fs.remove', p, { recursive: true }); selected = null; } catch (e) { fail(e); }
    render();
  }
  async function info() {
    const p = needSel(); if (!p) return;
    try {
      const s = current();
      await desktop.confirm({ title: s.name, message: `Đường dẫn: ${s.path}\nLoại: ${s.type === 'dir' ? 'thư mục' : 'tệp'}\nKích thước: ${s.type === 'dir' ? `${s.entries} mục` : fmtSize(s.size)}\nTạo: ${fmtTime(s.ctime)}\nSửa: ${fmtTime(s.mtime)}`, okText: 'Đóng', cancel: false });
    } catch (e) { fail(e); }
  }
  const menuFor = (it) => [
    { label: 'Mở', action: () => open(it) },
    ...(/\.vx$/i.test(it.name) ? [{ label: 'Cài đặt thành ứng dụng', action: () => desktop.install(it.path) }] : []),
    'sep',
    { label: 'Sao chép', action: () => copyOrCut('copy') }, { label: 'Cắt', action: () => copyOrCut('cut') },
    { label: 'Đổi tên', action: rename }, { label: 'Thông tin', action: info },
    'sep', { label: 'Xóa', danger: true, action: remove },
  ];

  const tool = (text, title, fn) => h('button', { class: 'btn small', type: 'button', title, 'aria-label': title, text, onclick: fn });
  const content = h('div', { class: 'fm' },
    h('div', { class: 'fm-bar' }, tool('⬆', 'Lên một cấp', () => go(dirName(cwd))), pathInput),
    h('div', { class: 'fm-tools' },
      tool('📁+', 'Thư mục mới', newFolder), tool('📄+', 'Tệp mới', newFile), tool('✏️', 'Đổi tên', rename),
      tool('📋', 'Sao chép', () => copyOrCut('copy')), tool('✂️', 'Cắt', () => copyOrCut('cut')), tool('📥', 'Dán', paste),
      tool('🗑', 'Xóa', remove), tool('ℹ️', 'Thông tin', info)),
    list, status);
  win = desktop.wm.open({ appId: 'files', title: 'Tệp', icon: '📁', content, width: 250, height: 320 });
  win.getState = () => ({ cwd });
  win.api = { go, render, select: (p) => { selected = p; render(); }, newFolder, newFile, rename, paste, remove, copyOrCut };
  render();
  return win;
}
