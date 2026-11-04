// VoidFS: inode-style tree held in memory, persisted node-by-node through a database.
// Space is accounted in 512-byte blocks (files) and one block per directory.
import { isBytes } from '../core/bytes.js';

export const BLOCK = 512;
export const MAX_FILE = 1024 * 1024;
export const MAX_NAME = 128;
export const MAX_DEPTH = 24;
export const MAX_NODES = 20000;
const blocks = (n) => Math.ceil(n / BLOCK) * BLOCK;
const enc = new TextEncoder();
const dec = new TextDecoder();

export class FsError extends Error {
  constructor(code, message) { super(message ?? code); this.name = 'FsError'; this.code = code; }
}

export function normalizePath(path, cwd = '/') {
  if (typeof path !== 'string' || path.includes('\0')) throw new FsError('EINVAL', 'Invalid path');
  const out = [];
  for (const p of (path.startsWith('/') ? path : `${cwd}/${path}`).split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop(); else out.push(p);
  }
  if (out.length > MAX_DEPTH) throw new FsError('EINVAL', 'Path too deep');
  return `/${out.join('/')}`;
}

const validName = (n) => typeof n === 'string' && n.length > 0 && n.length <= MAX_NAME && !n.includes('/') && !n.includes('\0') && n !== '.' && n !== '..';
const cost = (n) => (n.type === 'dir' ? BLOCK : blocks(n.data.length));
const serialize = (n) => (n.type === 'dir' ? { ...n, children: [...n.children] } : { ...n });
const hydrate = (r) => (r && r.type === 'dir' && Array.isArray(r.children) ? { ...r, children: new Map(r.children) } : r);

export class FileSystem {
  constructor(db, { quota = 8 * 1024 * 1024, clock = Date.now, autoFlushMs = 0 } = {}) {
    this.db = db;
    this.quota = quota;
    this.clock = clock;
    this.autoFlushMs = autoFlushMs;
    this.nodes = new Map();
    this.nextId = 2;
    this.dirty = new Set();
    this.deleted = new Set();
    this.metaDirty = false;
    this.used = 0;
    this.repairs = [];
    this.onFlushError = null;
    this._timer = null;
    this._chain = Promise.resolve();
  }

  // ---- mount / integrity ----
  async mount() {
    const rows = await this.db.getAll('nodes');
    const meta = await this.db.get('meta', 'super');
    this.nodes = new Map(rows.map((r) => [r.key, hydrate(r.value)]));
    if (meta) { if (Number.isInteger(meta.quota)) this.quota = meta.quota; this.nextId = meta.nextId ?? 2; }
    if (rows.length === 0) this._makeRoot();
    this.repairs = this._verify(this.nodes, true);
    for (const id of this.nodes.keys()) if (id >= this.nextId) this.nextId = id + 1;
    this._recount();
    if (rows.length === 0 || this.repairs.length) {
      this.nodes.forEach((_, id) => this.dirty.add(id));
      this.metaDirty = true;
      await this.flush();
    }
    return this;
  }

  _makeRoot(map = this.nodes) {
    const t = this.clock();
    map.set(1, { id: 1, type: 'dir', name: '', parent: 0, ctime: t, mtime: t, children: new Map() });
    this.dirty.add(1);
  }

