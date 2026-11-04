// Fechas que la app no pudo interpretar. Se conservan tal cual; el usuario puede corregirlas.

import type { TreeData } from './types';
import { EVENT_LABELS, fullName } from './format';
import { getPerson } from './tree';

export interface UnparsedDate {
  kind: 'person' | 'family';
  id: string;
  who: string;
  event: string;
  text: string;
}

export function unparsedDates(t: TreeData): UnparsedDate[] {
  const out: UnparsedDate[] = [];
  for (const p of t.people.values()) {
    for (const e of p.events) {
      if (e.date && !e.date.ok) {
        out.push({ kind: 'person', id: p.id, who: `${fullName(p)} (RIN ${p.rin})`, event: EVENT_LABELS[e.type] ?? e.type, text: e.date.text });
      }
    }
  }
  for (const f of t.families.values()) {
    for (const e of f.events) {
      if (e.date && !e.date.ok) {
        const names = [getPerson(t, f.husbandId), getPerson(t, f.wifeId)].filter(Boolean).map((x) => fullName(x)).join(' y ');
        out.push({ kind: 'family', id: f.id, who: `${names} (MRIN ${f.mrin})`, event: EVENT_LABELS[e.type] ?? e.type, text: e.date.text });
      }
    }
  }
  return out;
}
