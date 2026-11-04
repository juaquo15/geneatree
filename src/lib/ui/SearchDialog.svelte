<script lang="ts">
  import { app } from '../store/app.svelte';
  import { foldKeep, fullName, lifeYears } from '../model/format';
  import type { Person } from '../model/types';
  import Modal from './Modal.svelte';

  interface Hit {
    p: Person;
    where: 'Nombre' | 'Lugar' | 'Nota';
    text: string;
    at: number;
    len: number;
  }

  let query = $state('');
  let debounced = $state('');
  let active = $state(0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const MAX = 100;

  // Índice una vez por árbol: nombre, lugares y notas sin tildes.
  const index = $derived(
    [...app.tree!.people.values()].map((p) => {
      const name = fullName(p);
      const places = [...new Set(p.events.map((e) => e.place).filter(Boolean))].join(' · ');
      return { p, name, fname: foldKeep(name), places, fplaces: foldKeep(places), fnotes: foldKeep(p.notes) };
    }),
  );

  const hits = $derived.by(() => {
    const q = foldKeep(debounced.trim());
    if (q.length < 2) return [] as Hit[];
    const out: Hit[] = [];
    for (const r of index) {
      let at = r.fname.indexOf(q);
      if (at >= 0) out.push({ p: r.p, where: 'Nombre', text: r.name, at, len: q.length });
      else if ((at = r.fplaces.indexOf(q)) >= 0) out.push({ p: r.p, where: 'Lugar', text: r.places, at, len: q.length });
      else if ((at = r.fnotes.indexOf(q)) >= 0) out.push({ p: r.p, where: 'Nota', text: r.p.notes, at, len: q.length });
      if (out.length >= MAX) break;
    }
    return out;
  });

  /** Fragmento alrededor de la coincidencia, en partes (sin HTML). */
  function snippet(h: Hit) {
    const from = Math.max(0, h.at - 50);
    const to = Math.min(h.text.length, h.at + h.len + 70);
    return {
      before: (from > 0 ? '…' : '') + h.text.slice(from, h.at).replace(/\s+/g, ' '),
      match: h.text.slice(h.at, h.at + h.len),
      after: h.text.slice(h.at + h.len, to).replace(/\s+/g, ' ') + (to < h.text.length ? '…' : ''),
    };
  }

  function oninput() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      debounced = query;
      active = 0;
    }, 200);
  }

  function go(p: Person) {
    app.dialog = undefined;
    app.makePrimary(p.id);
    if (app.view === 'individual') app.view = 'family';
  }

  function onkey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') active = Math.min(active + 1, hits.length - 1);
    else if (e.key === 'ArrowUp') active = Math.max(active - 1, 0);
    else if (e.key === 'Enter') {
      clearTimeout(timer);
      debounced = query;
      const h = hits[active];
      if (h) go(h.p);
    } else return;
    e.preventDefault();
  }
</script>

<Modal title="Buscar en nombres, lugares y notas" onclose={() => (app.dialog = undefined)} wide>
  <label class="q">
    Buscar
    <input bind:value={query} {oninput} onkeydown={onkey} placeholder="ej.: Angamos, Familias Fundadoras, Santiago" autocomplete="off" />
  </label>
  {#if debounced.trim().length >= 2}
    <p class="count" aria-live="polite">{hits.length >= MAX ? `Más de ${MAX} resultados; escriba más para afinar.` : `${hits.length} resultados`}</p>
    <ul>
      {#each hits as h, i (h.p.id)}
        {@const s = snippet(h)}
        <li>
          <button type="button" class:active={i === active} onclick={() => go(h.p)}>
            <span class="name">{fullName(h.p)} <small>{lifeYears(h.p)} · RIN {h.p.rin}</small></span>
            <span class="snip"><em>{h.where}:</em> {s.before}<mark>{s.match}</mark>{s.after}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</Modal>

<style>
  .q { display: flex; gap: 0.5em; align-items: center; }
  .q input { flex: 1; }
  .count { color: var(--muted); font-size: 0.85em; margin: 0.4em 0; }
  ul { list-style: none; margin: 0; padding: 0; }
  li button {
    display: flex; flex-direction: column; gap: 0.1em; width: 100%; text-align: left;
    font: inherit; border: none; border-bottom: 1px solid var(--line-soft); background: none; color: inherit;
    padding: 0.35em 0.4em; cursor: pointer;
  }
  li button.active, li button:hover { background: var(--info-bg); }
  .name small { color: var(--muted); }
  .snip { font-size: 0.85em; color: var(--muted); }
  mark { background: var(--warn-bg); color: var(--warn-ink); }
</style>
