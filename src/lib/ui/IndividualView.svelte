<script lang="ts">
  import { app } from '../store/app.svelte';
  import { birthSummary, deathSummary, fold, fullName, sortName } from '../model/format';
  import type { Person } from '../model/types';

  type SortBy = 'name' | 'rin';
  let sortBy = $state<SortBy>('name');
  let query = $state('');
  let scrollTop = $state(0);
  let viewportH = $state(600);
  let rowH = $state(32);
  let list: HTMLDivElement | undefined = $state();
  let probe: HTMLDivElement | undefined = $state();
  let searchInput: HTMLInputElement | undefined = $state();

  // Ordenar 32 mil personas cuesta; solo se recalcula si cambia el árbol o el criterio.
  // La misma clave sirve para ordenar y para la búsqueda binaria.
  const byName = $derived.by(() => {
    const keyed = [...app.tree!.people.values()].map((p) => [sortName(p), p] as const);
    keyed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1].rin - b[1].rin));
    return { people: keyed.map((k) => k[1]), keys: keyed.map((k) => k[0]) };
  });
  const sorted = $derived(
    sortBy === 'rin' ? [...app.tree!.people.values()].sort((a, b) => a.rin - b.rin) : byName.people,
  );
  const keys = $derived(byName.keys);

  const selIndex = $derived(sorted.findIndex((p) => p.id === app.selectedId));
  const OVERSCAN = 8;
  const first = $derived(Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN));
  const last = $derived(Math.min(sorted.length, Math.ceil((scrollTop + viewportH) / rowH) + OVERSCAN));
  const visible = $derived(sorted.slice(first, last));

  $effect(() => {
    if (probe) rowH = probe.getBoundingClientRect().height || 32;
  });

  // Al entrar, mostrar a la persona seleccionada.
  $effect(() => {
    if (list && selIndex >= 0) scrollIntoView(selIndex);
  });

  function scrollIntoView(i: number) {
    if (!list) return;
    const top = i * rowH;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + rowH > list.scrollTop + list.clientHeight) list.scrollTop = top - list.clientHeight + rowH;
  }

  function selectIndex(i: number) {
    const p = sorted[Math.max(0, Math.min(sorted.length - 1, i))];
    if (!p) return;
    app.selectedId = p.id;
    scrollIntoView(sorted.indexOf(p));
  }

  /** Escribir salta a la primera coincidencia (apellido, luego nombre), como PAF. */
  function jump() {
    const q = fold(query).replace(/,/g, ' ').replace(/\s+/g, ' ');
    if (!q) return;
    if (sortBy === 'rin' || /^\d+$/.test(q)) {
      const rin = Number(q);
      const i = sorted.findIndex((p) => p.rin === rin);
      if (i >= 0) selectIndex(i);
      return;
    }
    // búsqueda binaria por prefijo
    let lo = 0;
    let hi = keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (keys[mid]! < q) lo = mid + 1;
      else hi = mid;
    }
    if (lo < keys.length && keys[lo]!.startsWith(q)) {
      selectIndex(lo);
    } else {
      // Si no coincide el prefijo, buscar las palabras en cualquier orden.
      const words = q.split(' ');
      const i = keys.findIndex((k) => words.every((w) => k.includes(w)));
      if (i >= 0) selectIndex(i);
    }
  }

  function open(p: Person) {
    app.selectedId = p.id;
    app.setView('family');
  }

  export function onKey(e: KeyboardEvent): boolean {
    const page = Math.max(1, Math.floor(viewportH / rowH) - 1);
    const i = selIndex < 0 ? 0 : selIndex;
    switch (e.key) {
      case 'ArrowDown': selectIndex(i + 1); return true;
      case 'ArrowUp': selectIndex(i - 1); return true;
      case 'PageDown': selectIndex(i + page); return true;
      case 'PageUp': selectIndex(i - page); return true;
      case 'Home': if (e.target !== searchInput) { selectIndex(0); return true; } return false;
      case 'End': if (e.target !== searchInput) { selectIndex(sorted.length - 1); return true; } return false;
      case 'Enter': {
        const p = sorted[i];
        if (p) open(p);
        return true;
      }
    }
    // Teclear letras lleva al buscador.
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && e.target !== searchInput) {
      searchInput?.focus();
    }
    return false;
  }
