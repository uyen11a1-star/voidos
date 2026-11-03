import { VoidFault } from '../core/errors.js';

// VoidCPU instruction encoding (4 bytes, little-endian immediate):
//   byte0 = opcode | byte1 = (rd << 4) | rs | byte2..3 = imm16
// Operand formats: none | r (rd) | rr (rd, rs) | ri (rd, imm) | i (imm)
// Memory semantics are noted per op; "[x]" is a 16-bit word, "[x]b" a byte.
const DEFS = [
  ['NOP', 0x00, 'none'],
  ['HALT', 0x01, 'none'],
  ['MOV', 0x10, 'rr'], // rd = rs
  ['MOVI', 0x11, 'ri'], // rd = imm
  ['LOAD', 0x12, 'ri'], // rd = [imm]
  ['LOADR', 0x13, 'rr'], // rd = [rs]
  ['STORE', 0x14, 'ri'], // [imm] = rd
  ['STORER', 0x15, 'rr'], // [rd] = rs
  ['LOADB', 0x16, 'rr'], // rd = [rs]b
  ['STOREB', 0x17, 'rr'], // [rd]b = rs
  ['PUSH', 0x18, 'r'],
  ['POP', 0x19, 'r'],
  ['ADD', 0x20, 'rr'],
  ['ADDI', 0x21, 'ri'],
  ['SUB', 0x22, 'rr'],
  ['SUBI', 0x23, 'ri'],
  ['MUL', 0x24, 'rr'],
  ['DIV', 0x25, 'rr'], // unsigned; divide by zero faults
  ['MOD', 0x26, 'rr'],
  ['INC', 0x27, 'r'], // keeps C
  ['DEC', 0x28, 'r'], // keeps C
  ['AND', 0x29, 'rr'],
  ['OR', 0x2a, 'rr'],
  ['XOR', 0x2b, 'rr'],
  ['NOT', 0x2c, 'r'],
  ['CMP', 0x2d, 'rr'], // flags of rd - rs
  ['CMPI', 0x2e, 'ri'],
  ['JMP', 0x30, 'i'],
  ['JE', 0x31, 'i'],
  ['JNE', 0x32, 'i'],
  ['JG', 0x33, 'i'], // signed greater
  ['JL', 0x34, 'i'], // signed less
  ['CALL', 0x35, 'i'],
  ['RET', 0x36, 'none'],
  ['SYSCALL', 0x40, 'i'],
  ['PRINT', 0x41, 'r'], // console output: char code = rd & 0xFF
  ['INPUT', 0x42, 'r'], // rd = next input value; blocks (WAITING) if none
];

export const OP = Object.freeze(Object.fromEntries(DEFS.map(([n, c]) => [n, c])));
export const INSTRUCTION_SIZE = 4;

// code -> { name, code, fmt } (sparse array of 256)
export const BY_CODE = new Array(256).fill(null);
for (const [name, code, fmt] of DEFS) BY_CODE[code] = { name, code, fmt };
export const BY_NAME = Object.freeze(Object.fromEntries(DEFS.map(([name, code, fmt]) => [name, { name, code, fmt }])));

const checkReg = (v) => Number.isInteger(v) && v >= 0 && v <= 7;

// Encode one instruction to 4 bytes (used by tests, assembler, loaders).
export function encode(name, rd = 0, rs = 0, imm = 0) {
  const def = BY_NAME[name];
  if (!def) throw new Error(`Unknown mnemonic: ${name}`);
  if (!checkReg(rd) || !checkReg(rs)) throw new RangeError('Register must be 0..7');
  if (!Number.isInteger(imm) || imm < -0x8000 || imm > 0xffff) throw new RangeError('Immediate must fit 16 bits');
  const i = imm & 0xffff;
  return [def.code, (rd << 4) | rs, i & 0xff, i >> 8];
}

// Decode into a reusable object (no per-step allocation).
export function decodeInto(out, b0, b1, b2, b3) {
  const def = BY_CODE[b0];
  if (!def) throw new VoidFault('ILLEGAL_OPCODE', `Illegal opcode 0x${b0.toString(16).padStart(2, '0')}`);
  const rd = b1 >> 4;
  const rs = b1 & 0xf;
  if (def.fmt !== 'none' && def.fmt !== 'i' && rd > 7) throw new VoidFault('ILLEGAL_REGISTER', `Illegal register R${rd}`);
  if (def.fmt === 'rr' && rs > 7) throw new VoidFault('ILLEGAL_REGISTER', `Illegal register R${rs}`);
  out.op = b0;
  out.rd = rd;
  out.rs = rs;
  out.imm = b2 | (b3 << 8);
  return out;
}
