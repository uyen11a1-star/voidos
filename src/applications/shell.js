import { normalizePath } from '../os/filesystem.js';
import { hexdump } from '../hardware/memory-inspector.js';

const kb = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

// Splits a command line; supports "double" and 'single' quotes and the > / >> redirection operators.
export function tokenize(line) {
  const out = [];
  let cur = '', quote = null, has = false;
  const flush = () => { if (has) out.push(cur); cur = ''; has = false; };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === quote) quote = null; else cur += c; continue; }
    if (c === '"' || c === "'") { quote = c; has = true; } else if (/\s/.test(c)) flush();
    else if (c === '>') { flush(); if (line[i + 1] === '>') { out.push('>>'); i++; } else out.push('>'); } else { cur += c; has = true; }
  }
  if (quote) throw new Error('unterminated quote');
  flush();
  return out;
}

const need = (a, n, usage) => { if (a.length < n) throw new Error(`usage: ${usage}`); };
const flags = (a) => ({ f: new Set(a.filter((x) => /^-[a-z]+$/.test(x)).flatMap((x) => [...x.slice(1)])), rest: a.filter((x) => !/^-[a-z]+$/.test(x)) });

const COMMANDS = {
  help: (sh, a, out) => out(`Lệnh: ${Object.keys(COMMANDS).join(' ')}\nChạy chương trình: run <file.vx> | Biên dịch: asm <src.asm> [out.vx] | Ctrl+C: nút ^C\n`),
  clear: (sh) => sh.clear(),
  pwd: (sh, a, out) => out(`${sh.cwd}\n`),
  cd: (sh, a) => {
    const p = a[0] ? sh.path(a[0]) : sh.home;
    if (sh.sys('fs.stat', p).type !== 'dir') throw new Error(`Not a directory: ${p}`);
    sh.cwd = p;
  },
  ls: (sh, a, out) => {
    const { f, rest } = flags(a);
    const p = sh.path(rest[0] ?? '.');
    const st = sh.sys('fs.stat', p);
    const items = st.type === 'dir' ? sh.sys('fs.list', p) : [st];
    if (f.has('l')) for (const e of items) out(`${e.type === 'dir' ? 'd' : '-'} ${(e.type === 'dir' ? `${e.entries} items` : kb(e.size)).padStart(10)}  ${e.name}${e.type === 'dir' ? '/' : ''}\n`);
    else out(`${items.map((e) => e.name + (e.type === 'dir' ? '/' : '')).join('  ')}\n`);
  },
  stat: (sh, a, out) => { need(a, 1, 'stat <path>'); const s = sh.sys('fs.stat', sh.path(a[0])); out(`${s.path}\n  type: ${s.type}  size: ${kb(s.size)}  entries: ${s.entries}\n  created: ${new Date(s.ctime).toLocaleString()}\n  modified: ${new Date(s.mtime).toLocaleString()}\n`); },
  mkdir: (sh, a) => { const { f, rest } = flags(a); need(rest, 1, 'mkdir [-p] <dir>...'); rest.forEach((d) => sh.sys('fs.mkdir', sh.path(d), { recursive: f.has('p') })); },
  touch: (sh, a) => { need(a, 1, 'touch <file>...'); a.forEach((p) => { const f = sh.path(p); sh.sys('fs.write', f, sh.sys('fs.exists', f) ? sh.sys('fs.readBytes', f) : ''); }); },
  cat: (sh, a, out) => { need(a, 1, 'cat <file>...'); a.forEach((p) => out(sh.sys('fs.read', sh.path(p)))); },
  write: (sh, a) => { need(a, 2, 'write <file> <text...>'); sh.sys('fs.write', sh.path(a[0]), a.slice(1).join(' ')); },
  rm: (sh, a) => { const { f, rest } = flags(a); need(rest, 1, 'rm [-r] <path>...'); rest.forEach((p) => sh.sys('fs.remove', sh.path(p), { recursive: f.has('r') })); },
  cp: (sh, a) => { const { f, rest } = flags(a); need(rest, 2, 'cp [-r] <from> <to>'); sh.sys('fs.copy', sh.path(rest[0]), sh.path(rest[1]), { recursive: f.has('r') }); },
  mv: (sh, a) => { need(a, 2, 'mv <from> <to>'); sh.sys('fs.move', sh.path(a[0]), sh.path(a[1])); },
  echo: (sh, a, out) => out(`${a.join(' ')}\n`),
  hexdump: (sh, a, out) => {
    need(a, 1, 'hexdump <file>');
    const b = sh.sys('fs.readBytes', sh.path(a[0]));
    out(`${hexdump({ peek8: (i) => (i < b.length ? b[i] : null) }, 0, Math.min(256, b.length), 8)}\n`);
  },
  ps: (sh, a, out) => {
    out('PID  STATE      CYCLES      MEM    NAME\n');
    for (const p of sh.sys('proc.list')) out(`${String(p.pid).padEnd(4)} ${p.state.padEnd(10)} ${String(p.cycles).padEnd(10)} ${kb(p.bytes).padEnd(6)} ${p.name}\n`);
  },
  kill: (sh, a) => { need(a, 1, 'kill <pid>'); sh.sys('proc.kill', Number(a[0])); },
  suspend: (sh, a) => { need(a, 1, 'suspend <pid>'); sh.sys('proc.suspend', Number(a[0])); },
  resume: (sh, a) => { need(a, 1, 'resume <pid>'); sh.sys('proc.resume', Number(a[0])); },
  free: (sh, a, out) => { const m = sh.sys('sys.mem'); out(`RAM  total ${kb(m.totalBytes)}  used ${kb(m.usedBytes)}  free ${kb(m.freeBytes)}\nframes: ${m.usedFrames}/${m.totalFrames} used (${m.reservedFrames} reserved for the kernel)\n`); },
  df: (sh, a, out) => { const u = sh.sys('fs.usage'); out(`disk0  quota ${kb(u.quota)}  used ${kb(u.used)}  free ${kb(u.free)}  (${u.files} files, ${u.dirs} dirs)\n`); },
  cpuinfo: (sh, a, out) => { const i = sh.sys('sys.info'); out(`${i.cpu}\n  registers: R0-R7, PC, SP, FLAGS(Z,N,C,V)\n  address space: 64 KB virtual, 4 KB pages (R/W/X)\n  load: ${(sh.sys('sys.cpu') * 100).toFixed(1)}%   cycles executed: ${i.totalCycles}\n`); },
  meminfo: (sh, a, out) => {
    const m = sh.sys('sys.mem');
    out(`physical: ${kb(m.totalBytes)}  used: ${kb(m.usedBytes)}  free: ${kb(m.freeBytes)}\n`);
    for (const p of sh.sys('proc.list')) out(`  pid ${p.pid} ${p.name}: ${p.pages} pages (${kb(p.bytes)})\n`);
  },
  uptime: (sh, a, out) => out(`up ${(sh.sys('sys.uptime') / 1000).toFixed(0)} s\n`),
  reboot: (sh) => sh.sys('sys.power', 'reboot'),
  shutdown: (sh) => sh.sys('sys.power', 'shutdown'),
  asm: (sh, a, out) => {
    need(a, 1, 'asm <src.asm> [out.vx]');
    const src = sh.path(a[0]);
    const dst = sh.path(a[1] ?? src.replace(/\.asm$/, '') + '.vx');
    const r = sh.sys('sys.assemble', src, dst);
    out(`assembled ${src} -> ${dst} (${r.size} bytes)\n`);
  },
  run: (sh, a) => {
    need(a, 1, 'run <file.vx>');
    sh.fg = sh.sys('proc.spawn', sh.path(a[0]), {
      onOutput: (s) => sh.write(s),
      onExit: (r) => { sh.fg = null; if (r.signal) sh.write('\n[killed]\n'); else if (r.exitCode) sh.write(`\n[exit ${r.exitCode}]\n`); sh.prompt(); },
    });
  },
  apps: (sh, a, out) => { const l = sh.sys('app.list'); out(l.length ? `${l.map((x) => `${x.id} (${x.name}) ${x.path}`).join('\n')}\n` : 'no installed apps\n'); },
  install: (sh, a, out) => { need(a, 1, 'install <file.vx> [id] [name]'); const r = sh.sys('app.install', sh.path(a[0]), a[1], a[2]); out(`installed "${r.id}" (opens from the Start menu)\n`); },
  uninstall: (sh, a) => { need(a, 1, 'uninstall <id>'); sh.sys('app.uninstall', a[0]); },
};

