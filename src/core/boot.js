import { EventBus } from './event-bus.js';
import { VoidFault } from './errors.js';
import { DEFAULT_CONFIG, sanitizeConfig } from './config.js';
import { createMachine, spawnImage } from './machine.js';
import { clampRamSize, PAGE_SIZE } from '../hardware/ram.js';
import { assemble } from '../instruction/assembler.js';
import { FileSystem, FsError } from '../os/filesystem.js';
import { packExecutable, parseExecutable } from '../os/executable.js';
import { cstr } from '../os/system-calls.js';
import { Kernel } from '../os/kernel.js';
import bootloaderSrc from '../os/bootloader.asm?raw';
import helloSrc from '../../examples/hello.asm?raw';
import fibSrc from '../../examples/fib.asm?raw';
import counterSrc from '../../examples/counter.asm?raw';
import echoSrc from '../../examples/echo.asm?raw';

export const SYSTEM_VERSION = '0.2.0';
const SAMPLES = { hello: helloSrc, fib: fibSrc, counter: counterSrc, echo: echoSrc };
const KERNEL_MAGIC = [0x56, 0x4b, 0x52, 0x4e]; // "VKRN"
const FAIL = 0xffff;

export class BootError extends Error {
  constructor(message) { super(message); this.name = 'BootError'; }
}

export function makeKernelImage(info) {
  const json = new TextEncoder().encode(JSON.stringify(info));
  const out = new Uint8Array(5 + json.length);
  out.set([...KERNEL_MAGIC, 1]);
  out.set(json, 5);
  return out;
}

export function parseKernelImage(bytes) {
  if (bytes.length < 6 || KERNEL_MAGIC.some((b, i) => bytes[i] !== b) || bytes[4] !== 1) throw new BootError('Kernel panic: unsupported kernel image');
  let info;
  try { info = JSON.parse(new TextDecoder().decode(bytes.subarray(5))); } catch { throw new BootError('Kernel panic: corrupt kernel image'); }
  if (!info || typeof info.name !== 'string') throw new BootError('Kernel panic: corrupt kernel image');
  const int = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);
  return { name: info.name.slice(0, 32), version: String(info.version ?? SYSTEM_VERSION).slice(0, 16), quantum: int(info.quantum, 100, 20000, 2000), maxProcs: int(info.maxProcs, 1, 64, 24) };
}

const WELCOME = `Chào mừng đến với VoidOS ${SYSTEM_VERSION}!

Đây là máy tính ảo tự xây từ đầu: CPU 16 bit, RAM có bảo vệ trang, ổ đĩa lưu bằng IndexedDB.
Thử trong Terminal:
  ls /bin            xem chương trình có sẵn
  run /bin/fib.vx    chạy chương trình bytecode
  asm hello.asm h.vx tự biên dịch file Assembly
  run h.vx
`;

// Writes missing system files only, so it is safe to run on a partly damaged disk.
export function installSystem(fs) {
  for (const d of ['/boot', '/bin', '/etc', '/home/user', '/tmp', '/apps']) if (!fs.exists(d)) fs.mkdir(d, { recursive: true });
  const put = (p, data) => { if (!fs.exists(p)) fs.writeFile(p, data); };
  put('/boot/loader.bin', packExecutable(assemble(bootloaderSrc)));
  put('/boot/kernel.vx', makeKernelImage({ name: 'VoidOS', version: SYSTEM_VERSION, quantum: 2000, maxProcs: 24 }));
  put('/etc/config.json', JSON.stringify(DEFAULT_CONFIG, null, 2));
  put('/etc/apps.json', '[]');
  put('/home/user/welcome.txt', WELCOME);
  for (const [name, src] of Object.entries(SAMPLES)) {
    put(`/home/user/${name}.asm`, src);
    put(`/bin/${name}.vx`, packExecutable(assemble(src)));
  }
}

function readConfig(fs) {
  try { return sanitizeConfig(JSON.parse(fs.readText('/etc/config.json'))); } catch { return sanitizeConfig(null); }
}

function memoryTest(ram) {
  const n = Math.min(ram.size, 65536);
  for (const pat of [0x55, 0xaa, 0x00]) {
    ram.bytes.fill(pat, 0, n);
    for (let i = 0; i < n; i++) if (ram.bytes[i] !== pat) throw new BootError(`Memory test failed at 0x${i.toString(16)}`);
  }
}

