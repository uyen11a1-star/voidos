import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { assemble, AssemblyError } from '../src/instruction/assembler.js';
import { disassemble } from '../src/instruction/decoder.js';
import { encode } from '../src/instruction/instruction-set.js';
import { createMachine, spawnImage } from '../src/core/machine.js';
import { STATE } from '../src/hardware/cpu.js';

const asm = (src) => Array.from(assemble(src).image);
const errs = (src) => { try { assemble(src); } catch (e) { if (e instanceof AssemblyError) return e.errors; throw e; } return null; };
const msg = (src) => errs(src).map((e) => `${e.line}:${e.message}`).join(' | ');

function runFile(path, cycles = 100000) {
  const prog = assemble(readFileSync(path, 'utf8'));
  const bytes = [];
  const p = spawnImage(createMachine(), prog, { io: { print: (c) => bytes.push(c) } });
  p.cpu.run(cycles);
  return { cpu: p.cpu, text: new TextDecoder().decode(Uint8Array.from(bytes)), proc: p };
}

describe('instruction encoding (every operand shape)', () => {
  it('matches encode() for each shape', () => {
    expect(asm('NOP')).toEqual(encode('NOP'));
    expect(asm('PUSH R3')).toEqual(encode('PUSH', 3));
    expect(asm('MOV R1, R2')).toEqual(encode('MOV', 1, 2));
    expect(asm('MOVI R1, 0x1234')).toEqual(encode('MOVI', 1, 0, 0x1234));
    expect(asm('JMP 8')).toEqual(encode('JMP', 0, 0, 8));
    expect(asm('LOAD R1, [0x200]')).toEqual(encode('LOAD', 1, 0, 0x200));
    expect(asm('LOADR R1, [R2]')).toEqual(encode('LOADR', 1, 2));
    expect(asm('LOADB R1, [R2]')).toEqual(encode('LOADB', 1, 2));
    expect(asm('STORE [0x200], R5')).toEqual(encode('STORE', 5, 0, 0x200));
    expect(asm('STORER [R4], R5')).toEqual(encode('STORER', 4, 5));
    expect(asm('STOREB [R4], R5')).toEqual(encode('STOREB', 4, 5));
  });
  it('is case-insensitive for mnemonics, registers and directives', () => {
    expect(asm('movi r1, 5')).toEqual(asm('MOVI R1, 5'));
    expect(asm('.BYTE 1')).toEqual([1]);
  });
  it('accepts negative immediates and number bases', () => {
    expect(asm('MOVI R0, -1')).toEqual(encode('MOVI', 0, 0, 0xffff));
    expect(asm('MOVI R0, 0b101')).toEqual(encode('MOVI', 0, 0, 5));
    expect(asm('MOVI R0, 0xFFFF')).toEqual(encode('MOVI', 0, 0, 0xffff));
  });
  it('char literals and escapes', () => {
    expect(asm("MOVI R0, 'A'")).toEqual(encode('MOVI', 0, 0, 65));
    expect(asm("MOVI R0, '\\n'")).toEqual(encode('MOVI', 0, 0, 10));
    expect(asm("MOVI R0, ';'")).toEqual(encode('MOVI', 0, 0, 59)); // ';' is not a comment inside quotes
  });
});

describe('labels, symbols, expressions', () => {
  it('resolves forward and backward labels', () => {
    const img = asm('start: JMP end\n NOP\n end: JMP start');
    expect(img).toEqual([...encode('JMP', 0, 0, 8), ...encode('NOP'), ...encode('JMP', 0, 0, 0)]);
  });
  it('supports label + offset, $ and .equ', () => {
    expect(asm('.equ BASE, 0x100\nMOVI R0, BASE+4')).toEqual(encode('MOVI', 0, 0, 0x104));
    expect(asm('NOP\nMOVI R0, $')).toEqual([...encode('NOP'), ...encode('MOVI', 0, 0, 4)]);
    expect(asm('x: NOP\nMOVI R0, x + 8 - 4')).toEqual([...encode('NOP'), ...encode('MOVI', 0, 0, 4)]);
  });
  it('several labels on one line, label alone, label + instruction', () => {
    const r = assemble('a: b: NOP\nc:\nNOP');
    expect(r.symbols.get('a')).toBe(0);
    expect(r.symbols.get('b')).toBe(0);
    expect(r.symbols.get('c')).toBe(4);
  });
  it('labels are case-sensitive', () => {
    const r = assemble('Foo: NOP\nfoo: NOP');
    expect(r.symbols.get('Foo')).toBe(0);
    expect(r.symbols.get('foo')).toBe(4);
  });
});

