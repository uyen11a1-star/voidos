import { isBytes } from '../core/bytes.js';
import { MAX_IMAGE_SIZE } from '../instruction/assembler.js';

// VXEX executable: magic "VXEX" | version u8 | reserved u8 | codeLen u16 | dataLen u16 | code | data
// code is mapped read+execute at 0, data (if any) read+write at the following page boundary.
const MAGIC = [0x56, 0x58, 0x45, 0x58];
const HEADER = 10;

export class ExecFormatError extends Error {
  constructor(message) { super(message); this.name = 'ExecFormatError'; }
}

export function packExecutable({ image, dataStart }) {
  const codeLen = dataStart ?? image.length;
  const dataLen = dataStart === null ? 0 : image.length - dataStart;
  const out = new Uint8Array(HEADER + image.length);
  out.set(MAGIC, 0);
  out[4] = 1;
  out[6] = codeLen & 0xff; out[7] = codeLen >> 8;
  out[8] = dataLen & 0xff; out[9] = dataLen >> 8;
  out.set(image, HEADER);
  return out;
}

export function parseExecutable(bytes) {
  if (!isBytes(bytes) || bytes.length < HEADER || MAGIC.some((b, i) => bytes[i] !== b)) throw new ExecFormatError('Not a VoidOS executable (bad signature)');
  if (bytes[4] !== 1) throw new ExecFormatError(`Unsupported executable version ${bytes[4]}`);
  const codeLen = bytes[6] | (bytes[7] << 8);
  const dataLen = bytes[8] | (bytes[9] << 8);
  if (codeLen + dataLen !== bytes.length - HEADER) throw new ExecFormatError('Executable is truncated or corrupt');
  if (codeLen + dataLen > MAX_IMAGE_SIZE || codeLen === 0) throw new ExecFormatError('Executable has an invalid size');
  if (dataLen > 0 && codeLen % 4096 !== 0) throw new ExecFormatError('Data segment is not page-aligned');
  return { image: bytes.slice(HEADER), dataStart: dataLen > 0 ? codeLen : null };
}
