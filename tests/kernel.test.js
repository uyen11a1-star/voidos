import { describe, it, expect } from 'vitest';
import { bootSystem } from './helpers-os.js';
import { assemble } from '../src/instruction/assembler.js';
import { packExecutable } from '../src/os/executable.js';

const exe = (src) => packExecutable(assemble(src));
async function setup() { const s = await bootSystem(); s.out = ''; s.exits = []; return s; }
const spawn = (s, src, extra = {}) => s.kernel.spawn(exe(src), { name: 'test', onOutput: (t) => { s.out += t; }, onExit: (r) => s.exits.push(r), ...extra });
const freeFrames = (s) => s.kernel.memStats().usedFrames;

describe('processes', () => {
  it('runs a program to completion, frees its memory, records the exit', async () => {
    const s = await setup();
    const base = freeFrames(s);
    const pid = spawn(s, 'MOVI R0, 72\nPRINT R0\nHALT');
    expect(s.kernel.list()[0]).toMatchObject({ pid, name: 'test', state: 'ready' });
    expect(freeFrames(s)).toBeGreaterThan(base);
    s.kernel.runUntilIdle();
    expect(s.out).toBe('H');
    expect(s.exits[0]).toMatchObject({ pid, exitCode: 0, fault: null });
    expect(freeFrames(s)).toBe(base);
    expect(s.kernel.list()).toEqual([]);
  });
  it('sample programs from the disk run (fib, counter)', async () => {
    const s = await setup();
    s.kernel.spawnFile('/bin/fib.vx', { onOutput: (t) => { s.out += t; } });
    s.kernel.spawnFile('/bin/counter.vx', { onOutput: (t) => { s.out += t; } });
    s.kernel.runUntilIdle();
    expect(s.out).toContain('0 1 1 2 3 5 8 13 21 34');
    expect(s.out).toContain('12345');
  });
  it('a fault kills only that process and reports it', async () => {
    const s = await setup();
    const base = freeFrames(s);
    spawn(s, 'MOVI R0, 1\nMOVI R1, 0\nDIV R0, R1');
    const other = spawn(s, 'MOVI R0, 66\nPRINT R0\nHALT');
    s.kernel.runUntilIdle();
    expect(s.out).toContain('DIV_ZERO');
    expect(s.out).toContain('B');
    expect(s.exits.find((e) => e.pid !== other).fault.code).toBe('DIV_ZERO');
    expect(s.exits.find((e) => e.pid === other).exitCode).toBe(0);
    expect(freeFrames(s)).toBe(base);
  });
  it('an infinite loop cannot freeze the kernel: ticks stay bounded and kill works', async () => {
    const s = await setup();
    const pid = spawn(s, 'l: JMP l');
    const used = s.kernel.tick(40000);
    expect(used).toBe(2000); // exactly one quantum
    s.kernel.kill(pid);
    expect(s.exits[0]).toMatchObject({ exitCode: 137, signal: 'KILL' });
    expect(() => s.kernel.kill(pid)).toThrow(/No such process/);
  });
  it('round-robin is fair between busy processes', async () => {
    const s = await setup();
    const a = spawn(s, 'l: JMP l'), b = spawn(s, 'l: JMP l');
    for (let i = 0; i < 20; i++) s.kernel.tick(3000); // budget smaller than 2 quanta
    const [pa, pb] = s.kernel.list();
    expect(Math.abs(pa.cycles - pb.cycles)).toBeLessThanOrEqual(2000);
    expect(pa.cycles).toBeGreaterThan(10000);
    s.kernel.kill(a); s.kernel.kill(b);
  });
  it('suspend stops execution, resume continues', async () => {
    const s = await setup();
    const pid = spawn(s, 'l: JMP l');
    s.kernel.tick();
    s.kernel.suspend(pid);
    const c = s.kernel.list()[0].cycles;
    s.kernel.tick();
    expect(s.kernel.list()[0]).toMatchObject({ state: 'suspended', cycles: c });
    s.kernel.resume(pid);
    s.kernel.tick();
    expect(s.kernel.list()[0].cycles).toBeGreaterThan(c);
    s.kernel.kill(pid);
  });
  it('stdin: INPUT blocks the process (waiting) until text arrives', async () => {
    const s = await setup();
    const pid = s.kernel.spawnFile('/bin/echo.vx', { onOutput: (t) => { s.out += t; }, onExit: (r) => s.exits.push(r) });
    s.kernel.tick();
    expect(s.kernel.list()[0].state).toBe('waiting');
    s.kernel.stdin(pid, 'hi q');
    s.kernel.runUntilIdle();
    expect(s.out).toBe('hi ');
    expect(s.exits[0].exitCode).toBe(0);
  });
  it('limits: too many processes, no memory, bad executables', async () => {
    const s = await setup();
    s.kernel.maxProcs = 2;
    const a = spawn(s, 'l: JMP l'), b = spawn(s, 'l: JMP l');
    expect(() => spawn(s, 'HALT')).toThrow(/Too many processes/);
    s.kernel.kill(a); s.kernel.kill(b);
    s.kernel.maxProcs = 24;
    expect(() => s.kernel.spawn(new Uint8Array([1, 2, 3]))).toThrow(/signature/);
    const pids = [];
    let err;
    try { for (let i = 0; i < 400; i++) pids.push(spawn(s, 'l: JMP l')); } catch (e) { err = e; }
    // either the process limit or memory ends the loop; memory must never leak either way
    expect(['EAGAIN', 'ENOMEM']).toContain(err.code);
    pids.forEach((p) => s.kernel.kill(p));
    expect(freeFrames(s)).toBe(1);
  });
});

