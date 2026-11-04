// GEDCOM (tal como lo exporta PAF 5) → modelo de GeneaTree.

import type {
  Family,
  ImportWarning,
  LifeEvent,
  MediaLink,
  Person,
  RawNode,
  Sex,
  TreeData,
} from '../model/types';
import { parseDate } from './dates';
import { child, childValue, parseLines, toRaw, type GedNode } from './lines';

const PERSON_EVENTS = new Set([
  'BIRT', 'CHR', 'DEAT', 'BURI', 'CREM', 'ADOP', 'BAPM', 'BARM', 'BASM', 'BLES',
  'CHRA', 'CONF', 'FCOM', 'ORDN', 'NATU', 'EMIG', 'IMMI', 'CENS', 'PROB', 'WILL',
  'GRAD', 'RETI', 'EVEN', 'OCCU', 'RESI', 'EDUC', 'RELI', 'TITL', 'NATI', 'MILI',
]);
const FAMILY_EVENTS = new Set([
  'MARR', 'DIV', 'ANUL', 'ENGA', 'MARB', 'MARC', 'MARL', 'MARS', 'DIVF', 'CENS', 'EVEN',
]);
const REAL_SUFFIX = /^(jr\.?|sr\.?|h\.|hijo|i{1,3}|iv)$/i;

