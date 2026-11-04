import { h, clear } from './dom.js';
import { onLongPress } from './context-menu.js';

// Application launcher: built-in and installed apps, search, power buttons.
export class StartMenu {
  constructor(desktop) {
    this.desktop = desktop;
    this.isOpen = false;
    this.host = h('span', { class: 'start-host' });
    this.search = h('input', { class: 'start-search', type: 'search', placeholder: 'Tìm ứng dụng…', 'aria-label': 'Tìm ứng dụng', autocomplete: 'off', oninput: () => this.render() });
    this.list = h('div', { class: 'start-list' });
    this.el = h('div', { class: 'vo-start', hidden: true },
      h('div', { class: 'start-head' }, this.host, this.search),
      this.list,
      h('div', { class: 'start-foot' },
        h('button', { class: 'btn', type: 'button', text: '↻ Khởi động lại', onclick: () => this._power('reboot') }),
        h('button', { class: 'btn danger', type: 'button', text: '⏻ Tắt máy', onclick: () => this._power('shutdown') })));
  }

  render() {
    const q = this.search.value.trim().toLowerCase();
    this.host.textContent = this.desktop.config.hostname;
    clear(this.list);
    for (const app of this.desktop.allApps().filter((a) => a.name.toLowerCase().includes(q))) {
      const item = h('button', { class: 'start-item', type: 'button', onclick: () => { this.close(); this.desktop.openApp(app.id); } },
        h('span', { class: 'start-icon', text: app.icon }), h('span', { text: app.name }));
      if (app.installed) onLongPress(item, (e) => this.desktop.menu(e, [{ label: 'Gỡ cài đặt', danger: true, action: () => this.desktop.uninstall(app.id) }]));
      this.list.append(item);
    }
    if (!this.list.children.length) this.list.append(h('div', { class: 'start-empty', text: 'Không có ứng dụng phù hợp' }));
  }

  open() { this.render(); this.el.hidden = false; this.isOpen = true; this.search.focus?.(); }
  close() { this.el.hidden = true; this.isOpen = false; this.search.value = ''; }
  toggle() { if (this.isOpen) this.close(); else this.open(); }

  _power(action) { this.close(); this.desktop.sys('sys.power', action); }
}
