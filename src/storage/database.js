// Persistent key/value backends with one tiny async API:
//   get(store,key)  getAll(store) -> [{key,value}]  batch(ops)  (ops are applied atomically)
// ops: {op:'put',store,key,value} | {op:'delete',store,key} | {op:'clear'}
const STORES = ['nodes', 'meta'];

function checkOps(ops) {
  for (const o of ops) {
    const ok = o.op === 'clear' || ((o.op === 'put' || o.op === 'delete') && STORES.includes(o.store));
    if (!ok) throw new Error(`Bad database operation: ${JSON.stringify(o)}`);
  }
}

export class MemoryDatabase {
  constructor() { this.persistent = false; this.data = { nodes: new Map(), meta: new Map() }; }
  async get(store, key) {
    const v = this.data[store].get(key);
    return v === undefined ? undefined : structuredClone(v);
  }
  async getAll(store) {
    return [...this.data[store]].map(([key, value]) => ({ key, value: structuredClone(value) }));
  }
  async batch(ops) {
    checkOps(ops);
    for (const o of ops) {
      if (o.op === 'clear') { this.data.nodes.clear(); this.data.meta.clear(); }
      else if (o.op === 'put') this.data[o.store].set(o.key, structuredClone(o.value));
      else this.data[o.store].delete(o.key);
    }
  }
}

export class IndexedDBDatabase {
  constructor(db) { this.persistent = true; this.db = db; }

  static open(name = 'voidos-disk', factory = globalThis.indexedDB) {
    return new Promise((resolve, reject) => {
      if (!factory) { reject(new Error('IndexedDB is not available')); return; }
      const req = factory.open(name, 1);
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(new IndexedDBDatabase(req.result));
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB open was blocked'));
    });
  }

  get(store, key) {
    return new Promise((resolve, reject) => {
      const r = this.db.transaction(store, 'readonly').objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  getAll(store) {
    return new Promise((resolve, reject) => {
      const out = [];
      const r = this.db.transaction(store, 'readonly').objectStore(store).openCursor();
      r.onsuccess = () => {
        const c = r.result;
        if (c) { out.push({ key: c.key, value: c.value }); c.continue(); } else resolve(out);
      };
      r.onerror = () => reject(r.error);
    });
  }

  batch(ops) {
    return new Promise((resolve, reject) => {
      try { checkOps(ops); } catch (e) { reject(e); return; }
      const tx = this.db.transaction(STORES, 'readwrite');
      for (const o of ops) {
        if (o.op === 'clear') STORES.forEach((s) => tx.objectStore(s).clear());
        else if (o.op === 'put') tx.objectStore(o.store).put(o.value, o.key);
        else tx.objectStore(o.store).delete(o.key);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
    });
  }
}

// Real disk when the browser has IndexedDB, RAM-only fallback otherwise.
export async function openDisk(name) {
  try { return await IndexedDBDatabase.open(name); } catch { return new MemoryDatabase(); }
}
