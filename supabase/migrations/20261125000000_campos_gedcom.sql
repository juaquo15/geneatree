-- Campos del GEDCOM de PAF que el esquema inicial no guardaba y que hacen
-- falta para exportar sin pérdida (F-40):
--   * spouse_order: orden de los matrimonios de una persona (FAMS). PAF lo
--     respeta en la vista Familia y no se puede deducir de `families`.
--   * changed_at: fecha "CHAN" de PAF, tal como venía (texto).
--   * media.position y media.extra: orden de las fotos de una persona y tags
--     de OBJE no interpretados (_TYPE…).

alter table public.persons
  add column spouse_order text[] not null default '{}',
  add column changed_at text;
alter table public.families add column changed_at text;
alter table public.media
  add column position integer not null default 0,
  add column extra jsonb;

-- Las vistas con columnas explícitas o `*` no ven columnas nuevas: se
-- recrean agregándolas al final (create or replace conserva los permisos).

create or replace view public.persons_visible as
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
  case when p.is_living and not public.can_write(p.tree_id) then null else p.extra end as extra,
  p.spouse_order,
  case when p.is_living and not public.can_write(p.tree_id) then null else p.changed_at end as changed_at
from public.persons p
where public.can_read(p.tree_id)
  and (p.deleted_at is null or public.can_write(p.tree_id));

create or replace view public.families_visible as
select
  f.tree_id, f.id, f.mrin, f.husband_id, f.wife_id, f.deleted_at, f.created_at, f.updated_at,
  case when not public.can_write(f.tree_id) and exists (
         select 1 from public.persons s
         where s.tree_id = f.tree_id and s.id in (f.husband_id, f.wife_id) and s.is_living)
       then '' else f.notes end as notes,
  case when not public.can_write(f.tree_id) and exists (
         select 1 from public.persons s
         where s.tree_id = f.tree_id and s.id in (f.husband_id, f.wife_id) and s.is_living)
       then null else f.extra end as extra,
  case when not public.can_write(f.tree_id) and exists (
         select 1 from public.persons s
         where s.tree_id = f.tree_id and s.id in (f.husband_id, f.wife_id) and s.is_living)
       then null else f.changed_at end as changed_at
from public.families f
where public.can_read(f.tree_id)
  and (f.deleted_at is null or public.can_write(f.tree_id));

create or replace view public.media_visible as
select m.* from public.media m
where public.can_read(m.tree_id) and (
  public.can_write(m.tree_id)
  or not exists (
    select 1 from public.persons p
    where p.tree_id = m.tree_id and p.id = m.person_id and p.is_living)
);
