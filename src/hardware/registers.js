// Flag bits in the FLAGS register.
export const FLAG = Object.freeze({ Z: 1, N: 2, C: 4, V: 8 });

export class RegisterFile {
  constructor() {
    this.r = new Uint16Array(8); // R0..R7, auto-wrapped to 16 bits
    this.pc = 0;
    this.sp = 0;
    this.flags = 0;
  }

  reset(entry = 0, sp = 0) {
    this.r.fill(0);
    this.pc = entry & 0xffff;
    this.sp = sp & 0xffff; // stack grows down; 0 wraps to 0xFFFE on first push
    this.flags = 0;
  }
}
