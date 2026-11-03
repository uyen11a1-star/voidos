import { VoidFault } from '../core/errors.js';
import { PAGE_SIZE } from '../hardware/ram.js';
import { PageTable, VIRTUAL_PAGES } from '../hardware/mmu.js';

// Physical frame allocator (page granularity). Frames are zeroed on allocation
// so one process can never read another's leftovers.
export class FrameAllocator {
  constructor(ram, { reservedFrames = 0 } = {}) {
    this.ram = ram;
    this.totalFrames = Math.floor(ram.size / PAGE_SIZE);
    if (!Number.isInteger(reservedFrames) || reservedFrames < 0 || reservedFrames > this.totalFrames) {
      throw new RangeError('reservedFrames out of range');
    }
    this.reservedFrames = reservedFrames; // kept for the kernel, never handed out
    this.used = new Uint8Array(this.totalFrames);
    this.used.fill(1, 0, reservedFrames);
    this.usedCount = reservedFrames;
  }

  // Returns an array of n frame numbers (lowest first) or null if not enough free.
  allocate(n) {
    if (!Number.isInteger(n) || n <= 0) throw new RangeError('allocate(n): n must be a positive integer');
    if (n > this.totalFrames - this.usedCount) return null;
    const frames = [];
    for (let f = 0; f < this.totalFrames && frames.length < n; f++) if (!this.used[f]) frames.push(f);
    for (const f of frames) {
      this.used[f] = 1;
      this.ram.bytes.fill(0, f * PAGE_SIZE, (f + 1) * PAGE_SIZE);
    }
    this.usedCount += n;
    return frames;
  }

  // Validates everything first, so a bad call changes nothing.
  free(frames) {
    const seen = new Set();
    for (const f of frames) {
      if (!Number.isInteger(f) || f < this.reservedFrames || f >= this.totalFrames) throw new RangeError(`Cannot free frame ${f}`);
      if (!this.used[f] || seen.has(f)) throw new Error(`Double free of frame ${f}`);
      seen.add(f);
    }
    for (const f of seen) this.used[f] = 0;
    this.usedCount -= seen.size;
  }

  stats() {
    const free = this.totalFrames - this.usedCount;
    return {
      totalFrames: this.totalFrames,
      usedFrames: this.usedCount,
      freeFrames: free,
      reservedFrames: this.reservedFrames,
      totalBytes: this.totalFrames * PAGE_SIZE,
      usedBytes: this.usedCount * PAGE_SIZE,
      freeBytes: free * PAGE_SIZE,
    };
  }
}

// One process's virtual memory: a page table plus the frames it owns.
// OOM / no room returns null; invalid arguments throw.
export class AddressSpace {
  constructor(allocator) {
    this.allocator = allocator;
    this.table = new PageTable();
  }

  _checkRange(vpage, count) {
    if (!Number.isInteger(vpage) || !Number.isInteger(count) || count <= 0 || vpage < 0 || vpage + count > VIRTUAL_PAGES) {
      throw new RangeError(`Bad page range: ${vpage}+${count}`);
    }
  }

  // Map `count` fresh zeroed pages at virtual page `vpage`. Returns the base address or null (out of memory).
  allocate(vpage, count, perms) {
    this._checkRange(vpage, count);
    for (let i = 0; i < count; i++) if (this.table.isMapped(vpage + i)) throw new Error(`Virtual page ${vpage + i} already mapped`);
    const frames = this.allocator.allocate(count);
    if (!frames) return null;
    frames.forEach((f, i) => this.table.map(vpage + i, f, perms));
    return vpage * PAGE_SIZE;
  }

  // First-fit allocation of `bytes` (rounded up to pages). Page 0 is skipped (null-pointer trap).
  alloc(bytes, perms) {
    if (!Number.isInteger(bytes) || bytes <= 0) throw new RangeError('alloc(bytes): bytes must be a positive integer');
    const pages = Math.ceil(bytes / PAGE_SIZE);
    let run = 0;
    for (let p = 1; p < VIRTUAL_PAGES; p++) {
      run = this.table.isMapped(p) ? 0 : run + 1;
      if (run === pages) return this.allocate(p - pages + 1, pages, perms);
    }
    return null;
  }

  protect(vpage, count, perms) {
    this._checkRange(vpage, count);
    for (let i = 0; i < count; i++) if (!this.table.isMapped(vpage + i)) throw new Error(`Virtual page ${vpage + i} not mapped`);
    for (let i = 0; i < count; i++) this.table.map(vpage + i, this.table.get(vpage + i).frame, perms);
  }

  freePages(vpage, count) {
    this._checkRange(vpage, count);
    const frames = [];
    for (let i = 0; i < count; i++) {
      const e = this.table.get(vpage + i);
      if (!e) throw new Error(`Virtual page ${vpage + i} not mapped`);
      frames.push(e.frame);
    }
    this.allocator.free(frames);
    for (let i = 0; i < count; i++) this.table.unmap(vpage + i);
  }

  free(vaddr, bytes) {
    if (vaddr % PAGE_SIZE !== 0) throw new RangeError('free(vaddr): vaddr must be page-aligned');
    this.freePages(vaddr / PAGE_SIZE, Math.ceil(bytes / PAGE_SIZE));
  }

  destroy() {
    for (let p = 0; p < VIRTUAL_PAGES; p++) if (this.table.isMapped(p)) this.freePages(p, 1);
  }

  usage() {
    const pages = this.table.mappedCount();
    return { pages, bytes: pages * PAGE_SIZE };
  }

  _phys(vaddr) {
    const e = vaddr >= 0 && vaddr < VIRTUAL_PAGES * PAGE_SIZE ? this.table.get(vaddr >>> 12) : null;
    if (!e) throw new VoidFault('PAGE_FAULT', `Page fault: 0x${vaddr.toString(16)} is not mapped`);
    return e.frame * PAGE_SIZE + (vaddr & (PAGE_SIZE - 1));
  }

  // Kernel-privileged copy in/out (ignores permissions, never ignores mapping).
  poke(vaddr, bytes) {
    for (let i = 0; i < bytes.length; i++) this._phys(vaddr + i); // validate all first
    for (let i = 0; i < bytes.length; i++) this.allocator.ram.bytes[this._phys(vaddr + i)] = bytes[i];
  }

  peek(vaddr, length) {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = this.allocator.ram.bytes[this._phys(vaddr + i)];
    return out;
  }
}
