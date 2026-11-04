import { describe, it, expect } from 'vitest';
import { bootSystem } from './helpers-os.js';
import { MemoryDatabase } from '../src/storage/database.js';
import { FileSystem } from '../src/os/filesystem.js';
import { makeKernelImage, parseKernelImage, BootError, SYSTEM_VERSION } from '../src/core/boot.js';
import { Computer } from '../src/core/computer.js';

const text = (logs) => logs.map((l) => l.text).join('\n');

describe('first boot', () => {
  it('goes through every stage, installs the system and runs the bootloader on the CPU', async () => {
    const s = await bootSystem();
    const t = text(s.logs);
    for (const stage of ['VoidBIOS', 'Memory test: 1024 KB OK', 'CPU: VoidCPU', 'Display:', 'No bootable system', 'Recovery installer', 'Boot device', '[bootloader] VoidBoot 1.0', '[bootloader] Kernel image verified', 'Bootloader done', 'Kernel: VoidOS', 'Root filesystem mounted', 'Starting desktop']) {
      expect(t).toContain(stage);
    }
    expect(+/\((\d+) CPU cycles\)/.exec(t)[1]).toBeGreaterThan(100); // real instructions were executed
    expect(s.logs.every((l) => l.level !== 'error')).toBe(true);
    expect(s.fs.exists('/boot/kernel.vx')).toBe(true);
    expect(s.fs.exists('/bin/fib.vx')).toBe(true);
    expect(s.kernel.version).toBe(SYSTEM_VERSION);
    expect(s.machine.allocator.stats().usedFrames).toBe(1); // bootloader memory was released
  });
  it('second boot does not reinstall and keeps user data', async () => {
    const db = new MemoryDatabase();
    const a = await bootSystem({ db });
    a.fs.writeFile('/home/user/mine.txt', 'giữ lại');
    await a.fs.flush();
    const b = await bootSystem({ db });
    expect(text(b.logs)).not.toContain('Recovery installer');
    expect(b.fs.readText('/home/user/mine.txt')).toBe('giữ lại');
  });
  it('boots with config from disk (RAM size, fast boot)', async () => {
    const s = await bootSystem({ config: { ramKB: 2048, fastBoot: true } });
    expect(s.machine.ram.size).toBe(2048 * 1024);
    expect(text(s.logs)).toContain('Memory test: 2048 KB OK');
  });
  it('a damaged config falls back to defaults instead of blocking boot', async () => {
    const db = new MemoryDatabase();
    const a = await bootSystem({ db });
    a.fs.writeFile('/etc/config.json', '{ broken json');
    await a.fs.flush();
    expect((await bootSystem({ db })).config.ramKB).toBe(1024);
  });
  it('a missing kernel is restored by the recovery installer', async () => {
    const db = new MemoryDatabase();
    const a = await bootSystem({ db });
    a.fs.remove('/boot/kernel.vx'); await a.fs.flush();
    const b = await bootSystem({ db });
    expect(text(b.logs)).toContain('missing /boot/kernel.vx');
    expect(b.fs.exists('/boot/kernel.vx')).toBe(true);
  });
});

describe('boot failures are reported, not hidden', () => {
  const corrupt = async (path, mutate) => {
    const db = new MemoryDatabase();
    const a = await bootSystem({ db });
    a.fs.writeFile(path, mutate(a.fs.readFile(path))); await a.fs.flush();
    return db;
  };
  it('bad kernel signature: the bootloader (running on the CPU) refuses it', async () => {
    const db = await corrupt('/boot/kernel.vx', (b) => { b[0] = 0x58; return b; });
    const events = [];
    await expect(bootSystem({ db })).rejects.toThrow(/Bootloader stopped: boot: bad kernel signature/);
  });
  it('corrupt kernel image payload -> kernel panic', async () => {
    const bad = new Uint8Array([0x56, 0x4b, 0x52, 0x4e, 1, 0x7b, 0x7b]);
    const db = await corrupt('/boot/kernel.vx', () => bad);
    await expect(bootSystem({ db })).rejects.toThrow(/Kernel panic: corrupt kernel image/);
  });
  it('damaged bootloader is detected', async () => {
    const db = await corrupt('/boot/loader.bin', (b) => b.slice(0, 20));
    await expect(bootSystem({ db })).rejects.toThrow(/Bootloader is damaged/);
  });
  it('error is logged with level=error and boot:fail is emitted', async () => {
    const db = await corrupt('/boot/loader.bin', (b) => b.slice(0, 20));
    const { boot } = await import('../src/core/boot.js');
    const { EventBus } = await import('../src/core/event-bus.js');
    const events = new EventBus(); const seen = []; let failed = null;
    events.on('boot:log', (l) => seen.push(l)); events.on('boot:fail', (e) => { failed = e; });
    await expect(boot({ db, events, delay: 0 })).rejects.toBeInstanceOf(BootError);
    expect(seen.at(-1).level).toBe('error');
    expect(failed).toBeInstanceOf(BootError);
  });
  it('kernel image parser validates and sanitizes', () => {
    expect(parseKernelImage(makeKernelImage({ name: 'X', quantum: 5, maxProcs: 999 }))).toMatchObject({ name: 'X', quantum: 2000, maxProcs: 24 });
    expect(() => parseKernelImage(new Uint8Array(3))).toThrow(BootError);
    expect(() => parseKernelImage(makeKernelImage({ nope: 1 }))).toThrow(/corrupt/);
  });
});

describe('Computer power states', () => {
  it('off -> on -> off, data flushed on shutdown, can boot again', async () => {
    const db = new MemoryDatabase();
    const c = new Computer({ db, delay: 0, sleep: async () => {} });
    expect(c.state).toBe('off');
    const k = await c.powerOn();
    expect(c.state).toBe('on');
    await expect(c.powerOn()).rejects.toThrow();
    k.fs.writeFile('/home/user/saved.txt', 'x');
    await c.powerOff();
    expect(c.state).toBe('off');
    const again = new Computer({ db, delay: 0, sleep: async () => {} });
    const k2 = await again.powerOn();
    expect(k2.fs.readText('/home/user/saved.txt')).toBe('x');
  });
  it('a failed boot leaves the computer off', async () => {
    const db = new MemoryDatabase();
    const a = await bootSystem({ db });
    a.fs.writeFile('/boot/loader.bin', 'junk'); await a.fs.flush();
    const c = new Computer({ db, delay: 0, sleep: async () => {} });
    await expect(c.powerOn()).rejects.toThrow(BootError);
    expect(c.state).toBe('off');
  });
});