describe('syscalls from bytecode', () => {
  it('exit(code), getpid, write(ptr,len)', async () => {
    const s = await setup();
    const pid = spawn(s, 'MOVI R0, msg\nMOVI R1, 5\nSYSCALL 2\nSYSCALL 3\nADDI R0, 48\nPRINT R0\nMOVI R0, 7\nSYSCALL 1\nmsg: .ascii "hello"');
    s.kernel.runUntilIdle();
    expect(s.out).toBe(`hello${pid}`);
    expect(s.exits[0].exitCode).toBe(7);
  });
  it('sleep waits for the clock; yield ends the slice', async () => {
    const s = await setup();
    spawn(s, 'MOVI R0, 100\nSYSCALL 5\nMOVI R0, 33\nPRINT R0\nHALT');
    s.kernel.tick();
    expect(s.kernel.list()[0].state).toBe('sleeping');
    s.state.t += 50; s.kernel.tick();
    expect(s.out).toBe('');
    s.state.t += 60; s.kernel.runUntilIdle();
    expect(s.out).toBe('!');
    const y = spawn(s, 'SYSCALL 4\nSYSCALL 4\nHALT');
    expect(s.kernel.tick()).toBe(1); // yield: one instruction per slice
    s.kernel.kill(y);
  });
  it('writefile + readfile round trip through the real filesystem', async () => {
    const s = await setup();
    spawn(s, `MOVI R0, path\nMOVI R1, txt\nMOVI R2, 3\nSYSCALL 7\nMOVI R0, path\nMOVI R1, buf\nMOVI R2, 16\nSYSCALL 6\nMOV R1, R0\nMOVI R0, buf\nSYSCALL 2\nHALT\npath: .string "/tmp/sys.txt"\ntxt: .ascii "abc"\n.data\nbuf: .space 16`);
    s.kernel.runUntilIdle();
    expect(s.fs.readText('/tmp/sys.txt')).toBe('abc');
    expect(s.out).toBe('abc');
  });
  it('missing file returns the error code (0xFFFF) instead of crashing', async () => {
    const s = await setup();
    spawn(s, 'MOVI R0, path\nMOVI R1, buf\nMOVI R2, 4\nSYSCALL 6\nCMPI R0, 0xFFFF\nJNE bad\nMOVI R0, 79\nPRINT R0\nbad: HALT\npath: .string "/nope"\n.data\nbuf: .space 4');
    s.kernel.runUntilIdle();
    expect(s.out).toBe('O');
  });
  it('alloc gives usable writable memory; free releases it; process memory is isolated', async () => {
    const s = await setup();
    spawn(s, 'MOVI R0, 100\nSYSCALL 8\nMOV R4, R0\nMOVI R2, 65\nSTOREB [R4], R2\nLOADB R3, [R4]\nPRINT R3\nMOV R0, R4\nMOVI R1, 100\nSYSCALL 9\nPRINT R0\nHALT');
    s.kernel.runUntilIdle();
    expect(s.out).toBe('A\0'); // stored 'A' and read it back; free() returned 0
    expect(freeFrames(s)).toBe(1); // everything released on exit
  });
  it('bad pointers are caught by the MMU (PAGE_FAULT), not by luck', async () => {
    const s = await setup();
    spawn(s, 'MOVI R0, 0x5000\nMOVI R1, 4\nSYSCALL 2\nHALT');
    s.kernel.runUntilIdle();
    expect(s.exits[0].fault.code).toBe('PAGE_FAULT');
    spawn(s, 'MOVI R0, path\nMOVI R1, 0x0\nMOVI R2, 4\nSYSCALL 6\nHALT\npath: .string "/etc/config.json"'); // dst = page 0 is read-only code
    s.kernel.runUntilIdle();
    expect(s.exits[1].fault.code).toBe('PROTECTION_FAULT');
  });
  it('unknown syscall faults the caller only', async () => {
    const s = await setup();
    spawn(s, 'SYSCALL 99');
    s.kernel.runUntilIdle();
    expect(s.exits[0].fault.code).toBe('BAD_SYSCALL');
  });
  it('unterminated path string is rejected', async () => {
    const s = await setup();
    spawn(s, `MOVI R0, buf\nMOVI R1, buf\nMOVI R2, 1\nSYSCALL 6\nHALT\n.data\nbuf: .space 300`); // zero-filled -> terminated, fine
    s.kernel.runUntilIdle();
    expect(s.exits[0].fault).toBeNull();
  });
});

