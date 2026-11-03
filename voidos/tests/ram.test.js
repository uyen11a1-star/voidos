import { describe, it, expect } from 'vitest';
import { RAM, RAM_MAX_SIZE, PAGE_SIZE, RAM_MIN_SIZE, safeRamLimit, clampRamSize } from '../src/hardware/ram.js';

describe('RAM', () => {
  it('reads and writes bytes and little-endian words', () => {
    const r = new RAM(16);
    r.write16(2, 0x1234);
    expect(r.read8(2)).toBe(0x34);
    expect(r.read8(3)).toBe(0x12);
    expect(r.read16(2)).toBe(0x1234);
    r.write8(0, 0x1ff);
    expect(r.read8(0)).toBe(0xff);
  });
  it('faults out of range (byte, word at the edge, negative)', () => {
    const r = new RAM(16);
    expect(() => r.read8(16)).toThrow(/out of range/);
    expect(() => r.read16(15)).toThrow(/out of range/);
    expect(() => r.write8(-1, 0)).toThrow(/out of range/);
    expect(() => r.load(10, new Uint8Array(10))).toThrow(/out of range/);
  });
  it('rejects invalid sizes', () => {
    expect(() => new RAM(0)).toThrow();
    expect(() => new RAM(RAM_MAX_SIZE + 1)).toThrow();
    expect(() => new RAM(1.5)).toThrow();
  });
  it('supports physical RAM above 64 KB', () => {
    const r = new RAM(1024 * 1024);
    r.write16(0xfffff - 1, 0xbeef);
    expect(r.read16(0xfffff - 1)).toBe(0xbeef);
  });
  it('peek8 is null out of range and fetch8 matches read8', () => {
    const r = new RAM(8);
    r.write8(3, 9);
    expect(r.peek8(3)).toBe(9);
    expect(r.peek8(8)).toBeNull();
    expect(r.peek8(-1)).toBeNull();
    expect(r.fetch8(3)).toBe(9);
  });
  it('clampRamSize keeps size within [64KB, safe limit] and page aligned', () => {
    expect(clampRamSize(1)).toBe(RAM_MIN_SIZE);
    expect(clampRamSize(1e12)).toBe(safeRamLimit());
    expect(clampRamSize(100000) % PAGE_SIZE).toBe(0);
    expect(clampRamSize(NaN)).toBe(RAM_MIN_SIZE);
  });
});
