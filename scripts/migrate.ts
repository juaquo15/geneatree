// Migración GEDCOM → Supabase (H2). Se ejecuta en el equipo local, nunca en CI
// ni en el navegador.
//
//   DATABASE_URL='postgresql://postgres:…@db.<ref>.supabase.co:5432/postgres' \
//     npm run migrate -- --file ruta/al/export.ged --tree <uuid> [--prune] [--dry-run]
//
//   Primera vez (crea el árbol y deja al dueño):
//     npm run migrate -- --file export.ged --new-tree "Familia" --owner correo@ejemplo.com
//
// DATABASE_URL va por entorno (no por argumento) para que no quede en el
// historial de la terminal. Es la conexión directa del panel de Supabase
// (Project Settings → Database); salta RLS, así que trátela como una contraseña.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { importGedcom } from '../src/lib/gedcom/import';
import { migrateTree, type Counts } from './lib/migrate';

const USAGE = `Uso: npm run migrate -- --file export.ged (--tree <uuid> | --new-tree "Nombre") [--owner correo] [--prune] [--keep-log] [--dry-run]`;

const { values: args } = parseArgs({
  options: {
    file: { type: 'string' },
    tree: { type: 'string' },
    'new-tree': { type: 'string' },
    owner: { type: 'string' },
    prune: { type: 'boolean', default: false },
    'keep-log': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

function fail(msg: string): never {
  console.error(`Error: ${msg}\n${USAGE}`);
  process.exit(1);
}

if (args.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!args.file) fail('falta --file');
if (!args.tree === !args['new-tree']) fail('use --tree o --new-tree (solo uno)');
const url = process.env.DATABASE_URL;
if (!url) fail('falta la variable de entorno DATABASE_URL');

const text = readFileSync(args.file, 'utf8');
const tree = importGedcom(text);
console.log(`GEDCOM: ${tree.people.size} personas, ${tree.families.size} familias.`);
const broken = tree.warnings.filter((w) => w.kind === 'missing-ref').length;
if (broken) console.warn(`Aviso: ${broken} referencias a registros que no existen (se omiten).`);

const client = new pg.Client({ connectionString: url });
await client.connect();
let ok = false;
try {
  await client.query('begin');
  // Con 32k personas la primera carga tarda ~30 s; que no la corte un límite por consulta.
  await client.query('set local statement_timeout = 0');
  let treeId = args.tree;
  if (!treeId) {
    const r = await client.query<{ id: string }>(`insert into public.trees (name) values ($1) returning id`, [args['new-tree']]);
    treeId = r.rows[0]!.id;
    console.log(`Árbol creado: ${treeId}`);
  } else if ((await client.query(`select 1 from public.trees where id = $1`, [treeId])).rowCount === 0) {
    throw new Error(`no existe el árbol ${treeId}`);
  }

  if (args.owner) {
    const u = await client.query<{ id: string }>(`select id from auth.users where lower(email) = lower($1)`, [args.owner]);
    if (!u.rows[0]) throw new Error(`no hay un usuario con el correo ${args.owner} (invítelo primero desde Supabase)`);
    const current = await client.query<{ user_id: string }>(
      `select user_id from public.tree_members where tree_id = $1 and role = 'owner'`,
      [treeId],
    );
    if (current.rows[0] && current.rows[0].user_id !== u.rows[0].id) throw new Error('el árbol ya tiene otro dueño');
    await client.query(
      `insert into public.tree_members (tree_id, user_id, role) values ($1, $2, 'owner')
       on conflict (tree_id, user_id) do update set role = 'owner'`,
      [treeId, u.rows[0].id],
    );
  }

  const t0 = performance.now();
  const r = await migrateTree(client, treeId, tree, { prune: args.prune, keepLog: args['keep-log'] });
  console.log(`Listo en ${((performance.now() - t0) / 1000).toFixed(1)} s.`);
  console.log(`  Personas: ${r.inserted.persons} nuevas, ${r.updated.persons} actualizadas`);
  console.log(`  Familias: ${r.inserted.families} nuevas, ${r.updated.families} actualizadas`);
  console.log(`  Hijos:    ${r.inserted.children} nuevos, ${r.updated.children} actualizados, ${r.removedChildren} quitados`);
  console.log(`  Eventos reescritos en ${r.rewritten.events} personas/familias; fotos en ${r.rewritten.media} personas`);
  if (r.missing.persons.length || r.missing.families.length) {
    const what = `${r.missing.persons.length} personas y ${r.missing.families.length} familias que ya no están en el GEDCOM`;
    console.log(args.prune ? `  A la papelera: ${what}.` : `  Atención: hay ${what} (use --prune para enviarlas a la papelera).`);
  }

  const keys = Object.keys(r.expected) as (keyof Counts)[];
  const bad = keys.filter((k) => r.expected[k] !== r.actual[k]);
  console.log('\n  Conteo      GEDCOM    Base');
  for (const k of keys) console.log(`  ${k.padEnd(10)} ${String(r.expected[k]).padStart(7)} ${String(r.actual[k]).padStart(7)}${bad.includes(k) ? '  ✗' : ''}`);

  if (args['dry-run']) {
    await client.query('rollback');
    ok = bad.length === 0;
    console.log('\n--dry-run: no se guardó nada.');
  } else if (bad.length) {
    await client.query('rollback');
    console.error('\nLos conteos no coinciden: no se guardó nada.');
  } else {
    await client.query('commit');
    ok = true;
    console.log('\nGuardado. Los conteos coinciden.');
  }
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.error(`Error: ${(e as Error).message}. No se guardó nada.`);
} finally {
  await client.end();
}
process.exit(ok ? 0 : 1);
