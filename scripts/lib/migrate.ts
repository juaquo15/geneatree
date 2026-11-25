// GEDCOM ya importado (TreeData) → un árbol en Postgres/Supabase.
//
// Idempotente: se puede repetir con un export más nuevo de PAF y solo escribe
// lo que cambió (identificado por el _UID de PAF). Correrlo dos veces seguidas
// no escribe nada la segunda vez (F-41).
//
// Corre como el rol `postgres` (conexión directa), que salta RLS; nunca con
// claves de la app. Todo va en una sola transacción que abre quien llama.

import type { TreeData } from '../../src/lib/model/types';
import { treeToRows, type TreeRows } from '../../src/lib/db/rows';

export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface MigrateOptions {
  /** Envía a la papelera lo que está en la base pero ya no en el GEDCOM. */
  prune?: boolean;
  /** Conserva en `change_log` las filas que genera la importación. */
  keepLog?: boolean;
}

export interface Counts {
  persons: number;
  families: number;
  children: number;
  events: number;
  media: number;
  notes: number;
}

export interface MigrateReport {
  inserted: { persons: number; families: number; children: number };
  updated: { persons: number; families: number; children: number };
  /** Personas/familias cuyos eventos o fotos se reemplazaron. */
  rewritten: { events: number; media: number };
  /** En la base pero no en el GEDCOM (a la papelera si `prune`). */
  missing: { persons: string[]; families: string[] };
  removedChildren: number;
  expected: Counts;
  actual: Counts;
}

const BATCH = 2000;

function* chunks<T>(xs: T[]): Generator<T[]> {
  for (let i = 0; i < xs.length; i += BATCH) yield xs.slice(i, i + BATCH);
}

/** JSON con claves ordenadas, para comparar con lo que devuelve jsonb. */
function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  );
}

type Col = [name: string, type: string];

/**
 * Inserta o actualiza filas desde un arreglo JSON. Solo toca las filas que
 * difieren (o que estaban en la papelera, si `undelete`).
 */
async function upsert(
  sql: Sql,
  table: string,
  treeId: string,
  key: string[],
  cols: Col[],
  rows: object[],
  undelete: boolean,
): Promise<{ inserted: number; updated: number }> {
  const names = cols.map(([n]) => n);
  const data = names.filter((n) => !key.includes(n));
  const set = [...data.map((n) => `${n} = excluded.${n}`), ...(undelete ? ['deleted_at = null'] : [])];
  const differs = [
    `(${data.map((n) => `t.${n}`).join(', ')}) is distinct from (${data.map((n) => `excluded.${n}`).join(', ')})`,
    ...(undelete ? ['t.deleted_at is not null'] : []),
  ].join(' or ');
  const text = `
    insert into public.${table} as t (tree_id, ${names.join(', ')})
    select $1, ${names.map((n) => `r.${n}`).join(', ')}
    from jsonb_to_recordset($2::jsonb) as r(${cols.map(([n, ty]) => `${n} ${ty}`).join(', ')})
    on conflict (tree_id, ${key.join(', ')}) do update set ${set.join(', ')}
    where ${differs}
    returning (xmax = 0) as inserted`;
  let inserted = 0;
  let updated = 0;
  for (const part of chunks(rows)) {
    const res = await sql.query<{ inserted: boolean }>(text, [treeId, JSON.stringify(part)]);
    for (const r of res.rows) r.inserted ? inserted++ : updated++;
  }
  return { inserted, updated };
}

const PERSON_COLS: Col[] = [
  ['id', 'text'], ['rin', 'integer'], ['sex', 'text'], ['given_names', 'text'], ['surname', 'text'],
  ['surname2', 'text'], ['suffix', 'text'], ['title', 'text'], ['nickname', 'text'],
  ['alt_names', 'jsonb'], ['notes', 'text'], ['extra', 'jsonb'], ['spouse_order', 'text[]'],
  ['changed_at', 'text'],
];
const FAMILY_COLS: Col[] = [
  ['id', 'text'], ['mrin', 'integer'], ['husband_id', 'text'], ['wife_id', 'text'],
  ['notes', 'text'], ['extra', 'jsonb'], ['changed_at', 'text'],
];
const CHILD_COLS: Col[] = [
  ['family_id', 'text'], ['person_id', 'text'], ['position', 'integer'], ['pedigree', 'text'],
  ['is_primary', 'boolean'],
];
const EVENT_COLS: Col[] = [
  ['person_id', 'text'], ['family_id', 'text'], ['position', 'integer'], ['type', 'text'],
  ['date_text', 'text'], ['date_parsed', 'jsonb'], ['date_sort', 'integer'], ['place', 'text'],
  ['cause', 'text'], ['note', 'text'], ['extra', 'jsonb'],
];
const MEDIA_COLS: Col[] = [
  ['person_id', 'text'], ['position', 'integer'], ['file', 'text'], ['title', 'text'],
  ['format', 'text'], ['note', 'text'], ['is_primary', 'boolean'], ['extra', 'jsonb'],
];

