import { RAM } from '../hardware/ram.js';
import { CPU } from '../hardware/cpu.js';
import { MMU, PERM, VIRTUAL_PAGES } from '../hardware/mmu.js';
import { FrameAllocator, AddressSpace } from '../os/memory-manager.js';
import { PAGE_SIZE } from '../hardware/ram.js';

// Frame 0..reservedFrames-1 stay reserved for the (future) kernel.
export function createMachine({ ramSize = 1024 * 1024, reservedFrames = 1 } = {}) {
  const ram = new RAM(ramSize);
  const allocator = new FrameAllocator(ram, { reservedFrames });
  return { ram, allocator };
}

const STACK_PAGE = VIRTUAL_PAGES - 1; // stack grows down from the top of the address space

// Build a process: segments = [{ addr, bytes, perms }] laid out at virtual addresses,
// plus a read/write stack page at the top. Returns { space, mmu, cpu }.
// (Phase 5 replaces this with a real executable format + loader.)
export function spawn(machine, { segments, io = {}, syscall = null }) {
  const space = new AddressSpace(machine.allocator);
  try {
    const pagePerms = new Map();
    for (const seg of segments) {
      const first = Math.floor(seg.addr / PAGE_SIZE);
      const last = Math.floor((seg.addr + seg.bytes.length - 1) / PAGE_SIZE);
      if (last >= STACK_PAGE) throw new RangeError('Segment overlaps the stack page');
      for (let p = first; p <= last; p++) pagePerms.set(p, (pagePerms.get(p) ?? 0) | seg.perms);
    }
    for (const p of pagePerms.keys()) {
      if (space.allocate(p, 1, PERM.R | PERM.W) === null) throw new Error('Out of memory');
    }
    for (const seg of segments) space.poke(seg.addr, seg.bytes);
    for (const [p, perms] of pagePerms) space.protect(p, 1, perms);
    if (space.allocate(STACK_PAGE, 1, PERM.R | PERM.W) === null) throw new Error('Out of memory');
  } catch (e) {
    space.destroy(); // never leak frames on a failed spawn
    throw e;
  }
  const mmu = new MMU(machine.ram);
  mmu.activate(space.table);
  const cpu = new CPU(mmu, { io, syscall });
  cpu.reset(0);
  return { space, mmu, cpu };
}

// Spawn an assembled program: everything before dataStart is code (R+X),
// everything from dataStart on is data (R+W, not executable).
export function spawnImage(machine, program, opts = {}) {
  const { image, dataStart } = program;
  const codeEnd = dataStart ?? image.length;
  const segments = [];
  if (codeEnd > 0) segments.push({ addr: 0, bytes: image.subarray(0, codeEnd), perms: PERM.R | PERM.X });
  if (dataStart !== null && image.length > dataStart) {
    segments.push({ addr: dataStart, bytes: image.subarray(dataStart), perms: PERM.R | PERM.W });
  }
  if (segments.length === 0) throw new RangeError('Empty program');
  return spawn(machine, { segments, ...opts });
}
