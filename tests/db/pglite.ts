import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

// Corre las migraciones reales sobre Postgres en WASM (PGlite). Simula lo que
// Supabase aporta: el esquema `auth`, los roles anon/authenticated y los
// privilegios por defecto que Supabase concede a tablas y funciones nuevas.

const MIGRATIONS = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));

const PREAMBLE = `
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`;

/** Una base nueva con todas las migraciones aplicadas. */
export async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(PREAMBLE);
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(MIGRATIONS + f, 'utf8'));
  }
  return db;
}
