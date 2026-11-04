import { STATE } from '../hardware/cpu.js';
import { hexdump } from '../hardware/memory-inspector.js';
import { clampRamSize } from '../hardware/ram.js';
import { createMachine, spawnImage } from '../core/machine.js';
import { assemble, AssemblyError } from '../instruction/assembler.js';
import helloSrc from '../../examples/hello.asm?raw';
import fibSrc from '../../examples/fib.asm?raw';
import counterSrc from '../../examples/counter.asm?raw';

const EXAMPLES = { hello: helloSrc, fib: fibSrc, counter: counterSrc };
const CYCLES_PER_SLICE = 20000; // execution-speed limit per timer tick (keeps the UI responsive)
const PROTECTION_TEST = 'MOVI R0, 1\nSTORE [0x40], R0   ; writes into the read-only code page\nHALT\n';

const $ = (id) => document.getElementById(id);
const src = $('src');
const screen = $('screen');
const status = $('status');
const memstat = $('memstat');
const memdump = $('memdump');
const listing = $('listing');

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

function refresh() {
  const { cpu, mmu, space } = proc;
  const f = cpu.fault;
  status.textContent = `state: ${cpu.state} | cycles: ${cpu.cycles} | PC: 0x${cpu.regs.pc.toString(16)}` + (f ? ` | ${f.code}: ${f.message}` : '');
  const s = machine.allocator.stats();
  memstat.textContent = `RAM: ${s.usedFrames}/${s.totalFrames} frames (${s.usedBytes / 1024}/${s.totalBytes / 1024} KB) | process: ${space.usage().pages} trang`;
  memdump.textContent = hexdump(mmu, 0, 64, 8);
}

const hex = (n, w) => n.toString(16).padStart(w, '0');
function showListing(program) {
  listing.textContent = program.listing
    .map((l) => `${String(l.line).padStart(3)}  ${hex(l.addr, 4)}  ${l.bytes.map((b) => hex(b, 2)).join(' ')}${l.size > l.bytes.length ? '…' : ''}\n         ${l.source}`)
    .join('\n');
}

function runSource(text) {
  teardown();
  screen.textContent = '';
  listing.textContent = '';
  let program;
  try {
    program = assemble(text);
  } catch (e) {
    if (!(e instanceof AssemblyError)) throw e;
    screen.textContent = e.errors.map((x) => `dòng ${x.line}: ${x.message}`).join('\n');
    status.textContent = `Lỗi assembler (${e.errors.length})`;
    return;
  }
  showListing(program);
  const decoder = new TextDecoder(); // program output is a UTF-8 byte stream
  try {
    proc = spawnImage(machine, program, {
      io: { print: (c) => { screen.textContent += decoder.decode(Uint8Array.of(c), { stream: true }); } },
    });
  } catch (e) {
    screen.textContent = `Không chạy được: ${e.message}`;
    return;
  }
  const tick = () => {
    proc.cpu.run(CYCLES_PER_SLICE);
    refresh();
    if (proc.cpu.state === STATE.RUNNING) timer = setTimeout(tick, 0);
    else stop();
  };
  tick();
}

function loadExample() {
  src.value = EXAMPLES[$('example').value];
}

$('example').addEventListener('change', () => { loadExample(); runSource(src.value); });
$('run').addEventListener('click', () => runSource(src.value));
$('prot').addEventListener('click', () => { src.value = PROTECTION_TEST; runSource(src.value); });
$('stop').addEventListener('click', stop);
loadExample();
runSource(src.value);
