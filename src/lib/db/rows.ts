// Modelo de GeneaTree → filas de las tablas de Supabase (supabase/migrations).
// Lo usan la migración inicial (scripts/migrate.ts) y, más adelante, la
// sincronización. Los nombres de campo son los de las columnas.

import type { Family, LifeEvent, Person, TreeData } from '../model/types';

export interface PersonRow {
  id: string;
  rin: number;
  sex: string;
  given_names: string;
  surname: string;
  surname2: string;
  suffix: string;
  title: string;
  nickname: string;
  alt_names: Person['altNames'];
  notes: string;
  extra: Person['extra'] | null;
  spouse_order: string[];
  changed_at: string | null;
}

export interface FamilyRow {
  id: string;
  mrin: number;
  husband_id: string | null;
  wife_id: string | null;
  notes: string;
  extra: Family['extra'] | null;
  changed_at: string | null;
}

export interface ChildRow {
  family_id: string;
  person_id: string;
  position: number;
  pedigree: string | null;
  is_primary: boolean | null;
}

export interface EventRow {
  person_id: string | null;
  family_id: string | null;
  position: number;
  type: string;
  date_text: string;
  date_parsed: LifeEvent['date'] | null;
  date_sort: number | null;
  place: string;
  cause: string;
  note: string;
  extra: LifeEvent['extra'] | null;
}

export interface MediaRow {
  person_id: string;
  position: number;
  file: string;
  title: string;
  format: string | null;
  note: string;
  is_primary: boolean;
  extra: Person['media'][number]['extra'] | null;
}

export interface TreeRows {
  persons: PersonRow[];
  families: FamilyRow[];
  children: ChildRow[];
  events: EventRow[];
  media: MediaRow[];
}

const eventRow = (e: LifeEvent, position: number, owner: { person_id?: string; family_id?: string }): EventRow => ({
  person_id: owner.person_id ?? null,
  family_id: owner.family_id ?? null,
  position,
  type: e.type,
  date_text: e.date?.text ?? '',
  date_parsed: e.date ?? null,
  date_sort: e.date?.sort ?? null,
  place: e.place ?? '',
  cause: e.cause ?? '',
  note: e.note ?? '',
  extra: e.extra ?? null,
});

export function treeToRows(t: TreeData): TreeRows {
  const rows: TreeRows = { persons: [], families: [], children: [], events: [], media: [] };

  for (const p of t.people.values()) {
    rows.persons.push({
      id: p.id,
      rin: p.rin,
      sex: p.sex,
      given_names: p.givenNames,
      surname: p.surname,
      surname2: p.surname2,
      suffix: p.suffix,
      title: p.title,
      nickname: p.nickname,
      alt_names: p.altNames,
      notes: p.notes,
      extra: p.extra ?? null,
      spouse_order: p.spouseFamilies.filter((id) => t.families.has(id)),
      changed_at: p.changedAt ?? null,
    });
    p.events.forEach((e, i) => rows.events.push(eventRow(e, i, { person_id: p.id })));
    p.media.forEach((m, i) =>
      rows.media.push({
        person_id: p.id,
        position: i,
        file: m.file,
        title: m.title ?? '',
        format: m.format ?? null,
        note: m.note ?? '',
        is_primary: m.primary ?? false,
        extra: m.extra ?? null,
      }),
    );
  }

  for (const f of t.families.values()) {
    const has = (id: string | undefined) => (id && t.people.has(id) ? id : null);
    rows.families.push({
      id: f.id,
      mrin: f.mrin,
      husband_id: has(f.husbandId),
      wife_id: has(f.wifeId),
      notes: f.notes,
      extra: f.extra ?? null,
      changed_at: f.changedAt ?? null,
    });
    f.events.forEach((e, i) => rows.events.push(eventRow(e, i, { family_id: f.id })));
    const seen = new Set<string>();
    f.childIds.forEach((childId, i) => {
      const child = t.people.get(childId);
      if (!child || seen.has(childId)) return;
      seen.add(childId);
      const link = child.parents.find((l) => l.familyId === f.id);
      rows.children.push({
        family_id: f.id,
        person_id: childId,
        position: i,
        pedigree: link?.pedigree ?? null,
        is_primary: link?.primary ?? null,
      });
    });
  }

  return rows;
}
