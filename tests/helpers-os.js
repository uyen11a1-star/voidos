import { boot } from '../src/core/boot.js';
import { MemoryDatabase } from '../src/storage/database.js';
import { EventBus } from '../src/core/event-bus.js';

// Boots a complete VoidOS in memory. clock is controllable for sleep tests.
export async function bootSystem({ db = new MemoryDatabase(), config } = {}) {
  const state = { t: 1_000_000 };
  const events = new EventBus();
  const logs = [];
  events.on('boot:log', (l) => logs.push(l));
  if (config) {
    const { FileSystem } = await import('../src/os/filesystem.js');
    const fs = new FileSystem(db); await fs.mount(); fs.mkdir('/etc'); fs.writeFile('/etc/config.json', JSON.stringify(config)); await fs.flush();
  }
  const sys = await boot({ db, events, clock: () => state.t, sleep: async () => {}, delay: 0 });
  return { ...sys, db, events, logs, state, call: (n, ...a) => sys.kernel.call(n, ...a) };
}