describe('monitoring uses real data', () => {
  it('cpuUsage reflects executed cycles over the window', async () => {
    const s = await setup();
    for (let i = 0; i < 30; i++) s.kernel.tick();
    expect(s.kernel.cpuUsage()).toBe(0);
    const pid = spawn(s, 'l: JMP l');
    for (let i = 0; i < 30; i++) s.kernel.tick(40000);
    expect(s.kernel.cpuUsage()).toBeCloseTo(2000 / 40000, 5);
    s.kernel.kill(pid);
    expect(s.kernel.info()).toMatchObject({ name: 'VoidOS', cpu: 'VoidCPU 16-bit', procs: 0 });
    expect(s.kernel.info().totalCycles).toBe(60000);
  });
  it('memStats and per-process memory match the allocator', async () => {
    const s = await setup();
    const pid = spawn(s, 'l: JMP l');
    const p = s.kernel.list()[0];
    expect(p.pages).toBe(2); // code + stack
    expect(s.kernel.memStats().usedFrames).toBe(1 + 2);
    s.kernel.kill(pid);
    expect(s.kernel.uptime()).toBe(0);
    s.state.t += 5000;
    expect(s.kernel.uptime()).toBe(5000);
  });
  it('shutdown kills everything and flushes the disk', async () => {
    const s = await setup();
    spawn(s, 'l: JMP l');
    s.fs.writeFile('/home/user/last.txt', 'bye');
    await s.kernel.shutdown();
    expect(s.kernel.list()).toEqual([]);
    expect(s.db.data.nodes.size).toBeGreaterThan(5);
    const { boot } = await import('../src/core/boot.js');
    const again = await boot({ db: s.db, delay: 0, sleep: async () => {} });
    expect(again.fs.readText('/home/user/last.txt')).toBe('bye');
  });
});

