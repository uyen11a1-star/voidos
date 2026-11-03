import { describe, it, expect } from 'vitest';
import { createMachine, spawn } from '../src/core/machine.js';
import { PERM } from '../src/hardware/mmu.js';
import { STATE } from '../src/hardware/cpu.js';
import { encode } from '../src/instruction/instruction-set.js';
import { buildDemo, DEMO_TEXT_ADDR } from '../src/core/demo-program.js';
import { hexdump } from '../src/hardware/memory-inspector.js';

const asm = (prog) => prog.flatMap((p) => encode(...p));
const runProc = (machine, prog, extra = []) => {
  const out = [];
  const p = spawn(machine, { segments: [{ addr: 0, bytes: asm(prog), perms: PERM.R | PERM.X }, ...extra], io: { print: (c) => out.push(c) } });
  p.cpu.run(10000);
  return { ...p, out };
};

describe('CPU running on the MMU (integration)', () => {
  it('Phase 1 demo program still runs, now in protected paged memory', () => {
    const m = createMachine();
    const { code, text } = buildDemo();
    const out = [];
    const p = spawn(m, {
      segments: [{ addr: 0, bytes: code, perms: PERM.R | PERM.X }, { addr: DEMO_TEXT_ADDR, bytes: text, perms: PERM.R }],
      io: { print: (c) => out.push(c) },
    });
    p.cpu.run(10000);
    expect(String.fromCharCode(...out)).toBe('VoidOS CPU online: 6*7=42\n');
    expect(p.cpu.state).toBe(STATE.HALTED);
    expect(hexdump(p.mmu, 0x100, 16)).toContain('|VoidOS CPU onlin|');
  });
  it('stack lives in the top page: PUSH/POP/CALL/RET work through the MMU', () => {
    const m = createMachine();
    const p = runProc(m, [['MOVI', 0, 0, 5], ['PUSH', 0], ['CALL', 0, 0, 20], ['POP', 2], ['HALT'], ['MOVI', 1, 0, 9], ['RET']]);
    expect(p.cpu.state).toBe(STATE.HALTED);
    expect(p.cpu.regs.r[1]).toBe(9);
    expect(p.cpu.regs.r[2]).toBe(5);
    expect(p.mmu.read16(0xfffe)).toBe(5); // pushed value sits at the top of the stack page
    expect(p.cpu.regs.sp).toBe(0);
  });
  it('writing to the (read-only) code page raises PROTECTION_FAULT and keeps PC', () => {
    const p = runProc(createMachine(), [['MOVI', 0, 0, 1], ['STORE', 0, 0, 0x40], ['HALT']]);
    expect(p.cpu.state).toBe(STATE.FAULT);
    expect(p.cpu.fault).toMatchObject({ code: 'PROTECTION_FAULT', pc: 4 });
  });
  it('jumping into a non-executable page raises PROTECTION_FAULT', () => {
    const p = runProc(createMachine(), [['JMP', 0, 0, 0xf000]]);
    expect(p.cpu.fault).toMatchObject({ code: 'PROTECTION_FAULT', pc: 0xf000 });
  });
  it('touching an unmapped page raises PAGE_FAULT', () => {
    const p = runProc(createMachine(), [['LOAD', 0, 0, 0x5000]]);
    expect(p.cpu.fault.code).toBe('PAGE_FAULT');
  });
  it('processes are isolated: same virtual address, different physical memory', () => {
    const m = createMachine();
    const data = (v) => [{ addr: 0x1000, bytes: [v], perms: PERM.R | PERM.W }];
    const a = runProc(m, [['MOVI', 1, 0, 0x1000], ['LOADB', 0, 1], ['HALT']], data(11));
    const b = runProc(m, [['MOVI', 1, 0, 0x1000], ['LOADB', 0, 1], ['HALT']], data(22));
    expect(a.cpu.regs.r[0]).toBe(11);
    expect(b.cpu.regs.r[0]).toBe(22);
  });
  it('spawn/destroy returns every frame (no leaks) and OOM spawn cleans up', () => {
    const m = createMachine({ ramSize: 8 * 4096, reservedFrames: 1 });
    const seg = [{ addr: 0, bytes: asm([['HALT']]), perms: PERM.R | PERM.X }];
    const before = m.allocator.stats().usedFrames;
    const p = spawn(m, { segments: seg });
    expect(m.allocator.stats().usedFrames).toBe(before + 2); // code page + stack page
    p.space.destroy();
    expect(m.allocator.stats().usedFrames).toBe(before);
    const procs = [];
    for (let i = 0; i < 3; i++) procs.push(spawn(m, { segments: seg })); // 6 frames, 7 usable
    expect(() => spawn(m, { segments: seg })).toThrow(/Out of memory/);
    expect(m.allocator.stats().usedFrames).toBe(before + 6); // failed spawn leaked nothing
  });
  it('segment that collides with the stack page is rejected', () => {
    expect(() => spawn(createMachine(), { segments: [{ addr: 0xf000, bytes: [1], perms: PERM.R }] })).toThrow();
  });
});
