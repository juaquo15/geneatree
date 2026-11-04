// Motor de edición. Toda modificación pasa por una transacción que guarda el estado
// "antes" y "después" de cada registro tocado. Con eso se implementan deshacer,
// historial, papelera y (más adelante) la sincronización.

import type { Family, LifeEvent, Person, Sex, TreeData } from './types';
import { parseDate } from '../gedcom/dates';

export interface Change {
  id: string;
  at: string;
  label: string;
  /** null = el registro no existía (antes) o fue eliminado (después). */
  before: { people: [string, Person | null][]; families: [string, Family | null][] };
  after: { people: [string, Person | null][]; families: [string, Family | null][] };
}

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

const clone = <T>(x: T): T => structuredClone(x);

export class EditTx {
  private bp = new Map<string, Person | null>();
  private ap = new Map<string, Person | null>();
  private bf = new Map<string, Family | null>();
  private af = new Map<string, Family | null>();

  constructor(
    readonly tree: TreeData,
    readonly label: string,
  ) {}

  /** Copia editable de una persona (la primera vez guarda el "antes"). */
  person(id: string): Person {
    if (this.ap.has(id)) {
      const p = this.ap.get(id);
      if (!p) throw new Error(`Persona ${id} eliminada en esta edición`);
      return p;
    }
    const orig = this.tree.people.get(id);
    if (!orig) throw new Error(`No existe la persona ${id}`);
    this.bp.set(id, clone(orig));
    const copy = clone(orig);
    this.ap.set(id, copy);
    return copy;
  }

  family(id: string): Family {
    if (this.af.has(id)) {
      const f = this.af.get(id);
      if (!f) throw new Error(`Familia ${id} eliminada en esta edición`);
      return f;
    }
    const orig = this.tree.families.get(id);
    if (!orig) throw new Error(`No existe la familia ${id}`);
    this.bf.set(id, clone(orig));
    const copy = clone(orig);
    this.af.set(id, copy);
    return copy;
  }

  /** Lectura sin marcar como modificado (ve los cambios de esta transacción). */
  peekPerson(id: string | undefined): Person | undefined {
    if (!id) return undefined;
    if (this.ap.has(id)) return this.ap.get(id) ?? undefined;
    return this.tree.people.get(id);
  }

  peekFamily(id: string | undefined): Family | undefined {
    if (!id) return undefined;
    if (this.af.has(id)) return this.af.get(id) ?? undefined;
    return this.tree.families.get(id);
  }

  putNewPerson(p: Person) {
    this.bp.set(p.id, null);
    this.ap.set(p.id, p);
  }

  putNewFamily(f: Family) {
    this.bf.set(f.id, null);
    this.af.set(f.id, f);
  }

  /** Restaura un registro tal cual (papelera). */
  restorePerson(p: Person) {
    if (!this.bp.has(p.id)) this.bp.set(p.id, clone(this.tree.people.get(p.id) ?? null));
    this.ap.set(p.id, clone(p));
  }

  restoreFamily(f: Family) {
    if (!this.bf.has(f.id)) this.bf.set(f.id, clone(this.tree.families.get(f.id) ?? null));
    this.af.set(f.id, clone(f));
  }

  removePerson(id: string) {
    this.person(id);
    this.ap.set(id, null);
  }

  removeFamily(id: string) {
    this.family(id);
    this.af.set(id, null);
  }

  nextRin(): number {
    let max = 0;
    for (const p of this.tree.people.values()) if (p.rin > max) max = p.rin;
    for (const p of this.ap.values()) if (p && p.rin > max) max = p.rin;
    return max + 1;
  }

  nextMrin(): number {
    let max = 0;
    for (const f of this.tree.families.values()) if (f.mrin > max) max = f.mrin;
    for (const f of this.af.values()) if (f && f.mrin > max) max = f.mrin;
    return max + 1;
  }

