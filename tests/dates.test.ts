import { describe, expect, it } from 'vitest';
import { describeDate, parseDate } from '../src/lib/gedcom/dates';

// Casos tomados de formatos reales escritos en PAF (sin datos personales).
const cases: [string, Partial<ReturnType<typeof parseDate>>][] = [
  ['3 Mar 1974', { qualifier: 'exact', year: 1974, month: 3, day: 3, sort: 19740303 }],
  ['4 Ago 1924', { year: 1924, month: 8, day: 4 }],
  ['14 Dic 1939', { year: 1939, month: 12, day: 14 }],
  ['1º Ene 1845', { year: 1845, month: 1, day: 1 }],
  ['1º  Mar 1638', { year: 1638, month: 3, day: 1 }],
  ['20 Ago1926', { year: 1926, month: 8, day: 20 }],
  ['14 abr 1884', { year: 1884, month: 4, day: 14 }],
  ['3 Abril 1884', { year: 1884, month: 4, day: 3 }],
  ['14 Septiembre 1942', { year: 1942, month: 9, day: 14 }],
  ['21 septbre 1966', { year: 1966, month: 9, day: 21 }],
  ['3 de Junio de 1876', { year: 1876, month: 6, day: 3 }],
  ['Junio de 1853.-', { year: 1853, month: 6 }],
  ['Nov 1956', { year: 1956, month: 11 }],
  ['20-VII-1716', { year: 1716, month: 7, day: 20 }],
  ['29-XI1834', { year: 1834, month: 11, day: 29 }],
  ['10 VII-1882', { year: 1882, month: 7, day: 10 }],
  ['4- Dic-1874', { year: 1874, month: 12, day: 4 }],
  ['14 Dic. 1882', { year: 1882, month: 12, day: 14 }],
  ['6 Ago !769', { year: 1769, month: 8, day: 6 }],
  ['!4 Jun 1810', { year: 1810, month: 6, day: 14 }],
  ['13 ·Ene 1982 ', { year: 1982, month: 1, day: 13 }],
  ['Por 1792', { qualifier: 'about', year: 1792 }],
  ['Por1863', { qualifier: 'about', year: 1863 }],
  ['Pur 1645', { qualifier: 'about', year: 1645 }],
  ['Por Jul 1688', { qualifier: 'about', year: 1688, month: 7 }],
  ['Alrededor de 1686', { qualifier: 'about', year: 1686 }],
  ['Alrededpr de 1772', { qualifier: 'about', year: 1772 }],
  ['Aprox. 1626', { qualifier: 'about', year: 1626 }],
  ['Aprox.1684', { qualifier: 'about', year: 1684 }],
  ['Aprox. 1 ene 1755', { qualifier: 'about', year: 1755, month: 1, day: 1 }],
  ['Hacia 1804', { qualifier: 'about', year: 1804 }],
  ['Antes de 1587', { qualifier: 'before', year: 1587 }],
  ['Antes del 9 Sep 1707', { qualifier: 'before', year: 1707, month: 9, day: 9 }],
  ['Después de 1713', { qualifier: 'after', year: 1713 }],
  ['BEF 1861', { qualifier: 'before', year: 1861 }],
  ['ABT 1700', { qualifier: 'about', year: 1700 }],
  ['Entre 1774 y 1776', { qualifier: 'between', year: 1774, year2: 1776 }],
  ['Entre 1818-1820', { qualifier: 'between', year: 1818, year2: 1820 }],
  ['Entre 1579 - 1580', { qualifier: 'between', year: 1579, year2: 1580 }],
  ['BET 1700 AND 1710', { qualifier: 'between', year: 1700, year2: 1710 }],
  ['1703 ó 1705', { qualifier: 'or', year: 1703, year2: 1705 }],
  ['Oct 1527 ó1530', { qualifier: 'or', year: 1527, month: 10, year2: 1530 }],
  ['3 o 7 Sep 1732', { qualifier: 'or', year: 1732, month: 9, day: 3, day2: 7 }],
  ['12 Ago 1528 o 1529', { qualifier: 'or', year: 1528, year2: 1529 }],
  ['1 Enero 1734/35 ', { year: 1734, month: 1, day: 1 }],
  ['1825-26', { qualifier: 'or', year: 1825, year2: 1826 }],
  ['7 Octubre 1987', { year: 1987, month: 10, day: 7 }],
];

describe('parseDate', () => {
  it.each(cases)('%s', (text, expected) => {
    const d = parseDate(text);
    expect(d.ok).toBe(true);
    expect(d.text).toBe(text);
    expect(d).toMatchObject(expected);
  });

  it.each([
    'La Serena',
    'Cementerio General de Santiago',
    '23 Jul 18891',
    '5 Frb 1856',
    '21 Feb',
    'j',
    '',
  ])('no inventa una fecha para "%s"', (text) => {
    const d = parseDate(text);
    expect(d.ok).toBe(false);
    expect(d.text).toBe(text);
    expect(d.sort).toBeNull();
  });
});

describe('describeDate', () => {
  it.each([
    ['4 Ago 1924', '4 de agosto de 1924'],
    ['Nov 1956', 'noviembre de 1956'],
    ['1792', '1792'],
    ['Por 1792', 'aproximadamente 1792'],
    ['Antes del 9 Sep 1707', 'antes de 9 de septiembre de 1707'],
    ['Entre 1774 y 1776', 'entre 1774 y 1776'],
    ['3 o 7 Sep 1732', '3 o 7 de septiembre de 1732'],
    ['1703 ó 1705', '1703 o 1705'],
  ])('%s → %s', (text, expected) => {
    expect(describeDate(parseDate(text))).toBe(expected);
  });

  it('devuelve null si no se entiende', () => {
    expect(describeDate(parseDate('La Serena'))).toBeNull();
  });
});
