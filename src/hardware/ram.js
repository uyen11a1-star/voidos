import { VoidFault } from '../core/errors.js';

// Phase 1: minimal RAM (flat byte array, little-endian words, bounds-checked).
// Allocation, protection and inspection arrive in Phase 2.
export class RAM {
  constructor(size = 65536) {
    if (!Number.isInteger(size) || size <= 0 || size > 65536) {
      throw new RangeError('RAM size must be 1..65536 bytes (16-bit address space)');
    }
    this.size = size;
    this.bytes = new Uint8Array(size);
  }

  _check(addr, len) {
    if (!Number.isInteger(addr) || addr < 0 || addr + len > this.size) {
      throw new VoidFault('MEM_OUT_OF_RANGE', `Memory access out of range: 0x${(addr >>> 0).toString(16)}`);
    }
  }

  read8(addr) {
    this._check(addr, 1);
    return this.bytes[addr];
  }

  write8(addr, value) {
    this._check(addr, 1);
    this.bytes[addr] = value & 0xff;
  }

  read16(addr) {
    this._check(addr, 2);
    return this.bytes[addr] | (this.bytes[addr + 1] << 8);
  }

  write16(addr, value) {
    this._check(addr, 2);
    this.bytes[addr] = value & 0xff;
    this.bytes[addr + 1] = (value >> 8) & 0xff;
  }

  load(addr, data) {
    this._check(addr, data.length);
    this.bytes.set(data, addr);
  }

  clear() {
    this.bytes.fill(0);
  }
}
