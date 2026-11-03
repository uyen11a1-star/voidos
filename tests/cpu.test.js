import { describe, it, expect } from 'vitest';
import { machine } from './helpers.js';
import { STATE } from '../src/hardware/cpu.js';
import { FLAG } from '../src/hardware/registers.js';
import { encode, BY_CODE, decodeInto } from '../src/instruction/instruction-set.js';

const run = (prog, opts) => {
  const m = machine(prog, opts);
  m.cpu.run(10000);
  return m;
};

describe('data transfer', () => {
  it('MOVI/MOV', () => {
    const { cpu } = run([['MOVI', 1, 0, 0xbeef], ['MOV', 2, 1], ['HALT']]);
    expect(cpu.regs.r[2]).toBe(0xbeef);
    expect(cpu.state).toBe(STATE.HALTED);
  });
  it('STORE/LOAD word and STOREB/LOADB byte', () => {
    const { cpu, ram } = run([
      ['MOVI', 0, 0, 0xabcd], ['STORE', 0, 0, 0x200], ['LOAD', 1, 0, 0x200],
      ['MOVI', 2, 0, 0x300], ['MOVI', 3, 0, 0x1ff], ['STOREB', 2, 3], ['LOADB', 4, 2], ['HALT'],
    ]);
    expect(ram.read16(0x200)).toBe(0xabcd);
    expect(cpu.regs.r[1]).toBe(0xabcd);
    expect(cpu.regs.r[4]).toBe(0xff);
  });
  it('STORER/LOADR through a pointer', () => {
    const { cpu } = run([['MOVI', 0, 0, 0x400], ['MOVI', 1, 0, 77], ['STORER', 0, 1], ['LOADR', 2, 0], ['HALT']]);
    expect(cpu.regs.r[2]).toBe(77);
  });
  it('PUSH/POP is LIFO and restores SP', () => {
    const { cpu } = run([['MOVI', 0, 0, 1], ['MOVI', 1, 0, 2], ['PUSH', 0], ['PUSH', 1], ['POP', 2], ['POP', 3], ['HALT']]);
    expect(cpu.regs.r[2]).toBe(2);
    expect(cpu.regs.r[3]).toBe(1);
    expect(cpu.regs.sp).toBe(0);
  });
});

describe('arithmetic and flags', () => {
  it('ADD sets carry on unsigned wrap and Z on zero', () => {
    const { cpu } = run([['MOVI', 0, 0, 0xffff], ['MOVI', 1, 0, 1], ['ADD', 0, 1], ['HALT']]);
    expect(cpu.regs.r[0]).toBe(0);
    expect(cpu.regs.flags & FLAG.C).toBeTruthy();
    expect(cpu.regs.flags & FLAG.Z).toBeTruthy();
  });
  it('ADD sets signed overflow (0x7FFF + 1)', () => {
    const { cpu } = run([['MOVI', 0, 0, 0x7fff], ['ADDI', 0, 0, 1], ['HALT']]);
    expect(cpu.regs.r[0]).toBe(0x8000);
    expect(cpu.regs.flags & FLAG.V).toBeTruthy();
    expect(cpu.regs.flags & FLAG.N).toBeTruthy();
  });
  it('SUB sets borrow when a < b', () => {
    const { cpu } = run([['MOVI', 0, 0, 1], ['SUBI', 0, 0, 2], ['HALT']]);
    expect(cpu.regs.r[0]).toBe(0xffff);
    expect(cpu.regs.flags & FLAG.C).toBeTruthy();
  });
  it('MUL/DIV/MOD', () => {
    const { cpu } = run([['MOVI', 0, 0, 42], ['MOVI', 1, 0, 10], ['MOV', 2, 0], ['DIV', 2, 1], ['MOD', 0, 1], ['MOVI', 3, 0, 300], ['MUL', 3, 3], ['HALT']]);
    expect(cpu.regs.r[2]).toBe(4);
    expect(cpu.regs.r[0]).toBe(2);
    expect(cpu.regs.r[3]).toBe(90000 & 0xffff);
    expect(cpu.regs.flags & FLAG.C).toBeTruthy(); // product overflowed 16 bits
  });
  it('INC/DEC keep the carry flag', () => {
    const { cpu } = run([['MOVI', 0, 0, 0xffff], ['ADDI', 0, 0, 1], ['INC', 1], ['HALT']]);
    expect(cpu.regs.r[1]).toBe(1);
    expect(cpu.regs.flags & FLAG.C).toBeTruthy();
  });
  it('logic ops', () => {
    const { cpu } = run([
      ['MOVI', 0, 0, 0x0ff0], ['MOVI', 1, 0, 0x00ff], ['MOV', 2, 0], ['AND', 2, 1], ['MOV', 3, 0], ['OR', 3, 1],
      ['MOV', 4, 0], ['XOR', 4, 1], ['MOV', 5, 0], ['NOT', 5], ['HALT'],
    ]);
    expect([cpu.regs.r[2], cpu.regs.r[3], cpu.regs.r[4], cpu.regs.r[5]]).toEqual([0x00f0, 0x0fff, 0x0f0f, 0xf00f]);
  });
});

