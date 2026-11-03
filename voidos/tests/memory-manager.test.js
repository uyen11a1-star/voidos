import { describe, it, expect } from 'vitest';
import { RAM } from '../src/hardware/ram.js';
import { PERM } from '../src/hardware/mmu.js';
import { FrameAllocator, AddressSpace } from '../src/os/memory-manager.js';

const mk = (frames = 8, reserved = 1) => {
  const ram = new RAM(frames * 4096);
  return { ram, alloc: new FrameAllocator(ram, { reservedFrames: reserved }) };
};

describe('FrameAllocator', () => {
  it('hands out lowest free frames, skipping reserved ones', () => {
    const { alloc } = mk();
    expect(alloc.allocate(3)).toEqual([1, 2, 3]);
    expect(alloc.stats()).toMatchObject({ totalFrames: 8, usedFrames: 4, freeFrames: 4, reservedFrames: 1, usedBytes: 4 * 4096 });
  });
  it('returns null when out of memory and changes nothing', () => {
    const { alloc } = mk();
    expect(alloc.allocate(8)).toBeNull();
    expect(alloc.stats().usedFrames).toBe(1);
    expect(alloc.allocate(7)).toHaveLength(7);
    expect(alloc.allocate(1)).toBeNull();
  });
  it('free makes frames reusable and zeroes them on reallocation', () => {
    const { alloc, ram } = mk();
    const [f] = alloc.allocate(1);
    ram.bytes[f * 4096 + 10] = 99;
    alloc.free([f]);
    const [g] = alloc.allocate(1);
    expect(g).toBe(f);
    expect(ram.bytes[g * 4096 + 10]).toBe(0);
  });
  it('rejects double free, reserved/out-of-range frames, and duplicates without side effects', () => {
    const { alloc } = mk();
    const [a, b] = alloc.allocate(2);
    expect(() => alloc.free([0])).toThrow();
    expect(() => alloc.free([99])).toThrow();
    expect(() => alloc.free([a, a])).toThrow(/Double free/);
    expect(alloc.stats().usedFrames).toBe(3);
    alloc.free([a, b]);
    expect(() => alloc.free([a])).toThrow(/Double free/);
    expect(alloc.stats().usedFrames).toBe(1);
  });
  it('validates arguments', () => {
    const { alloc } = mk();
    expect(() => alloc.allocate(0)).toThrow();
    expect(() => alloc.allocate(1.5)).toThrow();
    expect(() => new FrameAllocator(new RAM(4096), { reservedFrames: 2 })).toThrow();
  });
});

describe('AddressSpace', () => {
  it('allocate maps pages with permissions and usage() reports them', () => {
    const { alloc } = mk();
    const s = new AddressSpace(alloc);
    expect(s.allocate(2, 2, PERM.R | PERM.W)).toBe(0x2000);
    expect(s.table.get(2).perms).toBe(PERM.R | PERM.W);
    expect(s.usage()).toEqual({ pages: 2, bytes: 8192 });
  });
  it('allocate refuses overlap and bad ranges', () => {
    const s = new AddressSpace(mk().alloc);
    s.allocate(1, 1, PERM.R);
    expect(() => s.allocate(1, 1, PERM.R)).toThrow(/already mapped/);
    expect(() => s.allocate(15, 2, PERM.R)).toThrow();
    expect(() => s.allocate(-1, 1, PERM.R)).toThrow();
  });
  it('allocate returns null on OOM and leaks nothing', () => {
    const { alloc } = mk(4, 1);
    const s = new AddressSpace(alloc);
    expect(s.allocate(1, 4, PERM.R)).toBeNull();
    expect(s.usage().pages).toBe(0);
    expect(alloc.stats().usedFrames).toBe(1);
  });
  it('alloc is first-fit, rounds up to pages and never uses page 0', () => {
    const s = new AddressSpace(mk().alloc);
    expect(s.alloc(1, PERM.R | PERM.W)).toBe(0x1000);
    expect(s.alloc(4097, PERM.R | PERM.W)).toBe(0x2000); // 2 pages
    s.free(0x1000, 1);
    expect(s.alloc(100, PERM.R)).toBe(0x1000); // reuses the hole
    expect(s.table.isMapped(0)).toBe(false);
  });
  it('alloc returns null when virtual space is exhausted', () => {
    const s = new AddressSpace(new FrameAllocator(new RAM(32 * 4096)));
    expect(s.alloc(15 * 4096, PERM.R)).toBe(0x1000);
    expect(s.alloc(1, PERM.R)).toBeNull();
  });
  it('protect changes permissions, free returns frames, destroy frees everything', () => {
    const { alloc } = mk();
    const s = new AddressSpace(alloc);
    s.allocate(0, 2, PERM.R | PERM.W);
    s.protect(0, 2, PERM.R | PERM.X);
    expect(s.table.get(1).perms).toBe(PERM.R | PERM.X);
    s.freePages(0, 1);
    expect(alloc.stats().usedFrames).toBe(2);
    expect(() => s.protect(0, 1, PERM.R)).toThrow();
    expect(() => s.freePages(0, 1)).toThrow();
    s.destroy();
    expect(alloc.stats().usedFrames).toBe(1);
  });
  it('free requires page alignment', () => {
    const s = new AddressSpace(mk().alloc);
    s.alloc(1, PERM.R);
    expect(() => s.free(0x1001, 1)).toThrow();
  });
  it('poke/peek copy across pages, ignore permissions, fault on unmapped', () => {
    const s = new AddressSpace(mk().alloc);
    s.allocate(0, 2, PERM.R);
    s.poke(0xffe, [1, 2, 3, 4]);
    expect([...s.peek(0xffe, 4)]).toEqual([1, 2, 3, 4]);
    expect(() => s.poke(0x1ffe, [1, 2, 3])).toThrow(/not mapped/);
    expect([...s.peek(0x1ffe, 2)]).toEqual([0, 0]); // failed poke wrote nothing
  });
  it('two address spaces never share memory', () => {
    const { alloc, ram } = mk();
    const a = new AddressSpace(alloc), b = new AddressSpace(alloc);
    a.allocate(0, 1, PERM.R | PERM.W);
    b.allocate(0, 1, PERM.R | PERM.W);
    a.poke(0, [7]);
    expect(b.peek(0, 1)[0]).toBe(0);
    expect(a.table.get(0).frame).not.toBe(b.table.get(0).frame);
    expect(ram.bytes[a.table.get(0).frame * 4096]).toBe(7);
  });
});
