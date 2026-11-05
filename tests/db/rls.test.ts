import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Corre las migraciones reales sobre Postgres en WASM (PGlite). Simula lo que
// Supabase aporta: el esquema `auth`, los roles anon/authenticated y los
// privilegios por defecto que Supabase concede a tablas y funciones nuevas.

const MIGRATIONS = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));

const PREAMBLE = `
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`;

const OWNER = '00000000-0000-0000-0000-00000000000a';
const EDITOR = '00000000-0000-0000-0000-00000000000b';
const VIEWER = '00000000-0000-0000-0000-00000000000c';
const STRANGER = '00000000-0000-0000-0000-00000000000d';
const T1 = '10000000-0000-0000-0000-000000000001';
const T2 = '10000000-0000-0000-0000-000000000002';

const SEED = `
  insert into auth.users (id) values ('${OWNER}'), ('${EDITOR}'), ('${VIEWER}'), ('${STRANGER}');
  insert into public.trees (id, name) values ('${T1}', 'Familia'), ('${T2}', 'Ajeno');
  insert into public.tree_members (tree_id, user_id, role) values
    ('${T1}', '${OWNER}', 'owner'), ('${T1}', '${EDITOR}', 'editor'), ('${T1}', '${VIEWER}', 'viewer'),
    ('${T2}', '${STRANGER}', 'owner');

  insert into public.persons (tree_id, id, rin, given_names, surname, notes) values
    ('${T1}', 'muerto', 1, 'Diego', 'Antiguo', 'nota secreta del muerto'),
    ('${T1}', 'vivo', 2, 'Luis', 'Actual', 'nota secreta del vivo'),
    ('${T1}', 'sin-fechas-padre', 3, 'Padre', 'SinFechas', ''),
    ('${T1}', 'sin-fechas-antiguo', 4, 'Remoto', 'SinFechas', ''),
    ('${T2}', 'ajeno', 1, 'Ajeno', 'Otro', 'no debe verse');
  insert into public.events (tree_id, person_id, type, date_text, date_sort, place) values
    ('${T1}', 'muerto', 'BIRT', '1700', 17000000, 'Pueblo'),
    ('${T1}', 'muerto', 'DEAT', '1760', 17600000, 'Pueblo'),
    ('${T1}', 'vivo', 'BIRT', '1990', 19900000, 'Ciudad');
  insert into public.families (tree_id, id, mrin, husband_id, wife_id, notes) values
    ('${T1}', 'f1', 1, 'sin-fechas-padre', null, 'nota de familia'),
    ('${T1}', 'f2', 2, 'sin-fechas-antiguo', null, 'nota de familia antigua'),
    ('${T1}', 'f3', 3, 'vivo', null, 'nota de familia viva');
  insert into public.family_children (tree_id, family_id, person_id) values
    ('${T1}', 'f1', 'vivo'),
    ('${T1}', 'f2', 'muerto');
  insert into public.events (tree_id, family_id, type, date_text, date_sort) values
    ('${T1}', 'f2', 'MARR', '1690', 16900000),
    ('${T1}', 'f3', 'MARR', '2015', 20150000);
  select public.refresh_living('${T1}');
`;

let db: PGlite;

type Q = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

/** Ejecuta como un usuario de la API (rol `authenticated` o `anon`); lo hecho se revierte. */
function as<T>(uid: string | null, fn: (q: Q) => Promise<T>, role: 'authenticated' | 'anon' = 'authenticated'): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    if (uid) await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    const result = await fn(async (sql, params) => (await tx.query(sql, params)).rows as Record<string, unknown>[]);
    throw Object.assign(new Error('rollback'), { result });
  }).then(
    () => undefined as never,
    (e: { message: string; result?: T }) => {
      if (e.message === 'rollback' && 'result' in e) return e.result as T;
      throw e;
    },
  );
}

const ids = (rows: Record<string, unknown>[]) => rows.map((r) => r.id as string).sort();

beforeAll(async () => {
  db = new PGlite();
  await db.exec(PREAMBLE);
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(MIGRATIONS + f, 'utf8'));
  }
  await db.exec(SEED);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe('S-06 usuario anónimo', () => {
  const tables = ['trees', 'tree_members', 'persons', 'families', 'family_children', 'events', 'media', 'change_log'];
  const views = ['persons_visible', 'families_visible', 'family_children_visible', 'events_visible', 'media_visible'];
  it.each([...tables, ...views])('no lee %s', async (name) => {
    await expect(as(null, (q) => q(`select * from public.${name}`), 'anon')).rejects.toThrow(/permission denied/);
  });
  it('no puede ejecutar las funciones de apoyo', async () => {
    await expect(as(null, (q) => q(`select public.refresh_living('${T1}')`), 'anon')).rejects.toThrow(/permission denied/);
    await expect(as(null, (q) => q(`select public.my_role('${T1}')`), 'anon')).rejects.toThrow(/permission denied/);
  });
});