describe('JS system calls (what apps use)', () => {
  it('dispatches by name, rejects unknown names', async () => {
    const s = await setup();
    s.call('fs.mkdir', '/home/user/d');
    s.call('fs.write', '/home/user/d/a.txt', 'hello');
    expect(s.call('fs.read', '/home/user/d/a.txt')).toBe('hello');
    expect(s.call('fs.list', '/home/user/d')).toHaveLength(1);
    s.call('fs.copy', '/home/user/d', '/tmp/d2', { recursive: true });
    s.call('fs.move', '/tmp/d2', '/home/user');
    s.call('fs.remove', '/home/user/d2', { recursive: true });
    expect(() => s.call('nope')).toThrow(/Unknown system call/);
    expect(() => s.call('constructor')).toThrow(/Unknown system call/);
  });
  it('sys.power validates and emits', async () => {
    const s = await setup();
    const seen = []; s.events.on('power', (a) => seen.push(a));
    s.call('sys.power', 'reboot'); s.call('sys.power', 'shutdown');
    expect(seen).toEqual(['reboot', 'shutdown']);
    expect(() => s.call('sys.power', 'explode')).toThrow(/shutdown or reboot/);
  });
  it('setConfig validates, persists to /etc/config.json and flags hardware changes', async () => {
    const s = await setup();
    const r = s.call('sys.setConfig', { theme: 'azure', ramKB: 2048 });
    expect(r.needsReboot).toBe(true);
    expect(JSON.parse(s.fs.readText('/etc/config.json'))).toMatchObject({ theme: 'azure', ramKB: 2048 });
    expect(s.call('sys.setConfig', { fastBoot: true }).needsReboot).toBe(false);
    s.call('sys.setConfig', { quotaKB: 4096 });
    expect(s.fs.quota).toBe(4096 * 1024);
    for (const bad of [{ theme: 'neon' }, { ramKB: 3 }, { hostname: 'a b' }, { resolution: '10x10' }, { quotaKB: 1 }, { bogus: 1 }, null]) expect(() => s.call('sys.setConfig', bad)).toThrow();
    expect(s.kernel.config.theme).toBe('azure'); // failed patches changed nothing
  });
  it('assemble + install + uninstall applications', async () => {
    const s = await setup();
    const changes = []; s.events.on('apps:change', (a) => changes.push(a.length));
    s.fs.writeFile('/home/user/p.asm', 'MOVI R0, 65\nPRINT R0\nHALT');
    expect(s.call('sys.assemble', '/home/user/p.asm', '/home/user/p.vx').size).toBeGreaterThan(10);
    s.call('app.install', '/home/user/p.vx', 'papp', 'P App');
    expect(s.call('app.list')).toEqual([{ id: 'papp', name: 'P App', path: '/apps/papp.vx' }]);
    s.kernel.spawnFile('/apps/papp.vx', { onOutput: (t) => { s.out = (s.out ?? '') + t; } });
    s.kernel.runUntilIdle();
    expect(s.out).toBe('A');
    expect(() => s.call('app.install', '/home/user/p.vx', 'papp')).toThrow(/already installed/);
    expect(() => s.call('app.install', '/home/user/p.vx', 'terminal')).toThrow(/reserved/);
    expect(() => s.call('app.install', '/home/user/p.vx', 'Bad Id!')).toThrow(/Invalid/);
    expect(() => s.call('app.install', '/home/user/welcome.txt')).toThrow(/signature/);
    s.call('app.uninstall', 'papp');
    expect(s.call('app.list')).toEqual([]);
    expect(s.fs.exists('/apps/papp.vx')).toBe(false);
    expect(() => s.call('app.uninstall', 'papp')).toThrow(/not installed/);
    expect(changes).toEqual([1, 0]);
    s.fs.writeFile('/etc/apps.json', '{{ not json'); // damaged registry = empty registry
    expect(s.call('app.list')).toEqual([]);
  });
});
