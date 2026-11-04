<script lang="ts">
  import { app } from '../store/app.svelte';
  import { fold, fullName, lifeYears, sortName } from '../model/format';
  import type { Person } from '../model/types';

  interface Props {
    onpick: (p: Person) => void;
    exclude?: string[];
    label?: string;
  }
  let { onpick, exclude = [], label = 'Buscar persona' }: Props = $props();

  let query = $state('');
  let active = $state(0);
  const MAX = 50;

  // Claves de búsqueda una sola vez por árbol.
  const index = $derived([...app.tree!.people.values()].map((p) => [sortName(p) + ' ' + p.rin, p] as const));

  const results = $derived.by(() => {
    const words = fold(query).split(/[\s,]+/).filter(Boolean);
    if (words.length === 0) return [];
    const out: Person[] = [];
    for (const [key, p] of index) {
      if (exclude.includes(p.id)) continue;
      if (words.every((w) => key.includes(w))) {
        out.push(p);
        if (out.length >= MAX) break;
      }
    }
    return out;
  });

  function onkey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') active = Math.min(active + 1, results.length - 1);
    else if (e.key === 'ArrowUp') active = Math.max(active - 1, 0);
    else if (e.key === 'Enter' && results[active]) onpick(results[active]!);
    else return;
    e.preventDefault();
  }
</script>

<div class="picker">
  <label>
    {label}
    <input bind:value={query} oninput={() => (active = 0)} onkeydown={onkey} placeholder="Apellido nombre o RIN" autocomplete="off" />
  </label>
  {#if query.trim()}
    <ul role="listbox" aria-label="Resultados">
      {#each results as p, i (p.id)}
        <li role="option" aria-selected={i === active}>
          <button type="button" class:active={i === active} onclick={() => onpick(p)}>
            <span>{fullName(p)}</span>
            <small>{lifeYears(p)} · RIN {p.rin}</small>
          </button>
        </li>
      {:else}
        <li class="none">Sin resultados</li>
      {/each}
      {#if results.length >= MAX}<li class="none">Mostrando los primeros {MAX}; escriba más para afinar.</li>{/if}
    </ul>
  {/if}
</div>

<style>
  .picker label { display: flex; gap: 0.5em; align-items: center; }
  .picker input { flex: 1; }
  ul { list-style: none; margin: 0.4em 0 0; padding: 0; max-height: 16em; overflow: auto; border: 1px solid var(--line-soft); background: var(--box); }
  li button {
    display: flex; justify-content: space-between; gap: 1em; width: 100%;
    font: inherit; text-align: left; border: none; background: none; color: inherit; padding: 0.2em 0.5em; cursor: pointer;
  }
  li button.active, li button:hover { background: var(--sel); color: var(--sel-ink); }
  small { opacity: 0.8; white-space: nowrap; }
  .none { padding: 0.2em 0.5em; color: var(--muted); }
</style>
