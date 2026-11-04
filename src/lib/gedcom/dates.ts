// Interpretación de fechas escritas a mano en español (y GEDCOM estándar en inglés).
// Nunca modifica el texto: solo calcula una interpretación para ordenar y calcular edades.

import type { DateQualifier, ParsedDate } from '../model/types';

const MONTHS: Record<string, number> = {
  ene: 1, jan: 1,
  feb: 2,
  mar: 3,
  abr: 4, apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8, aug: 8,
  sep: 9, set: 9,
  oct: 10,
  nov: 11,
  dic: 12, dec: 12,
};

const ROMAN: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6,
  vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12,
};

const QUALIFIERS: [RegExp, DateQualifier][] = [
  [/^(?:alrededor|alredor|alrededpr)(?:\s+de)?\s*/, 'about'],
  [/^(?:por|pur|hacia|aprox\.?|abt\.?|about|cal|est|ca\.?|circa)\s*/, 'about'],
  [/^(?:antes)(?:\s+del?)?\s*/, 'before'],
  [/^(?:bef\.?|before)\s*/, 'before'],
  [/^(?:despu[eé]s)(?:\s+del?)?\s*/, 'after'],
  [/^(?:aft\.?|after)\s*/, 'after'],
];

interface Point {
  year?: number;
  month?: number;
  day?: number;
}

function monthFromWord(w: string): number | undefined {
  const r = ROMAN[w];
  if (r) return r;
  // "agosto", "septbre", "dic." → prefijo de 3 letras
  return MONTHS[w.slice(0, 3)];
}

/** Interpreta un punto en el tiempo: "1º Ene 1845", "20-VII-1716", "Ago1926", "1734/35". */
function parsePoint(s: string): Point | null {
  let t = s
    .replace(/(\d)\s*[º°ª]/g, '$1') // 1º → 1
    .replace(/\bde(?:l)?\b/g, ' ') // "3 de Junio de 1876"
    .replace(/[-.,/]/g, ' ')
    .replace(/([a-z])(\d)/g, '$1 $2') // Ago1926
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  const parts = t.split(' ');
  const p: Point = {};
  const nums: number[] = [];
  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      nums.push(Number(part));
    } else {
      const m = monthFromWord(part);
      if (m === undefined || p.month !== undefined) return null;
      p.month = m;
    }
  }
  // Años dobles "1734/35" o "1856-57": el segundo número corto es parte del mismo año.
  if (nums.length >= 2) {
    const lastN = nums[nums.length - 1]!;
    const prev = nums[nums.length - 2]!;
    if (prev >= 100 && lastN < 100) nums.pop();
  }
  if (nums.length === 0) return null;
  const year = nums.pop()!;
  if (year < 100 || year > 2999) return null;
  p.year = year;
  if (nums.length === 1) {
    const day = nums[0]!;
    if (p.month === undefined || day < 1 || day > 31) return null;
    p.day = day;
  } else if (nums.length > 1) {
    return null;
  }
  return p;
}

function sortKey(p: Point): number | null {
  if (p.year === undefined) return null;
  return p.year * 10000 + (p.month ?? 0) * 100 + (p.day ?? 0);
}

export function parseDate(text: string): ParsedDate {
  const fail: ParsedDate = { text, ok: false, qualifier: 'exact', sort: null };
  let s = text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[·]/g, '')
    .replace(/!(\d)/g, '1$1') // "!769": Shift+1 por error en vez de 1
    .replace(/[\s.,\-–]+$/g, '')
    .trim();
  if (!s) return fail;

  let qualifier: DateQualifier = 'exact';
  for (const [re, q] of QUALIFIERS) {
    if (re.test(s)) {
      qualifier = q;
      s = s.replace(re, '').trim();
      break;
    }
  }

  // GEDCOM estándar: BET x AND y / FROM x TO y
  let range = /^(?:bet|between|entre|from)\s+(.+?)\s+(?:and|y|to|-)\s+(.+)$/.exec(s);
  if (!range && /^entre\s/.test(s)) range = /^entre\s+(.+?)\s*-\s*(.+)$/.exec(s);
  if (range) {
    const a = parsePoint(range[1]!);
    const b = parsePoint(range[2]!);
    if (a && b) return withRange(text, 'between', a, b);
    return fail;
  }

  // Alternativas: "1703 ó 1705", "3 o 7 Sep 1732", "12 Ago 1528 o 1529", "10 Mar/Sep 1912"
  // El separador debe ser palabra suelta, para no confundirlo con la "o" de "oct".
  const alt = /^(.+?)\s+(?:[oóu]\s+|ó)(.+)$/.exec(s);
  if (alt && /\d/.test(alt[1]!) && /\d/.test(alt[2]!)) {
    const b = parsePoint(alt[2]!);
    let a = parsePoint(alt[1]!);
    // "3 o 7 Sep 1732": el primero hereda mes y año del segundo.
    if (!a && b && /^\d{1,2}$/.test(alt[1]!.trim())) {
      a = { ...b, day: Number(alt[1]!.trim()) };
    }
    // "12 Ago 1528 o 1529"
    if (a && !b && /^\d{3,4}$/.test(alt[2]!.trim())) {
      return withRange(text, 'or', a, { year: Number(alt[2]!.trim()) });
    }
    if (a && b) return withRange(text, 'or', a, b);
  }

  // "1825-26", "1779/1881": dos años sueltos
  const twoYears = /^(\d{4})\s*([-/])\s*(\d{2,4})$/.exec(s);
  if (twoYears) {
    const y1 = Number(twoYears[1]);
    let y2 = Number(twoYears[3]);
    if (y2 < 100) y2 = Math.floor(y1 / 100) * 100 + y2;
    if (twoYears[2] === '/' && y2 - y1 === 1) {
      // año doble "1734/35" (calendario antiguo): es un solo año
      return { text, ok: true, qualifier, year: y1, sort: y1 * 10000 };
    }
    return withRange(text, 'or', { year: y1 }, { year: y2 });
  }

  const p = parsePoint(s);
  if (!p) return fail;
  const d: ParsedDate = { text, ok: true, qualifier, sort: sortKey(p) };
  if (p.year !== undefined) d.year = p.year;
  if (p.month !== undefined) d.month = p.month;
  if (p.day !== undefined) d.day = p.day;
  return d;
}

function withRange(text: string, qualifier: DateQualifier, a: Point, b: Point): ParsedDate {
  const d: ParsedDate = { text, ok: true, qualifier, sort: sortKey(a) };
  if (a.year !== undefined) d.year = a.year;
  if (a.month !== undefined) d.month = a.month;
  if (a.day !== undefined) d.day = a.day;
  if (b.year !== undefined) d.year2 = b.year;
  if (b.month !== undefined) d.month2 = b.month;
  if (b.day !== undefined) d.day2 = b.day;
  return d;
}

/** Año aproximado, útil para "vivo/fallecido" y edades. */
export function dateYear(d: ParsedDate | undefined): number | undefined {
  return d?.ok ? d.year : undefined;
}
