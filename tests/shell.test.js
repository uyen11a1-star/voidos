import { describe, it, expect } from 'vitest';
import { bootSystem } from './helpers-os.js';
import { Shell, tokenize } from '../src/applications/shell.js';

async function mk() {
  const s = await bootSystem();
  const sh = new Shell((n, ...a) => s.kernel.call(n, ...a), { write: (t) => { sh.out += t; }, clear: () => { sh.out = ''; sh.cleared = true; }, prompt: () => { sh.prompts++; } });
  sh.out = ''; sh.prompts = 0;
  sh.run = (line) => { sh.out = ''; sh.exec(line); const o = sh.out; return o; };
  return { s, sh };
}

describe('tokenize', () => {
  it('quotes and redirection', () => {
    expect(tokenize('echo "a b"  c')).toEqual(['echo', 'a b', 'c']);
    expect(tokenize("echo 'x y'>>f")).toEqual(['echo', 'x y', '>>', 'f']);
    expect(tokenize('echo hi > f')).toEqual(['echo', 'hi', '>', 'f']);
    expect(tokenize('echo ""')).toEqual(['echo', '']);
    expect(() => tokenize('echo "oops')).toThrow(/unterminated/);
  });
});

describe('file commands act on the real filesystem', () => {
  it('pwd cd ls mkdir touch write cat echo redirects', async () => {
    const { s, sh } = await mk();
    expect(sh.run('pwd')).toBe('/home/user\n');
    expect(sh.run('ls')).toContain('welcome.txt');
    expect(sh.run('ls -l /bin')).toContain('fib.vx');
    sh.run('mkdir -p a/b/c'); expect(s.fs.exists('/home/user/a/b/c')).toBe(true);
    sh.run('cd a/b'); expect(sh.run('pwd')).toBe('/home/user/a/b\n');
    sh.run('touch x.txt'); expect(s.fs.stat('/home/user/a/b/x.txt').size).toBe(0);
    sh.run('write y.txt xin chào'); expect(sh.run('cat y.txt')).toBe('xin chào');
    sh.run('echo một > z.txt'); sh.run('echo hai >> z.txt');
    expect(s.fs.readText('/home/user/a/b/z.txt')).toBe('một\nhai\n');
    sh.run('ls > list.txt'); expect(s.fs.readText('/home/user/a/b/list.txt')).toContain('x.txt');
    sh.run('cd /'); sh.run('cd'); expect(sh.cwd).toBe('/home/user');
    sh.run('cd ../..'); expect(sh.cwd).toBe('/');
  });
  it('cp mv rm incl. recursive flags', async () => {
    const { s, sh } = await mk();
    sh.run('mkdir d'); sh.run('write d/f data');
    expect(sh.run('cp d e')).toContain('Is a directory');
    sh.run('cp -r d e'); expect(s.fs.readText('/home/user/e/f')).toBe('data');
    sh.run('mv e/f e/g'); expect(s.fs.exists('/home/user/e/g')).toBe(true);
    expect(sh.run('rm e')).toContain('not empty');
    sh.run('rm -r e d'); expect(s.fs.exists('/home/user/e')).toBe(false);
  });
  it('errors are readable, never thrown', async () => {
    const { sh } = await mk();
    expect(sh.run('cat /nope')).toContain('No such file');
    expect(sh.run('cd /etc/config.json')).toContain('Not a directory');
    expect(sh.run('mkdir')).toContain('usage');
    expect(sh.run('bogus')).toContain('command not found');
    expect(sh.run('constructor')).toContain('command not found');
    expect(sh.run('echo hi >')).toContain('syntax error');
    expect(sh.run('echo "x')).toContain('unterminated');
    expect(sh.run('write /f')).toContain('usage');
    expect(sh.run('kill 999')).toContain('No such process');
  });
  it('clear and help', async () => {
    const { sh } = await mk();
    sh.run('clear'); expect(sh.cleared).toBe(true);
    const h = sh.run('help');
    for (const c of ['ls', 'cd', 'pwd', 'mkdir', 'touch', 'cat', 'write', 'rm', 'cp', 'mv', 'echo', 'ps', 'kill', 'free', 'df', 'cpuinfo', 'meminfo', 'reboot', 'shutdown']) expect(h).toContain(c);
  });
});