describe('directives', () => {
  it('.byte/.word little-endian with expressions', () => {
    expect(asm('.byte 1, 0xff, -1, \'A\'')).toEqual([1, 255, 255, 65]);
    expect(asm('x: .word 0x1234, x+2')).toEqual([0x34, 0x12, 0x02, 0x00]);
  });
  it('.string adds NUL, .ascii does not, UTF-8 and escapes work', () => {
    expect(asm('.string "ab"')).toEqual([97, 98, 0]);
    expect(asm('.ascii "ab"')).toEqual([97, 98]);
    expect(asm('.ascii "a;b\\n\\"q\\\\"')).toEqual([97, 59, 98, 10, 34, 113, 92]);
    expect(asm('.ascii "à"')).toEqual([0xc3, 0xa0]);
    expect(asm('.ascii "a", "b"')).toEqual([97, 98]);
  });
  it('.space reserves zeros; .org pads forward', () => {
    expect(asm('.space 3\n.byte 7')).toEqual([0, 0, 0, 7]);
    expect(asm('.org 4\n.byte 9')).toEqual([0, 0, 0, 0, 9]);
  });
  it('.data aligns to the next page and records dataStart', () => {
    const r = assemble('NOP\n.data\nv: .word 5');
    expect(r.dataStart).toBe(4096);
    expect(r.symbols.get('v')).toBe(4096);
    expect(r.image.length).toBe(4098);
  });
  it('empty source and comment-only source give an empty image', () => {
    expect(assemble('').image.length).toBe(0);
    expect(assemble('; nothing\n\n   ; more').image.length).toBe(0);
    expect(asm('NOP\r\nNOP\r\n').length).toBe(8); // CRLF
  });
});

describe('error reporting', () => {
  it('reports unknown instruction with the line number', () => {
    expect(msg('NOP\nFOO R1')).toBe('2:Unknown instruction "FOO"');
  });
  it('operand count, bad register, missing brackets', () => {
    expect(msg('MOV R1')).toMatch(/MOV takes 2 operands, got 1/);
    expect(msg('MOV R1, R9')).toMatch(/Register R9 does not exist/);
    expect(msg('LOAD R1, 5')).toMatch(/Expected a memory operand/);
    expect(msg('LOADR R1, [R1+2]')).toMatch(/Expected register/);
  });
  it('helpful hints for MOV/ADDI mix-ups', () => {
    expect(msg('MOV R1, 5')).toMatch(/write MOVI/);
    expect(msg('MOVI R1, R2')).toMatch(/is a register, not a value \(use MOV\)/);
  });
  it('undefined and duplicate symbols, register used as label', () => {
    expect(msg('JMP nowhere')).toMatch(/Undefined symbol "nowhere"/);
    expect(msg('a: NOP\na: NOP')).toMatch(/2:Duplicate symbol "a"/);
    expect(msg('r1: NOP')).toMatch(/register name/);
  });
  it('range errors', () => {
    expect(msg('MOVI R0, 65536')).toMatch(/out of range/);
    expect(msg('MOVI R0, -32769')).toMatch(/out of range/);
    expect(msg('.byte 256')).toMatch(/Byte value 256 out of range/);
  });
  it('string / expression / directive errors', () => {
    expect(msg('.string "abc')).toMatch(/Unterminated/);
    expect(msg('.string abc')).toMatch(/Expected a "string"/);
    expect(msg('.string "a" x')).toMatch(/Expected a "string"|Unexpected/);
    expect(msg('MOVI R0, 12abc')).toMatch(/Invalid number/);
    expect(msg('MOVI R0, 1 2')).toMatch(/Unexpected/);
    expect(msg('MOVI R0, 1 +')).toMatch(/Incomplete/);
    expect(msg('MOVI R0, ,5')).toMatch(/Empty operand/);
    expect(msg('.bogus 1')).toMatch(/Unknown directive/);
    expect(msg(".string \"\\q\"")).toMatch(/Unknown escape/);
    expect(msg("MOVI R0, 'à'")).toMatch(/ASCII/);
  });
  it('.org backwards, .data twice, instruction after .data, forward ref in .org/.space', () => {
    expect(msg('NOP\n.org 0')).toMatch(/backwards/);
    expect(msg('.data\n.data')).toMatch(/twice/);
    expect(msg('.data\nNOP')).toMatch(/not allowed after .data/);
    expect(msg('.space later\nlater: NOP')).toMatch(/Undefined symbol/);
  });
  it('size limits: no huge allocations, program cannot reach the stack page', () => {
    expect(msg('.space 4000000000')).toMatch(/out of range/);
    expect(msg('.space 60000\n.space 60000')).toMatch(/exceeds 60 KB/);
    expect(msg('.org 0xF001')).toMatch(/out of range/);
  });
  it('collects every error, sorted by line', () => {
    const e = errs('FOO\nMOV R1\nNOP\nBAR');
    expect(e.map((x) => x.line)).toEqual([1, 2, 4]);
  });
  it('rejects non-string input', () => {
    expect(() => assemble(null)).toThrow(TypeError);
  });
});