/**
 * Reemplaza los eventos (o fotos) de cada dueño cuya lista cambió. Los
 * eventos no tienen un id estable en GEDCOM: se comparan como lista ordenada.
 */
async function replaceLists(
  sql: Sql,
  table: 'events' | 'media',
  treeId: string,
  cols: Col[],
  rows: object[],
  owners: { persons: Set<string>; families: Set<string> },
): Promise<number> {
  const ownerCols = table === 'events' ? ['person_id', 'family_id'] : ['person_id'];
  const ownerKey = (r: Record<string, unknown>) =>
    r.person_id != null ? `p:${r.person_id as string}` : `f:${r.family_id as string}`;
  const strip = (r: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(r).filter(([k]) => !ownerCols.includes(k)));

  const want = new Map<string, unknown[]>();
  for (const id of owners.persons) want.set(`p:${id}`, []);
  if (table === 'events') for (const id of owners.families) want.set(`f:${id}`, []);
  for (const r of rows as Record<string, unknown>[]) want.get(ownerKey(r))?.push(strip(r));

  const have = new Map<string, string>();
  const res = await sql.query<Record<string, unknown> & { list: unknown[] }>(
    `select ${ownerCols.join(', ')},
       jsonb_agg(to_jsonb(x) - array['id', 'tree_id', 'updated_at', 'storage_path', ${ownerCols
         .map((c) => `'${c}'`)
         .join(', ')}] order by x.position) as list
     from public.${table} x where tree_id = $1 group by ${ownerCols.join(', ')}`,
    [treeId],
  );
  for (const r of res.rows) have.set(ownerKey(r), canon(r.list));

  const changed = [...want].filter(([k, list]) => (have.get(k) ?? canon([])) !== canon(list)).map(([k]) => k);
  if (changed.length === 0) return 0;

  const persons = changed.filter((k) => k.startsWith('p:')).map((k) => k.slice(2));
  const families = changed.filter((k) => k.startsWith('f:')).map((k) => k.slice(2));
  // Las fotos ya subidas al bucket conservan su objeto si el archivo es el mismo.
  const keepStorage =
    table === 'media'
      ? (
          await sql.query<{ person_id: string; file: string; storage_path: string }>(
            `select person_id, file, storage_path from public.media
             where tree_id = $1 and person_id = any($2::text[]) and storage_path is not null`,
            [treeId, persons],
          )
        ).rows
      : [];
  if (persons.length) await sql.query(`delete from public.${table} where tree_id = $1 and person_id = any($2::text[])`, [treeId, persons]);
  if (families.length) await sql.query(`delete from public.${table} where tree_id = $1 and family_id = any($2::text[])`, [treeId, families]);

  const set = new Set(changed);
  const fresh = (rows as Record<string, unknown>[]).filter((r) => set.has(ownerKey(r)));
  const names = cols.map(([n]) => n);
  for (const part of chunks(fresh)) {
    await sql.query(
      `insert into public.${table} (tree_id, ${names.join(', ')})
       select $1, ${names.map((n) => `r.${n}`).join(', ')}
       from jsonb_to_recordset($2::jsonb) as r(${cols.map(([n, ty]) => `${n} ${ty}`).join(', ')})`,
      [treeId, JSON.stringify(part)],
    );
  }
  for (const k of keepStorage) {
    await sql.query(
      `update public.media set storage_path = $4
       where tree_id = $1 and person_id = $2 and file = $3 and storage_path is null`,
      [treeId, k.person_id, k.file, k.storage_path],
    );
  }
  return changed.length;
}

