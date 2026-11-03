import { VoidFault } from '../core/errors.js';
import { PAGE_SIZE } from './ram.js';

// Virtual address space of the 16-bit CPU: 64 KB = 16 pages of 4 KB.
export const VIRTUAL_PAGES = 16;
export const VIRTUAL_SIZE = VIRTUAL_PAGES * PAGE_SIZE;

// Permission / access bits (same values on purpose: allowed iff entry & access).
export const PERM = Object.freeze({ R: 1, W: 2, X: 4 });
export const ACCESS = Object.freeze({ READ: 1, WRITE: 2, EXEC: 4 });
const ACCESS_NAME = { 1: 'read', 2: 'write', 4: 'execute' };

// Entry layout: bits 0-2 perms | bit 3 present | bits 4+ physical frame number.
const PRESENT = 8;

const hex = (n) => `0x${n.toString(16)}`;

export class PageTable {
  constructor() {
    this.entries = new Uint32Array(VIRTUAL_PAGES);
  }

  _checkPage(vpage) {
    if (!Number.isInteger(vpage) || vpage < 0 || vpage >= VIRTUAL_PAGES) {
      throw new RangeError(`Virtual page out of range: ${vpage}`);
    }
  }

  map(vpage, frame, perms) {
    this._checkPage(vpage);
    if (!Number.isInteger(frame) || frame < 0) throw new RangeError(`Bad frame: ${frame}`);
    if (!Number.isInteger(perms) || perms < 0 || perms > 7) throw new RangeError(`Bad permissions: ${perms}`);
    this.entries[vpage] = (frame << 4) | PRESENT | perms;
  }

  unmap(vpage) {
    this._checkPage(vpage);
    this.entries[vpage] = 0;
  }

  get(vpage) {
    this._checkPage(vpage);
    const e = this.entries[vpage];
    return e & PRESENT ? { frame: e >>> 4, perms: e & 7 } : null;
  }

  isMapped(vpage) {
    return (this.entries[vpage] & PRESENT) !== 0;
  }

  mappedCount() {
    let n = 0;
    for (let i = 0; i < VIRTUAL_PAGES; i++) if (this.entries[i] & PRESENT) n++;
    return n;
  }
}

// Memory interface the CPU talks to (read8/16, write8/16, fetch8): translates
// virtual -> physical through the active page table and enforces permissions.
export class MMU {
  constructor(ram) {
    this.ram = ram;
    this.table = null;
    this.size = VIRTUAL_SIZE; // for inspectors
  }

  // Context switch = pointing the MMU at another process's page table.
  activate(table) {
    this.table = table;
  }

  _translate(vaddr, access) {
    if (!this.table) throw new VoidFault('NO_ADDRESS_SPACE', 'No address space is active');
    if (!Number.isInteger(vaddr) || vaddr < 0 || vaddr >= VIRTUAL_SIZE) {
      throw new VoidFault('PAGE_FAULT', `Page fault: address ${hex(vaddr >>> 0)} outside address space`);
    }
    const e = this.table.entries[vaddr >>> 12];
    if (!(e & PRESENT)) throw new VoidFault('PAGE_FAULT', `Page fault: ${hex(vaddr)} is not mapped`);
    if (!(e & access)) {
      throw new VoidFault('PROTECTION_FAULT', `Protection fault: cannot ${ACCESS_NAME[access]} ${hex(vaddr)}`);
    }
    return ((e >>> 4) << 12) | (vaddr & 0xfff);
  }

  read8(vaddr) {
    return this.ram.read8(this._translate(vaddr, ACCESS.READ));
  }

  read16(vaddr) {
    if ((vaddr & 0xfff) !== 0xfff) return this.ram.read16(this._translate(vaddr, ACCESS.READ));
    // word straddles two pages (frames need not be adjacent)
    return this.read8(vaddr) | (this.read8(vaddr + 1) << 8);
  }

  write8(vaddr, value) {
    this.ram.write8(this._translate(vaddr, ACCESS.WRITE), value);
  }

  write16(vaddr, value) {
    if ((vaddr & 0xfff) !== 0xfff) {
      this.ram.write16(this._translate(vaddr, ACCESS.WRITE), value);
      return;
    }
    // translate both halves first so a fault never leaves a half-written word
    const p0 = this._translate(vaddr, ACCESS.WRITE);
    const p1 = this._translate(vaddr + 1, ACCESS.WRITE);
    this.ram.write8(p0, value);
    this.ram.write8(p1, value >> 8);
  }

  fetch8(vaddr) {
    return this.ram.read8(this._translate(vaddr, ACCESS.EXEC));
  }

  // Inspector read: ignores permissions, null if unmapped.
  peek8(vaddr) {
    if (!this.table || !Number.isInteger(vaddr) || vaddr < 0 || vaddr >= VIRTUAL_SIZE) return null;
    const e = this.table.entries[vaddr >>> 12];
    if (!(e & PRESENT)) return null;
    return this.ram.peek8(((e >>> 4) << 12) | (vaddr & 0xfff));
  }
}
