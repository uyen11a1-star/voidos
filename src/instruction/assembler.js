import { BY_NAME, encode, shapeOf } from './instruction-set.js';

// Two-pass assembler for the VoidCPU.
//   pass 1: sizes + symbol table (labels, .equ)   pass 2: encode with all symbols known
// Syntax:  label:  MNEMONIC op, op   ; comment
// Directives: .org .equ .byte .word .string .ascii .space .data
// Throws AssemblyError (with .errors = [{line, message}]) listing every problem found.

export const MAX_IMAGE_SIZE = 0xf000; // 60 KB: the top page of the address space is the stack
const PAGE = 4096;
const MAX_ERRORS = 50;
const MAX_SOURCE = 1_000_000;
const REG_RE = /^R([0-7])$/i;
const OPERAND_COUNT = { none: 0, r: 1, rr: 2, ri: 2, i: 1, ld_i: 2, ld_r: 2, st_i: 2, st_r: 2 };

export class AssemblyError extends Error {
  constructor(errors) {
    super(errors.map((e) => `line ${e.line}: ${e.message}`).join('\n'));
    this.name = 'AssemblyError';
    this.errors = errors;
  }
}

class AsmError extends Error {} // per-line problem, collected by the caller

const ESCAPES = { n: 10, t: 9, r: 13, 0: 0, '\\': 92, "'": 39, '"': 34 };
function escapeValue(ch) {
  if (!Object.prototype.hasOwnProperty.call(ESCAPES, ch)) throw new AsmError(`Unknown escape "\\${ch}"`);
  return ESCAPES[ch];
}

function charValue(body) {
  if (body[0] === '\\') return escapeValue(body[1]);
  const cp = body.codePointAt(0);
  if (cp > 0x7f) throw new AsmError('Character literal must be ASCII (use .string for other text)');
  return cp;
}

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ';') return line.slice(0, i);
  }
  return line;
}

// Split on top-level commas (ignoring commas inside quotes or brackets).
function splitOperands(text) {
  const s = text.trim();
  if (!s) return [];
  const out = [];
  let quote = null, depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === ',' && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  if (out.some((o) => o === '')) throw new AsmError('Empty operand (stray comma?)');
  return out;
}

function evalExpr(text, symbols, pc) {
  const s = text.trim();
  if (!s) throw new AsmError('Missing value');
  let i = 0, total = 0, sign = 1, expectTerm = true;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (expectTerm) {
      if (c === '-') { sign = -sign; i++; continue; }
      if (c === '+') { i++; continue; }
      const rest = s.slice(i);
      let m, val;
      if ((m = /^0[xX][0-9a-fA-F]+/.exec(rest))) val = parseInt(m[0].slice(2), 16);
      else if ((m = /^0[bB][01]+/.exec(rest))) val = parseInt(m[0].slice(2), 2);
      else if ((m = /^[0-9]+/.exec(rest))) val = parseInt(m[0], 10);
      else if ((m = /^'(\\.|[^\\'])'/.exec(rest))) val = charValue(m[1]);
      else if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest))) {
        if (REG_RE.test(m[0])) throw new AsmError(`"${m[0]}" is a register, not a value`);
        if (!symbols.has(m[0])) throw new AsmError(`Undefined symbol "${m[0]}"`);
        val = symbols.get(m[0]);
      } else if (c === '$') { m = ['$']; val = pc; }
      else throw new AsmError(`Unexpected "${c}" in expression`);
      if (/^[A-Za-z0-9_]/.test(s[i + m[0].length] ?? '')) throw new AsmError(`Invalid number or name near "${rest.slice(0, 12)}"`);
      total += sign * val;
      sign = 1;
      expectTerm = false;
      i += m[0].length;
    } else if (c === '+') { expectTerm = true; sign = 1; i++; }
    else if (c === '-') { expectTerm = true; sign = -1; i++; }
    else throw new AsmError(`Unexpected "${c}" in expression (missing comma?)`);
  }
  if (expectTerm) throw new AsmError('Incomplete expression');
  return total;
}

function parseString(text) {
  const s = text.trim();
  if (s[0] !== '"') throw new AsmError('Expected a "string"');
  let out = '';
  let i = 1;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '"') break;
    if (c === '\\') out += String.fromCharCode(escapeValue(s[++i] ?? ''));
    else out += c;
  }
  if (s[i] !== '"') throw new AsmError('Unterminated string');
  if (i !== s.length - 1) throw new AsmError('Unexpected text after closing quote');
  return new TextEncoder().encode(out); // UTF-8
}

