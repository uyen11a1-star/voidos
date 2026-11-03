import { VoidFault } from '../core/errors.js';

export const PAGE_SIZE = 4096;
export const RAM_MIN_SIZE = 64 * 1024;
export const RAM_MAX_SIZE = 16 * 1024 * 1024; // hard ceiling of the emulator

// Largest RAM we allow on this device. Uses navigator.deviceMemory (GB) when the
// browser exposes it; low-memory devices get a smaller ceiling.
export function safeRamLimit() {
  const gb = typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined;
  return gb && gb <= 2 ? 4 * 1024 * 1024 : RAM_MAX_SIZE;
}

// Clamp a user-requested size to [64 KB, safe limit], rounded down to whole pages.
export function clampRamSize(requested) {
  const n = Number.isFinite(requested) ? Math.floor(requested) : RAM_MIN_SIZE;
  const clamped = Math.min(Math.max(n, RAM_MIN_SIZE), safeRamLimit());
  return clamped - (clamped % PAGE_SIZE);
}

// Physical memory: flat byte array, little-endian words, bounds-checked.
// Address translation and protection live in the MMU (mmu.js).
export class RAM {
  constructor(size = 65536) {
    if (!Number.isInteger(size) || size <= 0 || size > RAM_MAX_SIZE) {
      throw new RangeError(`RAM size must be 1..${RAM_MAX_SIZE} bytes`);
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

  // Instruction fetch. Flat RAM has no execute protection.
  fetch8(addr) {
    return this.read8(addr);
  }

  // Side-effect-free read for inspectors: null outside the RAM.
  peek8(addr) {
    return Number.isInteger(addr) && addr >= 0 && addr < this.size ? this.bytes[addr] : null;
  }

  load(addr, data) {
    this._check(addr, data.length);
    this.bytes.set(data, addr);
  }

  clear() {
    this.bytes.fill(0);
  }
}
