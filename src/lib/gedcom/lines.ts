// Lectura de GEDCOM 5.5 a un árbol de nodos.
// Tolerante: PAF a veces dejó caracteres raros dentro de las notas.

import type { RawNode } from '../model/types';

export interface GedNode extends RawNode {
  line: number;
  children: GedNode[];
}

export interface ParsedLines {
  records: GedNode[];
  badLines: { line: number; text: string }[];
}

const LINE_RE = /^\s*(\d+)\s+(?:(@[^@]+@)\s+)?([A-Za-z0-9_]+)(?: (.*))?$/;
const VTAB = /\v/g;

/**
 * Convierte el texto GEDCOM en registros de nivel 0 con sus hijos.
 * Las líneas CONC/CONT se funden en el valor de su padre.
 * Una línea que no tiene forma GEDCOM se considera continuación de la anterior,
 * así no se pierde texto.
 */
export function parseLines(input: string): ParsedLines {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  // Solo CR/LF terminan una línea. PAF dejó \v dentro de algunas notas como salto
  // interno; se convierte en \n después de reconocer la línea.
  const lines = text.split(/\r\n|\r|\n/);
  const records: GedNode[] = [];
  const badLines: ParsedLines['badLines'] = [];
  const stack: GedNode[] = [];
  let last: GedNode | undefined;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === '') continue;
    const m = LINE_RE.exec(raw);
    if (!m) {
      badLines.push({ line: i + 1, text: raw });
      if (last) last.value += '\n' + raw.replace(VTAB, '\n');
      continue;
    }
    const level = Number(m[1]);
    const tag = m[3]!.toUpperCase();
    const value = (m[4] ?? '').replace(VTAB, '\n');

    if (tag === 'CONC' || tag === 'CONT') {
      const parent = stack[level - 1];
      if (parent) {
        parent.value += (tag === 'CONT' ? '\n' : '') + value;
        last = parent;
        continue;
      }
    }

    const node: GedNode = { tag, value, children: [], line: i + 1 };
    if (m[2]) node.xref = m[2];
    if (level === 0) {
      records.push(node);
    } else {
      const parent = stack[level - 1];
      if (!parent) {
        badLines.push({ line: i + 1, text: raw });
        continue;
      }
      parent.children.push(node);
    }
    stack.length = level;
    stack[level] = node;
    last = node;
  }
  return { records, badLines };
}

/** Primer hijo con el tag dado. */
export function child(node: GedNode, tag: string): GedNode | undefined {
  return node.children.find((c) => c.tag === tag);
}

export function childValue(node: GedNode, tag: string): string | undefined {
  return child(node, tag)?.value;
}

export function toRaw(node: GedNode): RawNode {
  const r: RawNode = { tag: node.tag, value: node.value, children: node.children.map(toRaw) };
  if (node.xref) r.xref = node.xref;
  return r;
}
