import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importGedcom } from '../../src/lib/gedcom/import';
import { countTree, migrateTree, type MigrateOptions } from '../../scripts/lib/migrate';
import { freshDb } from './pglite';

// F-41: la migración GEDCOM → Supabase es fiel e idempotente.

const fixture = readFileSync(new URL('../fixtures/familia-ficticia.ged', import.meta.url), 'utf8');
const JUAN = 'aaaa0000000000000000000000000000aaaa';
const F1 = 'bbbb0000000000000000000000000000bbbb';
const VIEWER = '00000000-0000-0000-0000-00000000000c';

let db: PGlite;
let treeId: string;

const run = (ged: string, opts: MigrateOptions = {}) => db.transaction((tx) => migrateTree(tx, treeId, importGedcom(ged), opts));
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0]!;
const all = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows;

beforeAll(async () => {
  db = await freshDb();
  treeId = (await one<{ id: string }>(`insert into public.trees (name) values ('Prueba') returning id`)).id;
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe('F-41 migración GEDCOM → base', () => {
  it('la primera vez inserta todo y los conteos coinciden con el GEDCOM', async () => {
    const r = await run(fixture);
    expect(r.inserted).toEqual({ persons: 5, families: 2, children: 2 });
    expect(r.updated).toEqual({ persons: 0, families: 0, children: 0 });
    expect(r.actual).toEqual(r.expected);
    expect(r.expected).toMatchObject({ persons: 5, families: 2, children: 2, media: 1 });
  });

  it('guarda los campos sin perder nada', async () => {
    const juan = await one(`select * from public.persons where tree_id = $1 and id = $2`, [treeId, JUAN]);
    expect(juan).toMatchObject({
      rin: 1,
      sex: 'M',
      given_names: 'Juan Pablo',
      surname: 'Ficticio',
      surname2: 'Inventado',
      notes: 'Nació en un pueblo que no existe.\nSegunda línea de la nota.',
      spouse_order: [F1],
      changed_at: '1 Jan 2020 10:00:00',
    });
    const birth = await one(`select * from public.events where tree_id = $1 and person_id = $2 and type = 'BIRT'`, [treeId, JUAN]);
    expect(birth).toMatchObject({ date_text: '4 Ago 1924', date_sort: 19240804, place: 'Pueblo Imaginario' });
    expect(birth.date_parsed).toMatchObject({ year: 1924, month: 8, day: 4, ok: true });

    const diego = await one(`select extra from public.persons where tree_id = $1 and rin = 4`, [treeId]);
    expect(diego.extra).toEqual([expect.objectContaining({ tag: '_CUSTOM', value: 'valor raro' })]);

    const foto = await one(`select * from public.media where tree_id = $1 and person_id = $2`, [treeId, JUAN]);
    expect(foto).toMatchObject({ file: 'genes\\2005-05-27\\Foto Ficticia.JPG', format: 'jpg', title: 'Foto', is_primary: true });
    expect(foto.extra).toEqual([expect.objectContaining({ tag: '_TYPE', value: 'PHOTO' })]);

    const kids = await all(`select family_id, person_id, pedigree from public.family_children where tree_id = $1 order by family_id`, [treeId]);
    expect(kids).toEqual([
      { family_id: 'F2', person_id: JUAN, pedigree: null },
      { family_id: F1, person_id: 'I3', pedigree: 'birth' },
    ]);
  });

  it('calcula quién está vivo', async () => {
    const rows = await all<{ rin: number; is_living: boolean }>(`select rin, is_living from public.persons where tree_id = $1 order by rin`, [treeId]);
    const living = Object.fromEntries(rows.map((r) => [r.rin, r.is_living]));
    expect(living[1]).toBe(true); // nació en 1924, sin defunción
    expect(living[4]).toBe(false); // tiene defunción
  });

  it('no deja la importación en la bitácora', async () => {
    expect(await one(`select count(*)::int as n from public.change_log`)).toEqual({ n: 0 });
  });

  it('la segunda vez no escribe nada', async () => {
    const eventIds = await all(`select id from public.events where tree_id = $1 order by id`, [treeId]);
    const r = await run(fixture, { keepLog: true });
    expect(r.inserted).toEqual({ persons: 0, families: 0, children: 0 });
    expect(r.updated).toEqual({ persons: 0, families: 0, children: 0 });
    expect(r.rewritten).toEqual({ events: 0, media: 0 });
    expect(r.removedChildren).toBe(0);
    expect(r.actual).toEqual(r.expected);
    expect(await all(`select id from public.events where tree_id = $1 order by id`, [treeId])).toEqual(eventIds);
    expect(await one(`select count(*)::int as n from public.change_log`)).toEqual({ n: 0 });
  });

  it('con un export más nuevo actualiza solo lo que cambió y conserva las fotos ya subidas', async () => {
    await db.query(`update public.media set storage_path = 'arbol/foto.jpg' where tree_id = $1 and person_id = $2`, [treeId, JUAN]);
    const edited = fixture
      .replace('2 DATE Por 1930', '2 DATE 3 Mar 1931')
      .replace('2 TITL Foto', '2 TITL Foto de boda')
      .replace('1 CHIL @I3@\n', '');
    const r = await run(edited);
    expect(r.updated).toEqual({ persons: 0, families: 0, children: 0 });
    expect(r.rewritten).toEqual({ events: 1, media: 1 });
    expect(r.removedChildren).toBe(1);
    expect(r.actual).toEqual(r.expected);

    const maria = await one(`select date_text, date_sort from public.events e join public.persons p on p.tree_id = e.tree_id and p.id = e.person_id where e.tree_id = $1 and p.rin = 2`, [treeId]);
    expect(maria).toEqual({ date_text: '3 Mar 1931', date_sort: 19310303 });
    expect(await one(`select title, storage_path from public.media where tree_id = $1`, [treeId])).toEqual({
      title: 'Foto de boda',
      storage_path: 'arbol/foto.jpg',
    });
  });

  it('avisa de lo que ya no está en el GEDCOM y con --prune lo manda a la papelera', async () => {
    const sinJose = fixture.replace(/0 @I5@ INDI[\s\S]*?(?=0 @F1@)/, '');
    const r = await run(sinJose);
    expect(r.missing).toEqual({ persons: ['I5'], families: [] });
    expect(r.actual.persons).toBe(r.expected.persons + 1);

    const p = await run(sinJose, { prune: true });
    expect(p.missing.persons).toEqual(['I5']);
    expect(p.actual).toEqual(p.expected);
    expect(await one(`select deleted_at is not null as trashed from public.persons where tree_id = $1 and id = 'I5'`, [treeId])).toEqual({ trashed: true });

    // Si vuelve a aparecer, sale de la papelera.
    const back = await run(fixture);
    expect(back.updated.persons).toBe(1);
    expect(await one(`select deleted_at from public.persons where tree_id = $1 and id = 'I5'`, [treeId])).toEqual({ deleted_at: null });
    expect(await countTree(db, treeId)).toEqual(back.expected);
  });

  it('el lector no ve la fecha de cambio de una persona viva', async () => {
    await db.query(`insert into auth.users (id) values ($1)`, [VIEWER]);
    await db.query(`insert into public.tree_members (tree_id, user_id, role) values ($1, $2, 'viewer')`, [treeId, VIEWER]);
    const rows = await db.transaction(async (tx) => {
      await tx.exec(`set local role authenticated`);
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [VIEWER]);
      return (await tx.query(`select masked, given_names, changed_at, spouse_order from public.persons_visible where id = $1`, [JUAN])).rows;
    });
    expect(rows).toEqual([{ masked: true, given_names: 'Persona viva', changed_at: null, spouse_order: [F1] }]);
  });
});