  /** Aplica los cambios al árbol (in situ) y devuelve el registro del cambio. */
  commit(): Change {
    // Lo que se tocó pero quedó igual no es un cambio.
    const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
    for (const [id, p] of this.ap) if (same(p, this.bp.get(id))) (this.ap.delete(id), this.bp.delete(id));
    for (const [id, f] of this.af) if (same(f, this.bf.get(id))) (this.af.delete(id), this.bf.delete(id));
    const now = new Date().toISOString();
    for (const [id, p] of this.ap) {
      if (p) {
        p.changedAt = now;
        this.tree.people.set(id, p);
      } else this.tree.people.delete(id);
    }
    for (const [id, f] of this.af) {
      if (f) {
        f.changedAt = now;
        this.tree.families.set(id, f);
      } else this.tree.families.delete(id);
    }
    return {
      id: newId(),
      at: now,
      label: this.label,
      before: { people: [...this.bp], families: [...this.bf] },
      after: { people: [...this.ap].map(([k, v]) => [k, v && clone(v)]), families: [...this.af].map(([k, v]) => [k, v && clone(v)]) },
    };
  }
}

/** Aplica un estado (before o after de un Change) directamente al árbol. */
export function applyState(t: TreeData, s: Change['before']): void {
  for (const [id, p] of s.people) {
    if (p) t.people.set(id, clone(p));
    else t.people.delete(id);
  }
  for (const [id, f] of s.families) {
    if (f) t.families.set(id, clone(f));
    else t.families.delete(id);
  }
}

/** Cambio inverso, para deshacer dejando registro en el historial. */
export function invert(c: Change, label: string): Change {
  return { id: newId(), at: new Date().toISOString(), label, before: c.after, after: c.before };
}

// ---------------------------------------------------------------------------
// Operaciones

export interface PersonInit {
  sex?: Sex;
  givenNames?: string;
  surname?: string;
  surname2?: string;
  title?: string;
  suffix?: string;
}

export function addPerson(tx: EditTx, init: PersonInit = {}): string {
  const p: Person = {
    id: newId(),
    rin: tx.nextRin(),
    sex: init.sex ?? 'U',
    givenNames: init.givenNames ?? '',
    surname: init.surname ?? '',
    surname2: init.surname2 ?? '',
    suffix: init.suffix ?? '',
    title: init.title ?? '',
    nickname: '',
    altNames: [],
    events: [],
    notes: '',
    media: [],
    parents: [],
    spouseFamilies: [],
  };
  tx.putNewPerson(p);
  return p.id;
}

function newFamily(tx: EditTx): Family {
  const f: Family = { id: newId(), mrin: tx.nextMrin(), childIds: [], events: [], notes: '' };
  tx.putNewFamily(f);
  return f;
}

/** Crea, actualiza o elimina (si queda vacío) un evento por tipo. */
export function setEvent(events: LifeEvent[], type: string, dateText: string, place: string): void {
  const i = events.findIndex((e) => e.type === type);
  const d = dateText.trim();
  const pl = place.trim();
  if (!d && !pl) {
    if (i >= 0 && !events[i]!.note && !events[i]!.cause && !events[i]!.extra?.length) events.splice(i, 1);
    else if (i >= 0) {
      delete events[i]!.date;
      delete events[i]!.place;
    }
    return;
  }
  const ev: LifeEvent = i >= 0 ? events[i]! : { type };
  if (d) {
    if (ev.date?.text !== dateText) ev.date = parseDate(dateText);
  } else delete ev.date;
  if (pl) ev.place = pl;
  else delete ev.place;
  if (i < 0) events.push(ev);
}

function roleFor(p: Person): 'husbandId' | 'wifeId' {
  return p.sex === 'F' ? 'wifeId' : 'husbandId';
}

function linkChildTo(tx: EditTx, f: Family, childId: string) {
  if (!f.childIds.includes(childId)) f.childIds.push(childId);
  const c = tx.person(childId);
  if (!c.parents.some((l) => l.familyId === f.id)) c.parents.push({ familyId: f.id });
}

function setSpouse(tx: EditTx, f: Family, role: 'husbandId' | 'wifeId', personId: string) {
  f[role] = personId;
  const p = tx.person(personId);
  if (!p.spouseFamilies.includes(f.id)) p.spouseFamilies.push(f.id);
}