  // Returns a list of problems; with repair=true fixes them (orphans go to /lost+found).
  _verify(map, repair) {
    const problems = [];
    for (const [id, n] of [...map]) {
      const ok = n && n.id === id && Number.isInteger(id) && id >= 1 && typeof n.name === 'string'
        && (n.type === 'file' ? isBytes(n.data) && n.data.length <= MAX_FILE : n.type === 'dir' && n.children instanceof Map);
      if (!ok) { problems.push(`invalid node ${id}`); if (repair) map.delete(id); }
    }
    if (!map.has(1) || map.get(1).type !== 'dir') {
      problems.push('missing root');
      if (repair) this._makeRoot(map);
    }
    for (const dir of map.values()) {
      if (dir.type !== 'dir') continue;
      for (const [name, cid] of [...dir.children]) {
        const c = map.get(cid);
        if (!validName(name) || !c || c.parent !== dir.id || c.name !== name) {
          problems.push(`bad entry "${name}" in node ${dir.id}`);
          if (repair) dir.children.delete(name);
        }
      }
    }
    const reach = () => {
      const seen = new Set([1]);
      const stack = [1];
      while (stack.length) for (const cid of map.get(stack.pop()).children?.values() ?? []) if (!seen.has(cid)) { seen.add(cid); stack.push(cid); }
      return seen;
    };
    let seen = reach();
    const lost = [...map.values()].filter((n) => !seen.has(n.id));
    if (lost.length) {
      problems.push(`${lost.length} unreachable node(s)`);
      if (repair) {
        let lf = map.get(1).children.get('lost+found');
        if (lf === undefined) {
          lf = this.nextId = Math.max(this.nextId, ...map.keys()) + 1;
          const t = this.clock();
          map.set(lf, { id: lf, type: 'dir', name: 'lost+found', parent: 1, ctime: t, mtime: t, children: new Map() });
          map.get(1).children.set('lost+found', lf);
        }
        const dir = map.get(lf);
        for (const n of lost) {
          const top = !map.get(n.parent) || map.get(n.parent).children?.get(n.name) !== n.id;
          if (top) { n.parent = lf; n.name = `orphan-${n.id}`; dir.children.set(n.name, n.id); }
        }
        seen = reach();
        for (const n of [...map.values()]) if (!seen.has(n.id)) map.delete(n.id); // cycles: unrecoverable
      }
    }
    return problems;
  }

  _recount() { this.used = 0; for (const n of this.nodes.values()) this.used += cost(n); }

  // ---- persistence ----
  _touch(...ids) {
    for (const id of ids) this.dirty.add(id);
    if (this.autoFlushMs > 0 && !this._timer) {
      this._timer = setTimeout(() => { this._timer = null; this.flush().catch((e) => this.onFlushError?.(e)); }, this.autoFlushMs);
    }
  }

  flush() {
    const run = this._chain.then(() => this._flushNow());
    this._chain = run.catch(() => {});
    return run;
  }

  async _flushNow() {
    if (!this.dirty.size && !this.deleted.size && !this.metaDirty) return;
    const ids = [...this.dirty];
    const dels = [...this.deleted];
    const ops = [];
    for (const id of ids) if (this.nodes.has(id)) ops.push({ op: 'put', store: 'nodes', key: id, value: serialize(this.nodes.get(id)) });
    for (const id of dels) ops.push({ op: 'delete', store: 'nodes', key: id });
    ops.push({ op: 'put', store: 'meta', key: 'super', value: { version: 1, nextId: this.nextId, quota: this.quota } });
    this.dirty.clear(); this.deleted.clear(); this.metaDirty = false;
    try { await this.db.batch(ops); } catch (e) {
      ids.forEach((i) => this.dirty.add(i)); dels.forEach((i) => this.deleted.add(i)); this.metaDirty = true;
      throw e;
    }
  }

  // Replace the whole disk atomically (used by backup import). Caller supplies a Map of nodes.
  async replaceAll(map, { quota, nextId }) {
    const problems = this._verify(map, false);
    if (problems.length) throw new FsError('ECORRUPT', problems.slice(0, 3).join('; '));
    let used = 0;
    for (const n of map.values()) used += cost(n);
    if (used > quota) throw new FsError('ENOSPC', 'Backup does not fit in the disk quota');
    const ops = [{ op: 'clear' }];
    for (const [id, n] of map) ops.push({ op: 'put', store: 'nodes', key: id, value: serialize(n) });
    ops.push({ op: 'put', store: 'meta', key: 'super', value: { version: 1, nextId, quota } });
    await this._chain;
    await this.db.batch(ops);
    this.nodes = map; this.quota = quota; this.nextId = nextId; this.used = used;
    this.dirty.clear(); this.deleted.clear(); this.metaDirty = false;
  }

  // ---- lookup helpers ----
  _lookup(path) {
    const p = normalizePath(path);
    let node = this.nodes.get(1);
    if (p === '/') return node;
    for (const name of p.slice(1).split('/')) {
      if (node.type !== 'dir') throw new FsError('ENOTDIR', `Not a directory: ${p}`);
      const id = node.children.get(name);
      if (id === undefined) throw new FsError('ENOENT', `No such file or directory: ${p}`);
      node = this.nodes.get(id);
    }
    return node;
  }

