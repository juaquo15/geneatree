-- GeneaTree: esquema inicial con RLS en todas las tablas.
-- Principio: nada es accesible a `anon`; todo cuelga de un árbol y de la
-- membresía del usuario en ese árbol (owner | editor | viewer).

create type public.tree_role as enum ('owner', 'editor', 'viewer');

create table public.trees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.tree_members (
  tree_id uuid not null references public.trees(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.tree_role not null,
  created_at timestamptz not null default now(),
  primary key (tree_id, user_id)
);
create index tree_members_user_idx on public.tree_members (user_id);

-- Un árbol siempre conserva al menos un dueño.
create unique index tree_members_one_owner_idx
  on public.tree_members (tree_id) where role = 'owner';

create table public.persons (
  tree_id uuid not null references public.trees(id) on delete cascade,
  id text not null,                       -- _UID de PAF o generado
  rin integer not null,
  sex text not null default 'U' check (sex in ('M', 'F', 'U')),
  given_names text not null default '',
  surname text not null default '',
  surname2 text not null default '',
  suffix text not null default '',
  title text not null default '',
  nickname text not null default '',
  alt_names jsonb not null default '[]',
  notes text not null default '',
  extra jsonb,                            -- tags GEDCOM no interpretados
  is_living boolean not null default false, -- calculado por trigger (ver abajo)
  living_override boolean,                -- el dueño puede forzar vivo/fallecido
  deleted_at timestamptz,                 -- papelera
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tree_id, id),
  unique (tree_id, rin)
);
create index persons_updated_idx on public.persons (tree_id, updated_at);

create table public.families (
  tree_id uuid not null references public.trees(id) on delete cascade,
  id text not null,
  mrin integer not null,
  husband_id text,
  wife_id text,
  notes text not null default '',
  extra jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tree_id, id),
  unique (tree_id, mrin),
  foreign key (tree_id, husband_id) references public.persons (tree_id, id) on delete set null (husband_id),
  foreign key (tree_id, wife_id) references public.persons (tree_id, id) on delete set null (wife_id)
);
create index families_updated_idx on public.families (tree_id, updated_at);

create table public.family_children (
  tree_id uuid not null,
  family_id text not null,
  person_id text not null,
  position integer not null default 0,
  pedigree text,                          -- birth, adopted, foster…
  is_primary boolean,
  primary key (tree_id, family_id, person_id),
  foreign key (tree_id, family_id) references public.families (tree_id, id) on delete cascade,
  foreign key (tree_id, person_id) references public.persons (tree_id, id) on delete cascade
);
create index family_children_person_idx on public.family_children (tree_id, person_id);

-- Eventos de personas y de familias. Exactamente uno de person_id / family_id.
create table public.events (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null,
  person_id text,
  family_id text,
  position integer not null default 0,
  type text not null,
  date_text text not null default '',      -- fuente de verdad
  date_parsed jsonb,                       -- ParsedDate
  date_sort integer,
  place text not null default '',
  cause text not null default '',
  note text not null default '',
  extra jsonb,
  updated_at timestamptz not null default now(),
  check ((person_id is null) <> (family_id is null)),
  foreign key (tree_id, person_id) references public.persons (tree_id, id) on delete cascade,
  foreign key (tree_id, family_id) references public.families (tree_id, id) on delete cascade
);
create index events_person_idx on public.events (tree_id, person_id);
create index events_family_idx on public.events (tree_id, family_id);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null,
  person_id text not null,
  file text not null,                      -- ruta original de PAF
  storage_path text,                       -- objeto en el bucket privado
  title text not null default '',
  format text,
  note text not null default '',
  is_primary boolean not null default false,
  updated_at timestamptz not null default now(),
  foreign key (tree_id, person_id) references public.persons (tree_id, id) on delete cascade
);
create index media_person_idx on public.media (tree_id, person_id);

create table public.change_log (
  id bigint generated always as identity primary key,
  tree_id uuid not null references public.trees(id) on delete cascade,
  user_id uuid default auth.uid(),
  table_name text not null,
  row_key text not null,
  op text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);
create index change_log_tree_idx on public.change_log (tree_id, at desc);

-- ---------------------------------------------------------------------------
-- Funciones auxiliares (security definer para no recursar en RLS)
-- ---------------------------------------------------------------------------

create function public.my_role(p_tree uuid)
returns public.tree_role
language sql stable security definer set search_path = ''
as $$
  select role from public.tree_members
  where tree_id = p_tree and user_id = (select auth.uid())
$$;

