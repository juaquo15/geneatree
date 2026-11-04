// Modelo de dominio de GeneaTree.
// Principio: nunca perder lo que el usuario escribió. Las fechas guardan el texto
// original y los tags GEDCOM que no entendemos se conservan en `extra`.

export type Sex = 'M' | 'F' | 'U';

export type DateQualifier =
  | 'exact'
  | 'about' // Por, Alrededor de, Aprox., Hacia, ABT
  | 'before' // Antes de, BEF
  | 'after' // Después de, AFT
  | 'between' // Entre X y Y, BET X AND Y
  | 'or'; // 1703 ó 1705, 3 o 7 Sep 1732

export interface ParsedDate {
  /** Texto tal como lo escribió el usuario. Es la fuente de verdad. */
  text: string;
  /** false si no pudimos interpretarla; aparece en "fechas por revisar". */
  ok: boolean;
  qualifier: DateQualifier;
  year?: number;
  month?: number;
  day?: number;
  /** Segundo extremo para 'between' / 'or'. */
  year2?: number;
  month2?: number;
  day2?: number;
  /** yyyymmdd para ordenar (mes/día desconocidos = 00). null si no se pudo. */
  sort: number | null;
}

export type EventType =
  | 'BIRT'
  | 'CHR'
  | 'DEAT'
  | 'BURI'
  | 'MARR'
  | 'DIV'
  | 'ADOP'
  | (string & {});

export interface LifeEvent {
  type: EventType;
  date?: ParsedDate;
  place?: string;
  cause?: string;
  note?: string;
  extra?: RawNode[];
}

export interface MediaLink {
  file: string;
  title?: string;
  format?: string;
  note?: string;
  primary?: boolean;
  extra?: RawNode[];
}

export interface ParentLink {
  familyId: string;
  /** birth, adopted, foster, sealing… (GEDCOM PEDI) */
  pedigree?: string;
  primary?: boolean;
}

export interface Person {
  /** Id estable: el _UID de PAF si existe; si no, uno generado. */
  id: string;
  /** Record ID Number de PAF (I123 → 123). Visible al usuario, como en PAF. */
  rin: number;
  sex: Sex;
  givenNames: string;
  /** Apellido paterno (GEDCOM SURN). */
  surname: string;
  /** Apellido materno. PAF lo guardaba en NSFX (sufijo). */
  surname2: string;
  /** Sufijo real (Jr., H.) cuando NSFX no era un apellido. */
  suffix: string;
  /** Título / prefijo: Capitán, Fray, Doctor… (GEDCOM NPFX) */
  title: string;
  nickname: string;
  /** Otros nombres: _AKA, _MARNM… */
  altNames: { type: string; value: string }[];
  events: LifeEvent[];
  notes: string;
  media: MediaLink[];
  parents: ParentLink[];
  spouseFamilies: string[];
  changedAt?: string;
  extra?: RawNode[];
}

export interface Family {
  id: string;
  /** Marriage Record ID Number (F1934 → 1934). */
  mrin: number;
  husbandId?: string;
  wifeId?: string;
  childIds: string[];
  events: LifeEvent[];
  notes: string;
  changedAt?: string;
  extra?: RawNode[];
}

/** Nodo GEDCOM sin interpretar, para preservar datos desconocidos. */
export interface RawNode {
  tag: string;
  value: string;
  xref?: string;
  children: RawNode[];
}

export interface ImportWarning {
  kind: 'bad-line' | 'unparsed-date' | 'missing-ref' | 'unknown-record';
  message: string;
  line?: number;
  personId?: string;
  familyId?: string;
}

export interface TreeData {
  people: Map<string, Person>;
  families: Map<string, Family>;
  warnings: ImportWarning[];
  /** Tags preservados en `extra`, con su conteo, para el informe de importación. */
  preservedTags: Map<string, number>;
}
