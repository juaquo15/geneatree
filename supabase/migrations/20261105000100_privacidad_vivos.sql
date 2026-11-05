-- Privacidad de personas vivas.
-- Los `viewer` no leen las tablas: leen vistas que ocultan a los vivos
-- (queda "Persona viva" y sus vínculos, sin fechas, lugares ni notas).
-- Es una protección de mejor esfuerzo: el dueño puede forzar el estado de
-- cualquier persona con `living_override`.

drop function public.compute_living(uuid, text);

-- Por seguridad, una persona nueva o sin determinar se oculta hasta que
-- `refresh_living` o sus eventos digan lo contrario.
alter table public.persons alter column is_living set default true;

-- Con fechas: true/false. Sin fechas suficientes: null (sin determinar).
create function public.compute_living_dated(p_tree uuid, p_person text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select living_override from public.persons where tree_id = p_tree and id = p_person),
    case
      when exists (
        select 1 from public.events
        where tree_id = p_tree and person_id = p_person and type in ('DEAT', 'BURI')
      ) then false
      else (
        select date_sort / 10000 > extract(year from now())::int - 110
        from public.events
        where tree_id = p_tree and person_id = p_person
          and type in ('BIRT', 'CHR') and date_sort is not null
        order by date_sort limit 1
      )
    end
  )
$$;

create function public.birth_year(p_tree uuid, p_person text)
returns integer
language sql stable security definer set search_path = ''
as $$
  select date_sort / 10000 from public.events
  where tree_id = p_tree and person_id = p_person
    and type in ('BIRT', 'CHR') and date_sort is not null
  order by date_sort limit 1
$$;

revoke all on function public.compute_living_dated(uuid, text), public.birth_year(uuid, text)
  from public, anon, authenticated;

-- Los eventos mantienen `is_living` al día para la regla con fechas.
create function public.events_living() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  tid uuid;
  pid text;
  v boolean;
begin
  tid := coalesce(new.tree_id, old.tree_id);
  pid := coalesce(new.person_id, old.person_id);
  if pid is not null then
    v := public.compute_living_dated(tid, pid);
    if v is not null then
      update public.persons set is_living = v
      where tree_id = tid and id = pid and is_living is distinct from v;
    end if;
  end if;
  return null;
end $$;

create trigger events_living_trg after insert or update or delete on public.events
  for each row execute function public.events_living();