  _parentOf(path) {
    const p = normalizePath(path);
    if (p === '/') throw new FsError('EINVAL', 'Cannot operate on the root directory');
    const i = p.lastIndexOf('/');
    const dir = this._lookup(i === 0 ? '/' : p.slice(0, i));
    if (dir.type !== 'dir') throw new FsError('ENOTDIR', `Not a directory: ${p.slice(0, i)}`);
    return { dir, name: p.slice(i + 1), path: p };
  }

  _pathOf(node) {
    const parts = [];
    for (let n = node; n.id !== 1; n = this.nodes.get(n.parent)) parts.unshift(n.name);
    return `/${parts.join('/')}`;
  }

  _info(n) {
    return { id: n.id, type: n.type, name: n.name, path: this._pathOf(n), size: n.type === 'file' ? n.data.length : 0, entries: n.type === 'dir' ? n.children.size : 0, ctime: n.ctime, mtime: n.mtime };
  }

  _need(bytes) {
    if (this.used + bytes > this.quota) throw new FsError('ENOSPC', 'No space left on device');
  }

  _create(dir, name, type, data) {
    if (!validName(name)) throw new FsError('EINVAL', `Invalid name: "${name}"`);
    if (dir.children.has(name)) throw new FsError('EEXIST', `Already exists: ${name}`);
    if (this.nodes.size >= MAX_NODES) throw new FsError('ENOSPC', 'Too many files');
    const n = { id: this.nextId, type, name, parent: dir.id, ctime: this.clock(), mtime: this.clock() };
    if (type === 'dir') n.children = new Map(); else n.data = data;
    this._need(cost(n));
    this.nextId++;
    this.nodes.set(n.id, n);
    dir.children.set(name, n.id);
    dir.mtime = this.clock();
    this.used += cost(n);
    this.metaDirty = true;
    this._touch(n.id, dir.id);
    return n;
  }

  // ---- public API ----
  exists(path) { try { this._lookup(path); return true; } catch (e) { if (e instanceof FsError) return false; throw e; } }
  stat(path) { return this._info(this._lookup(path)); }

  list(path) {
    const d = this._lookup(path);
    if (d.type !== 'dir') throw new FsError('ENOTDIR', `Not a directory: ${path}`);
    return [...d.children.values()].map((id) => this._info(this.nodes.get(id)))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  }

  mkdir(path, { recursive = false } = {}) {
    const p = normalizePath(path);
    if (recursive) {
      let cur = '';
      for (const part of p.split('/').filter(Boolean)) {
        cur += `/${part}`;
        if (!this.exists(cur)) this.mkdir(cur);
        else if (this.stat(cur).type !== 'dir') throw new FsError('ENOTDIR', `Not a directory: ${cur}`);
      }
      return this.stat(p);
    }
    const { dir, name } = this._parentOf(p);
    return this._info(this._create(dir, name, 'dir'));
  }

  writeFile(path, data, { append = false } = {}) {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    if (!isBytes(bytes)) throw new FsError('EINVAL', 'Data must be a string or Uint8Array');
    const { dir, name } = this._parentOf(path);
    const id = dir.children.get(name);
    if (id === undefined) {
      if (bytes.length > MAX_FILE) throw new FsError('EFBIG', 'File too large');
      return this._info(this._create(dir, name, 'file', bytes.slice()));
    }
    const n = this.nodes.get(id);
    if (n.type === 'dir') throw new FsError('EISDIR', `Is a directory: ${path}`);
    let next = bytes;
    if (append) { next = new Uint8Array(n.data.length + bytes.length); next.set(n.data); next.set(bytes, n.data.length); }
    if (next.length > MAX_FILE) throw new FsError('EFBIG', 'File too large');
    this._need(blocks(next.length) - blocks(n.data.length));
    this.used += blocks(next.length) - blocks(n.data.length);
    n.data = next === bytes ? bytes.slice() : next;
    n.mtime = this.clock();
    this._touch(n.id);
    return this._info(n);
  }