describe('control flow', () => {
  it('JE/JNE', () => {
    // R0 = 5; CMPI R0,5; JE skip; MOVI R1,1 (skipped); skip: MOVI R2,9
    const { cpu } = run([['MOVI', 0, 0, 5], ['CMPI', 0, 0, 5], ['JE', 0, 0, 16], ['MOVI', 1, 0, 1], ['MOVI', 2, 0, 9], ['HALT']]);
    expect(cpu.regs.r[1]).toBe(0);
    expect(cpu.regs.r[2]).toBe(9);
  });
  it('JG/JL are signed (0xFFFF = -1 < 1)', () => {
    const { cpu } = run([
      ['MOVI', 0, 0, 0xffff], ['CMPI', 0, 0, 1], ['JL', 0, 0, 16], ['MOVI', 1, 0, 111], ['MOVI', 2, 0, 5], ['HALT'],
    ]);
    expect(cpu.regs.r[1]).toBe(0); // JL taken
    const g = run([['MOVI', 0, 0, 2], ['CMPI', 0, 0, 1], ['JG', 0, 0, 16], ['MOVI', 1, 0, 111], ['HALT']]);
    expect(g.cpu.regs.r[1]).toBe(0); // JG taken
    const ng = run([['MOVI', 0, 0, 1], ['CMPI', 0, 0, 1], ['JG', 0, 0, 16], ['MOVI', 1, 0, 111], ['HALT']]);
    expect(ng.cpu.regs.r[1]).toBe(111); // equal: JG not taken
  });
  it('signed compare across overflow (-32768 < 1)', () => {
    const { cpu } = run([['MOVI', 0, 0, 0x8000], ['CMPI', 0, 0, 1], ['JL', 0, 0, 16], ['MOVI', 1, 0, 111], ['HALT']]);
    expect(cpu.regs.r[1]).toBe(0);
  });
  it('CALL/RET', () => {
    // 0:CALL 12; 4:MOVI R1,2; 8:HALT; 12:MOVI R0,7; 16:RET
    const { cpu } = run([['CALL', 0, 0, 12], ['MOVI', 1, 0, 2], ['HALT'], ['MOVI', 0, 0, 7], ['RET']]);
    expect(cpu.regs.r[0]).toBe(7);
    expect(cpu.regs.r[1]).toBe(2);
    expect(cpu.regs.sp).toBe(0);
  });
  it('loop computes 1+2+..+10', () => {
    // R0=sum R1=i; loop(8): ADD R0,R1; DEC R1; JNE 8
    const { cpu } = run([['MOVI', 1, 0, 10], ['MOVI', 0, 0, 0], ['ADD', 0, 1], ['DEC', 1], ['JNE', 0, 0, 8], ['HALT']]);
    expect(cpu.regs.r[0]).toBe(55);
  });
});

