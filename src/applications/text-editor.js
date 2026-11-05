import { h } from '../desktop/dom.js';
import { highlightToFragment } from './asm-highlight.js';
import { normalizePath } from '../os/filesystem.js';
import { baseName } from '../desktop/format.js';

const DRAFT_DIR = '/tmp/.drafts';
const HL_LIMIT = 60000;
const hash32 = (s) => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return x.toString(16).padStart(8, '0'); };
const draftPath = (path) => `${DRAFT_DIR}/${hash32(path ?? '(untitled)')}.json`;
const isAsm = (p) => !!p && /\.asm$/i.test(p);

export function openEditor(desktop, state = {}) {
  const sys = desktop.sys;
  let path = null, saved = '', dirty = false, win = null, draftTimer = null;

  const ta = h('textarea', { class: 'ed-ta', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', wrap: 'off', 'aria-label': 'Nội dung' });
  const code = h('code');
  const hl = h('pre', { class: 'ed-hl', 'aria-hidden': 'true', hidden: true }, code);
  const label = h('span', { class: 'ed-path' });

  const title = () => `${path ? baseName(path) : 'Chưa đặt tên'}${dirty ? ' •' : ''}`;
  const refreshChrome = () => {
    label.textContent = path ?? '(chưa lưu)';
    if (win) desktop.wm.setTitle(win, `Soạn thảo - ${title()}`);
    const on = isAsm(path) && ta.value.length <= HL_LIMIT;
    ta.classList.toggle('hl-on', on);
    hl.hidden = !on;
    code.replaceChildren(on ? highlightToFragment(`${ta.value}\n`) : '');
  };
  const fail = (e) => desktop.notify(e.message ?? String(e), { level: 'error' });

  function dropDraft(p) { try { sys('fs.remove', draftPath(p)); } catch { /* none */ } }
  function writeDraft() {
    draftTimer = null;
    if (!dirty) return;
    try {
      if (!sys('fs.exists', DRAFT_DIR)) sys('fs.mkdir', DRAFT_DIR, { recursive: true });
      sys('fs.write', draftPath(path), JSON.stringify({ path, text: ta.value, at: desktop.kernel.clock() }));
    } catch { /* a full disk must not break typing */ }
  }
  async function offerDraft() {
    let d = null;
    try { d = JSON.parse(sys('fs.read', draftPath(path))); } catch { return; }
    if (!d || typeof d.text !== 'string' || d.path !== path || d.text === ta.value || (path === null && !d.text)) return;
    if (await desktop.confirm({ message: 'Có bản nháp chưa lưu của tệp này. Khôi phục?', okText: 'Khôi phục' })) { ta.value = d.text; dirty = ta.value !== saved; refreshChrome(); }
    else dropDraft(path);
  }

  async function load(p) {
    let bytes;
    try { bytes = sys('fs.readBytes', p); } catch (e) { fail(e); return false; }
    if (bytes.subarray(0, 1024).includes(0)) { desktop.notify('Tệp nhị phân: không mở bằng Soạn thảo (dùng lệnh hexdump)', { level: 'error' }); return false; }
    path = p; saved = new TextDecoder().decode(bytes); ta.value = saved; dirty = false;
    refreshChrome();
    await offerDraft();
    return true;
  }

  async function saveAs() {
    const input = await desktop.prompt({ title: 'Lưu thành', label: 'Đường dẫn tệp', value: path ?? '/home/user/moi.txt', okText: 'Lưu' });
    if (!input || !input.trim()) return false;
    const target = normalizePath(input.trim(), '/home/user');
    if (target !== path && sys('fs.exists', target) && !(await desktop.confirm({ message: `${target} đã tồn tại. Ghi đè?`, okText: 'Ghi đè', danger: true }))) return false;
    const old = path;
    path = target;
    if (!(await save())) { path = old; return false; }
    if (old === null) dropDraft(null);
    return true;
  }
  async function save() {
    if (path === null) return saveAs();
    try { sys('fs.write', path, ta.value); } catch (e) { fail(e); return false; }
    saved = ta.value; dirty = false; dropDraft(path); refreshChrome();
    desktop.notify(`Đã lưu ${baseName(path)}`, { level: 'ok' });
    return true;
  }
  async function discardOk() {
    return !dirty || desktop.confirm({ message: 'Có thay đổi chưa lưu. Bỏ thay đổi?', okText: 'Bỏ', danger: true });
  }
  async function newDoc() {
    if (!(await discardOk())) return;
    dropDraft(path); path = null; saved = ''; ta.value = ''; dirty = false; refreshChrome();
  }
  async function openPath() {
    if (!(await discardOk())) return;
    const input = await desktop.prompt({ title: 'Mở tệp', label: 'Đường dẫn tệp', value: path ?? '/home/user/', okText: 'Mở' });
    if (input && input.trim()) await load(normalizePath(input.trim(), '/home/user'));
  }
  async function build() {
    if (!isAsm(path) && !(dirty && path === null)) { desktop.notify('Chỉ biên dịch được tệp .asm đã lưu', { level: 'error' }); return null; }
    if ((dirty || path === null) && !(await save())) return null;
    if (!isAsm(path)) { desktop.notify('Chỉ biên dịch được tệp .asm', { level: 'error' }); return null; }
    const out = path.replace(/\.asm$/i, '.vx');
    try {
      const r = sys('sys.assemble', path, out);
      desktop.notify(`Đã biên dịch → ${baseName(out)} (${r.size} byte)`, { level: 'ok' });
      return out;
    } catch (e) {
      await desktop.confirm({ title: 'Lỗi biên dịch', message: e.message, okText: 'Đóng', cancel: false });
      return null;
    }
  }
  async function run() { const out = await build(); if (out) desktop.runProgram(out); }

  ta.addEventListener('input', () => {
    dirty = ta.value !== saved;
    refreshChrome();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(writeDraft, 800);
  });
  ta.addEventListener('scroll', () => { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey) { // keep focus in the editor: insert 4 spaces
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en } = ta;
      ta.setRangeText('    ', s, en, 'end');
      ta.dispatchEvent(new Event('input'));
    } else if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
  });

  const tool = (text, tip, fn) => h('button', { class: 'btn small', type: 'button', title: tip, 'aria-label': tip, text, onclick: fn });
  const content = h('div', { class: 'ed' },
    h('div', { class: 'ed-tools' }, tool('Mới', 'Tệp mới', newDoc), tool('Mở', 'Mở tệp', openPath), tool('Lưu', 'Lưu', save), tool('Lưu thành', 'Lưu thành', saveAs), tool('Biên dịch', 'Biên dịch .asm', build), tool('▶ Chạy', 'Biên dịch và chạy', run)),
    h('div', { class: 'ed-wrap' }, hl, ta), label);
  win = desktop.wm.open({ appId: 'editor', title: 'Soạn thảo', icon: 'editor', content, width: 250, height: 320 });
  win.getState = () => ({ path });
  win.onBeforeClose = discardOk;
  win.closers.push(() => { clearTimeout(draftTimer); writeDraft(); });
  win.api = { load, save, saveAs, build, run, newDoc, textarea: ta, get dirty() { return dirty; }, get path() { return path; } };
  refreshChrome();
  if (typeof state.path === 'string') load(state.path); else offerDraft();
  return win;
}
