import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { importGedcom } from '../src/lib/gedcom/import';
import {
  addPerson,
  applyState,
  deletePerson,
  EditTx,
  invert,
  linkChild,
  linkParent,
  linkSpouse,
  moveChild,
  restoreDeleted,
  setEvent,
  sortChildren,
  unlinkChild,
} from '../src/lib/model/edit';
import type { TreeData } from '../src/lib/model/types';

const text = readFileSync(new URL('./fixtures/familia-ficticia.ged', import.meta.url), 'utf8');
let t: TreeData;
const rin = (n: number) => [...t.people.values()].find((p) => p.rin === n)!;

/** Verifica que todos los vínculos sean bidireccionales. */
function assertConsistent(tree: TreeData) {
  for (const f of tree.families.values()) {
    for (const id of [f.husbandId, f.wifeId]) {
      if (id) expect(tree.people.get(id)?.spouseFamilies).toContain(f.id);
    }
    for (const c of f.childIds) expect(tree.people.get(c)?.parents.map((l) => l.familyId)).toContain(f.id);
  }
  for (const p of tree.people.values()) {
    for (const l of p.parents) expect(tree.families.get(l.familyId)?.childIds).toContain(p.id);
    for (const fid of p.spouseFamilies) {
      const f = tree.families.get(fid)!;
      expect([f.husbandId, f.wifeId]).toContain(p.id);
    }
  }
}

beforeEach(() => {
  t = importGedcom(text);
  // la referencia rota del fixture (@I99@) se descarta al importar
});

describe('EditTx', () => {
  it('guarda antes/después y no altera el árbol hasta commit', () => {
    const tx = new EditTx(t, 'editar');
    tx.person(rin(1).id).givenNames = 'Cambiado';
    expect(rin(1).givenNames).toBe('Juan Pablo');
    const c = tx.commit();
    expect(rin(1).givenNames).toBe('Cambiado');
    expect(c.before.people[0]![1]!.givenNames).toBe('Juan Pablo');
    expect(c.after.people[0]![1]!.givenNames).toBe('Cambiado');
  });

  it('lo que se toca sin cambiar no queda en el registro', () => {
    const tx = new EditTx(t, 'nada');
    tx.person(rin(1).id).givenNames = 'Juan Pablo';
    const c = tx.commit();
    expect(c.after.people).toEqual([]);
  });

  it('deshacer restaura exactamente el estado anterior', () => {
    const byId = () => [...t.people.values()].sort((a, b) => a.id.localeCompare(b.id));
    const snapshot = structuredClone(byId());
    const tx = new EditTx(t, 'varios');
    const id = addPerson(tx, { givenNames: 'Nuevo', sex: 'M' });
    linkParent(tx, rin(2).id, id, 'father');
    deletePerson(tx, rin(3).id);
    const c = tx.commit();
    applyState(t, invert(c, 'deshacer').after);
    expect(byId()).toEqual(snapshot);
    assertConsistent(t);
  });
});

