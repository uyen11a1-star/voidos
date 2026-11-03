import { STATE } from './hardware/cpu.js';
import { PERM } from './hardware/mmu.js';
import { hexdump } from './hardware/memory-inspector.js';
import { clampRamSize } from './hardware/ram.js';
import { createMachine, spawn } from './core/machine.js';
import { encode } from './instruction/instruction-set.js';
import { buildDemo, DEMO_TEXT_ADDR } from './core/demo-program.js';

const CYCLES_PER_SLICE = 20000; // execution-speed limit per timer tick (keeps the UI responsive)

const $ = (id) => document.getElementById(id);
const screen = $('screen');
const status = $('status');
const memstat = $('memstat');
const memdump = $('memdump');

const machine = createMachine({ ramSize: clampRamSize(1024 * 1024), reservedFrames: 1 });
let proc = null;
let timer = null;

function stop() {
  clearTimeout(timer);
  timer = null;
}

// Free the previous process's frames so repeated runs never leak memory.
function teardown() {
  stop();
  if (proc) proc.space.destroy();
  proc = null;
}

function refresh(extra = '') {
  const { cpu, mmu, space } = proc;
  status.textContent = `state: ${cpu.state} | cycles: ${cpu.cycles} | PC: 0x${cpu.regs.pc.toString(16)}` + extra;
  const s = machine.allocator.stats();
  memstat.textContent = `RAM: ${s.usedFrames}/${s.totalFrames} frames dùng (${s.usedBytes / 1024} KB / ${s.totalBytes / 1024} KB) | process: ${space.usage().pages} trang`;
  memdump.textContent = hexdump(mmu, 0x100, 48);
}

function run(segments) {
  teardown();
  screen.textContent = '';
  proc = spawn(machine, { segments, io: { print: (c) => { screen.textContent += String.fromCharCode(c); } } });
  const tick = () => {
    proc.cpu.run(CYCLES_PER_SLICE);
    const f = proc.cpu.fault;
    refresh(f ? ` | ${f.code}: ${f.message}` : '');
    if (proc.cpu.state === STATE.RUNNING) timer = setTimeout(tick, 0);
    else stop();
  };
  tick();
}

function runDemo() {
  const { code, text } = buildDemo();
  run([
    { addr: 0, bytes: code, perms: PERM.R | PERM.X },
    { addr: DEMO_TEXT_ADDR, bytes: text, perms: PERM.R },
  ]);
}

// A program that tries to overwrite its own (read-only) code page.
function runProtectionTest() {
  const bytes = [['MOVI', 0, 0, 1], ['STORE', 0, 0, 0x40], ['HALT']].flatMap((i) => encode(...i));
  run([{ addr: 0, bytes, perms: PERM.R | PERM.X }]);
  screen.textContent += 'Chương trình ghi vào trang code (chỉ đọc/thực thi)…\n';
}

$('run').addEventListener('click', runDemo);
$('prot').addEventListener('click', runProtectionTest);
$('stop').addEventListener('click', stop);
runDemo();
