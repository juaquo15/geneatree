// Cómo se muestran nombres y fechas. Siempre se muestra el texto que escribió el usuario.

import type { LifeEvent, Person } from './types';
import { event } from './tree';

export function fullName(p: Person | undefined): string {
  if (!p) return '';
  return [p.title, p.givenNames, p.surname, p.surname2, p.suffix].filter(Boolean).join(' ');
}

/** Clave de orden como PAF: apellido, nombre, luego el sufijo (donde PAF guarda el materno); sin tildes. */
export function sortName(p: Person): string {
  return fold(`${p.surname} ${p.givenNames} ${p.surname2} ${p.suffix}`).replace(/\s+/g, ' ');
}

/** "Apellido, Nombre Materno", el nombre completo de la lista de PAF (sin título). */
export function listName(p: Person): string {
  const rest = [p.givenNames, p.surname2, p.suffix].filter(Boolean).join(' ');
  return [p.surname, rest].filter(Boolean).join(', ');
}

/** Fecha y lugar de nacimiento (o bautizo, con fromAlt) por separado, para las columnas de la lista. */
export function birthParts(p: Person): { date: string; place: string; fromAlt: boolean } {
  const b = event(p, 'BIRT');
  if (b?.date || b?.place) return { date: b.date?.text ?? '', place: b.place ?? '', fromAlt: false };
  const c = event(p, 'CHR');
  if (c?.date || c?.place) return { date: c.date?.text ?? '', place: c.place ?? '', fromAlt: true };
  return { date: '', place: '', fromAlt: false };
}

export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

const foldCache = new Map<string, string>();

/**
 * Minúsculas sin tildes conservando el largo exacto (para resaltar coincidencias
 * en el texto original). Rápido: solo los caracteres no ASCII pasan por normalize.
 */
export function foldKeep(s: string): string {
  return s.toLowerCase().replace(/[^\x00-\x7f]/g, (ch) => {
    let r = foldCache.get(ch);
    if (r === undefined) {
      const base = ch.normalize('NFD')[0] ?? ch;
      r = base.length === ch.length ? base : ch;
      foldCache.set(ch, r);
    }
    return r;
  });
}

export function eventText(e: LifeEvent | undefined): string {
  if (!e) return '';
  return [e.date?.text, e.place].filter(Boolean).join(' - ');
}

/**
 * Nacimiento (o bautizo con *, como PAF) y defunción (o sepultación con *).
 */
export function birthSummary(p: Person): { text: string; fromAlt: boolean } {
  const b = event(p, 'BIRT');
  if (b?.date || b?.place) return { text: eventText(b), fromAlt: false };
  const c = event(p, 'CHR');
  if (c?.date || c?.place) return { text: eventText(c), fromAlt: true };
  return { text: '', fromAlt: false };
}

export function deathSummary(p: Person): { text: string; fromAlt: boolean } {
  const d = event(p, 'DEAT');
  if (d?.date || d?.place) return { text: eventText(d), fromAlt: false };
  const b = event(p, 'BURI');
  if (b?.date || b?.place) return { text: eventText(b), fromAlt: true };
  return { text: '', fromAlt: false };
}

/** "1810 – 1870", "c. 1792 –", con años interpretados; vacío si no hay. */
export function lifeYears(p: Person): string {
  const y = (types: string[]) => {
    for (const t of types) {
      const d = event(p, t)?.date;
      if (d?.ok && d.year) return (d.qualifier === 'exact' ? '' : 'c. ') + d.year;
    }
    return '';
  };
  const b = y(['BIRT', 'CHR']);
  const d = y(['DEAT', 'BURI']);
  return b || d ? `${b} – ${d}`.trim() : '';
}

export function birthDate(p: Person): string {
  return event(p, 'BIRT')?.date?.text ?? event(p, 'CHR')?.date?.text ?? '';
}

export const EVENT_LABELS: Record<string, string> = {
  BIRT: 'Nacimiento',
  CHR: 'Bautizo',
  DEAT: 'Defunción',
  BURI: 'Sepultación',
  CREM: 'Cremación',
  ADOP: 'Adopción',
  MARR: 'Matrimonio',
  DIV: 'Divorcio',
  OCCU: 'Ocupación',
  RESI: 'Residencia',
  EDUC: 'Educación',
  RELI: 'Religión',
  TITL: 'Título',
  MILI: 'Servicio militar',
  IMMI: 'Inmigración',
  EMIG: 'Emigración',
  CENS: 'Censo',
  CONF: 'Confirmación',
  FCOM: 'Primera comunión',
  ENGA: 'Compromiso',
};

export const PEDIGREE_LABELS: Record<string, string> = {
  birth: '',
  adopted: 'Adoptado',
  foster: 'Acogida',
  sealing: 'Sellamiento',
};
