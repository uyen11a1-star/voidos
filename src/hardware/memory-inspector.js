// Hex + ASCII memory views. `src` is anything with peek8(addr) -> number|null
// (physical RAM or an MMU). Unreadable bytes show as "??" / "?".
export function dumpRows(src, start, length, width = 16) {
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(length) || length < 0 || !Number.isInteger(width) || width <= 0) {
    throw new RangeError('hexdump: start/length/width must be non-negative integers (width > 0)');
  }
  const rows = [];
  for (let off = 0; off < length; off += width) {
    const n = Math.min(width, length - off);
    const bytes = [];
    for (let i = 0; i < n; i++) bytes.push(src.peek8(start + off + i));
    const ascii = bytes.map((b) => (b === null ? '?' : b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    rows.push({ addr: start + off, bytes, ascii });
  }
  return rows;
}

export function hexdump(src, start, length, width = 16) {
  return dumpRows(src, start, length, width)
    .map((r) => {
      const cells = r.bytes.map((b) => (b === null ? '??' : b.toString(16).padStart(2, '0'))).join(' ');
      return `${r.addr.toString(16).padStart(8, '0')}  ${cells.padEnd(width * 3 - 1)}  |${r.ascii}|`;
    })
    .join('\n');
}
