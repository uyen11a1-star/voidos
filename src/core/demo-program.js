import { encode } from '../instruction/instruction-set.js';

// Phase 1 demo: real machine code executed by VoidCPU (assembler arrives in Phase 3).
// Prints a string from RAM, then computes 6*7 and prints it as two decimal digits.
export const DEMO_TEXT = 'VoidOS CPU online: 6*7=';
export const DEMO_TEXT_ADDR = 0x100;

export function buildDemo() {
  const code = [
    ['MOVI', 1, 0, DEMO_TEXT_ADDR], // 0:  R1 = &text
    ['LOADB', 0, 1],                // 4:  R0 = [R1]b
    ['CMPI', 0, 0, 0],              // 8
    ['JE', 0, 0, 28],               // 12: end of string
    ['PRINT', 0],                   // 16
    ['INC', 1],                     // 20
    ['JMP', 0, 0, 4],               // 24
    ['MOVI', 2, 0, 6],              // 28
    ['MOVI', 3, 0, 7],              // 32
    ['MUL', 2, 3],                  // 36: R2 = 42
    ['MOVI', 4, 0, 10],             // 40
    ['MOV', 5, 2],                  // 44
    ['DIV', 5, 4],                  // 48: R5 = tens
    ['MOD', 2, 4],                  // 52: R2 = ones
    ['ADDI', 5, 0, 48],             // 56
    ['PRINT', 5],                   // 60
    ['ADDI', 2, 0, 48],             // 64
    ['PRINT', 2],                   // 68
    ['MOVI', 0, 0, 10],             // 72
    ['PRINT', 0],                   // 76
    ['HALT'],                       // 80
  ].flatMap((i) => encode(...i));
  const text = [...DEMO_TEXT].map((c) => c.charCodeAt(0)).concat(0);
  return { code, text };
}