-- Reglas para quien no tiene fechas, aplicadas por `refresh_living`:
-- vive si es padre/madre de alguien nacido hace menos de 60 años y sin
-- defunción, o si su padre o madre vive. No es transitivo a propósito.
create function public.refresh_living(p_tree uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_owner(p_tree) then
    raise exception 'solo el dueño puede recalcular quién está vivo' using errcode = '42501';
  end if;

  update public.persons p set is_living = d.v
  from (
    select id, public.compute_living_dated(tree_id, id) as v
    from public.persons where tree_id = p_tree
  ) d
  where p.tree_id = p_tree and p.id = d.id and d.v is not null and p.is_living is distinct from d.v;

  update public.persons p set is_living = r.v
  from (
    select u.id,
      exists (
        select 1
        from public.families f
        join public.family_children fc on fc.tree_id = f.tree_id and fc.family_id = f.id
        where f.tree_id = p_tree and u.id in (f.husband_id, f.wife_id)
          and public.birth_year(p_tree, fc.person_id) > extract(year from now())::int - 60
          and not exists (
            select 1 from public.events e
            where e.tree_id = p_tree and e.person_id = fc.person_id and e.type in ('DEAT', 'BURI'))
      )
      or exists (
        select 1
        from public.family_children fc
        join public.families f on f.tree_id = fc.tree_id and f.id = fc.family_id
        where fc.tree_id = p_tree and fc.person_id = u.id
          and (public.compute_living_dated(p_tree, f.husband_id) is true
            or public.compute_living_dated(p_tree, f.wife_id) is true)
      ) as v
    from public.persons u
    where u.tree_id = p_tree and public.compute_living_dated(u.tree_id, u.id) is null
  ) r
  where p.tree_id = p_tree and p.id = r.id and p.is_living is distinct from r.v;
end $$;

revoke all on function public.refresh_living(uuid) from public, anon;
grant execute on function public.refresh_living(uuid) to authenticated;

-- Los clientes no deciden quién está vivo: solo el dueño fuerza el estado.
create function public.persons_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.is_living := true;
      if new.living_override is not null then
        raise exception 'solo el dueño puede fijar living_override' using errcode = '42501';
      end if;
    else
      new.is_living := old.is_living;
      if new.living_override is distinct from old.living_override then
        if not public.is_owner(new.tree_id) then
          raise exception 'solo el dueño puede fijar living_override' using errcode = '42501';
        end if;
        if new.living_override is not null then
          new.is_living := new.living_override;
        end if;
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger persons_guard_trg before insert or update on public.persons
  for each row execute function public.persons_guard();

-- Recalcular `is_living` no es un cambio de contenido: no va a la bitácora.
create or replace function public.log_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  key text;
begin
  if tg_op = 'UPDATE' and tg_table_name = 'persons'
     and (to_jsonb(new) - 'is_living' - 'updated_at') = (to_jsonb(old) - 'is_living' - 'updated_at') then
    return new;
  end if;
  key := coalesce(r->>'id', concat_ws('/', r->>'family_id', r->>'person_id'));
  insert into public.change_log (tree_id, table_name, row_key, op, before, after)
  values ((r->>'tree_id')::uuid, tg_table_name, key, tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------------
-- Vistas para toda lectura de la app. Pertenecen al dueño de la migración
-- (saltan RLS) y filtran por membresía; solo `authenticated` las lee.
-- ---------------------------------------------------------------------------

create view public.persons_visible as
select
  p.tree_id, p.id, p.rin, p.deleted_at, p.created_at, p.updated_at,
  (p.is_living and not public.can_write(p.tree_id)) as masked,
  case when p.is_living and not public.can_write(p.tree_id) then 'U' else p.sex end as sex,
  case when p.is_living and not public.can_write(p.tree_id) then 'Persona viva' else p.given_names end as given_names,
  case when p.is_living and not public.can_write(p.tree_id) then '' else p.surname end as surname,
  case when p.is_living and not public.can_write(p.tree_id) then '' else p.surname2 end as surname2,
  case when p.is_living and not public.can_write(p.tree_id) then '' else p.suffix end as suffix,
  case when p.is_living and not public.can_write(p.tree_id) then '' else p.title end as title,
  case when p.is_living and not public.can_write(p.tree_id) then '' else p.nickname end as nickname,
  case when p.is_living and not public.can_write(p.tree_id) then '[]'::jsonb else p.alt_names end as alt_names,
  case when p.is_living and not public.can_write(p.tree_id) then '' else p.notes end as notes,
  case when p.is_living and not public.can_write(p.tree_id) then null else p.extra end as extra
from public.persons p
where public.can_read(p.tree_id)
  and (p.deleted_at is null or public.can_write(p.tree_id));

create view public.families_visible as
select
  f.tree_id, f.id, f.mrin, f.husband_id, f.wife_id, f.deleted_at, f.created_at, f.updated_at,
  case when not public.can_write(f.tree_id) and exists (
         select 1 from public.persons s
         where s.tree_id = f.tree_id and s.id in (f.husband_id, f.wife_id) and s.is_living)
       then '' else f.notes end as notes,
  case when not public.can_write(f.tree_id) and exists (
         select 1 from public.persons s
         where s.tree_id = f.tree_id and s.id in (f.husband_id, f.wife_id) and s.is_living)
       then null else f.extra end as extra
from public.families f
where public.can_read(f.tree_id)
  and (f.deleted_at is null or public.can_write(f.tree_id));

create view public.family_children_visible as
select fc.* from public.family_children fc
where public.can_read(fc.tree_id);

create view public.events_visible as
select e.* from public.events e
where public.can_read(e.tree_id) and (
  public.can_write(e.tree_id)
  or (e.person_id is not null and not exists (
        select 1 from public.persons p
        where p.tree_id = e.tree_id and p.id = e.person_id and p.is_living))
  or (e.family_id is not null and not exists (
        select 1 from public.families f
        join public.persons p on p.tree_id = f.tree_id and p.id in (f.husband_id, f.wife_id)
        where f.tree_id = e.tree_id and f.id = e.family_id and p.is_living))
);

create view public.media_visible as
select m.* from public.media m
where public.can_read(m.tree_id) and (
  public.can_write(m.tree_id)
  or not exists (
    select 1 from public.persons p
    where p.tree_id = m.tree_id and p.id = m.person_id and p.is_living)
);

revoke all on public.persons_visible, public.families_visible, public.family_children_visible,
  public.events_visible, public.media_visible from public, anon, authenticated;
grant select on public.persons_visible, public.families_visible, public.family_children_visible,
  public.events_visible, public.media_visible to authenticated;
