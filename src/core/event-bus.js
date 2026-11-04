// Minimal synchronous pub/sub used by boot, kernel and desktop.
export class EventBus {
  constructor() { this.handlers = new Map(); }
  on(name, fn) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(fn);
    return () => this.handlers.get(name)?.delete(fn);
  }
  emit(name, payload) {
    for (const fn of [...(this.handlers.get(name) ?? [])]) fn(payload);
  }
}
