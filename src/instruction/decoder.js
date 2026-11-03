import { BY_CODE, shapeOf } from './instruction-set.js';

const num = (n) => (n < 10 ? String(n) : `0x${n.toString(16)}`);

// Disassemble 4-byte instructions. Undecodable words come out as .byte so the
// listing never hides data. Output reassembles to the same bytes.
export function disassemble(bytes, start = 0) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 4) {
    const w = Array.from(bytes.slice(i, i + 4));
    const def = w.length === 4 ? BY_CODE[w[0]] : null;
    const rd = w.length === 4 ? w[1] >> 4 : 0;
    const rs = w.length === 4 ? w[1] & 15 : 0;
    const bad = !def || (def.fmt !== 'none' && def.fmt !== 'i' && rd > 7) || (def.fmt === 'rr' && rs > 7);
    if (bad) {
      out.push({ addr: start + i, bytes: w, text: `.byte ${w.map((b) => `0x${b.toString(16)}`).join(', ')}` });
      continue;
    }
    const imm = w[2] | (w[3] << 8);
    const R = (n) => `R${n}`;
    let ops;
    switch (shapeOf(def.name)) {
      case 'none': ops = ''; break;
      case 'r': ops = R(rd); break;
      case 'rr': ops = `${R(rd)}, ${R(rs)}`; break;
      case 'ri': ops = `${R(rd)}, ${num(imm)}`; break;
      case 'i': ops = num(imm); break;
      case 'ld_i': ops = `${R(rd)}, [${num(imm)}]`; break;
      case 'ld_r': ops = `${R(rd)}, [${R(rs)}]`; break;
      case 'st_i': ops = `[${num(imm)}], ${R(rd)}`; break;
      case 'st_r': ops = `[${R(rd)}], ${R(rs)}`; break;
      default: ops = '';
    }
    out.push({ addr: start + i, bytes: w, text: ops ? `${def.name.padEnd(7)} ${ops}` : def.name });
  }
  return out;
}