  readFile(path) {
    const n = this._lookup(path);
    if (n.type === 'dir') throw new FsError('EISDIR', `Is a directory: ${path}`);
    return n.data.slice();
  }

  readText(path) { return dec.decode(this.readFile(path)); }

  remove(path, { recursive = false } = {}) {
    const { dir, name } = this._parentOf(path);
    const id = dir.children.get(name);
    if (id === undefined) throw new FsError('ENOENT', `No such file or directory: ${path}`);
    const n = this.nodes.get(id);
    if (n.type === 'dir' && n.children.size && !recursive) throw new FsError('ENOTEMPTY', `Directory not empty: ${path}`);
    const drop = (x) => {
      if (x.type === 'dir') for (const c of x.children.values()) drop(this.nodes.get(c));
      this.used -= cost(x); this.nodes.delete(x.id); this.dirty.delete(x.id); this.deleted.add(x.id);
    };
    drop(n);
    dir.children.delete(name);
    dir.mtime = this.clock();
    this._touch(dir.id);
  }

  // mv semantics: if `to` is an existing directory the item moves inside it. rename: exact path only.
  move(from, to, { into = true } = {}) {
    const { dir: sd, name: sn, path: sp } = this._parentOf(from);
    const sid = sd.children.get(sn);
    if (sid === undefined) throw new FsError('ENOENT', `No such file or directory: ${from}`);
    const src = this.nodes.get(sid);
    let dp = normalizePath(to);
    if (into && this.exists(dp) && this.stat(dp).type === 'dir') dp = normalizePath(`${dp}/${sn}`);
    if (dp === sp) return this._info(src);
    if (src.type === 'dir' && (dp === sp || dp.startsWith(`${sp}/`))) throw new FsError('EINVAL', 'Cannot move a directory into itself');
    const { dir: dd, name: dn } = this._parentOf(dp);
    if (!validName(dn)) throw new FsError('EINVAL', `Invalid name: "${dn}"`);
    if (dd.children.has(dn)) throw new FsError('EEXIST', `Already exists: ${dp}`);
    sd.children.delete(sn);
    src.name = dn; src.parent = dd.id; src.mtime = this.clock();
    dd.children.set(dn, src.id);
    sd.mtime = dd.mtime = this.clock();
    this._touch(src.id, sd.id, dd.id);
    return this._info(src);
  }

  rename(from, to) { return this.move(from, to, { into: false }); }

  copy(from, to, { recursive = false } = {}) {
    const src = this._lookup(from);
    if (src.type === 'dir' && !recursive) throw new FsError('EISDIR', `Is a directory (use recursive): ${from}`);
    let dp = normalizePath(to);
    if (this.exists(dp) && this.stat(dp).type === 'dir') dp = normalizePath(`${dp}/${src.name || 'root'}`);
    if (src.type === 'dir' && (dp === this._pathOf(src) || dp.startsWith(`${this._pathOf(src)}/`))) throw new FsError('EINVAL', 'Cannot copy a directory into itself');
    const total = (n) => cost(n) + (n.type === 'dir' ? [...n.children.values()].reduce((s, c) => s + total(this.nodes.get(c)), 0) : 0);
    this._need(total(src));
    const { dir, name } = this._parentOf(dp);
    const dup = (n, d, nm) => {
      const c = this._create(d, nm, n.type, n.type === 'file' ? n.data.slice() : undefined);
      if (n.type === 'dir') for (const [cn, cid] of n.children) dup(this.nodes.get(cid), c, cn);
      return c;
    };
    return this._info(dup(src, dir, name));
  }

  setQuota(bytes) {
    if (!Number.isInteger(bytes) || bytes < this.used || bytes > 256 * 1024 * 1024) throw new FsError('EINVAL', 'Quota must be between current usage and 256 MB');
    this.quota = bytes; this.metaDirty = true; this._touch();
  }

  usage() {
    let files = 0, dirs = 0;
    for (const n of this.nodes.values()) if (n.type === 'dir') dirs++; else files++;
    return { quota: this.quota, used: this.used, free: this.quota - this.used, files, dirs };
  }
}
