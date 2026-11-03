import { RAM } from '../src/hardware/ram.js';
import { CPU } from '../src/hardware/cpu.js';
import { encode } from '../src/instruction/instruction-set.js';

// prog: array of [mnemonic, rd, rs, imm]. Returns { cpu, ram, out }.
export function machine(prog, opts = {}) {
  const ram = new RAM(opts.ramSize ?? 65536);
  const out = [];
  const cpu = new CPU(ram, { io: { print: (c) => out.push(c), input: opts.input }, syscall: opts.syscall });
  const bytes = prog.flatMap((p) => encode(...p));
  ram.load(0, bytes);
  return { cpu, ram, out };
}
