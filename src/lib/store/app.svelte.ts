// Estado de la aplicación. El árbol usa $state.raw: con 32 mil personas no
// queremos proxies reactivos profundos. Las ediciones modifican los Map in situ y
// luego se reasigna `tree` (objeto nuevo, mismos Map) para avisar a la interfaz.

import type { TreeData } from '../model/types';
import { getPerson } from '../model/tree';
import { applyState, EditTx, invert, restoreDeleted, type Change } from '../model/edit';
import { loadTrash, loadTree, removeTrash, saveChange, saveTree, type TrashEntry } from './persist';

export type View = 'family' | 'pedigree' | 'individual';
const VIEWS: View[] = ['family', 'pedigree', 'individual'];

/** Relación con la que se agrega una persona nueva (o existente). */
export type Relation =
  | { kind: 'none' }
  | { kind: 'father' | 'mother'; childId: string }
  | { kind: 'spouse'; personId: string; familyId?: string }
  | { kind: 'child'; parentId: string; familyId?: string };

export type Dialog =
  | { type: 'edit-person'; personId: string }
  | { type: 'add-person'; relation: Relation }
  | { type: 'edit-family'; familyId: string }
  | { type: 'search' }
  | { type: 'review-dates' }
  | { type: 'trash' };

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // modo privado: la preferencia solo dura la sesión
  }
}

const UNDO_LIMIT = 50;

class AppState {
  tree = $state.raw<TreeData | undefined>(undefined);
  status = $state<'loading' | 'empty' | 'importing' | 'ready'>('loading');
  error = $state('');
  notice = $state('');

  view = $state<View>('family');
  /** Persona en la posición principal (arriba a la izquierda). */
  primaryId = $state<string | undefined>(undefined);
  /** Persona resaltada con el cursor / teclado. */
  selectedId = $state<string | undefined>(undefined);
  homeId = $state<string | undefined>(readPref('homeId') ?? undefined);
  /** Índice del cónyuge mostrado, por persona (botón ⇕ de PAF). */
  spouseIndex = $state<Record<string, number>>({});
  dialog = $state<Dialog | undefined>(undefined);
  fontScale = $state(Number(readPref('fontScale')) || 1);

  /** Pila de deshacer (solo de esta sesión; el historial completo queda guardado). */
  undoStack = $state.raw<Change[]>([]);
  saving = $state(false);

  /** Último hijo visitado por persona, para la tecla C. */
  lastChild = new Map<string, string>();
  private history: string[] = [];
  private pendingSave: Promise<void> = Promise.resolve();

  async init() {
    try {
      const t0 = performance.now();
      const t = await loadTree();
      console.info(`[GeneaTree] copia local leída en ${Math.round(performance.now() - t0)} ms`);
      if (t && t.people.size > 0) this.setTree(t);
      else this.status = 'empty';
    } catch (e) {
      this.error = `No se pudo abrir la copia local: ${e}`;
      this.status = 'empty';
    }
  }

