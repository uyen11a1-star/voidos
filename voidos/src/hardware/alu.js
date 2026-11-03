// 16-bit ALU. Each operation returns the 16-bit result and leaves the
// carry/overflow outcome in this.carry / this.overflow.
export class Alu {
  constructor() {
    this.carry = 0;
    this.overflow = 0;
  }

  add(a, b) {
    const full = a + b;
    const res = full & 0xffff;
    this.carry = full > 0xffff ? 1 : 0;
    this.overflow = (~(a ^ b) & (a ^ res) & 0x8000) !== 0 ? 1 : 0;
    return res;
  }

  // C = borrow (a < b, unsigned); V = signed overflow.
  sub(a, b) {
    const res = (a - b) & 0xffff;
    this.carry = a < b ? 1 : 0;
    this.overflow = ((a ^ b) & (a ^ res) & 0x8000) !== 0 ? 1 : 0;
    return res;
  }

  // C = V = 1 when the product does not fit in 16 bits.
  mul(a, b) {
    const full = a * b;
    this.carry = this.overflow = full > 0xffff ? 1 : 0;
    return full & 0xffff;
  }

  // Unsigned. Caller must reject b === 0.
  div(a, b) {
    this.carry = this.overflow = 0;
    return Math.floor(a / b);
  }

  mod(a, b) {
    this.carry = this.overflow = 0;
    return a % b;
  }

  and(a, b) { this.carry = this.overflow = 0; return a & b; }
  or(a, b) { this.carry = this.overflow = 0; return a | b; }
  xor(a, b) { this.carry = this.overflow = 0; return a ^ b; }
  not(a) { this.carry = this.overflow = 0; return ~a & 0xffff; }
}
