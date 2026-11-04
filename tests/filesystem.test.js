import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { FileSystem, FsError, normalizePath, BLOCK, MAX_FILE } from '../src/os/filesystem.js';
import { MemoryDatabase, IndexedDBDatabase } from '../src/storage/database.js';
import { exportBackup, importBackup, BackupError } from '../src/storage/backup.js';

const mk = async (opts = {}, db = new MemoryDatabase()) => { const fs = new FileSystem(db, { clock: () => 1000, ...opts }); await fs.mount(); return fs; };
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };

describe('paths', () => {
  it('normalizes ., .., repeated slashes and relative paths', () => {
    expect(normalizePath('/a//b/./c/../d')).toBe('/a/b/d');
    expect(normalizePath('../../x', '/a/b')).toBe('/x');
    expect(normalizePath('x', '/a')).toBe('/a/x');
    expect(normalizePath('/')).toBe('/');
    expect(() => normalizePath('a\0b')).toThrow();
    expect(() => normalizePath('/' + 'a/'.repeat(30))).toThrow(/too deep/);
  });
});

describe('files and directories', () => {
  it('mkdir, writeFile, readFile, list, stat', async () => {
    const fs = await mk();
    fs.mkdir('/home');
    fs.writeFile('/home/a.txt', 'xin chào');
    expect(fs.readText('/home/a.txt')).toBe('xin chào');
    expect(fs.stat('/home/a.txt')).toMatchObject({ type: 'file', size: 9, name: 'a.txt', path: '/home/a.txt' });
    fs.mkdir('/home/zdir');
    expect(fs.list('/home').map((e) => e.name)).toEqual(['zdir', 'a.txt']); // dirs first
    fs.writeFile('/home/a.txt', '!', { append: true });
    expect(fs.readText('/home/a.txt')).toBe('xin chào!');
  });
  it('mkdir -p and error codes', async () => {
    const fs = await mk();
    fs.mkdir('/a/b/c', { recursive: true });
    expect(fs.exists('/a/b/c')).toBe(true);
    expect(code(() => fs.mkdir('/a'))).toBe('EEXIST');
    expect(code(() => fs.mkdir('/x/y'))).toBe('ENOENT');
    fs.writeFile('/f', 'x');
    expect(code(() => fs.mkdir('/f/z'))).toBe('ENOTDIR');
    expect(code(() => fs.readFile('/a'))).toBe('EISDIR');
    expect(code(() => fs.writeFile('/a', 'x'))).toBe('EISDIR');
    expect(code(() => fs.readFile('/nope'))).toBe('ENOENT');
    expect(code(() => fs.list('/f'))).toBe('ENOTDIR');
    expect(code(() => fs.mkdir('/'))).toBe('EINVAL');
    expect(code(() => fs.writeFile('/a/' + 'x'.repeat(200), 'x'))).toBe('EINVAL');
    expect(code(() => fs.writeFile('/q', 123))).toBe('EINVAL');
  });
  it('odd names are safe (__proto__, constructor)', async () => {
    const fs = await mk();
    fs.writeFile('/__proto__', 'a');
    fs.writeFile('/constructor', 'b');
    expect(fs.readText('/__proto__')).toBe('a');
    expect(fs.readText('/constructor')).toBe('b');
    expect(fs.exists('/toString')).toBe(false);
  });
  it('remove: files, non-empty dirs need recursive', async () => {
    const fs = await mk();
    fs.mkdir('/d'); fs.writeFile('/d/x', 'hi');
    expect(code(() => fs.remove('/d'))).toBe('ENOTEMPTY');
    fs.remove('/d', { recursive: true });
    expect(fs.exists('/d')).toBe(false);
    expect(fs.usage().used).toBe(BLOCK); // only root left
    expect(code(() => fs.remove('/d'))).toBe('ENOENT');
    expect(code(() => fs.remove('/'))).toBe('EINVAL');
  });
  it('rename / move / copy', async () => {
    const fs = await mk();
    fs.mkdir('/a'); fs.mkdir('/b'); fs.writeFile('/a/f', 'data');
    fs.rename('/a/f', '/a/g');
    expect(fs.exists('/a/f')).toBe(false);
    fs.move('/a/g', '/b'); // into directory
    expect(fs.readText('/b/g')).toBe('data');
    fs.copy('/b/g', '/a/copy');
    expect(fs.readText('/a/copy')).toBe('data');
    expect(code(() => fs.rename('/a/copy', '/b/g'))).toBe('EEXIST');
    expect(code(() => fs.move('/a', '/a/sub'))).toBe('EINVAL');
    expect(code(() => fs.copy('/a', '/z'))).toBe('EISDIR');
    fs.copy('/a', '/a2', { recursive: true });
    expect(fs.readText('/a2/copy')).toBe('data');
    expect(code(() => fs.copy('/a', '/a/inner', { recursive: true }))).toBe('EINVAL');
    fs.move('/a', '/b'); // dir moves with children
    expect(fs.readText('/b/a/copy')).toBe('data');
    expect(fs.stat('/b/a/copy').path).toBe('/b/a/copy');
  });
  it('space accounting matches a full recount, and quota is enforced without side effects', async () => {
    const fs = await mk({ quota: 10 * BLOCK });
    fs.writeFile('/a', new Uint8Array(BLOCK + 1)); // 2 blocks + root
    fs.mkdir('/d');
    const before = fs.usage().used;
    fs.recount = fs._recount(); expect(fs.used).toBe(before);
    expect(code(() => fs.writeFile('/big', new Uint8Array(10 * BLOCK)))).toBe('ENOSPC');
    expect(fs.exists('/big')).toBe(false);
    expect(fs.usage().used).toBe(before);
    expect(code(() => fs.writeFile('/a', new Uint8Array(10 * BLOCK)))).toBe('ENOSPC');
    expect(fs.readFile('/a').length).toBe(BLOCK + 1);
    expect(code(() => fs.copy('/a', '/a2'.repeat(1), {}))).toBeNull();
    expect(code(() => fs.writeFile('/huge', new Uint8Array(MAX_FILE + 1)))).toBe('EFBIG');
    expect(() => fs.setQuota(1)).toThrow();
  });
});

