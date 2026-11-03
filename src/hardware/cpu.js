import { VoidFault } from '../core/errors.js';
import { Alu } from './alu.js';
import { RegisterFile, FLAG } from './registers.js';
import { OP, INSTRUCTION_SIZE, decodeInto } from '../instruction/instruction-set.js';

export const STATE = Object.freeze({ RUNNING: 'running', HALTED: 'halted', WAITING: 'waiting', FAULT: 'fault' });

// VoidCPU: 16-bit, R0..R7, PC, SP, FLAGS(Z,N,C,V), 64 KB address space.
// Fetch -> decode -> execute. PC is advanced after fetch, so CALL pushes the
// return address directly. A fault restores PC to the faulting instruction.
export class CPU {
  // io = { print(charCode), input() -> number|null }, syscall = (num, cpu) => void
  constructor(ram, { io = {}, syscall = null } = {}) {
    this.ram = ram;
    this.regs = new RegisterFile();
    this.alu = new Alu();
    this.io = io;
    this.syscall = syscall;
    this.cycles = 0;
    this.state = STATE.RUNNING;
    this.fault = null;
    this._ins = { op: 0, rd: 0, rs: 0, imm: 0 };
  }

  reset(entry = 0) {
    this.regs.reset(entry, 0);
    this.cycles = 0;
    this.state = STATE.RUNNING;
    this.fault = null;
  }

  _setFlags(res, useAlu, keepCarry = false) {
    const f = this.regs.flags;
    let n = (res === 0 ? FLAG.Z : 0) | (res & 0x8000 ? FLAG.N : 0);
    if (useAlu) {
      n |= (this.alu.overflow ? FLAG.V : 0) | (this.alu.carry ? FLAG.C : 0);
    }
    if (keepCarry) n = (n & ~FLAG.C) | (f & FLAG.C);
    this.regs.flags = n;
  }

  // Executes one instruction. Returns 1 if it ran, 0 if blocked/halted/faulted.
  step() {
    if (this.state === STATE.HALTED || this.state === STATE.FAULT) return 0;
    const regs = this.regs;
    const startPc = regs.pc;
    try {
      const ram = this.ram;
      const ins = decodeInto(
        this._ins,
        ram.read8(startPc),
        ram.read8(startPc + 1),
        ram.read8(startPc + 2),
        ram.read8(startPc + 3),
      );
      regs.pc = (startPc + INSTRUCTION_SIZE) & 0xffff;
      if (this.state === STATE.WAITING) this.state = STATE.RUNNING;
      if (!this._execute(ins)) {
        // blocked (INPUT with no data): retry the same instruction later
        regs.pc = startPc;
        this.state = STATE.WAITING;
        return 0;
      }
      this.cycles++;
      return 1;
    } catch (e) {
      if (!(e instanceof VoidFault)) throw e;
      regs.pc = startPc;
      this.state = STATE.FAULT;
      this.fault = { code: e.code, message: e.message, pc: startPc };
      return 0;
    }
  }

  // Runs at most maxCycles instructions (the execution-speed limit / watchdog).
  run(maxCycles) {
    let done = 0;
    while (done < maxCycles && this.step()) done++;
    return done;
  }

