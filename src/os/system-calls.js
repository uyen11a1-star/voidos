import { VoidFault, KernelError } from '../core/errors.js';
import { FsError } from './filesystem.js';
import { PERM } from '../hardware/mmu.js';
import { assemble } from '../instruction/assembler.js';
import { packExecutable, parseExecutable } from './executable.js';
import { validatePatch, HARDWARE_KEYS } from '../core/config.js';
import { exportBackup, importBackup } from '../storage/backup.js';

const FAIL = 0xffff;
const RESERVED_APPS = ['terminal', 'files', 'editor', 'monitor', 'settings'];
const dec = new TextDecoder();
const base = (p) => p.split('/').filter(Boolean).pop() ?? p;

// ---- bytecode syscalls: SYSCALL n, arguments in R0..R2, result in R0 ----
export function cstr(mem, addr) {
  const bytes = [];
  for (let i = 0; i < 256; i++) {
    const b = mem.read8(addr + i);
    if (b === 0) return dec.decode(Uint8Array.from(bytes));
    bytes.push(b);
  }
  throw new VoidFault('BAD_STRING', 'Unterminated string (over 255 bytes)');
}

export const SYSCALLS = {
  1: (k, p, R) => { p.exiting = R[0]; },
  2: (k, p, R) => { const len = Math.min(R[1], 4096); for (let i = 0; i < len; i++) k._out(p, p.mmu.read8(R[0] + i)); R[0] = len; },
  3: (k, p, R) => { R[0] = p.pid; },
  4: (k, p) => { p.yielded = true; },
  5: (k, p, R) => { p.wakeAt = k.clock() + R[0]; p.state = 'sleeping'; },
  6: (k, p, R) => {
    const path = cstr(p.mmu, R[0]);
    let bytes;
    try { bytes = k.fs.readFile(path); } catch (e) { if (e instanceof FsError) { R[0] = FAIL; return; } throw e; }
    const n = Math.min(bytes.length, R[2]);
    for (let i = 0; i < n; i++) p.mmu.write8(R[1] + i, bytes[i]);
    R[0] = n;
  },
  7: (k, p, R) => {
    const path = cstr(p.mmu, R[0]);
    const data = new Uint8Array(R[2]);
    for (let i = 0; i < R[2]; i++) data[i] = p.mmu.read8(R[1] + i);
    try { k.fs.writeFile(path, data); R[0] = 0; } catch (e) { if (e instanceof FsError) { R[0] = FAIL; return; } throw e; }
  },
  8: (k, p, R) => { R[0] = R[0] > 0 ? (p.space.alloc(R[0], PERM.R | PERM.W) ?? 0) : 0; },
  9: (k, p, R) => { try { p.space.free(R[0], R[1]); R[0] = 0; } catch { R[0] = FAIL; } },
  10: (k, p, R) => { R[0] = Math.floor((k.clock() - k.bootTime) / 1000) & 0xffff; },
};

export function handleSyscall(kernel, proc, n, cpu) {
  const fn = SYSCALLS[n];
  if (!fn) throw new VoidFault('BAD_SYSCALL', `Unknown syscall ${n}`);
  fn(kernel, proc, cpu.regs.r);
}

// ---- JS syscalls: what desktop apps and the shell are allowed to do ----
const readApps = (k) => {
  try { const a = JSON.parse(k.fs.readText('/etc/apps.json')); return Array.isArray(a) ? a.filter((x) => x && typeof x.id === 'string' && typeof x.path === 'string') : []; } catch { return []; }
};

export const API = {
  'fs.list': (k, p) => k.fs.list(p),
  'fs.stat': (k, p) => k.fs.stat(p),
  'fs.exists': (k, p) => k.fs.exists(p),
  'fs.read': (k, p) => k.fs.readText(p),
  'fs.readBytes': (k, p) => k.fs.readFile(p),
  'fs.write': (k, p, d, o) => k.fs.writeFile(p, d, o),
  'fs.mkdir': (k, p, o) => k.fs.mkdir(p, o),
  'fs.remove': (k, p, o) => k.fs.remove(p, o),
  'fs.move': (k, a, b) => k.fs.move(a, b),
  'fs.rename': (k, a, b) => k.fs.rename(a, b),
  'fs.copy': (k, a, b, o) => k.fs.copy(a, b, o),
  'fs.usage': (k) => k.fs.usage(),
  'proc.list': (k) => k.list(),
  'proc.spawn': (k, path, o) => k.spawnFile(path, o),
  'proc.kill': (k, pid) => k.kill(pid),
  'proc.suspend': (k, pid) => k.suspend(pid),
  'proc.resume': (k, pid) => k.resume(pid),
  'proc.stdin': (k, pid, text) => k.stdin(pid, text),
  'sys.info': (k) => k.info(),
  'sys.uptime': (k) => k.uptime(),
  'sys.mem': (k) => k.memStats(),
  'sys.cpu': (k) => k.cpuUsage(),
  'sys.log': (k) => [...k.logBuf],
  'sys.config': (k) => ({ ...k.config }),
  'sys.setConfig': (k, patch) => {
    validatePatch(patch);
    if (patch.quotaKB !== undefined) k.fs.setQuota(patch.quotaKB * 1024);
    k.config = { ...k.config, ...patch };
    k.fs.writeFile('/etc/config.json', JSON.stringify(k.config, null, 2));
    k.events.emit('config:change', { patch, config: k.config });
    return { config: { ...k.config }, needsReboot: Object.keys(patch).some((x) => HARDWARE_KEYS.includes(x)) };
  },
  'sys.assemble': (k, src, out) => {
    const exe = packExecutable(assemble(k.fs.readText(src)));
    k.fs.writeFile(out, exe);
    return { size: exe.length };
  },
  'sys.power': (k, action) => {
    if (action !== 'shutdown' && action !== 'reboot') throw new KernelError('EINVAL', 'Power action must be shutdown or reboot');
    k.events.emit('power', action);
  },
  'backup.export': (k) => exportBackup(k.fs),
  'backup.import': (k, input) => importBackup(k.fs, input),
  'app.list': (k) => readApps(k),
  'app.install': (k, path, id, name) => {
    parseExecutable(k.fs.readFile(path)); // must be a valid executable
    id = id ?? base(path).replace(/\.vx$/, '');
    if (!/^[a-z0-9_-]{1,24}$/.test(id) || RESERVED_APPS.includes(id)) throw new KernelError('EINVAL', `Invalid or reserved app id "${id}"`);
    const apps = readApps(k);
    if (apps.some((a) => a.id === id)) throw new KernelError('EEXIST', `App "${id}" is already installed`);
    if (!k.fs.exists('/apps')) k.fs.mkdir('/apps');
    k.fs.copy(path, `/apps/${id}.vx`);
    apps.push({ id, name: name ?? id, path: `/apps/${id}.vx` });
    k.fs.writeFile('/etc/apps.json', JSON.stringify(apps, null, 2));
    k.events.emit('apps:change', apps);
    return { id };
  },
  'app.uninstall': (k, id) => {
    const apps = readApps(k);
    const app = apps.find((a) => a.id === id);
    if (!app) throw new KernelError('ENOENT', `App "${id}" is not installed`);
    if (k.fs.exists(app.path)) k.fs.remove(app.path);
    const rest = apps.filter((a) => a.id !== id);
    k.fs.writeFile('/etc/apps.json', JSON.stringify(rest, null, 2));
    k.events.emit('apps:change', rest);
  },
};