export class Shell {
  // sys: (name, ...args) => result, the only way the shell touches the system
  constructor(sys, { write, clear = () => {}, prompt = () => {}, home = '/home/user' }) {
    this.sys = sys; this.write = write; this.clear = clear; this.prompt = prompt; this.home = home;
    this.cwd = home; this.fg = null; this.history = [];
  }

  path(p) { return normalizePath(p, this.cwd); }

  exec(line) {
    line = line.trim();
    if (this.fg !== null) { // a program is running: the line is its input
      try { this.sys('proc.stdin', this.fg, `${line}\n`); } catch (e) { this.write(`${e.message}\n`); }
      return;
    }
    if (!line) return;
    this.history.push(line);
    let tokens;
    try { tokens = tokenize(line); } catch (e) { this.write(`${e.message}\n`); return; }
    let out = this.write, target = null, append = false, buf = '';
    const ri = tokens.findIndex((t) => t === '>' || t === '>>');
    if (ri >= 0) {
      target = tokens[ri + 1]; append = tokens[ri] === '>>';
      if (!target) { this.write('syntax error: missing file after >\n'); return; }
      tokens = [...tokens.slice(0, ri), ...tokens.slice(ri + 2)];
      out = (s) => { buf += s; };
    }
    const [cmd, ...args] = tokens;
    if (!cmd) return;
    const fn = Object.prototype.hasOwnProperty.call(COMMANDS, cmd) ? COMMANDS[cmd] : null;
    if (!fn) { this.write(`${cmd}: command not found (type help)\n`); return; }
    try {
      fn(this, args, out);
      if (target) this.sys('fs.write', this.path(target), buf, { append });
    } catch (e) { this.write(`${cmd}: ${e.message}\n`); }
  }

  interrupt() { if (this.fg !== null) { try { this.sys('proc.kill', this.fg); } catch { /* already gone */ } } }
}
