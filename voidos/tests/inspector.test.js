import { describe, it, expect } from 'vitest';
import { RAM } from '../src/hardware/ram.js';
import { hexdump, dumpRows } from '../src/hardware/memory-inspector.js';

describe('memory inspector', () => {
  it('formats hex + ASCII rows', () => {
    const r = new RAM(64);
    r.load(0, [...'VoidOS!'].map((c) => c.charCodeAt(0)).concat([0, 0xff]));
    const line = hexdump(r, 0, 16).split('\n')[0];
    expect(line).toBe('00000000  56 6f 69 64 4f 53 21 00 ff 00 00 00 00 00 00 00  |VoidOS!.........|');
  });
  it('partial last row is padded; out-of-range bytes show ??', () => {
    const r = new RAM(4);
    expect(hexdump(r, 2, 4, 4)).toBe('00000002  00 00 ?? ??  |..??|');
  });
  it('dumpRows gives structured data and validates arguments', () => {
    const r = new RAM(32);
    const rows = dumpRows(r, 0x10, 20, 8);
    expect(rows.map((x) => x.addr)).toEqual([0x10, 0x18, 0x20]);
    expect(rows[2].bytes).toHaveLength(4);
    expect(() => hexdump(r, -1, 4)).toThrow();
    expect(() => hexdump(r, 0, 4, 0)).toThrow();
    expect(hexdump(r, 0, 0)).toBe('');
  });
});