describe('S-07 aislamiento entre árboles', () => {
  it('un usuario de otro árbol no ve este árbol, ni por tabla ni por vista', async () => {
    const own = await as(STRANGER, (q) => q(`select id from public.persons`));
    expect(ids(own)).toEqual(['ajeno']);
    expect(await as(STRANGER, (q) => q(`select id from public.persons_visible where tree_id = '${T1}'`))).toEqual([]);
    expect(await as(STRANGER, (q) => q(`select id from public.trees`))).toEqual([{ id: T2 }]);
  });
  it('no puede escribir en este árbol', async () => {
    await expect(
      as(STRANGER, (q) => q(`insert into public.persons (tree_id, id, rin) values ('${T1}', 'intruso', 99)`)),
    ).rejects.toThrow(/row-level security/);
    const upd = await as(STRANGER, (q) => q(`update public.persons set given_names = 'x' where tree_id = '${T1}' returning id`));
    expect(upd).toEqual([]);
    const del = await as(STRANGER, (q) => q(`delete from public.persons where tree_id = '${T1}' returning id`));
    expect(del).toEqual([]);
  });
});

describe('S-08 viewer y privacidad de vivos', () => {
  it('no lee las tablas directamente', async () => {
    expect(await as(VIEWER, (q) => q(`select id from public.persons`))).toEqual([]);
    expect(await as(VIEWER, (q) => q(`select id from public.events`))).toEqual([]);
    expect(await as(VIEWER, (q) => q(`select id from public.families`))).toEqual([]);
  });
  it('ve a los vivos solo como "Persona viva", sin notas', async () => {
    const rows = await as(VIEWER, (q) => q(`select * from public.persons_visible where id = 'vivo'`));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ masked: true, given_names: 'Persona viva', surname: '', notes: '', sex: 'U' });
  });
  it('ve completos a los fallecidos', async () => {
    const rows = await as(VIEWER, (q) => q(`select * from public.persons_visible where id = 'muerto'`));
    expect(rows[0]).toMatchObject({ masked: false, given_names: 'Diego', notes: 'nota secreta del muerto' });
  });
  it('no ve fechas ni lugares de vivos, pero sí los de fallecidos', async () => {
    const ev = await as(VIEWER, (q) => q(`select person_id, family_id, type from public.events_visible`));
    expect(ev.filter((e) => e.person_id === 'vivo')).toEqual([]);
    expect(ev.filter((e) => e.person_id === 'muerto').map((e) => e.type).sort()).toEqual(['BIRT', 'DEAT']);
    expect(ev.filter((e) => e.family_id === 'f3')).toEqual([]);
    expect(ev.filter((e) => e.family_id === 'f2')).toHaveLength(1);
  });
  it('conserva los vínculos de la persona viva pero oculta las notas de su familia', async () => {
    const fam = await as(VIEWER, (q) => q(`select id, husband_id, notes from public.families_visible order by id`));
    expect(fam.find((f) => f.id === 'f3')).toMatchObject({ husband_id: 'vivo', notes: '' });
    expect(fam.find((f) => f.id === 'f2')).toMatchObject({ notes: 'nota de familia antigua' });
    const kids = await as(VIEWER, (q) => q(`select person_id from public.family_children_visible`));
    expect(kids.map((k) => k.person_id).sort()).toEqual(['muerto', 'vivo']);
  });
  it('no puede escribir', async () => {
    await expect(as(VIEWER, (q) => q(`insert into public.persons (tree_id, id, rin) values ('${T1}', 'v', 50)`))).rejects.toThrow(/row-level security/);
    expect(await as(VIEWER, (q) => q(`update public.persons set notes = 'x' returning id`))).toEqual([]);
  });
  it('no puede recalcular quién está vivo', async () => {
    await expect(as(VIEWER, (q) => q(`select public.refresh_living('${T1}')`))).rejects.toThrow(/solo el dueño/);
  });
  it('el editor y el dueño sí ven a los vivos completos', async () => {
    for (const u of [EDITOR, OWNER]) {
      const rows = await as(u, (q) => q(`select * from public.persons_visible where id = 'vivo'`));
      expect(rows[0]).toMatchObject({ masked: false, given_names: 'Luis', notes: 'nota secreta del vivo' });
    }
  });
});

