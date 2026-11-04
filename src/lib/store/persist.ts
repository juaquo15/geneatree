// Copia local del árbol en IndexedDB: la app abre sin conexión y sin reimportar.
// Cada edición guarda solo los registros tocados y queda en el historial.
// Más adelante este almacén será la caché de la sincronización con Supabase.

import type { Change } from '../model/edit';
import type { Family, Person, TreeData } from '../model/types';

const DB_NAME = 'geneatree';
const VERSION = 2;

export interface TrashEntry {
  id: string;
  at: string;
  label: string;
  personId: string;
  change: Change;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Transacción abortada'));
  });
}

let dbPromise: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = (e) => {
      const db = r.result;
      const t = r.transaction!;
      for (const name of ['people', 'families', 'changes', 'trash']) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      // v1 guardaba todo el árbol en un solo registro: se migra a registros separados.
      if (e.oldVersion === 1 && db.objectStoreNames.contains('trees')) {
        const old = t.objectStore('trees').get('local');
        old.onsuccess = () => {
          const data = old.result as { people: Person[]; families: Family[] } | undefined;
          if (data) {
            for (const p of data.people) t.objectStore('people').put(p);
            for (const f of data.families) t.objectStore('families').put(f);
          }
          db.deleteObjectStore('trees');
        };
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbPromise;
}

/** Reemplaza todo el árbol (importación). */
export async function saveTree(tree: TreeData): Promise<void> {
  const db = await open();
  const t = db.transaction(['people', 'families', 'changes', 'trash'], 'readwrite');
  for (const s of ['people', 'families', 'changes', 'trash']) t.objectStore(s).clear();
  const ps = t.objectStore('people');
  for (const p of tree.people.values()) ps.put(p);
  const fs = t.objectStore('families');
  for (const f of tree.families.values()) fs.put(f);
  await done(t);
}

export async function loadTree(): Promise<TreeData | undefined> {
  const db = await open();
  const t = db.transaction(['people', 'families'], 'readonly');
  const [people, families] = await Promise.all([
    req(t.objectStore('people').getAll() as IDBRequest<Person[]>),
    req(t.objectStore('families').getAll() as IDBRequest<Family[]>),
  ]);
  if (people.length === 0) return undefined;
  return {
    people: new Map(people.map((p) => [p.id, p])),
    families: new Map(families.map((f) => [f.id, f])),
    warnings: [],
    preservedTags: new Map(),
  };
}

/** Guarda una edición: los registros resultantes y la entrada de historial. */
export async function saveChange(change: Change, trash?: TrashEntry): Promise<void> {
  const db = await open();
  const t = db.transaction(['people', 'families', 'changes', 'trash'], 'readwrite');
  const ps = t.objectStore('people');
  for (const [id, p] of change.after.people) {
    if (p) ps.put(p);
    else ps.delete(id);
  }
  const fs = t.objectStore('families');
  for (const [id, f] of change.after.families) {
    if (f) fs.put(f);
    else fs.delete(id);
  }
  t.objectStore('changes').put(change);
  if (trash) t.objectStore('trash').put(trash);
  await done(t);
}

const TRASH_DAYS = 30;

/** Papelera, sin las entradas de más de 30 días (que se descartan). */
export async function loadTrash(): Promise<TrashEntry[]> {
  const db = await open();
  const t = db.transaction('trash', 'readwrite');
  const store = t.objectStore('trash');
  const all = await req(store.getAll() as IDBRequest<TrashEntry[]>);
  const limit = Date.now() - TRASH_DAYS * 86400_000;
  const keep: TrashEntry[] = [];
  for (const e of all) {
    if (Date.parse(e.at) < limit) store.delete(e.id);
    else keep.push(e);
  }
  await done(t);
  return keep.sort((a, b) => b.at.localeCompare(a.at));
}

export async function removeTrash(id: string): Promise<void> {
  const db = await open();
  const t = db.transaction('trash', 'readwrite');
  t.objectStore('trash').delete(id);
  await done(t);
}

export async function clearTree(): Promise<void> {
  const db = await open();
  const t = db.transaction(['people', 'families', 'changes', 'trash'], 'readwrite');
  for (const s of ['people', 'families', 'changes', 'trash']) t.objectStore(s).clear();
  await done(t);
}
