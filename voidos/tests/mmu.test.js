import { describe, it, expect } from 'vitest';
import { RAM } from '../src/hardware/ram.js';
import { MMU, PageTable, PERM } from '../src/hardware/mmu.js';

function setup() {
  const ram = new RAM(64 * 1024);
  const mmu = new MMU(ram);
  const table = new PageTable();
  mmu.activate(table);
  return { ram, mmu, table };
}
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };

describe('MMU translation and protection', () => {
  it('translates through the page table', () => {
    const { ram, mmu, table } = setup();
    table.map(2, 5, PERM.R | PERM.W); // vpage 2 -> frame 5
    mmu.write16(0x2010, 0xabcd);
    expect(ram.read16(5 * 4096 + 0x10)).toBe(0xabcd);
    expect(mmu.read16(0x2010)).toBe(0xabcd);
  });
  it('unmapped page -> PAGE_FAULT', () => {
    const { mmu } = setup();
    expect(code(() => mmu.read8(0x3000))).toBe('PAGE_FAULT');
  });
  it('address beyond 64 KB -> PAGE_FAULT', () => {
    const { mmu, table } = setup();
    table.map(15, 1, PERM.R);
    expect(code(() => mmu.read8(0x10000))).toBe('PAGE_FAULT');
    expect(code(() => mmu.read16(0xffff))).toBe('PAGE_FAULT'); // 2nd byte leaves the space
  });
  it('write to read-only and fetch from non-executable -> PROTECTION_FAULT', () => {
    const { mmu, table } = setup();
    table.map(0, 1, PERM.R | PERM.X);
    table.map(1, 2, PERM.R | PERM.W);
    expect(code(() => mmu.write8(0x10, 1))).toBe('PROTECTION_FAULT');
    expect(code(() => mmu.fetch8(0x1000))).toBe('PROTECTION_FAULT');
    expect(code(() => mmu.read8(0x10))).toBeNull();
    expect(code(() => mmu.fetch8(0x10))).toBeNull();
  });
  it('perms=0 page (guard) refuses everything', () => {
    const { mmu, table } = setup();
    table.map(4, 3, 0);
    expect(code(() => mmu.read8(0x4000))).toBe('PROTECTION_FAULT');
  });
  it('word crossing a page boundary works across non-adjacent frames', () => {
    const { ram, mmu, table } = setup();
    table.map(0, 7, PERM.R | PERM.W);
    table.map(1, 2, PERM.R | PERM.W);
    mmu.write16(0xfff, 0x1234);
    expect(ram.read8(7 * 4096 + 0xfff)).toBe(0x34);
    expect(ram.read8(2 * 4096)).toBe(0x12);
    expect(mmu.read16(0xfff)).toBe(0x1234);
  });
  it('cross-page write that faults on the 2nd page writes nothing', () => {
    const { ram, mmu, table } = setup();
    table.map(0, 7, PERM.R | PERM.W);
    table.map(1, 2, PERM.R); // read-only
    expect(code(() => mmu.write16(0xfff, 0x1234))).toBe('PROTECTION_FAULT');
    expect(ram.read8(7 * 4096 + 0xfff)).toBe(0);
  });
  it('no active address space -> NO_ADDRESS_SPACE', () => {
    const mmu = new MMU(new RAM(4096));
    expect(code(() => mmu.read8(0))).toBe('NO_ADDRESS_SPACE');
    expect(mmu.peek8(0)).toBeNull();
  });
  it('peek8 ignores permissions but is null for unmapped', () => {
    const { ram, mmu, table } = setup();
    table.map(0, 1, PERM.X);
    ram.write8(4096 + 5, 42);
    expect(mmu.peek8(5)).toBe(42);
    expect(mmu.peek8(0x2000)).toBeNull();
  });
  it('PageTable validates arguments', () => {
    const t = new PageTable();
    expect(() => t.map(16, 0, 1)).toThrow();
    expect(() => t.map(0, -1, 1)).toThrow();
    expect(() => t.map(0, 0, 8)).toThrow();
  });
});