describe('operaciones', () => {
  it('nuevas personas reciben RIN consecutivo', () => {
    const tx = new EditTx(t, 'a');
    const a = addPerson(tx);
    const b = addPerson(tx);
    tx.commit();
    expect(t.people.get(a)!.rin).toBe(6);
    expect(t.people.get(b)!.rin).toBe(7);
  });

  it('setEvent crea, interpreta, actualiza y elimina eventos', () => {
    const tx = new EditTx(t, 'e');
    const p = tx.person(rin(5).id);
    setEvent(p.events, 'BIRT', 'Por 1792', 'Lugar');
    expect(p.events[0]).toMatchObject({ type: 'BIRT', place: 'Lugar', date: { qualifier: 'about', year: 1792 } });
    setEvent(p.events, 'BIRT', '', 'Lugar');
    expect(p.events[0]!.date).toBeUndefined();
    setEvent(p.events, 'BIRT', '', '');
    expect(p.events).toHaveLength(0);
  });

  it('agregar padre a quien no tiene padres crea la familia', () => {
    const tx = new EditTx(t, 'padre');
    const dad = addPerson(tx, { sex: 'M' });
    const famId = linkParent(tx, rin(5).id, dad, 'father');
    tx.commit();
    expect(t.families.get(famId)).toMatchObject({ husbandId: dad, childIds: [rin(5).id] });
    assertConsistent(t);
  });

  it('agregar madre completa la familia existente del hijo', () => {
    const tx = new EditTx(t, 'madre');
    const mom = addPerson(tx, { sex: 'F' });
    // Juan (RIN 1) tiene familia de padres con solo el padre (RIN 4)
    const famId = linkParent(tx, rin(1).id, mom, 'mother');
    tx.commit();
    expect(rin(1).parents).toHaveLength(1);
    expect(t.families.get(famId)).toMatchObject({ husbandId: rin(4).id, wifeId: mom });
    assertConsistent(t);
  });

  it('cónyuge e hijo nuevos', () => {
    const tx = new EditTx(t, 'familia');
    const wife = addPerson(tx, { sex: 'F' });
    const famId = linkSpouse(tx, rin(5).id, wife);
    const kid = addPerson(tx);
    linkChild(tx, kid, rin(5).id, famId);
    tx.commit();
    expect(t.families.get(famId)).toMatchObject({ husbandId: rin(5).id, wifeId: wife, childIds: [kid] });
    assertConsistent(t);
  });

  it('cónyuge nuevo completa la familia monoparental indicada', () => {
    let tx = new EditTx(t, 'hijo');
    const kid = addPerson(tx);
    const famId = linkChild(tx, kid, rin(5).id);
    tx.commit();
    tx = new EditTx(t, 'esposa');
    const wife = addPerson(tx, { sex: 'F' });
    linkSpouse(tx, rin(5).id, wife, famId);
    tx.commit();
    expect(t.families.get(famId)).toMatchObject({ husbandId: rin(5).id, wifeId: wife, childIds: [kid] });
    expect(rin(5).spouseFamilies).toEqual([famId]);
    assertConsistent(t);
  });

  it('hijo de persona sin cónyuge crea familia monoparental', () => {
    const tx = new EditTx(t, 'hijo');
    const kid = addPerson(tx);
    const famId = linkChild(tx, kid, rin(2).id);
    tx.commit();
    expect(t.families.get(famId)).toMatchObject({ wifeId: rin(2).id, childIds: [kid] });
    assertConsistent(t);
  });

  it('desvincular el último hijo de una familia sin datos la elimina', () => {
    let tx = new EditTx(t, 'hijo');
    const kid = addPerson(tx);
    const famId = linkChild(tx, kid, rin(5).id);
    tx.commit();
    tx = new EditTx(t, 'quitar');
    unlinkChild(tx, famId, kid);
    tx.commit();
    expect(t.families.has(famId)).toBe(false);
    assertConsistent(t);
  });

  it('eliminar persona quita todos sus vínculos y la papelera la restaura', () => {
    const juan = rin(1).id;
    const tx = new EditTx(t, 'eliminar');
    deletePerson(tx, juan);
    const deletion = tx.commit();
    expect(t.people.has(juan)).toBe(false);
    assertConsistent(t);

    // Mientras estaba en la papelera, se editó a su esposa
    const tx2 = new EditTx(t, 'editar esposa');
    tx2.person(rin(2).id).notes = 'nota nueva';
    tx2.commit();

    const tx3 = new EditTx(t, 'restaurar');
    restoreDeleted(tx3, deletion);
    tx3.commit();
    expect(t.people.has(juan)).toBe(true);
    expect(rin(2).notes).toBe('nota nueva');
    expect(rin(1).spouseFamilies).toHaveLength(1);
    expect(rin(1).parents).toHaveLength(1);
    assertConsistent(t);
  });

  it('ordenar hijos por nacimiento y moverlos', () => {
    const tx = new EditTx(t, 'hijos');
    const fam = rin(1).spouseFamilies[0]!;
    const a = addPerson(tx, { givenNames: 'A' });
    setEvent(tx.person(a).events, 'BIRT', '1950', '');
    linkChild(tx, a, rin(1).id, fam);
    const b = addPerson(tx, { givenNames: 'B' });
    linkChild(tx, b, rin(1).id, fam);
    sortChildren(tx, fam);
    expect(tx.peekFamily(fam)!.childIds).toEqual([a, rin(3).id, b]);
    moveChild(tx, fam, b, -1);
    expect(tx.peekFamily(fam)!.childIds).toEqual([a, b, rin(3).id]);
    tx.commit();
    assertConsistent(t);
  });

  it('no permite asignar un segundo padre a una familia', () => {
    const tx = new EditTx(t, 'x');
    const other = addPerson(tx, { sex: 'M' });
    const fam = rin(1).spouseFamilies[0]!;
    expect(() => linkParent(tx, rin(3).id, other, 'father', fam)).toThrow();
  });
});
