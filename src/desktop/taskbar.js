import { h, clear } from './dom.js';

export const TASKBAR_H = 36;

export class Taskbar {
  constructor(desktop) {
    this.desktop = desktop;
    this.startBtn = h('button', { class: 'tb-start', type: 'button', 'aria-label': 'Menu Start', text: '◆', onclick: () => desktop.startMenu.toggle() });
    this.tasks = h('div', { class: 'tb-tasks' });
    this.clock = h('span', { class: 'tb-clock' });
    this.el = h('div', { class: 'vo-taskbar' }, this.startBtn, this.tasks, this.clock);
  }

  update() {
    const wm = this.desktop.wm;
    const top = wm.top();
    clear(this.tasks);
    for (const win of wm.list()) {
      this.tasks.append(h('button', {
        class: `tb-task${win === top ? ' active' : ''}${win.minimized ? ' min' : ''}`, type: 'button', title: win.title,
        onclick: () => { if (win.minimized || win !== top) wm.focus(win); else wm.minimize(win); },
      }, h('span', { text: win.icon }), h('span', { class: 'tb-label', text: win.title })));
    }
  }
}
