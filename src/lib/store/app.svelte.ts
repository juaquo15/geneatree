// Estado de la aplicación. El árbol usa $state.raw: con 32 mil personas no
// queremos proxies reactivos profundos; se reemplaza entero cuando cambia.

import type { TreeData } from '../model/types';
import { getPerson } from '../model/tree';
import { loadTree, saveTree } from './persist';

export type View = 'family' | 'pedigree' | 'individual';
const VIEWS: View[] = ['family', 'pedigree', 'individual'];

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

class AppState {
  tree = $state.raw<TreeData | undefined>(undefined);
  status = $state<'loading' | 'empty' | 'importing' | 'ready'>('loading');
  error = $state('');
  importReport = $state('');

  view = $state<View>('family');
  /** Persona en la posición principal (arriba a la izquierda). */
  primaryId = $state<string | undefined>(undefined);
  /** Persona resaltada con el cursor / teclado. */
  selectedId = $state<string | undefined>(undefined);
  homeId = $state<string | undefined>(readPref('homeId') ?? undefined);
  /** Índice del cónyuge mostrado, por persona (botón ↕ de PAF). */
  spouseIndex = $state<Record<string, number>>({});
  /** Ficha abierta (doble clic). */
  sheetId = $state<string | undefined>(undefined);
  fontScale = $state(Number(readPref('fontScale')) || 1);

  /** Último hijo visitado por persona, para la tecla C. */
  lastChild = new Map<string, string>();
  private history: string[] = [];

  async init() {
    try {
      const t = await loadTree();
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
      this.importReport =
        `Se importaron ${tree.people.size.toLocaleString('es-CL')} personas y ` +
        `${tree.families.size.toLocaleString('es-CL')} familias. ` +
        (unparsed ? `${unparsed} fechas quedaron como texto para revisar.` : '');
      this.homeId = undefined;
      this.setTree(tree);
      try {
        await saveTree(tree);
      } catch (err) {
        this.error = `Se importó, pero no se pudo guardar copia local: ${err}`;
      }
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
    if (prev) {
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