describe('listing', () => {
  it('has address, bytes and source for each emitted line', () => {
    const r = assemble('NOP\n; c\nMOVI R1, 2');
    expect(r.listing.map((l) => [l.line, l.addr])).toEqual([[1, 0], [3, 4]]);
    expect(r.listing[1].source).toBe('MOVI R1, 2');
  });
});

describe('disassembler', () => {
  const src = `
    MOVI R1, 0x100
    LOADB R0, [R1]
    LOAD R2, [0x200]
    STORE [0x200], R2
    STORER [R3], R4
    ADD R1, R2
    CMPI R0, 0
    JE 12
    PRINT R0
    PUSH R7
    RET
    HALT`;
  it('round-trips: assemble -> disassemble -> assemble gives the same bytes', () => {
    const a = assemble(src).image;
    const text = disassemble(a).map((d) => d.text).join('\n');
    expect(Array.from(assemble(text).image)).toEqual(Array.from(a));
  });
  it('shows illegal words as .byte', () => {
    expect(disassemble(Uint8Array.of(0xee, 0, 0, 0))[0].text).toBe('.byte 0xee, 0x0, 0x0, 0x0');
    expect(disassemble(Uint8Array.of(0x11, 0x90, 0, 0))[0].text.startsWith('.byte')).toBe(true); // MOVI R9
    expect(disassemble(Uint8Array.of(0x01, 0, 0))[0].text).toBe('.byte 0x1, 0x0, 0x0'); // short tail
  });
});

describe('example programs run on the CPU', () => {
  it('hello.asm prints UTF-8 text', () => {
    const r = runFile('examples/hello.asm');
    expect(r.cpu.state).toBe(STATE.HALTED);
    expect(r.text).toBe('Xin chào VoidOS!\n');
  });
  it('fib.asm (CALL/RET/PUSH/POP/DIV/MOD) prints Fibonacci numbers', () => {
    const r = runFile('examples/fib.asm');
    expect(r.cpu.state).toBe(STATE.HALTED);
    expect(r.text).toBe('0 1 1 2 3 5 8 13 21 34 \n');
  });
  it('counter.asm uses a variable in the writable .data page', () => {
    const r = runFile('examples/counter.asm');
    expect(r.cpu.state).toBe(STATE.HALTED);
    expect(r.text).toBe('12345\n');
  });
  it('code pages are read-only; data pages are not executable', () => {
    const w = spawnImage(createMachine(), assemble('MOVI R0, 1\nSTORE [0], R0\nHALT'));
    w.cpu.run(10);
    expect(w.cpu.fault.code).toBe('PROTECTION_FAULT');
    const x = spawnImage(createMachine(), assemble('JMP target\n.data\ntarget: .word 0'));
    x.cpu.run(10);
    expect(x.cpu.fault).toMatchObject({ code: 'PROTECTION_FAULT', pc: 4096 });
  });
  it('an empty program cannot be spawned', () => {
    expect(() => spawnImage(createMachine(), assemble(''))).toThrow(/Empty program/);
  });
});
