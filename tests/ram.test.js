import { describe, it, expect } from 'vitest';
import { RAM } from '../src/hardware/ram.js';

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
    expect(() => new RAM(65537)).toThrow();
  });
});