  importFile(file: File) {
    this.status = 'importing';
    this.error = '';
    const worker = new Worker(new URL('../gedcom/import.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = async (e) => {
      worker.terminate();
      if (!e.data.ok) {
        this.error = `No se pudo leer el archivo: ${e.data.error}`;
        this.status = 'empty';
        return;
      }
      const tree = e.data.tree as TreeData;
      const unparsed = tree.warnings.filter((w) => w.kind === 'unparsed-date').length;
      this.notice =
        `Se importaron ${tree.people.size.toLocaleString('es-CL')} personas y ` +
        `${tree.families.size.toLocaleString('es-CL')} familias. ` +
        (unparsed ? `${unparsed} fechas quedaron como texto para revisar.` : '');
      this.homeId = undefined;
      this.undoStack = [];
      this.setTree(tree);
      this.saving = true;
      const t0 = performance.now();
      this.pendingSave = saveTree(tree)
        .catch((err) => {
          this.error = `Se importó, pero no se pudo guardar copia local: ${err}`;
        })
        .finally(() => {
          this.saving = false;
          console.info(`[GeneaTree] copia local guardada en ${Math.round(performance.now() - t0)} ms`);
        });
      await this.pendingSave;
    };
    worker.postMessage(file);
  }

  private setTree(t: TreeData) {
    this.tree = t;
    if (!this.homeId || !t.people.has(this.homeId)) {
      const byRin1 = [...t.people.values()].find((p) => p.rin === 1);
      this.homeId = byRin1?.id ?? t.people.keys().next().value;
    }
    this.primaryId = this.homeId;
    this.selectedId = this.homeId;
    this.status = 'ready';
  }

  // --- Edición ---------------------------------------------------------------

  /**
   * Ejecuta una edición como una sola transacción: se aplica, se guarda y se
   * puede deshacer. Devuelve lo que devuelva `fn`.
   */
  edit<T>(label: string, fn: (tx: EditTx) => T, opts: { trashPersonId?: string } = {}): T {
    const tree = this.tree;
    if (!tree) throw new Error('No hay árbol cargado');
    const tx = new EditTx(tree, label);
    const result = fn(tx); // si lanza error, no se aplica nada
    const change = tx.commit();
    if (change.after.people.length === 0 && change.after.families.length === 0) return result;
    this.afterChange(change, opts.trashPersonId);
    this.undoStack = [...this.undoStack.slice(-UNDO_LIMIT + 1), change];
    return result;
  }

  undo() {
    const tree = this.tree;
    const last = this.undoStack.at(-1);
    if (!tree || !last) return;
    const inverse = invert(last, `Deshacer: ${last.label}`);
    applyState(tree, inverse.after);
    this.undoStack = this.undoStack.slice(0, -1);
    this.afterChange(inverse);
    // Si se deshizo una eliminación, ya no corresponde en la papelera.
    void removeTrash(last.id).catch(() => {});
    this.notice = `Se deshizo: ${last.label}`;
  }

  get undoLabel(): string | undefined {
    return this.undoStack.at(-1)?.label;
  }

  private afterChange(change: Change, trashPersonId?: string) {
    const tree = this.tree!;
    this.tree = { ...tree };
    // Si la persona en pantalla ya no existe, volver a una válida.
    if (!this.primaryId || !tree.people.has(this.primaryId)) {
      this.primaryId = this.history.reverse().find((id) => tree.people.has(id)) ?? this.homeId;
      this.history = [];
      if (!this.primaryId || !tree.people.has(this.primaryId)) this.primaryId = tree.people.keys().next().value;
    }
    if (!this.selectedId || !tree.people.has(this.selectedId)) this.selectedId = this.primaryId;
    const trash: TrashEntry | undefined = trashPersonId
      ? { id: change.id, at: change.at, label: change.label, personId: trashPersonId, change }
      : undefined;
    this.saving = true;
    this.pendingSave = this.pendingSave
      .then(() => saveChange(change, trash))
      .catch((err) => {
        this.error = `No se pudo guardar el cambio en este equipo: ${err}`;
      })
      .finally(() => {
        this.saving = false;
      });
  }

  /** Espera a que los cambios estén escritos (tests, cerrar la app). */
  flush(): Promise<void> {
    return this.pendingSave;
  }

  trash(): Promise<TrashEntry[]> {
    return loadTrash();
  }

  async restoreFromTrash(entry: TrashEntry) {
    const change = $state.snapshot(entry.change) as Change;
    const id = this.edit(`Restaurar: ${entry.label.replace(/^Eliminar:\s*/, '')}`, (tx) => restoreDeleted(tx, change));
    await removeTrash(entry.id);
    if (id) this.makePrimary(id);
  }

  // --- Navegación ------------------------------------------------------------

  /** Lleva a una persona a la posición principal. */
  makePrimary(id: string | undefined) {
    if (!id || !this.tree?.people.has(id) || id === this.primaryId) {
      if (id) this.selectedId = id;
      return;
    }
    if (this.primaryId) this.history.push(this.primaryId);
    this.primaryId = id;
    this.selectedId = id;
  }

  back() {
    const prev = this.history.pop();
    if (prev && this.tree?.people.has(prev)) {
      this.primaryId = prev;
      this.selectedId = prev;
    }
  }

  goHome() {
    this.makePrimary(this.homeId);
  }

  setHome(id: string | undefined) {
    if (!id) return;
    this.homeId = id;
    writePref('homeId', id);
  }

  /** Ctrl+S en PAF: pasar a la siguiente vista con la persona seleccionada como principal. */
  setView(v: View) {
    if (v !== 'individual' && this.selectedId) this.makePrimary(this.selectedId);
    this.view = v;
  }

  nextView() {
    this.setView(VIEWS[(VIEWS.indexOf(this.view) + 1) % VIEWS.length]!);
  }

  zoom(delta: number) {
    this.fontScale = Math.min(1.8, Math.max(0.7, Math.round((this.fontScale + delta) * 10) / 10));
    writePref('fontScale', String(this.fontScale));
  }

  get primary() {
    return this.tree ? getPerson(this.tree, this.primaryId) : undefined;
  }
  get selected() {
    return this.tree ? getPerson(this.tree, this.selectedId) : undefined;
  }
}

export const app = new AppState();
