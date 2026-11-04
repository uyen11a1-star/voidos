import { h, clear } from '../desktop/dom.js';
import { fmtSize, fmtUptime } from '../desktop/format.js';

const POINTS = 60;
const SVG = 'http://www.w3.org/2000/svg';

export function openMonitor(desktop) {
  const sys = desktop.sys;
  const hist = [];
  const bar = (cls) => { const fill = h('div', { class: `bar-fill ${cls}` }); return { el: h('div', { class: 'bar' }, fill), fill }; };
  const cpuBar = bar('cpu'), ramBar = bar('ram'), diskBar = bar('disk');
  const cpuText = h('span'), ramText = h('span'), diskText = h('span'), up = h('span'), cyc = h('span');
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${POINTS - 1} 40`); svg.setAttribute('class', 'spark'); svg.setAttribute('preserveAspectRatio', 'none');
  const line = document.createElementNS(SVG, 'polyline');
  line.setAttribute('fill', 'none'); line.setAttribute('stroke', 'currentColor'); line.setAttribute('stroke-width', '1');
  svg.append(line);
  const table = h('div', { class: 'mon-procs' });
  const row = (label, text, b) => h('div', { class: 'mon-row' }, h('div', { class: 'mon-label' }, h('b', { text: label }), text), b?.el);

  function refresh() {
    const cpu = sys('sys.cpu'), mem = sys('sys.mem'), disk = sys('fs.usage'), info = sys('sys.info'), procs = sys('proc.list');
    hist.push(cpu); if (hist.length > POINTS) hist.shift();
    cpuText.textContent = `${(cpu * 100).toFixed(1)}%`;
    cpuBar.fill.style.width = `${Math.min(100, cpu * 100)}%`;
    ramText.textContent = `${fmtSize(mem.usedBytes)} / ${fmtSize(mem.totalBytes)}`;
    ramBar.fill.style.width = `${(mem.usedBytes / mem.totalBytes) * 100}%`;
    diskText.textContent = `${fmtSize(disk.used)} / ${fmtSize(disk.quota)}`;
    diskBar.fill.style.width = `${(disk.used / disk.quota) * 100}%`;
    up.textContent = fmtUptime(info.uptime); cyc.textContent = String(info.totalCycles);
    line.setAttribute('points', hist.map((v, i) => `${i + POINTS - hist.length},${(40 - Math.min(1, v) * 38).toFixed(1)}`).join(' '));
    clear(table);
    table.append(h('div', { class: 'mon-ph' }, h('span', { text: 'PID' }), h('span', { text: 'Tên' }), h('span', { text: 'Trạng thái' }), h('span', { text: 'RAM' }), h('span')));
    if (!procs.length) table.append(h('div', { class: 'mon-none', text: 'Không có tiến trình người dùng' }));
    for (const p of procs) {
      table.append(h('div', { class: 'mon-pr' }, h('span', { text: p.pid }), h('span', { text: p.name }), h('span', { text: p.state }), h('span', { text: fmtSize(p.bytes) }),
        h('button', { class: 'btn small danger', type: 'button', title: `Kết thúc ${p.name}`, 'aria-label': `Kết thúc ${p.name}`, text: '✕', onclick: () => { try { sys('proc.kill', p.pid); } catch (e) { desktop.notify(e.message, { level: 'error' }); } refresh(); } })));
    }
  }

  const content = h('div', { class: 'mon' },
    row('CPU ', cpuText, cpuBar), h('div', { class: 'spark-wrap' }, svg),
    row('RAM ', ramText, ramBar), row('Ổ đĩa ', diskText, diskBar),
    h('div', { class: 'mon-row' }, h('b', { text: 'Uptime ' }), up, h('b', { text: '  Chu kỳ CPU ' }), cyc),
    table);
  const win = desktop.wm.open({ appId: 'monitor', title: 'Giám sát', icon: '📊', content, width: 250, height: 320 });
  const timer = setInterval(() => { if (!win.minimized) refresh(); }, 1000);
  win.closers.push(() => clearInterval(timer));
  win.refresh = refresh;
  refresh();
  return win;
}
