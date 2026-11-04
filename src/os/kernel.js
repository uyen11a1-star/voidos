import { KernelError } from '../core/errors.js';
import { EventBus } from '../core/event-bus.js';
import { spawnImage } from '../core/machine.js';
import { parseExecutable } from './executable.js';
import { handleSyscall, API } from './system-calls.js';

const WINDOW = 30; // ticks kept for the CPU usage average

// VoidOS kernel: process table, round-robin time-sliced scheduler, syscall dispatch.
// Every process has its own CPU context and its own address space (see AddressSpace).
export class Kernel {
  constructor({ machine, fs, clock = Date.now, events = new EventBus(), config = {}, image = {} }) {
    this.machine = machine; this.fs = fs; this.clock = clock; this.events = events; this.config = config;
    this.name = image.name ?? 'VoidOS';
    this.version = image.version ?? '0.2.0';
    this.quantum = image.quantum ?? 2000;
    this.maxProcs = image.maxProcs ?? 24;
    this.procs = new Map();
    this.nextPid = 1;
    this.exited = [];
    this.bootTime = clock();
    this.window = [];
    this.logBuf = [];
    this.rr = 0;
    this.totalCycles = 0;
    this.log(`${this.name} ${this.version} kernel started (quantum ${this.quantum} cycles, max ${this.maxProcs} processes)`);
  }

  log(msg) {
    this.logBuf.push(`[${((this.clock() - this.bootTime) / 1000).toFixed(3)}] ${msg}`);
    if (this.logBuf.length > 200) this.logBuf.shift();
  }

  call(name, ...args) {
    const fn = Object.prototype.hasOwnProperty.call(API, name) ? API[name] : null;
    if (!fn) throw new KernelError('ENOSYS', `Unknown system call "${name}"`);
    return fn(this, ...args);
  }

  // ---- processes ----
  spawn(bytes, { name = 'a.out', onOutput = null, onExit = null } = {}) {
    if (this.procs.size >= this.maxProcs) throw new KernelError('EAGAIN', 'Too many processes');
    const program = parseExecutable(bytes);
    const p = {
      pid: this.nextPid, name, state: 'ready', prevState: 'ready', stdin: [], onOutput, onExit, decoder: new TextDecoder(),
      cycles: 0, started: this.clock(), wakeAt: 0, exiting: null, yielded: false, cpu: null, space: null, mmu: null,
    };
    try {
      const m = spawnImage(this.machine, program, {
        io: { print: (c) => this._out(p, c), input: () => (p.stdin.length ? p.stdin.shift() : null) },
        syscall: (n, cpu) => handleSyscall(this, p, n, cpu),
      });
      Object.assign(p, { cpu: m.cpu, space: m.space, mmu: m.mmu });
    } catch (e) {
      throw new KernelError(/Out of memory/.test(e.message) ? 'ENOMEM' : 'EINVAL', e.message);
    }
    this.nextPid++;
    this.procs.set(p.pid, p);
    this.log(`spawn pid ${p.pid} (${name})`);
    this.events.emit('proc:spawn', { pid: p.pid, name });
    return p.pid;
  }

  spawnFile(path, opts = {}) {
    return this.spawn(this.fs.readFile(path), { name: path.split('/').filter(Boolean).pop(), ...opts });
  }

  _out(p, byte) {
    const s = p.decoder.decode(Uint8Array.of(byte), { stream: true });
    if (s && p.onOutput) p.onOutput(s);
  }

  _get(pid) {
    const p = this.procs.get(pid);
    if (!p) throw new KernelError('ESRCH', `No such process: ${pid}`);
    return p;
  }