/**
 * Vincula a parentId como padre o madre de childId.
 * - familyId: usar esa familia (por ejemplo, el matrimonio elegido del padre).
 * - si no, se completa la familia de padres del hijo si el lugar está libre,
 *   o se crea una nueva.
 */
export function linkParent(
  tx: EditTx,
  childId: string,
  parentId: string,
  role: 'father' | 'mother',
  familyId?: string,
): string {
  const key = role === 'father' ? 'husbandId' : 'wifeId';
  let f: Family | undefined;
  if (familyId) {
    f = tx.family(familyId);
    if (f[key] && f[key] !== parentId) throw new Error('Esa familia ya tiene ' + (role === 'father' ? 'padre' : 'madre'));
  } else {
    const child = tx.peekPerson(childId)!;
    const current = child.parents.map((l) => tx.peekFamily(l.familyId)).find((x) => x && !x[key]);
    f = current ? tx.family(current.id) : newFamily(tx);
  }
  setSpouse(tx, f, key, parentId);
  linkChildTo(tx, f, childId);
  return f.id;
}

/**
 * Une a dos personas como cónyuges. Con familyId se completa el lugar libre de esa
 * familia (p.ej. una familia con hijos pero sin el otro progenitor); si no, se crea
 * una familia nueva.
 */
export function linkSpouse(tx: EditTx, personId: string, spouseId: string, familyId?: string): string {
  const p = tx.peekPerson(personId)!;
  const s = tx.peekPerson(spouseId)!;
  if (familyId) {
    const f = tx.family(familyId);
    const free = !f.husbandId ? 'husbandId' : !f.wifeId ? 'wifeId' : undefined;
    if (!free) throw new Error('Esa familia ya tiene ambos cónyuges');
    setSpouse(tx, f, free, spouseId);
    return f.id;
  }
  const f = newFamily(tx);
  let pr = roleFor(p);
  let sr = roleFor(s);
  if (pr === sr) sr = pr === 'husbandId' ? 'wifeId' : 'husbandId';
  setSpouse(tx, f, pr, personId);
  setSpouse(tx, f, sr, spouseId);
  return f.id;
}

/**
 * Agrega un hijo. Si se indica familyId se usa esa familia; si no, se crea una
 * familia con el padre o madre como único progenitor conocido.
 */
export function linkChild(tx: EditTx, childId: string, parentId: string, familyId?: string): string {
  const f = familyId ? tx.family(familyId) : newFamily(tx);
  if (!familyId) setSpouse(tx, f, roleFor(tx.peekPerson(parentId)!), parentId);
  linkChildTo(tx, f, childId);
  return f.id;
}

function dropFamilyIfEmpty(tx: EditTx, familyId: string) {
  const f = tx.peekFamily(familyId);
  if (!f) return;
  const members = [f.husbandId, f.wifeId].filter(Boolean).length + f.childIds.length;
  // Una familia con un solo miembro y sin datos propios no aporta nada.
  const hasData = f.events.length > 0 || f.notes.trim() !== '' || (f.extra?.length ?? 0) > 0;
  if (members === 0 || (members === 1 && !hasData)) {
    for (const id of [f.husbandId, f.wifeId]) {
      if (id) {
        const p = tx.person(id);
        p.spouseFamilies = p.spouseFamilies.filter((x) => x !== familyId);
      }
    }
    for (const id of f.childIds) {
      const c = tx.person(id);
      c.parents = c.parents.filter((l) => l.familyId !== familyId);
    }
    tx.removeFamily(familyId);
  }
}

export function unlinkChild(tx: EditTx, familyId: string, childId: string) {
  const f = tx.family(familyId);
  f.childIds = f.childIds.filter((id) => id !== childId);
  const c = tx.person(childId);
  c.parents = c.parents.filter((l) => l.familyId !== familyId);
  dropFamilyIfEmpty(tx, familyId);
}

