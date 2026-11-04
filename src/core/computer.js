import { EventBus } from './event-bus.js';
import { boot } from './boot.js';

// Power state machine around BIOS boot and kernel shutdown.
export class Computer {
  constructor({ db, events = new EventBus(), clock = Date.now, sleep, delay } = {}) {
    this.opts = { db, clock, sleep, delay };
    this.events = events;
    this.state = 'off'; // off | booting | on
    this.kernel = null;
    this.system = null;
  }

  async powerOn() {
    if (this.state !== 'off') throw new Error(`Cannot power on while ${this.state}`);
    this.state = 'booting';
    try {
      this.system = await boot({ ...this.opts, events: this.events });
      this.kernel = this.system.kernel;
      this.state = 'on';
      return this.kernel;
    } catch (e) {
      this.state = 'off';
      throw e;
    }
  }

  async powerOff() {
    if (this.state !== 'on') return;
    await this.kernel.shutdown();
    this.kernel = null;
    this.system = null;
    this.state = 'off';
    this.events.emit('power:off');
  }
}
