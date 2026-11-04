import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importGedcom } from '../src/lib/gedcom/import';

const fixture = readFileSync(new URL('./fixtures/familia-ficticia.ged', import.meta.url), 'utf8');

describe('importGedcom (datos ficticios)', () => {
  const tree = importGedcom(fixture);
  const byRin = (rin: number) => [...tree.people.values()].find((p) => p.rin === rin)!;

  it('cuenta personas y familias', () => {
    expect(tree.people.size).toBe(5);
    expect(tree.families.size).toBe(2);
  });

  it('usa _UID como id estable y el número de registro como RIN', () => {
    const juan = byRin(1);
    expect(juan.id).toBe('aaaa0000000000000000000000000000aaaa');
    expect(byRin(2).id).toBe('I2');
  });

  it('separa apellido paterno, materno, título y sufijo real', () => {
    expect(byRin(1)).toMatchObject({ givenNames: 'Juan Pablo', surname: 'Ficticio', surname2: 'Inventado' });
    expect(byRin(4)).toMatchObject({ title: 'Capitán', givenNames: 'Diego', surname: 'Antiguo', surname2: '' });
    expect(byRin(5)).toMatchObject({ surname2: '', suffix: 'Jr.' });
  });

  it('une CONC y CONT en las notas', () => {
    expect(byRin(1).notes).toBe('Nació en un pueblo que no existe.\nSegunda línea de la nota.');
  });

  it('lee fechas en español y conserva el texto', () => {
    const birth = byRin(1).events.find((e) => e.type === 'BIRT')!;
    expect(birth.date).toMatchObject({ text: '4 Ago 1924', year: 1924, month: 8, day: 4 });
    expect(birth.place).toBe('Pueblo Imaginario');
  });

  it('enlaza familias, hijos y tipo de filiación', () => {
    const fam = tree.families.get('bbbb0000000000000000000000000000bbbb')!;
    expect(fam.husbandId).toBe(byRin(1).id);
    expect(fam.wifeId).toBe(byRin(2).id);
    expect(fam.childIds).toEqual([byRin(3).id]);
    expect(byRin(3).parents).toEqual([{ familyId: fam.id, pedigree: 'birth' }]);
    expect(fam.events[0]!.date).toMatchObject({ qualifier: 'between', year: 1950, year2: 1952 });
  });

  it('lee fotos enlazadas y conserva tags propios de PAF', () => {
    const media = byRin(1).media[0]!;
    expect(media).toMatchObject({ file: 'genes\\2005-05-27\\Foto Ficticia.JPG', primary: true, format: 'jpg' });
    expect(media.extra?.[0]).toMatchObject({ tag: '_TYPE', value: 'PHOTO' });
    expect(byRin(4).extra?.[0]).toMatchObject({ tag: '_CUSTOM', value: 'valor raro' });
  });

  it('avisa fechas no interpretables y referencias rotas sin perder datos', () => {
    const kinds = tree.warnings.map((w) => w.kind);
    expect(kinds).toContain('unparsed-date');
    expect(kinds).toContain('missing-ref');
    const death = byRin(4).events.find((e) => e.type === 'DEAT')!;
    expect(death.date).toMatchObject({ ok: false, text: 'La Serena' });
  });
});

// Prueba contra el archivo real. Nunca se sube al repo; se corre localmente con:
//   GED_PATH=ruta/al/archivo.ged npm test
const realPath = process.env.GED_PATH;
describe.skipIf(!realPath || !existsSync(realPath))('importGedcom (archivo real local)', () => {
  it('importa sin perder registros', () => {
    const text = readFileSync(realPath!, 'utf8');
    const expectedIndi = (text.match(/^0 @[^@]+@ INDI/gm) ?? []).length;
    const expectedFam = (text.match(/^0 @[^@]+@ FAM/gm) ?? []).length;
    const t0 = performance.now();
    const tree = importGedcom(text);
    const ms = Math.round(performance.now() - t0);
    const unparsed = tree.warnings.filter((w) => w.kind === 'unparsed-date');
    console.log(
      `Importadas ${tree.people.size} personas y ${tree.families.size} familias en ${ms} ms.\n` +
        `Fechas por revisar: ${unparsed.length}. Líneas reparadas: ${tree.warnings.filter((w) => w.kind === 'bad-line').length}.\n` +
        `Tags conservados: ${JSON.stringify([...tree.preservedTags])}`,
    );
    expect(tree.people.size).toBe(expectedIndi);
    expect(tree.families.size).toBe(expectedFam);
    expect(tree.warnings.filter((w) => w.kind === 'missing-ref')).toEqual([]);
  });
});
