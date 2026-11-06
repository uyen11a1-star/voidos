import { h, clear } from './dom.js';
import { renderIcon } from './icons.js';

export const TASKBAR_H = 36;

export class Taskbar {
  constructor(desktop) {
    this.desktop = desktop;
    this.startBtn = h('button', { class: 'tb-start', type: 'button', 'aria-label': 'Menu Start', text: '◆', onclick: () => desktop.startMenu.toggle() });
    this.tasks = h('div', { class: 'tb-tasks' });
    this.clock = h('span', { class: 'tb-clock' });
    this.music = h('button', { class: 'tb-music', type: 'button', text: '♪', title: 'Nhạc nền', 'aria-label': 'Phát hoặc tạm dừng nhạc', onclick: () => desktop.toggleMusic() });
    this.mouse = h('button', { class: 'tb-mouse', type: 'button', text: '🖱', title: 'Chuột ảo', 'aria-label': 'Bật hoặc tắt chuột ảo', 'aria-pressed': 'false', onclick: () => desktop.setVirtualMouse(!desktop.config.virtualMouse) });
    this.el = h('div', { class: 'vo-taskbar' }, this.startBtn, this.tasks, h('div', { class: 'tb-tray' }, this.mouse, this.music, this.clock));
  }

  update() {
    const wm = this.desktop.wm;
    const top = wm.top();
    clear(this.tasks);
    for (const win of wm.list()) {
      this.tasks.append(h('button', {
        class: `tb-task${win === top ? ' active' : ''}${win.minimized ? ' min' : ''}`, type: 'button', title: win.title,
        onclick: () => { if (win.minimized || win !== top) wm.focus(win); else wm.minimize(win); },
      }, renderIcon(win.icon, 'tb-ic'), h('span', { class: 'tb-label', text: win.title })));
    }
  }

  // Music button in the tray: shows play/pause and the current track.
  setMusic(info) {
    this.music.textContent = info.playing ? '⏸' : '♪';
    this.music.classList.toggle('playing', info.playing);
    this.music.title = info.playing ? `Đang phát: ${info.title}` : info.title ? `Tạm dừng: ${info.title}` : 'Nhạc nền';
  }

  setMouse(on) {
    this.mouse.classList.toggle('on', on);
    this.mouse.setAttribute('aria-pressed', String(on));
  }
}