</script>

<section class="individual" aria-label="Lista de personas">
  <div class="search">
    <label>
      Buscar
      <input
        bind:this={searchInput}
        bind:value={query}
        oninput={jump}
        placeholder={sortBy === 'name' ? 'Apellido Nombre…' : 'Número RIN…'}
        autocomplete="off"
        spellcheck="false"
      />
    </label>
    <span class="count">{sorted.length.toLocaleString('es-CL')} personas</span>
  </div>

  <div class="head row" role="row">
    <button class:active={sortBy === 'rin'} onclick={() => (sortBy = 'rin')}>RIN</button>
    <button class:active={sortBy === 'name'} onclick={() => (sortBy = 'name')}>Nombre completo</button>
    <span>Nacimiento / Bautizo</span>
    <span>Defunción / Sepultación</span>
  </div>

  <div
    class="list"
    role="listbox"
    tabindex="-1"
    aria-label="Personas"
    bind:this={list}
    bind:clientHeight={viewportH}
    onscroll={() => (scrollTop = list!.scrollTop)}
  >
    <div class="row probe" bind:this={probe} aria-hidden="true"><span>0</span></div>
    <div style="height:{sorted.length * rowH}px; position:relative">
      {#each visible as p, k (p.id)}
        {@const b = birthSummary(p)}
        {@const d = deathSummary(p)}
        <div
          class="row item"
          class:selected={p.id === app.selectedId}
          role="option"
          aria-selected={p.id === app.selectedId}
          tabindex="-1"
          style="top:{(first + k) * rowH}px"
          onclick={() => (app.selectedId = p.id)}
          ondblclick={() => open(p)}
          onkeydown={() => {}}
        >
          <span class="rin">{p.rin}</span>
          <span class="name">{p.surname}{p.surname2 ? ' ' + p.surname2 : ''}{p.givenNames ? ', ' + p.givenNames : ''}{p.title ? ` (${p.title})` : ''}</span>
          <span>{b.text}{b.fromAlt ? ' *' : ''}</span>
          <span>{d.text}{d.fromAlt ? ' *' : ''}</span>
        </div>
      {/each}
    </div>
  </div>
  <p class="hint">Enter o doble clic: abrir en vista Familia · {fullName(app.selected)}</p>
</section>

<style>
  .individual {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    padding: 0.8em 1em 0.4em;
    gap: 0.4em;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 1em;
    flex-wrap: wrap;
  }
  .search input {
    font: inherit;
    padding: 0.2em 0.4em;
    margin-left: 0.4em;
    border: 1px solid var(--line);
    width: min(22em, 70vw);
    background: var(--box);
    color: var(--ink);
  }
  .count { color: var(--muted); }
  .row {
    display: grid;
    grid-template-columns: 5em minmax(0, 2.2fr) minmax(0, 1.5fr) minmax(0, 1.5fr);
    gap: 0.6em;
    align-items: center;
    padding: 0.15em 0.5em;
    line-height: 1.5;
  }
  .row > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .head { font-weight: 600; border-bottom: 1px solid var(--line); }
  .head button {
    font: inherit;
    text-align: left;
    background: none;
    border: none;
    padding: 0;
    color: inherit;
    cursor: pointer;
    text-decoration: underline dotted;
  }
  .head button.active { text-decoration: underline; }
  .list {
    flex: 1;
    overflow: auto;
    border: 1px solid var(--line);
    background: var(--box);
    position: relative;
    min-height: 0;
  }
  .probe { visibility: hidden; position: absolute; }
  .item {
    position: absolute;
    left: 0;
    right: 0;
    cursor: pointer;
  }
  .item.selected { background: var(--sel); color: var(--sel-ink); }
  .rin { text-align: right; color: inherit; opacity: 0.75; }
  .hint { margin: 0; color: var(--muted); font-size: 0.85em; }
  @media (max-width: 760px) {
    .row { grid-template-columns: 3.5em minmax(0, 1fr) 7em; }
    .row > :nth-child(4) { display: none; }
  }
</style>