describe('system commands show real state', () => {
  it('free / df / meminfo / cpuinfo match the kernel', async () => {
    const { s, sh } = await mk();
    const m = s.kernel.memStats();
    expect(sh.run('free')).toContain(`frames: ${m.usedFrames}/${m.totalFrames}`);
    expect(sh.run('df')).toContain(`${s.fs.usage().files} files`);
    expect(sh.run('cpuinfo')).toContain('VoidCPU 16-bit');
    s.kernel.spawnFile('/bin/echo.vx');
    expect(sh.run('meminfo')).toMatch(/pid 1 echo\.vx: 2 pages/);
  });
  it('hexdump, stat, uptime', async () => {
    const { sh } = await mk();
    expect(sh.run('hexdump /boot/kernel.vx')).toContain('|VKRN');
    expect(sh.run('stat /etc')).toContain('type: dir');
    expect(sh.run('uptime')).toMatch(/up \d+ s/);
  });
  it('reboot / shutdown go through sys.power', async () => {
    const { s, sh } = await mk();
    const seen = []; s.events.on('power', (a) => seen.push(a));
    sh.run('reboot'); sh.run('shutdown');
    expect(seen).toEqual(['reboot', 'shutdown']);
  });
});

describe('running programs from the shell', () => {
  it('run prints output, then returns the prompt', async () => {
    const { s, sh } = await mk();
    sh.out = ''; sh.exec('run /bin/hello.vx');
    expect(sh.fg).not.toBeNull();
    s.kernel.runUntilIdle();
    expect(sh.out).toBe('Xin chào VoidOS!\n');
    expect(sh.fg).toBeNull();
    expect(sh.prompts).toBe(1);
  });
  it('typed lines become stdin of the foreground program; ps and ^C work', async () => {
    const { s, sh } = await mk();
    sh.exec('run /bin/echo.vx');
    s.kernel.tick();
    sh.out = ''; sh.exec('ps'); // foreground program owns the terminal: this line is its input
    sh.exec('q');
    s.kernel.runUntilIdle();
    expect(sh.out).toContain('ps\n'); // echo.vx printed the typed line back
    expect(sh.fg).toBeNull();
    sh.exec('run /bin/echo.vx'); s.kernel.tick();
    sh.interrupt();
    expect(sh.fg).toBeNull();
    expect(sh.out).toContain('[killed]');
    expect(s.kernel.list()).toEqual([]);
  });
  it('ps lists live processes with their state', async () => {
    const { s, sh } = await mk();
    const pid = s.kernel.spawnFile('/bin/echo.vx'); s.kernel.tick();
    const ps = sh.run('ps');
    expect(ps).toContain('PID'); expect(ps).toMatch(new RegExp(`${pid}\\s+waiting`)); expect(ps).toContain('echo.vx');
    sh.run(`kill ${pid}`); expect(s.kernel.list()).toEqual([]);
  });
  it('asm builds a program from source, install/apps/uninstall manage it', async () => {
    const { s, sh } = await mk();
    sh.run('write p.asm "MOVI R0, 90\nPRINT R0\nHALT"');
    s.fs.writeFile('/home/user/p.asm', 'MOVI R0, 90\nPRINT R0\nHALT');
    expect(sh.run('asm p.asm')).toContain('/home/user/p.vx');
    sh.exec('run p.vx'); s.kernel.runUntilIdle();
    expect(sh.out).toContain('Z');
    expect(sh.run('install p.vx zed Zed')).toContain('installed "zed"');
    expect(sh.run('apps')).toContain('zed (Zed)');
    sh.run('uninstall zed'); expect(sh.run('apps')).toContain('no installed apps');
  });
  it('assembler errors are shown with line numbers', async () => {
    const { s, sh } = await mk();
    s.fs.writeFile('/home/user/bad.asm', 'NOP\nFOO R1\nJMP nowhere');
    const o = sh.run('asm bad.asm');
    expect(o).toContain('line 2: Unknown instruction "FOO"');
    expect(o).toContain('line 3: Undefined symbol "nowhere"');
    expect(s.fs.exists('/home/user/bad.vx')).toBe(false);
  });
  it('running a non-executable shows an error', async () => {
    const { sh } = await mk();
    expect(sh.run('run welcome.txt')).toContain('signature');
    expect(sh.run('run missing.vx')).toContain('No such file');
  });
});
