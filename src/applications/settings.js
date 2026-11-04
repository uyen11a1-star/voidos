import { h, clear } from '../desktop/dom.js';
import { THEMES } from '../core/config.js';
import { safeRamLimit } from '../hardware/ram.js';
import { fmtSize, fmtUptime } from '../desktop/format.js';

const RESOLUTIONS = ['270x480', '360x640', '412x732', '480x854', '540x960', '720x1280', '640x360', '960x540', '1280x720'];
const RAMS = [256, 512, 1024, 2048, 4096, 8192, 16384];
const QUOTAS = [1024, 2048, 4096, 8192, 16384, 32768, 65536];
const THEME_NAMES = { gold: 'Vàng kim', azure: 'Xanh lam', crimson: 'Đỏ thẫm', emerald: 'Ngọc lục', violet: 'Tím' };

export function openSettings(desktop) {
  const sys = desktop.sys;
  const cfg = sys('sys.config');
  const banner = h('div', { class: 'set-banner', hidden: true });
  const fail = (e) => desktop.notify(e.message ?? String(e), { level: 'error' });

  const withCurrent = (opts, cur) => (opts.includes(cur) ? opts : [...opts, cur].sort((a, b) => (typeof a === 'number' ? a - b : 0)));
  const select = (opts, cur, fmt = String) => {
    const el = h('select', { class: 'set-input' });
    for (const o of withCurrent(opts, cur)) el.append(h('option', { value: o, text: fmt(o) }));
    el.value = String(cur);
    return el;
  };
  const theme = select(THEMES, cfg.theme, (t) => THEME_NAMES[t] ?? t);
  const res = select(RESOLUTIONS, cfg.resolution);
  const ram = select(RAMS.filter((k) => k * 1024 <= safeRamLimit()), cfg.ramKB, (k) => `${k} KB`);
  const quota = select(QUOTAS, cfg.quotaKB, (k) => `${k} KB`);
  const host = h('input', { class: 'set-input', type: 'text', value: cfg.hostname, maxlength: '32', autocapitalize: 'off', spellcheck: 'false' });
  const fast = h('input', { type: 'checkbox' }); fast.checked = cfg.fastBoot;
  const c24 = h('input', { type: 'checkbox' }); c24.checked = cfg.clock24;
  const vol = h('input', { type: 'range', min: '0', max: '100', step: '5', value: String(cfg.volume ?? 50), 'aria-label': 'Âm lượng' });
  const field = (label, el) => h('label', { class: 'set-field' }, h('span', { text: label }), el);

  async function apply() {
    const next = { theme: theme.value, resolution: res.value, ramKB: Number(ram.value), quotaKB: Number(quota.value), hostname: host.value.trim(), fastBoot: fast.checked, clock24: c24.checked, volume: Number(vol.value) };
    const cur = sys('sys.config');
    const patch = Object.fromEntries(Object.entries(next).filter(([k, v]) => cur[k] !== v));
    if (!Object.keys(patch).length) return desktop.notify('Không có thay đổi', { level: 'info' });
    try {
      const r = sys('sys.setConfig', patch);
      desktop.notify('Đã áp dụng cài đặt', { level: 'ok' });
      banner.hidden = !r.needsReboot;
      if (r.needsReboot) { clear(banner); banner.append('Dung lượng RAM chỉ đổi sau khi khởi động lại. ', h('button', { class: 'btn small', type: 'button', text: 'Khởi động lại', onclick: () => sys('sys.power', 'reboot') })); }
    } catch (e) { fail(e); }
  }

  const infoBox = h('div', { class: 'set-info' });
  function refreshInfo() {
    const i = sys('sys.info'), d = sys('fs.usage');
    clear(infoBox);
    for (const [k, v] of [['Hệ điều hành', `${i.name} ${i.version}`], ['Tên máy', i.hostname], ['CPU', i.cpu], ['RAM', fmtSize(i.ramBytes)], ['Ổ đĩa', `${fmtSize(d.used)} / ${fmtSize(d.quota)} (${d.files} tệp)`], ['Tiến trình', String(i.procs)], ['Thời gian chạy', fmtUptime(i.uptime)]]) {
      infoBox.append(h('div', { class: 'set-line' }, h('b', { text: k }), h('span', { text: v })));
    }
  }

  function exportBackup() {
    try {
      const text = JSON.stringify(sys('backup.export'));
      const d = new Date(desktop.kernel.clock());
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
      desktop.download(`voidos-backup-${stamp}.json`, text);
      desktop.notify(`Đã xuất sao lưu (${fmtSize(text.length)})`, { level: 'ok' });
    } catch (e) { fail(e); }
  }
  async function importBackup(text) {
    if (!(await desktop.confirm({ message: 'Khôi phục sẽ THAY TOÀN BỘ dữ liệu hiện tại bằng bản sao lưu, rồi khởi động lại. Tiếp tục?', okText: 'Khôi phục', danger: true }))) return false;
    try {
      await sys('backup.import', text);
      desktop.notify('Đã khôi phục. Đang khởi động lại…', { level: 'ok' });
      sys('sys.power', 'reboot');
      return true;
    } catch (e) { fail(e); return false; }
  }
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { importBackup(String(r.result)); fileInput.value = ''; };
    r.onerror = () => desktop.notify('Không đọc được tệp', { level: 'error' });
    r.readAsText(f);
  });

  const content = h('div', { class: 'set' },
    banner,
    h('h4', { text: 'Hiển thị' }), field('Giao diện', theme), field('Độ phân giải', res),
    h('h4', { text: 'Phần cứng ảo' }), field('RAM', ram), field('Dung lượng ổ đĩa', quota),
    h('h4', { text: 'Hệ thống' }), field('Tên máy', host),
    h('label', { class: 'set-check' }, fast, h('span', { text: 'Khởi động nhanh (bỏ qua hiệu ứng chờ)' })),
    h('label', { class: 'set-check' }, c24, h('span', { text: 'Đồng hồ 24 giờ' })),
    field('Âm lượng thông báo', vol),
    h('div', { class: 'set-actions' }, h('button', { class: 'btn primary', type: 'button', text: 'Áp dụng', onclick: apply })),
    h('h4', { text: 'Thông tin máy' }), infoBox,
    h('h4', { text: 'Sao lưu' }),
    h('div', { class: 'set-actions' }, h('button', { class: 'btn', type: 'button', text: 'Xuất sao lưu', onclick: exportBackup }), h('button', { class: 'btn', type: 'button', text: 'Khôi phục…', onclick: () => fileInput.click() }), fileInput));
  const win = desktop.wm.open({ appId: 'settings', title: 'Cài đặt', icon: '⚙️', content, width: 250, height: 330 });
  const timer = setInterval(() => { if (!win.minimized) refreshInfo(); }, 2000);
  win.closers.push(() => clearInterval(timer));
  win.api = { apply, exportBackup, importBackup, refreshInfo, fields: { theme, res, ram, quota, host, fast, c24, vol }, banner };
  refreshInfo();
  return win;
}
