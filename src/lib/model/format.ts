// Cómo se muestran nombres y fechas. Siempre se muestra el texto que escribió el usuario.

import type { LifeEvent, Person } from './types';
import { event } from './tree';

export function fullName(p: Person | undefined): string {
  if (!p) return '';
  return [p.title, p.givenNames, p.surname, p.surname2, p.suffix].filter(Boolean).join(' ');
}

/** Clave de orden alfabético como PAF: apellidos, luego nombre; sin tildes. */
export function sortName(p: Person): string {
  return fold(`${p.surname} ${p.surname2} ${p.givenNames}`).replace(/\s+/g, ' ');
}

export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
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