// BIOS: POST -> hardware detection -> boot device -> run the bootloader on the VoidCPU -> start the kernel.
export async function boot({ db, events = new EventBus(), clock = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), delay = 90 }) {
  const log = (text, level = 'ok') => events.emit('boot:log', { text, level });
  let fast = false;
  const pause = () => (fast || !delay ? Promise.resolve() : sleep(delay));
  try {
    log('VoidBIOS 1.0 - power on self test');
    await pause();
    const fs = new FileSystem(db, { autoFlushMs: 800 });
    await fs.mount();
    log(`Storage: disk0 ${db.persistent ? 'ready (persistent)' : 'ready (VOLATILE - IndexedDB unavailable, data is lost on reload)'}`, db.persistent ? 'ok' : 'warn');
    if (fs.repairs.length) log(`Disk check: repaired ${fs.repairs.length} problem(s); recovered files are in /lost+found`, 'warn');
    let config = readConfig(fs);
    fast = config.fastBoot;
    await pause();
    const machine = createMachine({ ramSize: clampRamSize(config.ramKB * 1024), reservedFrames: 1 });
    memoryTest(machine.ram);
    machine.ram.clear();
    log(`Memory test: ${machine.ram.size / 1024} KB OK`);
    await pause();
    log(`CPU: VoidCPU 16-bit, 8 registers, ${PAGE_SIZE}-byte pages`);
    log(`Display: ${config.resolution} framebuffer`);
    log(`Disk: ${(fs.quota / 1024).toFixed(0)} KB quota, ${(fs.usage().used / 1024).toFixed(1)} KB used`);
    await pause();

    const missing = ['/boot/loader.bin', '/boot/kernel.vx'].filter((p) => !fs.exists(p));
    if (missing.length) {
      log(`No bootable system on disk0 (missing ${missing.join(', ')})`, 'warn');
      log('Recovery installer: writing system files');
      installSystem(fs);
      await fs.flush();
      config = readConfig(fs);
      await pause();
    }
    log('Boot device: disk0 -> /boot/loader.bin');
    await pause();

    let program;
    try { program = parseExecutable(fs.readFile('/boot/loader.bin')); } catch (e) { throw new BootError(`Bootloader is damaged: ${e.message}`); }
    let line = '', lastLine = '', loaded = null, handoff = null, proc = null;
    const dec = new TextDecoder();
    const onChar = (c) => {
      for (const ch of dec.decode(Uint8Array.of(c), { stream: true })) {
        if (ch !== '\n') { line += ch; continue; }
        if (line) { lastLine = line; log(`[bootloader] ${line}`); }
        line = '';
      }
    };
    proc = spawnImage(machine, program, {
      io: { print: onChar },
      syscall: (n, cpu) => {
        const R = cpu.regs.r;
        if (n === 1) { // BIOS: read a file into memory
          let bytes;
          try { bytes = fs.readFile(cstr(proc.mmu, R[0])); } catch (e) { if (e instanceof FsError) { R[0] = FAIL; return; } throw e; }
          const len = Math.min(bytes.length, R[2]);
          proc.space.poke(R[1], bytes.subarray(0, len));
          loaded = R[1];
          R[0] = len;
        } else if (n === 2) { // BIOS: take the kernel image the bootloader loaded
          if (loaded === null || R[0] > 512) throw new VoidFault('BAD_HANDOFF', 'No kernel image was loaded');
          handoff = proc.space.peek(loaded, R[0]);
        } else throw new VoidFault('BAD_SYSCALL', `Unknown BIOS call ${n}`);
      },
    });
    proc.cpu.run(200000);
    if (line) { lastLine = line; log(`[bootloader] ${line}`); }
    const { state, fault, cycles } = proc.cpu;
    proc.space.destroy();
    if (state === 'fault') throw new BootError(`Bootloader crashed: ${fault.code} (${fault.message})`);
    if (state !== 'halted') throw new BootError('Bootloader did not finish');
    if (!handoff) throw new BootError(`Bootloader stopped: ${lastLine || 'no kernel handed over'}`);
    log(`Bootloader done (${cycles} CPU cycles)`);
    await pause();

    const image = parseKernelImage(handoff);
    const kernel = new Kernel({ machine, fs, clock, events, config, image });
    log(`Kernel: ${image.name} ${image.version}, ${machine.allocator.stats().totalFrames} page frames, round-robin scheduler`);
    log('Root filesystem mounted');
    await pause();
    log('Starting desktop');
    events.emit('boot:done', { kernel });
    return { kernel, fs, machine, config };
  } catch (e) {
    if (e instanceof BootError) { log(e.message, 'error'); events.emit('boot:fail', e); }
    throw e;
  }
}
