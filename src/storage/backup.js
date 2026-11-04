import { FsError, MAX_FILE, MAX_NODES } from '../os/filesystem.js';

// Backup = whole disk as JSON. Import validates everything before touching the disk,
// so a bad or incompatible file can never damage the current system.
export const BACKUP_FORMAT = 'voidos-backup';
export const BACKUP_VERSION = 1;

export class BackupError extends Error {
  constructor(code, message) { super(message); this.name = 'BackupError'; this.code = code; }
}

const b64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function exportBackup(fs) {
  return {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, created: fs.clock(), quota: fs.quota, nextId: fs.nextId,
    nodes: [...fs.nodes.values()].map((n) => ({
      id: n.id, type: n.type, name: n.name, parent: n.parent, ctime: n.ctime, mtime: n.mtime,
      ...(n.type === 'file' ? { data: b64(n.data) } : { children: [...n.children] }),
    })),
  };
}

export async function importBackup(fs, input) {
  let obj = input;
  if (typeof input === 'string') {
    try { obj = JSON.parse(input); } catch { throw new BackupError('BAD_JSON', 'Backup file is not valid JSON'); }
  }
  if (!obj || obj.format !== BACKUP_FORMAT || !Number.isInteger(obj.version) || obj.version < 1) {
    throw new BackupError('BAD_FORMAT', 'This is not a VoidOS backup');
  }
  if (obj.version > BACKUP_VERSION) throw new BackupError('NEWER_VERSION', `Backup version ${obj.version} is newer than this VoidOS supports (${BACKUP_VERSION})`);
  // (older versions would be migrated here; version 1 is current)
  if (!Array.isArray(obj.nodes) || obj.nodes.length === 0 || obj.nodes.length > MAX_NODES) throw new BackupError('BAD_FORMAT', 'Backup has no valid node list');
  if (!Number.isInteger(obj.quota) || !Number.isInteger(obj.nextId)) throw new BackupError('BAD_FORMAT', 'Backup header is incomplete');
  const map = new Map();
  try {
    for (const r of obj.nodes) {
      if (!r || !Number.isInteger(r.id) || map.has(r.id)) throw new BackupError('CORRUPT', `Duplicate or invalid node id ${r?.id}`);
      const n = { id: r.id, type: r.type, name: r.name, parent: r.parent, ctime: r.ctime, mtime: r.mtime };
      if (r.type === 'file') {
        if (typeof r.data !== 'string') throw new BackupError('CORRUPT', `File ${r.id} has no data`);
        n.data = unb64(r.data);
        if (n.data.length > MAX_FILE) throw new BackupError('CORRUPT', `File ${r.id} is too large`);
      } else if (r.type === 'dir' && Array.isArray(r.children) && r.children.every((c) => Array.isArray(c) && c.length === 2)) {
        n.children = new Map(r.children);
      } else throw new BackupError('CORRUPT', `Node ${r.id} has an invalid type`);
      map.set(n.id, n);
    }
    await fs.replaceAll(map, { quota: obj.quota, nextId: Math.max(obj.nextId, ...map.keys()) + 1 });
  } catch (e) {
    if (e instanceof BackupError) throw e;
    if (e instanceof FsError) throw new BackupError(e.code === 'ENOSPC' ? 'TOO_BIG' : 'CORRUPT', e.message);
    if (e instanceof DOMException || e instanceof TypeError) throw new BackupError('CORRUPT', 'Backup data is damaged');
    throw e;
  }
}