export function expectedCounts(rows: TreeRows): Counts {
  return {
    persons: rows.persons.length,
    families: rows.families.length,
    children: rows.children.length,
    events: rows.events.length,
    media: rows.media.length,
    notes:
      rows.persons.filter((p) => p.notes).length +
      rows.families.filter((f) => f.notes).length +
      rows.events.filter((e) => e.note).length,
  };
}

/** Conteos de lo que está fuera de la papelera, para compararlos con el GEDCOM. */
export async function countTree(sql: Sql, treeId: string): Promise<Counts> {
  const res = await sql.query<Counts>(
    `with p as (select id, notes from public.persons where tree_id = $1 and deleted_at is null),
          f as (select id, notes from public.families where tree_id = $1 and deleted_at is null),
          e as (select note from public.events where tree_id = $1
                and (person_id in (select id from p) or family_id in (select id from f)))
     select
       (select count(*) from p)::int as persons,
       (select count(*) from f)::int as families,
       (select count(*) from public.family_children where tree_id = $1
          and family_id in (select id from f) and person_id in (select id from p))::int as children,
       (select count(*) from e)::int as events,
       (select count(*) from public.media where tree_id = $1 and person_id in (select id from p))::int as media,
       ((select count(*) from p where notes <> '') + (select count(*) from f where notes <> '')
          + (select count(*) from e where note <> ''))::int as notes`,
    [treeId],
  );
  return res.rows[0]!;
}

export async function migrateTree(sql: Sql, treeId: string, tree: TreeData, opts: MigrateOptions = {}): Promise<MigrateReport> {
  const rows = treeToRows(tree);
  const owners = { persons: new Set(rows.persons.map((p) => p.id)), families: new Set(rows.families.map((f) => f.id)) };

  // Personas primero: las familias y los hijos las referencian.
  const persons = await upsert(sql, 'persons', treeId, ['id'], PERSON_COLS, rows.persons, true);
  const families = await upsert(sql, 'families', treeId, ['id'], FAMILY_COLS, rows.families, true);
  const children = await upsert(sql, 'family_children', treeId, ['family_id', 'person_id'], CHILD_COLS, rows.children, false);

  // Hijos que el GEDCOM ya no pone en una familia que sí trae.
  const removed = await sql.query(
    `delete from public.family_children fc
     where fc.tree_id = $1 and fc.family_id = any($2::text[])
       and not exists (
         select 1 from jsonb_to_recordset($3::jsonb) as r(family_id text, person_id text)
         where r.family_id = fc.family_id and r.person_id = fc.person_id)
     returning 1`,
    [treeId, [...owners.families], JSON.stringify(rows.children.map(({ family_id, person_id }) => ({ family_id, person_id })))],
  );

  const events = await replaceLists(sql, 'events', treeId, EVENT_COLS, rows.events, owners);
  const media = await replaceLists(sql, 'media', treeId, MEDIA_COLS, rows.media, owners);

  const missingOf = async (table: 'persons' | 'families', ids: Set<string>) =>
    (
      await sql.query<{ id: string }>(
        `select id from public.${table} where tree_id = $1 and deleted_at is null and not (id = any($2::text[])) order by id`,
        [treeId, [...ids]],
      )
    ).rows.map((r) => r.id);
  const missing = { persons: await missingOf('persons', owners.persons), families: await missingOf('families', owners.families) };
  if (opts.prune) {
    for (const table of ['persons', 'families'] as const) {
      if (missing[table].length)
        await sql.query(`update public.${table} set deleted_at = now() where tree_id = $1 and id = any($2::text[])`, [treeId, missing[table]]);
    }
  }

  // Sin sesión de usuario, refresh_living no exige ser dueño.
  await sql.query(`select public.refresh_living($1)`, [treeId]);

  // La importación no es historia editorial: now() es la hora de inicio de
  // esta transacción, así que solo se borran las filas que escribió ella.
  if (!opts.keepLog) await sql.query(`delete from public.change_log where tree_id = $1 and at = now()`, [treeId]);

  return {
    inserted: { persons: persons.inserted, families: families.inserted, children: children.inserted },
    updated: { persons: persons.updated, families: families.updated, children: children.updated },
    rewritten: { events, media },
    missing,
    removedChildren: removed.rows.length,
    expected: expectedCounts(rows),
    actual: await countTree(sql, treeId),
  };
}
