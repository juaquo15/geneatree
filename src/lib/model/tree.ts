// Consultas de navegación sobre el árbol (sin estado de UI).

import type { Family, LifeEvent, Person, TreeData } from './types';

export function getPerson(t: TreeData, id: string | undefined): Person | undefined {
  return id ? t.people.get(id) : undefined;
}

/** Familia de los padres "principal", como en PAF: la marcada primaria o la primera. */
export function parentFamily(t: TreeData, p: Person | undefined): Family | undefined {
  if (!p || p.parents.length === 0) return undefined;
  const link = p.parents.find((l) => l.primary) ?? p.parents[0]!;
  return t.families.get(link.familyId);
}

export function father(t: TreeData, p: Person | undefined): Person | undefined {
  return getPerson(t, parentFamily(t, p)?.husbandId);
}

export function mother(t: TreeData, p: Person | undefined): Person | undefined {
  return getPerson(t, parentFamily(t, p)?.wifeId);
}

export function spouseFamilies(t: TreeData, p: Person | undefined): Family[] {
  if (!p) return [];
  return p.spouseFamilies.map((id) => t.families.get(id)).filter((f): f is Family => !!f);
}

export function spouseIn(t: TreeData, f: Family | undefined, p: Person): Person | undefined {
  if (!f) return undefined;
  return getPerson(t, f.husbandId === p.id ? f.wifeId : f.husbandId);
}

export function children(t: TreeData, f: Family | undefined): Person[] {
  if (!f) return [];
  return f.childIds.map((id) => t.people.get(id)).filter((c): c is Person => !!c);
}

export function hasDescendants(t: TreeData, p: Person): boolean {
  return spouseFamilies(t, p).some((f) => f.childIds.length > 0);
}

export function hasAncestors(t: TreeData, p: Person): boolean {
  const f = parentFamily(t, p);
  return !!f && !!(f.husbandId || f.wifeId);
}

export function event(p: { events: LifeEvent[] } | undefined, type: string): LifeEvent | undefined {
  return p?.events.find((e) => e.type === type);
}

/**
 * Qué hijo lleva la tecla C (reglas de PAF 5):
 * el último hijo visitado; si no, el mayor con descendencia; si no, el menor.
 */
export function childForNavigation(
  t: TreeData,
  p: Person,
  lastVisited: Map<string, string>,
): Person | undefined {
  const all = spouseFamilies(t, p).flatMap((f) => children(t, f));
  if (all.length === 0) return undefined;
  const visited = lastVisited.get(p.id);
  const v = visited ? all.find((c) => c.id === visited) : undefined;
  if (v) return v;
  return all.find((c) => hasDescendants(t, c)) ?? all[all.length - 1];
}