create function public.can_read(p_tree uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select public.my_role(p_tree) is not null $$;

create function public.can_write(p_tree uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select public.my_role(p_tree) in ('owner', 'editor') $$;

create function public.is_owner(p_tree uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select public.my_role(p_tree) = 'owner' $$;

revoke all on function public.my_role(uuid), public.can_read(uuid),
  public.can_write(uuid), public.is_owner(uuid) from public, anon;
grant execute on function public.my_role(uuid), public.can_read(uuid),
  public.can_write(uuid), public.is_owner(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers: updated_at, bitácora, vivo/fallecido
-- ---------------------------------------------------------------------------

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end $$;

create trigger persons_touch before update on public.persons
  for each row execute function public.touch_updated_at();
create trigger families_touch before update on public.families
  for each row execute function public.touch_updated_at();
create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();
create trigger media_touch before update on public.media
  for each row execute function public.touch_updated_at();

-- Solo inserción por trigger: los usuarios no tienen política de escritura.
create function public.log_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  key text;
begin
  key := coalesce(r->>'id', concat_ws('/', r->>'family_id', r->>'person_id'));
  insert into public.change_log (tree_id, table_name, row_key, op, before, after)
  values ((r->>'tree_id')::uuid, tg_table_name, key, tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger persons_log after insert or update or delete on public.persons
  for each row execute function public.log_change();
create trigger families_log after insert or update or delete on public.families
  for each row execute function public.log_change();
create trigger family_children_log after insert or update or delete on public.family_children
  for each row execute function public.log_change();
create trigger events_log after insert or update or delete on public.events
  for each row execute function public.log_change();
create trigger media_log after insert or update or delete on public.media
  for each row execute function public.log_change();

-- Una persona está viva si no tiene defunción/entierro y nació hace menos de
-- 110 años, o si no tiene ninguna fecha (la regla de descendientes recientes
-- se aplica en la migración de privacidad). `living_override` manda sobre todo.
create function public.compute_living(p_tree uuid, p_person text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select living_override from public.persons where tree_id = p_tree and id = p_person),
    not exists (
      select 1 from public.events
      where tree_id = p_tree and person_id = p_person and type in ('DEAT', 'BURI')
    ) and coalesce(
      (select date_sort / 10000 > extract(year from now())::int - 110
       from public.events
       where tree_id = p_tree and person_id = p_person and type in ('BIRT', 'CHR')
         and date_sort is not null
       order by date_sort limit 1),
      true)
  )
$$;
revoke all on function public.compute_living(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.trees enable row level security;
alter table public.tree_members enable row level security;
alter table public.persons enable row level security;
alter table public.families enable row level security;
alter table public.family_children enable row level security;
alter table public.events enable row level security;
alter table public.media enable row level security;
alter table public.change_log enable row level security;

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

grant select, update (name) on public.trees to authenticated;
grant select on public.tree_members to authenticated;
grant select on public.change_log to authenticated;
grant select, insert, update, delete on
  public.families, public.family_children, public.events, public.media
  to authenticated;
-- persons: los viewer leen a través de la vista `persons_visible`, no de la tabla.
grant select, insert, update, delete on public.persons to authenticated;

create policy trees_read on public.trees for select to authenticated
  using (public.can_read(id));
create policy trees_rename on public.trees for update to authenticated
  using (public.is_owner(id)) with check (public.is_owner(id));

create policy members_read on public.tree_members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_owner(tree_id));

-- Solo el dueño puede ver el log completo.
create policy change_log_read on public.change_log for select to authenticated
  using (public.is_owner(tree_id));

-- Tablas de contenido: lectura solo owner/editor directamente; los viewer
-- pasan por vistas que ocultan a los vivos (migración siguiente).
create policy persons_rw_select on public.persons for select to authenticated
  using (public.can_write(tree_id));
create policy persons_ins on public.persons for insert to authenticated
  with check (public.can_write(tree_id));
create policy persons_upd on public.persons for update to authenticated
  using (public.can_write(tree_id)) with check (public.can_write(tree_id));
create policy persons_del on public.persons for delete to authenticated
  using (public.can_write(tree_id));

do $$
declare t text;
begin
  foreach t in array array['families', 'family_children', 'events', 'media'] loop
    execute format('create policy %I_sel on public.%I for select to authenticated using (public.can_write(tree_id))', t, t);
    execute format('create policy %I_ins on public.%I for insert to authenticated with check (public.can_write(tree_id))', t, t);
    execute format('create policy %I_upd on public.%I for update to authenticated using (public.can_write(tree_id)) with check (public.can_write(tree_id))', t, t);
    execute format('create policy %I_del on public.%I for delete to authenticated using (public.can_write(tree_id))', t, t);
  end loop;
end $$;
