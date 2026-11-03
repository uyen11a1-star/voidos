import { RAM } from './hardware/ram.js';
import { CPU, STATE } from './hardware/cpu.js';
import { buildDemo, DEMO_TEXT_ADDR } from './core/demo-program.js';

const CYCLES_PER_SLICE = 20000; // execution-speed limit per timer tick (keeps the UI responsive)

const screen = document.getElementById('screen');
const status = document.getElementById('status');
const runBtn = document.getElementById('run');
const stopBtn = document.getElementById('stop');
let timer = null;

function start() {
  stop();
  screen.textContent = '';
  const ram = new RAM(65536);
  const { code, text } = buildDemo();
  ram.load(0, code);
  ram.load(DEMO_TEXT_ADDR, text);
  const cpu = new CPU(ram, { io: { print: (c) => { screen.textContent += String.fromCharCode(c); } } });
  cpu.reset(0);
  const tick = () => {
    cpu.run(CYCLES_PER_SLICE);
    status.textContent = `state: ${cpu.state} | cycles: ${cpu.cycles} | PC: 0x${cpu.regs.pc.toString(16)}`
      + (cpu.fault ? ` | fault: ${cpu.fault.code}` : '');
    if (cpu.state === STATE.RUNNING) timer = setTimeout(tick, 0);
    else stop();
  };
  tick();
}

function stop() {
  clearTimeout(timer);
  timer = null;
}

runBtn.addEventListener('click', start);
stopBtn.addEventListener('click', stop);
start();