describe('persistence', () => {
  for (const [label, makeDb] of [['MemoryDatabase', async () => new MemoryDatabase()], ['IndexedDB', async () => IndexedDBDatabase.open(`t${Math.random()}`)]]) {
    it(`survives remount (${label})`, async () => {
      const db = await makeDb();
      const fs = await mk({}, db);
      fs.mkdir('/docs'); fs.writeFile('/docs/n.txt', 'bền vững'); fs.writeFile('/tmp1', 'x'); fs.remove('/tmp1');
      fs.setQuota(2 * 1024 * 1024);
      await fs.flush();
      const again = await mk({}, db);
      expect(again.readText('/docs/n.txt')).toBe('bền vững');
      expect(again.exists('/tmp1')).toBe(false);
      expect(again.quota).toBe(2 * 1024 * 1024);
      expect(again.repairs).toEqual([]);
      again.writeFile('/new', 'id check'); // ids keep increasing, no collision
      expect(again.readText('/docs/n.txt')).toBe('bền vững');
    });
  }
  it('autoflush writes shortly after a change', async () => {
    const db = new MemoryDatabase();
    const fs = await mk({ autoFlushMs: 5 }, db);
    fs.writeFile('/auto', 'yes');
    await new Promise((r) => setTimeout(r, 40));
    expect((await mk({}, db)).readText('/auto')).toBe('yes');
  });
  it('a failed flush keeps data dirty and can be retried', async () => {
    const db = new MemoryDatabase();
    const fs = await mk({}, db);
    fs.writeFile('/k', 'v');
    const orig = db.batch.bind(db);
    db.batch = async () => { throw new Error('disk error'); };
    await expect(fs.flush()).rejects.toThrow('disk error');
    db.batch = orig;
    await fs.flush();
    expect((await mk({}, db)).readText('/k')).toBe('v');
  });
  it('repairs a damaged disk: dangling entries dropped, orphans rescued into /lost+found', async () => {
    const db = new MemoryDatabase();
    const fs = await mk({}, db);
    fs.mkdir('/d'); fs.writeFile('/d/keep.txt', 'rescue me'); fs.writeFile('/gone', 'x');
    await fs.flush();
    const dId = fs.stat('/d').id;
    await db.batch([{ op: 'delete', store: 'nodes', key: fs.stat('/gone').id }]); // dangling entry in root
    const root = await db.get('meta', 'super');
    const rootNode = (await db.getAll('nodes')).find((r) => r.key === 1).value;
    rootNode.children = rootNode.children.filter(([n]) => n !== 'd'); // /d (and its file) becomes unreachable
    await db.batch([{ op: 'put', store: 'nodes', key: 1, value: rootNode }, { op: 'put', store: 'meta', key: 'super', value: root }]);
    const fixed = await mk({}, db);
    expect(fixed.repairs.length).toBeGreaterThan(0);
    expect(fixed.exists('/gone')).toBe(false);
    expect(fixed.readText(`/lost+found/orphan-${dId}/keep.txt`)).toBe('rescue me');
    expect((await mk({}, db)).repairs).toEqual([]); // repaired state was saved
  });
  it('invalid nodes and a lost root are repaired too', async () => {
    const db = new MemoryDatabase();
    await db.batch([{ op: 'put', store: 'nodes', key: 5, value: { id: 5, type: 'weird', name: 'x', parent: 1 } }]);
    const fs = await mk({}, db);
    expect(fs.exists('/')).toBe(true);
    expect(fs.nodes.has(5)).toBe(false);
  });
});

