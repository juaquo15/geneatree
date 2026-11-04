// Copia local del árbol en IndexedDB: la app abre sin conexión y sin reimportar.
// Más adelante este almacén será la caché de la sincronización con Supabase.

import type { Family, Person, TreeData } from '../model/types';

const DB_NAME = 'geneatree';
const STORE = 'trees';
const KEY = 'local';

interface StoredTree {
  people: Person[];
  families: Family[];
  savedAt: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        t.onerror = () => {
          db.close();
          reject(t.error);
        };
      }),
  );
}

export async function saveTree(tree: TreeData): Promise<void> {
  const data: StoredTree = {
    people: [...tree.people.values()],
    families: [...tree.families.values()],
    savedAt: new Date().toISOString(),
  };
  await tx('readwrite', (s) => s.put(data, KEY));
}

export async function loadTree(): Promise<TreeData | undefined> {
  const data = (await tx('readonly', (s) => s.get(KEY))) as StoredTree | undefined;
  if (!data) return undefined;
  return {
    people: new Map(data.people.map((p) => [p.id, p])),
    families: new Map(data.families.map((f) => [f.id, f])),
    warnings: [],
    preservedTags: new Map(),
  };
}

export async function clearTree(): Promise<void> {
  await tx('readwrite', (s) => s.delete(KEY));
}