  _execute({ op, rd, rs, imm }) {
    const R = this.regs.r;
    const regs = this.regs;
    const ram = this.ram;
    const alu = this.alu;
    switch (op) {
      case OP.NOP: break;
      case OP.HALT: this.state = STATE.HALTED; break;
      case OP.MOV: R[rd] = R[rs]; break;
      case OP.MOVI: R[rd] = imm; break;
      case OP.LOAD: R[rd] = ram.read16(imm); break;
      case OP.LOADR: R[rd] = ram.read16(R[rs]); break;
      case OP.STORE: ram.write16(imm, R[rd]); break;
      case OP.STORER: ram.write16(R[rd], R[rs]); break;
      case OP.LOADB: R[rd] = ram.read8(R[rs]); break;
      case OP.STOREB: ram.write8(R[rd], R[rs]); break;
      case OP.PUSH: {
        const sp = (regs.sp - 2) & 0xffff;
        ram.write16(sp, R[rd]); // may fault; SP only changes on success
        regs.sp = sp;
        break;
      }
      case OP.POP: {
        R[rd] = ram.read16(regs.sp);
        regs.sp = (regs.sp + 2) & 0xffff;
        break;
      }
      case OP.ADD: R[rd] = alu.add(R[rd], R[rs]); this._setFlags(R[rd], true); break;
      case OP.ADDI: R[rd] = alu.add(R[rd], imm); this._setFlags(R[rd], true); break;
      case OP.SUB: R[rd] = alu.sub(R[rd], R[rs]); this._setFlags(R[rd], true); break;
      case OP.SUBI: R[rd] = alu.sub(R[rd], imm); this._setFlags(R[rd], true); break;
      case OP.MUL: R[rd] = alu.mul(R[rd], R[rs]); this._setFlags(R[rd], true); break;
      case OP.DIV:
        if (R[rs] === 0) throw new VoidFault('DIV_ZERO', 'Division by zero');
        R[rd] = alu.div(R[rd], R[rs]); this._setFlags(R[rd], true); break;
      case OP.MOD:
        if (R[rs] === 0) throw new VoidFault('DIV_ZERO', 'Division by zero');
        R[rd] = alu.mod(R[rd], R[rs]); this._setFlags(R[rd], true); break;
      case OP.INC: R[rd] = alu.add(R[rd], 1); this._setFlags(R[rd], true, true); break;
      case OP.DEC: R[rd] = alu.sub(R[rd], 1); this._setFlags(R[rd], true, true); break;
      case OP.AND: R[rd] = alu.and(R[rd], R[rs]); this._setFlags(R[rd], true); break;
      case OP.OR: R[rd] = alu.or(R[rd], R[rs]); this._setFlags(R[rd], true); break;
      case OP.XOR: R[rd] = alu.xor(R[rd], R[rs]); this._setFlags(R[rd], true); break;
      case OP.NOT: R[rd] = alu.not(R[rd]); this._setFlags(R[rd], true); break;
      case OP.CMP: this._setFlags(alu.sub(R[rd], R[rs]), true); break;
      case OP.CMPI: this._setFlags(alu.sub(R[rd], imm), true); break;
      case OP.JMP: regs.pc = imm; break;
      case OP.JE: if (regs.flags & FLAG.Z) regs.pc = imm; break;
      case OP.JNE: if (!(regs.flags & FLAG.Z)) regs.pc = imm; break;
      case OP.JG: { // signed: !Z && N == V
        const f = regs.flags;
        if (!(f & FLAG.Z) && !!(f & FLAG.N) === !!(f & FLAG.V)) regs.pc = imm;
        break;
      }
      case OP.JL: { // signed: N != V
        const f = regs.flags;
        if (!!(f & FLAG.N) !== !!(f & FLAG.V)) regs.pc = imm;
        break;
      }
      case OP.CALL: {
        const sp = (regs.sp - 2) & 0xffff;
        ram.write16(sp, regs.pc);
        regs.sp = sp;
        regs.pc = imm;
        break;
      }
      case OP.RET: {
        const target = ram.read16(regs.sp);
        regs.sp = (regs.sp + 2) & 0xffff;
        regs.pc = target;
        break;
      }
      case OP.SYSCALL:
        if (!this.syscall) throw new VoidFault('NO_SYSCALL', 'No syscall handler installed');
        this.syscall(imm, this);
        break;
      case OP.PRINT:
        if (!this.io.print) throw new VoidFault('NO_DEVICE', 'No console device');
        this.io.print(R[rd] & 0xff);
        break;
      case OP.INPUT: {
        if (!this.io.input) throw new VoidFault('NO_DEVICE', 'No input device');
        const v = this.io.input();
        if (v === null || v === undefined) return false; // block
        R[rd] = v;
        break;
      }
      default:
        throw new VoidFault('ILLEGAL_OPCODE', `Unhandled opcode 0x${op.toString(16)}`);
    }
    return true;
  }
}