export function unlinkSpouse(tx: EditTx, familyId: string, personId: string) {
  const f = tx.family(familyId);
  if (f.husbandId === personId) delete f.husbandId;
  if (f.wifeId === personId) delete f.wifeId;
  const p = tx.person(personId);
  p.spouseFamilies = p.spouseFamilies.filter((id) => id !== familyId);
  dropFamilyIfEmpty(tx, familyId);
}

/** Elimina a una persona y todos sus vínculos. El Change resultante es la entrada de papelera. */
export function deletePerson(tx: EditTx, id: string) {
  const p = tx.peekPerson(id)!;
  for (const l of [...p.parents]) unlinkChild(tx, l.familyId, id);
  for (const famId of [...p.spouseFamilies]) {
    if (tx.peekFamily(famId)) unlinkSpouse(tx, famId, id);
  }
  tx.removePerson(id);
}

/**
 * Restaura a una persona eliminada (desde su Change de eliminación), volviendo a
 * enlazarla con las familias que aún existan. No pisa ediciones posteriores.
 */
export function restoreDeleted(tx: EditTx, deletion: Change): string | undefined {
  const entry = deletion.before.people.find(([id, p]) => p && deletion.after.people.some(([a, q]) => a === id && q === null));
  const person = entry?.[1];
  if (!person) return undefined;
  if (tx.peekPerson(person.id)) return person.id;
  const restored: Person = clone(person);
  restored.parents = [];
  restored.spouseFamilies = [];
  tx.restorePerson(restored);
  for (const [famId, snap] of deletion.before.families) {
    if (!snap) continue;
    const current = tx.peekFamily(famId);
    const asChild = snap.childIds.includes(person.id);
    const asSpouse = snap.husbandId === person.id ? 'husbandId' : snap.wifeId === person.id ? 'wifeId' : undefined;
    if (!asChild && !asSpouse) continue;
    if (!current) {
      // La familia desapareció: se recrea con los miembros que aún existen.
      const f: Family = clone(snap);
      f.childIds = f.childIds.filter((c) => c === person.id || tx.peekPerson(c));
      if (f.husbandId && f.husbandId !== person.id && !tx.peekPerson(f.husbandId)) delete f.husbandId;
      if (f.wifeId && f.wifeId !== person.id && !tx.peekPerson(f.wifeId)) delete f.wifeId;
      tx.restoreFamily(f);
      for (const c of f.childIds) {
        const cp = tx.person(c);
        if (!cp.parents.some((l) => l.familyId === famId)) cp.parents.push({ familyId: famId });
      }
      for (const s of [f.husbandId, f.wifeId]) {
        if (s) {
          const sp = tx.person(s);
          if (!sp.spouseFamilies.includes(famId)) sp.spouseFamilies.push(famId);
        }
      }
    } else {
      const f = tx.family(famId);
      if (asChild) linkChildTo(tx, f, person.id);
      if (asSpouse && !f[asSpouse]) setSpouse(tx, f, asSpouse, person.id);
    }
  }
  return person.id;
}

export function moveChild(tx: EditTx, familyId: string, childId: string, delta: -1 | 1) {
  const f = tx.family(familyId);
  const i = f.childIds.indexOf(childId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= f.childIds.length) return;
  [f.childIds[i], f.childIds[j]] = [f.childIds[j]!, f.childIds[i]!];
}

/** Ordena hijos por fecha de nacimiento (o bautizo); los sin fecha quedan al final en su orden. */
export function sortChildren(tx: EditTx, familyId: string) {
  const f = tx.family(familyId);
  const key = (id: string) => {
    const p = tx.peekPerson(id);
    const e = p?.events.find((x) => x.type === 'BIRT' && x.date?.sort) ?? p?.events.find((x) => x.type === 'CHR' && x.date?.sort);
    return e?.date?.sort ?? Number.MAX_SAFE_INTEGER;
  };
  f.childIds = f.childIds
    .map((id, i) => [id, key(id), i] as const)
    .sort((a, b) => a[1] - b[1] || a[2] - b[2])
    .map((x) => x[0]);
}