describe('quién está vivo', () => {
  it('aplica las reglas con y sin fechas', async () => {
    const rows = await db.query<{ id: string; is_living: boolean }>(`select id, is_living from public.persons where tree_id = '${T1}'`);
    const living = Object.fromEntries(rows.rows.map((r) => [r.id, r.is_living]));
    expect(living).toEqual({
      muerto: false, // tiene defunción
      vivo: true, // nació hace menos de 110 años y sin defunción
      'sin-fechas-padre': true, // padre de alguien nacido hace menos de 60 años
      'sin-fechas-antiguo': false, // sin fechas y sin descendientes recientes
    });
  });
  it('una persona nueva se oculta por defecto', async () => {
    await as(EDITOR, async (q) => {
      await q(`insert into public.persons (tree_id, id, rin, is_living) values ('${T1}', 'nuevo', 90, false)`);
      const r = await q(`select is_living from public.persons where id = 'nuevo'`);
      expect(r[0]).toEqual({ is_living: true });
    });
  });
  it('un editor no puede cambiar is_living ni living_override', async () => {
    await as(EDITOR, async (q) => {
      await q(`update public.persons set is_living = false where id = 'vivo'`);
      expect((await q(`select is_living from public.persons where id = 'vivo'`))[0]).toEqual({ is_living: true });
    });
    await expect(as(EDITOR, (q) => q(`update public.persons set living_override = false where id = 'vivo'`))).rejects.toThrow(/solo el dueño/);
  });
  it('el dueño puede forzar el estado', async () => {
    await as(OWNER, async (q) => {
      await q(`update public.persons set living_override = false where id = 'vivo'`);
      expect((await q(`select is_living from public.persons where id = 'vivo'`))[0]).toEqual({ is_living: false });
    });
  });
  it('agregar una defunción actualiza el estado', async () => {
    await as(EDITOR, async (q) => {
      await q(`insert into public.events (tree_id, person_id, type, date_text, date_sort) values ('${T1}', 'vivo', 'DEAT', '2020', 20200000)`);
      expect((await q(`select is_living from public.persons where id = 'vivo'`))[0]).toEqual({ is_living: false });
    });
  });
});

describe('S-09 el editor no administra el árbol', () => {
  it('escribe personas pero no cambia roles ni borra el árbol ni lo renombra', async () => {
    await as(EDITOR, async (q) => {
      const r = await q(`update public.persons set given_names = 'Editado' where id = 'muerto' returning id`);
      expect(r).toHaveLength(1);
    });
    await expect(as(EDITOR, (q) => q(`update public.tree_members set role = 'owner' where user_id = '${EDITOR}'`))).rejects.toThrow(/permission denied/);
    await expect(as(EDITOR, (q) => q(`delete from public.trees where id = '${T1}'`))).rejects.toThrow(/permission denied/);
    expect(await as(EDITOR, (q) => q(`update public.trees set name = 'x' where id = '${T1}' returning id`))).toEqual([]);
  });
  it('el dueño puede renombrar pero tampoco borrar el árbol desde la API', async () => {
    expect(await as(OWNER, (q) => q(`update public.trees set name = 'Nuevo' where id = '${T1}' returning id`))).toHaveLength(1);
    await expect(as(OWNER, (q) => q(`delete from public.trees where id = '${T1}'`))).rejects.toThrow(/permission denied/);
  });
  it('solo puede haber un dueño por árbol', async () => {
    await expect(
      db.exec(`insert into public.tree_members (tree_id, user_id, role) values ('${T1}', '${STRANGER}', 'owner')`),
    ).rejects.toThrow(/unique|duplicate/);
  });
});

describe('S-12 change_log', () => {
  it('los usuarios no pueden escribirlo ni editarlo', async () => {
    for (const u of [OWNER, EDITOR]) {
      await expect(as(u, (q) => q(`insert into public.change_log (tree_id, table_name, row_key, op) values ('${T1}', 'persons', 'x', 'INSERT')`))).rejects.toThrow(/permission denied/);
      await expect(as(u, (q) => q(`update public.change_log set op = 'DELETE'`))).rejects.toThrow(/permission denied/);
      await expect(as(u, (q) => q(`delete from public.change_log`))).rejects.toThrow(/permission denied/);
    }
  });
  it('registra los cambios por trigger y solo el dueño los lee', async () => {
    await as(EDITOR, (q) => q(`update public.persons set given_names = 'Cambiado' where id = 'muerto'`)).catch(() => {});
    await db.exec(`update public.persons set given_names = 'Cambiado' where id = 'muerto' and tree_id = '${T1}'`);
    const owner = await as(OWNER, (q) => q(`select table_name, op, after->>'given_names' as given from public.change_log where row_key = 'muerto' order by id desc limit 1`));
    expect(owner[0]).toMatchObject({ table_name: 'persons', op: 'UPDATE', given: 'Cambiado' });
    expect(await as(EDITOR, (q) => q(`select id from public.change_log`))).toEqual([]);
    expect(await as(VIEWER, (q) => q(`select id from public.change_log`))).toEqual([]);
  });
  it('recalcular is_living no ensucia la bitácora', async () => {
    const before = await db.query<{ n: number }>(`select count(*)::int as n from public.change_log`);
    await db.exec(`select public.refresh_living('${T1}')`);
    const after = await db.query<{ n: number }>(`select count(*)::int as n from public.change_log`);
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });
});