  _terminate(p, exitCode, fault = null, signal = null) {
    p.space.destroy(); // every page goes back to the frame allocator
    this.procs.delete(p.pid);
    p.state = 'terminated';
    const rest = p.decoder.decode();
    if (rest && p.onOutput) p.onOutput(rest);
    const rec = { pid: p.pid, name: p.name, exitCode, fault, signal, cycles: p.cycles, ended: this.clock() };
    this.exited.unshift(rec);
    if (this.exited.length > 20) this.exited.pop();
    this.log(`pid ${p.pid} (${p.name}) ended: ${fault ? fault.code : signal ?? `exit ${exitCode}`}`);
    this.events.emit('proc:exit', rec);
    p.onExit?.(rec);
  }

  kill(pid) { this._terminate(this._get(pid), 137, null, 'KILL'); }

  suspend(pid) {
    const p = this._get(pid);
    if (p.state === 'suspended') return;
    p.prevState = p.state === 'running' ? 'ready' : p.state;
    p.state = 'suspended';
  }

  resume(pid) {
    const p = this._get(pid);
    if (p.state === 'suspended') p.state = p.prevState;
  }

  stdin(pid, text) {
    const p = this._get(pid);
    for (const b of new TextEncoder().encode(text)) if (p.stdin.length < 4096) p.stdin.push(b);
  }

  // ---- scheduler ----
  tick(budget = 40000) {
    const now = this.clock();
    const list = [...this.procs.values()];
    let used = 0;
    for (let i = 0; i < list.length && used < budget; i++) {
      const p = list[(i + this.rr) % list.length];
      if (!this.procs.has(p.pid) || p.state === 'suspended') continue;
      if (p.state === 'sleeping') { if (now < p.wakeAt) continue; p.state = 'ready'; }
      used += this._run(p, Math.min(this.quantum, budget - used));
    }
    this.rr = list.length ? (this.rr + 1) % list.length : 0;
    this.window.push({ used, budget });
    if (this.window.length > WINDOW) this.window.shift();
    this.totalCycles += used;
    return used;
  }

  _run(p, quota) {
    let n = 0;
    p.state = 'running';
    while (n < quota) {
      if (!p.cpu.step()) break;
      n++;
      if (p.exiting !== null || p.yielded || p.state === 'sleeping') break;
    }
    p.cycles += n;
    p.yielded = false;
    const st = p.cpu.state;
    if (p.exiting !== null) this._terminate(p, p.exiting);
    else if (st === 'halted') this._terminate(p, 0);
    else if (st === 'fault') {
      const f = p.cpu.fault;
      if (p.onOutput) p.onOutput(`\n[pid ${p.pid} ${p.name}: ${f.code} at 0x${f.pc.toString(16)} - ${f.message}]\n`);
      this._terminate(p, 139, f);
    } else if (st === 'waiting') p.state = 'waiting';
    else if (p.state === 'running') p.state = 'ready';
    return n;
  }

  runUntilIdle(maxTicks = 1000) {
    let t = 0;
    while (this.procs.size && t++ < maxTicks) this.tick();
    return t;
  }

  // ---- information (real numbers only) ----
  list() {
    const now = this.clock();
    return [...this.procs.values()].map((p) => ({
      pid: p.pid, name: p.name, state: p.state, cycles: p.cycles, pages: p.space.usage().pages, bytes: p.space.usage().bytes, uptime: now - p.started,
    }));
  }

  memStats() { return this.machine.allocator.stats(); }

  cpuUsage() {
    const used = this.window.reduce((s, w) => s + w.used, 0);
    const total = this.window.reduce((s, w) => s + w.budget, 0);
    return total ? used / total : 0;
  }

  uptime() { return this.clock() - this.bootTime; }

  info() {
    return {
      name: this.name, version: this.version, hostname: this.config.hostname ?? 'voidos', cpu: 'VoidCPU 16-bit',
      ramBytes: this.machine.ram.size, procs: this.procs.size, uptime: this.uptime(), totalCycles: this.totalCycles,
    };
  }

  // Stop everything and write the disk. Safe to call more than once.
  async shutdown() {
    for (const pid of [...this.procs.keys()]) this.kill(pid);
    await this.fs.flush();
    this.log('system halted');
  }
}