export function importGedcom(text: string): TreeData {
  const { records, badLines } = parseLines(text);
  const warnings: ImportWarning[] = badLines.map((b) => ({
    kind: 'bad-line',
    line: b.line,
    message: `Línea sin formato GEDCOM, unida a la anterior: "${b.text.slice(0, 60)}"`,
  }));
  const preservedTags = new Map<string, number>();
  const keep = (path: string, node: GedNode, into: RawNode[]) => {
    into.push(toRaw(node));
    preservedTags.set(path, (preservedTags.get(path) ?? 0) + 1);
  };

  // Primera pasada: xref → id estable
  const idOf = new Map<string, string>();
  for (const r of records) {
    if (!r.xref || (r.tag !== 'INDI' && r.tag !== 'FAM')) continue;
    const uid = childValue(r, '_UID')?.trim();
    idOf.set(r.xref, uid ? uid.toLowerCase() : r.xref.replace(/@/g, ''));
  }
  const ref = (xref: string, from: GedNode): string | undefined => {
    const id = idOf.get(xref.trim());
    if (!id) {
      warnings.push({
        kind: 'missing-ref',
        line: from.line,
        message: `Referencia a ${xref} que no existe`,
      });
    }
    return id;
  };

  const people = new Map<string, Person>();
  const families = new Map<string, Family>();

  const readEvent = (node: GedNode, path: string): LifeEvent => {
    const ev: LifeEvent = { type: node.tag === 'EVEN' && node.value ? node.value : node.tag };
    for (const c of node.children) {
      switch (c.tag) {
        case 'DATE':
          if (c.value.trim()) ev.date = parseDate(c.value);
          break;
        case 'PLAC':
          if (c.value.trim()) ev.place = c.value.trim();
          break;
        case 'CAUS':
          ev.cause = c.value;
          break;
        case 'NOTE':
          ev.note = ev.note ? ev.note + '\n\n' + c.value : c.value;
          break;
        default:
          keep(`${path}.${node.tag}.${c.tag}`, c, (ev.extra ??= []));
      }
    }
    // Valor en la propia línea (p.ej. "1 OCCU Agricultor")
    if (node.tag !== 'EVEN' && node.value && node.value !== 'Y') {
      ev.note = ev.note ? `${node.value}\n\n${ev.note}` : node.value;
    }
    return ev;
  };

  const changed = (node: GedNode): string | undefined => {
    const d = child(node, 'DATE');
    if (!d) return undefined;
    const t = childValue(d, 'TIME');
    return t ? `${d.value} ${t}` : d.value;
  };

  for (const r of records) {
    if (r.tag === 'INDI' && r.xref) {
      const p: Person = {
        id: idOf.get(r.xref)!,
        rin: Number(r.xref.replace(/\D/g, '')) || 0,
        sex: 'U',
        givenNames: '',
        surname: '',
        surname2: '',
        suffix: '',
        title: '',
        nickname: '',
        altNames: [],
        events: [],
        notes: '',
        media: [],
        parents: [],
        spouseFamilies: [],
      };
      let primaryName = true;
      for (const c of r.children) {
        switch (c.tag) {
          case 'NAME':
            if (primaryName) {
              readName(p, c, (path, n) => keep(path, n, (p.extra ??= [])));
              primaryName = false;
            } else {
              p.altNames.push({ type: 'NAME', value: c.value.replace(/\//g, '').trim() });
            }
            break;
          case 'SEX':
            p.sex = (['M', 'F'].includes(c.value.trim().toUpperCase())
              ? c.value.trim().toUpperCase()
              : 'U') as Sex;
            break;
          case 'NOTE':
            p.notes = p.notes ? p.notes + '\n\n' + c.value : c.value;
            break;
          case 'OBJE':
            p.media.push(readMedia(c, (path, n, into) => keep(path, n, into)));
            break;
          case 'FAMC': {
            const famId = ref(c.value, c);
            if (famId) {
              const link: Person['parents'][number] = { familyId: famId };
              const pedi = childValue(c, 'PEDI');
              if (pedi) link.pedigree = pedi.toLowerCase();
              if (childValue(c, '_PRIMARY') === 'Y') link.primary = true;
              p.parents.push(link);
            }
            break;
          }
          case 'FAMS': {
            const famId = ref(c.value, c);
            if (famId) p.spouseFamilies.push(famId);
            break;
          }
          case 'CHAN': {
            const ch = changed(c);
            if (ch) p.changedAt = ch;
            break;
          }
          case '_UID':
            break;
          default:
            if (PERSON_EVENTS.has(c.tag)) p.events.push(readEvent(c, 'INDI'));
            else keep(`INDI.${c.tag}`, c, (p.extra ??= []));
        }
      }
      people.set(p.id, p);
    } else if (r.tag === 'FAM' && r.xref) {
      const f: Family = {
        id: idOf.get(r.xref)!,
        mrin: Number(r.xref.replace(/\D/g, '')) || 0,
        childIds: [],
        events: [],
        notes: '',
      };
      for (const c of r.children) {
        switch (c.tag) {
          case 'HUSB': {
            const id = ref(c.value, c);
            if (id) f.husbandId = id;
            break;
          }
          case 'WIFE': {
            const id = ref(c.value, c);
            if (id) f.wifeId = id;
            break;
          }
          case 'CHIL': {
            const id = ref(c.value, c);
            if (id) f.childIds.push(id);
            break;
          }
          case 'NOTE':
            f.notes = f.notes ? f.notes + '\n\n' + c.value : c.value;
            break;
          case 'CHAN': {
            const ch = changed(c);
            if (ch) f.changedAt = ch;
            break;
          }
          case '_UID':
            break;
          default:
            if (FAMILY_EVENTS.has(c.tag)) f.events.push(readEvent(c, 'FAM'));
            else keep(`FAM.${c.tag}`, c, (f.extra ??= []));
        }
      }
      families.set(f.id, f);
    } else if (!['HEAD', 'TRLR', 'SUBM'].includes(r.tag)) {
      warnings.push({
        kind: 'unknown-record',
        line: r.line,
        message: `Registro ${r.tag} no soportado todavía (conservado solo en el GEDCOM original)`,
      });
    }
  }

  for (const p of people.values()) {
    for (const ev of p.events) {
      if (ev.date && !ev.date.ok) {
        warnings.push({
          kind: 'unparsed-date',
          personId: p.id,
          message: `${ev.type}: "${ev.date.text}"`,
        });
      }
    }
  }
  for (const f of families.values()) {
    for (const ev of f.events) {
      if (ev.date && !ev.date.ok) {
        warnings.push({
          kind: 'unparsed-date',
          familyId: f.id,
          message: `${ev.type}: "${ev.date.text}"`,
        });
      }
    }
  }

  return { people, families, warnings, preservedTags };
}

function readName(
  p: Person,
  node: GedNode,
  keep: (path: string, n: GedNode) => void,
): void {
  // "Juan Pablo /Ficticio/ Inventado"
  const m = /^([^/]*)(?:\/([^/]*)\/?)?(.*)$/.exec(node.value) ?? [];
  let given = (m[1] ?? '').trim();
  let surname = (m[2] ?? '').trim();
  const after = (m[3] ?? '').trim();
  let hasGivn = false;
  let hasNsfx = false;
  for (const c of node.children) {
    const v = c.value.trim();
    switch (c.tag) {
      case 'GIVN':
        given = v;
        hasGivn = true;
        break;
      case 'SURN':
        surname = v;
        break;
      case 'NSFX':
        hasNsfx = true;
        if (REAL_SUFFIX.test(v)) p.suffix = v;
        else p.surname2 = v;
        break;
      case 'NPFX':
        p.title = v;
        break;
      case 'NICK':
        p.nickname = v;
        break;
      case '_MARNM':
      case '_AKA':
        p.altNames.push({ type: c.tag, value: v });
        break;
      default:
        keep(`INDI.NAME.${c.tag}`, c);
    }
  }
  // Sin subcampos: lo que va después del apellido se trata como apellido materno.
  if (!hasNsfx && after) {
    if (REAL_SUFFIX.test(after)) p.suffix = after;
    else p.surname2 = after;
  }
  // PAF repite el título dentro del nombre ("Capitán Juan"); GIVN viene limpio.
  if (!hasGivn && p.title && given.startsWith(p.title + ' ')) {
    given = given.slice(p.title.length + 1);
  }
  p.givenNames = given;
  p.surname = surname;
}

function readMedia(
  node: GedNode,
  keep: (path: string, n: GedNode, into: RawNode[]) => void,
): MediaLink {
  const m: MediaLink = { file: '' };
  for (const c of node.children) {
    switch (c.tag) {
      case 'FILE':
        m.file = c.value.trim();
        break;
      case 'TITL':
        m.title = c.value;
        break;
      case 'FORM':
        m.format = c.value.trim().toLowerCase();
        break;
      case 'NOTE':
        m.note = c.value;
        break;
      case '_PRIM':
        m.primary = c.value.trim() === 'Y';
        break;
      default:
        keep(`INDI.OBJE.${c.tag}`, c, (m.extra ??= []));
    }
  }
  return m;
}