function parseReg(text) {
  const t = text.trim();
  const m = REG_RE.exec(t);
  if (m) return Number(m[1]);
  if (/^R\d+$/i.test(t)) throw new AsmError(`Register ${t} does not exist (R0-R7)`);
  throw new AsmError(`Expected register R0-R7, got "${t}"`);
}

function parseMem(text) {
  const t = text.trim();
  if (t[0] !== '[' || t[t.length - 1] !== ']') throw new AsmError(`Expected a memory operand like [R1] or [addr], got "${t}"`);
  return t.slice(1, -1);
}

function checkRange(v, lo, hi, what) {
  if (v < lo || v > hi) throw new AsmError(`${what} ${v} out of range (${lo}..${hi})`);
  return v;
}

function encodeInstruction(item, symbols) {
  const { name, operands, addr } = item;
  const shape = shapeOf(name);
  const want = OPERAND_COUNT[shape];
  if (operands.length !== want) throw new AsmError(`${name} takes ${want} operand${want === 1 ? '' : 's'}, got ${operands.length}`);
  const val = (t) => checkRange(evalExpr(t, symbols, addr), -0x8000, 0xffff, 'Value');
  const imm = (t) => {
    if (REG_RE.test(t.trim()) && name.endsWith('I') && BY_NAME[name.slice(0, -1)]) {
      throw new AsmError(`"${t.trim()}" is a register, not a value (use ${name.slice(0, -1)})`);
    }
    return val(t);
  };
  const second = (t) => {
    try { return parseReg(t); } catch (e) {
      if (BY_NAME[`${name}I`] && !/^R\d+$/i.test(t.trim())) throw new AsmError(`${e.message} (to use a constant, write ${name}I)`);
      throw e;
    }
  };
  switch (shape) {
    case 'none': return encode(name);
    case 'r': return encode(name, parseReg(operands[0]));
    case 'rr': return encode(name, parseReg(operands[0]), second(operands[1]));
    case 'ri': return encode(name, parseReg(operands[0]), 0, imm(operands[1]));
    case 'i': return encode(name, 0, 0, val(operands[0]));
    case 'ld_i': return encode(name, parseReg(operands[0]), 0, val(parseMem(operands[1])));
    case 'ld_r': return encode(name, parseReg(operands[0]), parseReg(parseMem(operands[1])));
    case 'st_i': return encode(name, parseReg(operands[1]), 0, val(parseMem(operands[0])));
    case 'st_r': return encode(name, parseReg(parseMem(operands[0])), parseReg(operands[1]));
    default: throw new Error(`Unhandled operand shape ${shape}`);
  }
}