describe('system', () => {
  it('PRINT sends char codes to the console device', () => {
    const { out } = run([['MOVI', 0, 0, 72], ['PRINT', 0], ['MOVI', 0, 0, 105], ['PRINT', 0], ['HALT']]);
    expect(out).toEqual([72, 105]);
  });
  it('SYSCALL invokes the handler with number; PC already advanced', () => {
    const calls = [];
    const { cpu } = run([['SYSCALL', 0, 0, 3], ['HALT']], { syscall: (n, c) => calls.push([n, c.regs.pc]) });
    expect(calls).toEqual([[3, 4]]);
    expect(cpu.state).toBe(STATE.HALTED);
  });
  it('SYSCALL without handler faults', () => {
    const { cpu } = run([['SYSCALL', 0, 0, 1]]);
    expect(cpu.state).toBe(STATE.FAULT);
    expect(cpu.fault.code).toBe('NO_SYSCALL');
  });
  it('INPUT blocks (WAITING) until data exists, then resumes', () => {
    const queue = [];
    const m = machine([['INPUT', 0], ['PRINT', 0], ['HALT']], { input: () => (queue.length ? queue.shift() : null) });
    expect(m.cpu.run(100)).toBe(0);
    expect(m.cpu.state).toBe(STATE.WAITING);
    expect(m.cpu.regs.pc).toBe(0);
    queue.push(65);
    m.cpu.run(100);
    expect(m.out).toEqual([65]);
    expect(m.cpu.state).toBe(STATE.HALTED);
  });
});

describe('faults and limits', () => {
  it('division by zero faults and keeps PC at the faulting instruction', () => {
    const { cpu } = run([['MOVI', 0, 0, 1], ['MOVI', 1, 0, 0], ['DIV', 0, 1]]);
    expect(cpu.state).toBe(STATE.FAULT);
    expect(cpu.fault).toMatchObject({ code: 'DIV_ZERO', pc: 8 });
    expect(cpu.regs.pc).toBe(8);
    expect(cpu.step()).toBe(0);
  });
  it('illegal opcode and illegal register fault', () => {
    const a = machine([['NOP']]);
    a.ram.write8(0, 0xee);
    a.cpu.run(5);
    expect(a.cpu.fault.code).toBe('ILLEGAL_OPCODE');
    const b = machine([['NOP']]);
    b.ram.load(0, [0x11, 0x90, 0, 0]); // MOVI R9
    b.cpu.run(5);
    expect(b.cpu.fault.code).toBe('ILLEGAL_REGISTER');
  });
  it('out-of-range data access faults (STORE at 0xFFFF word)', () => {
    const { cpu } = run([['MOVI', 0, 0, 1], ['STORE', 0, 0, 0xffff]]);
    expect(cpu.fault.code).toBe('MEM_OUT_OF_RANGE');
  });
  it('a failed PUSH does not move SP', () => {
    const { cpu } = run([['PUSH', 0]], { ramSize: 1024 });
    expect(cpu.state).toBe(STATE.FAULT);
    expect(cpu.regs.sp).toBe(0);
  });
  it('infinite loop is bounded by run(maxCycles)', () => {
    const m = machine([['JMP', 0, 0, 0]]);
    expect(m.cpu.run(5000)).toBe(5000);
    expect(m.cpu.state).toBe(STATE.RUNNING);
    expect(m.cpu.cycles).toBe(5000);
  });
  it('fetch past end of RAM faults', () => {
    const m = machine([['NOP']], { ramSize: 6 });
    expect(m.cpu.run(10)).toBe(1);
    expect(m.cpu.fault.code).toBe('MEM_OUT_OF_RANGE');
  });
});

describe('instruction set', () => {
  it('encode/decode round-trips including negative immediates', () => {
    const b = encode('MOVI', 3, 5, -1);
    expect(b).toEqual([0x11, 0x35, 0xff, 0xff]);
    const out = decodeInto({}, ...b);
    expect(out).toMatchObject({ op: 0x11, rd: 3, rs: 5, imm: 0xffff });
  });
  it('rejects bad operands', () => {
    expect(() => encode('NOPE')).toThrow();
    expect(() => encode('MOV', 8, 0)).toThrow();
    expect(() => encode('MOVI', 0, 0, 0x10000)).toThrow();
  });
  it('all required instruction groups exist', () => {
    const names = BY_CODE.filter(Boolean).map((d) => d.name);
    for (const n of ['MOV','LOAD','STORE','PUSH','POP','ADD','SUB','MUL','DIV','INC','DEC','AND','OR','XOR','NOT','CMP','JMP','JE','JNE','JG','JL','CALL','RET','HALT','SYSCALL','PRINT','INPUT']) {
      expect(names).toContain(n);
    }
  });
});