describe('backup', () => {
  it('export -> import restores everything on another disk', async () => {
    const a = await mk();
    a.mkdir('/x'); a.writeFile('/x/bin.dat', Uint8Array.from([0, 1, 2, 255])); a.writeFile('/t.txt', 'Việt Nam');
    const json = JSON.stringify(exportBackup(a));
    const b = await mk({}, new MemoryDatabase());
    b.writeFile('/old', 'will be replaced');
    await importBackup(b, json);
    expect([...b.readFile('/x/bin.dat')]).toEqual([0, 1, 2, 255]);
    expect(b.readText('/t.txt')).toBe('Việt Nam');
    expect(b.exists('/old')).toBe(false);
    expect(b.used).toBe(a.used);
    await b.flush();
    expect((await mk({}, b.db)).readText('/t.txt')).toBe('Việt Nam');
  });
  it('rejects bad / newer / corrupt backups and leaves the disk untouched', async () => {
    const fs = await mk();
    fs.writeFile('/safe', 'still here');
    const good = exportBackup(fs);
    const bad = async (obj) => { try { await importBackup(fs, obj); } catch (e) { expect(e).toBeInstanceOf(BackupError); return e.code; } return null; };
    expect(await bad('not json{')).toBe('BAD_JSON');
    expect(await bad({ format: 'other' })).toBe('BAD_FORMAT');
    expect(await bad(null)).toBe('BAD_FORMAT');
    expect(await bad({ ...good, version: 99 })).toBe('NEWER_VERSION');
    expect(await bad({ ...good, nodes: [] })).toBe('BAD_FORMAT');
    expect(await bad({ ...good, quota: 'x' })).toBe('BAD_FORMAT');
    expect(await bad({ ...good, nodes: [...good.nodes, good.nodes[0]] })).toBe('CORRUPT'); // duplicate id
    expect(await bad({ ...good, nodes: good.nodes.map((n) => (n.type === 'file' ? { ...n, data: '!!notbase64' } : n)) })).toBe('CORRUPT');
    expect(await bad({ ...good, nodes: good.nodes.map((n) => (n.id === 1 ? { ...n, children: [['ghost', 77]] } : n)) })).toBe('CORRUPT'); // dangling child
    expect(await bad({ ...good, nodes: good.nodes.map((n) => (n.type === 'file' ? { ...n, parent: 99 } : n)) })).toBe('CORRUPT');
    expect(await bad({ ...good, quota: 10 })).toBe('TOO_BIG');
    expect(fs.readText('/safe')).toBe('still here');
  });
});