export function assemble(source) {
  if (typeof source !== 'string') throw new TypeError('assemble(source): source must be a string');
  if (source.length > MAX_SOURCE) throw new AssemblyError([{ line: 1, message: 'Source too large (max 1,000,000 characters)' }]);

  const errors = [];
  const symbols = new Map();
  const items = [];
  let pc = 0;
  let dataStart = null;
  const lines = source.split(/\r?\n/);

  const fail = (line, e) => {
    if (!(e instanceof AsmError)) throw e;
    if (errors.length < MAX_ERRORS) errors.push({ line, message: e.message });
  };
  const advance = (n) => {
    if (pc + n > MAX_IMAGE_SIZE) throw new AsmError(`Program exceeds ${MAX_IMAGE_SIZE / 1024} KB (the top page is reserved for the stack)`);
    pc += n;
  };
  const define = (name, value) => {
    if (REG_RE.test(name)) throw new AsmError(`"${name}" is a register name and cannot be used as a label`);
    if (symbols.has(name)) throw new AsmError(`Duplicate symbol "${name}"`);
    symbols.set(name, value);
  };

  // ---- pass 1: sizes and symbols ----
  lines.forEach((raw, idx) => {
    const line = idx + 1;
    try {
      let text = stripComment(raw).trim();
      let m;
      while ((m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(text))) {
        define(m[1], pc);
        text = text.slice(m[0].length).trim();
      }
      if (!text) return;
      m = /^(\.?[A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/.exec(text);
      if (!m) throw new AsmError(`Cannot parse "${text.slice(0, 20)}"`);
      const word = m[1];
      const rest = m[2];
      if (word[0] === '.') {
        const dir = word.toLowerCase();
        const ops = splitOperands(rest);
        const now = (t) => evalExpr(t, symbols, pc); // must be resolvable immediately
        switch (dir) {
          case '.org': {
            if (ops.length !== 1) throw new AsmError('.org takes 1 operand');
            const target = checkRange(now(ops[0]), 0, MAX_IMAGE_SIZE, '.org address');
            if (target < pc) throw new AsmError(`.org 0x${target.toString(16)} would move backwards (current 0x${pc.toString(16)})`);
            items.push({ type: 'bytes', addr: pc, bytes: new Uint8Array(target - pc), line, silent: true });
            pc = target;
            break;
          }
          case '.equ': {
            if (ops.length !== 2) throw new AsmError('.equ takes NAME, value');
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ops[0])) throw new AsmError(`Invalid name "${ops[0]}"`);
            define(ops[0], now(ops[1]));
            break;
          }
          case '.space': {
            if (ops.length !== 1) throw new AsmError('.space takes 1 operand');
            const n = checkRange(now(ops[0]), 0, MAX_IMAGE_SIZE, '.space size');
            advance(n);
            items.push({ type: 'bytes', addr: pc - n, bytes: new Uint8Array(n), line, silent: false });
            break;
          }
          case '.data': {
            if (ops.length !== 0) throw new AsmError('.data takes no operands');
            if (dataStart !== null) throw new AsmError('.data used twice');
            const target = Math.ceil(pc / PAGE) * PAGE;
            if (target > MAX_IMAGE_SIZE) throw new AsmError('No room left for a data page');
            items.push({ type: 'bytes', addr: pc, bytes: new Uint8Array(target - pc), line, silent: true });
            pc = target;
            dataStart = target;
            break;
          }
          case '.byte':
          case '.word': {
            if (ops.length === 0) throw new AsmError(`${dir} needs at least one value`);
            const size = dir === '.byte' ? 1 : 2;
            items.push({ type: dir.slice(1), addr: pc, operands: ops, line });
            advance(size * ops.length);
            break;
          }
          case '.string':
          case '.ascii': {
            if (ops.length === 0) throw new AsmError(`${dir} needs a "string"`);
            const parts = ops.map(parseString);
            if (dir === '.string') parts.push(new Uint8Array([0]));
            const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
            let o = 0;
            for (const p of parts) { bytes.set(p, o); o += p.length; }
            items.push({ type: 'bytes', addr: pc, bytes, line, silent: false });
            advance(bytes.length);
            break;
          }
          default: throw new AsmError(`Unknown directive ${word}`);
        }
        return;
      }
      const name = word.toUpperCase();
      if (!BY_NAME[name]) throw new AsmError(`Unknown instruction "${word}"`);
      if (dataStart !== null) throw new AsmError('Instructions are not allowed after .data (data pages are not executable)');
      items.push({ type: 'ins', addr: pc, name, operands: splitOperands(rest), line });
      advance(4);
    } catch (e) { fail(line, e); }
  });

  // ---- pass 2: encode ----
  const image = new Uint8Array(pc);
  const listing = [];
  for (const item of items) {
    try {
      let bytes;
      if (item.type === 'bytes') bytes = item.bytes;
      else if (item.type === 'ins') bytes = encodeInstruction(item, symbols);
      else {
        const vals = item.operands.map((t) => (item.type === 'byte'
          ? checkRange(evalExpr(t, symbols, item.addr), -128, 255, 'Byte value')
          : checkRange(evalExpr(t, symbols, item.addr), -0x8000, 0xffff, 'Word value')));
        bytes = item.type === 'byte' ? vals.map((v) => v & 0xff) : vals.flatMap((v) => [v & 0xff, (v >> 8) & 0xff]);
      }
      image.set(bytes, item.addr);
      if (!item.silent) listing.push({ line: item.line, addr: item.addr, bytes: Array.from(bytes.slice(0, 8)), size: bytes.length, source: lines[item.line - 1].trim() });
    } catch (e) { fail(item.line, e); }
  }

  if (errors.length) {
    errors.sort((a, b) => a.line - b.line);
    throw new AssemblyError(errors);
  }
  return { image, symbols, listing, dataStart };
}
