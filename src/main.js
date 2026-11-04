import { openDisk } from './storage/database.js';
import { Computer } from './core/computer.js';
import { Desktop } from './desktop/desktop.js';

const $ = (id) => document.getElementById(id);
const bootEl = $('boot'), logEl = $('boot-log'), power = $('power'), root = $('desktop-root');
let computer = null, desktop = null, busy = false;

function log(text, level = 'ok') {
  const line = document.createElement('div');
  line.className = `bl ${level}`;
  line.textContent = text;
  logEl.append(line);
  logEl.scrollTop = logEl.scrollHeight;
}

async function powerOn() {
  if (busy) return;
  busy = true;
  power.disabled = true;
  logEl.replaceChildren();
  bootEl.hidden = false;
  root.hidden = true;
  try {
    const kernel = await computer.powerOn();
    bootEl.hidden = true;
    root.hidden = false;
    desktop = new Desktop({ kernel, root });
  } catch (e) {
    root.hidden = true;
    bootEl.hidden = false;
    if (e.name !== 'BootError') log(`Lỗi không mong đợi: ${e.message}`, 'error');
    power.textContent = '↻ Thử lại';
    power.disabled = false;
  }
  busy = false;
}

async function shutdown(restart) {
  if (busy) return;
  busy = true;
  try {
    desktop?.destroy();
    desktop = null;
    await computer.powerOff();
  } catch (e) { console.error(e); }
  root.hidden = true;
  bootEl.hidden = false;
  logEl.replaceChildren();
  log('Máy đã tắt. Dữ liệu đã được lưu.', 'warn');
  power.textContent = '⏻ Bật nguồn';
  power.disabled = false;
  busy = false;
  if (restart) await powerOn();
}

(async () => {
  const db = await openDisk('voidos');
  computer = new Computer({ db });
  computer.events.on('boot:log', ({ text, level }) => log(text, level));
  computer.events.on('power', (action) => setTimeout(() => shutdown(action === 'reboot'), 0));
  if (!db.persistent) log('Cảnh báo: trình duyệt không có IndexedDB, dữ liệu sẽ mất khi tải lại trang.', 'warn');
  power.addEventListener('click', powerOn);
  const flush = () => { try { Promise.resolve(computer.kernel?.fs.flush()).catch(() => {}); } catch { /* not running */ } };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('pagehide', flush);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
