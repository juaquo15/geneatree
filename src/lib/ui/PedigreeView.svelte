<script lang="ts">
  import { app } from '../store/app.svelte';
  import { childForNavigation, father, getPerson, hasAncestors, mother } from '../model/tree';
  import type { Person } from '../model/types';
  import PersonBox from './PersonBox.svelte';

  const GENS = 5;
  const SLOTS = 2 ** GENS; // números ahnentafel 1..31

  const t = $derived(app.tree!);
  const p = $derived(app.primary);

  /** slots[n] = persona con número ahnentafel n (padre 2n, madre 2n+1). */
  const slots = $derived.by(() => {
    const s: (Person | undefined)[] = new Array(SLOTS);
    s[1] = p;
    for (let n = 1; n < SLOTS / 2; n++) {
      s[2 * n] = father(t, s[n]);
      s[2 * n + 1] = mother(t, s[n]);
    }
    return s;
  });

  const gen = (n: number) => Math.floor(Math.log2(n));
  const rowSpan = (n: number) => 2 ** (GENS - 1 - gen(n));
  const rowStart = (n: number) => (n - 2 ** gen(n)) * rowSpan(n) + 1;
  const numbers = Array.from({ length: SLOTS - 1 }, (_, i) => i + 1);

  const selectedSlot = $derived(slots.findIndex((x, i) => i > 0 && x?.id === app.selectedId));

  /** Agregar padre (n par) o madre (n impar) de quien ocupa el lugar n/2. */
  function addParent(n: number) {
    const child = slots[Math.floor(n / 2)];
    if (!child) return;
    app.dialog = { type: 'add-person', relation: { kind: n % 2 === 0 ? 'father' : 'mother', childId: child.id } };
  }

  function select(n: number) {
    const x = slots[n];
    if (x) app.selectedId = x.id;
  }

  export function onKey(e: KeyboardEvent): boolean {
    if (!p) return false;
    const n = selectedSlot > 0 ? selectedSlot : 1;
    const g = gen(n);
    switch (e.key) {
      case 'ArrowRight':
      case 'PageUp': // línea del padre
        if (2 * n < SLOTS && slots[2 * n]) select(2 * n);
        else if (slots[n] && e.key === 'PageUp' && hasAncestors(t, slots[n]!)) app.makePrimary(slots[n]!.id);
        return true;
      case 'PageDown': // línea de la madre
        if (2 * n + 1 < SLOTS && slots[2 * n + 1]) select(2 * n + 1);
        else if (slots[n] && hasAncestors(t, slots[n]!)) app.makePrimary(slots[n]!.id);
        return true;
      case 'ArrowLeft':
        if (n > 1) select(Math.floor(n / 2));
        else goChild();
        return true;
      case 'ArrowUp':
      case 'ArrowDown': {
        const step = e.key === 'ArrowUp' ? -1 : 1;
        for (let m = n + step; m >= 2 ** g && m < 2 ** (g + 1); m += step) {
          if (slots[m]) {
            select(m);
            break;
          }
        }
        return true;
      }
      case 'Home':
        select(1);
        return true;
      case 'End':
        for (let m = SLOTS - 1; m >= 1; m--) {
          if (slots[m]) {
            select(m);
            break;
          }
        }
        return true;
      case 'Enter':
        if (e.ctrlKey) {
          app.makePrimary(app.selectedId);
          return true;
        }
        return false;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return false;
    switch (e.key.toLowerCase()) {
      case 'f':
        if (2 * n < SLOTS) select(2 * n);
        else if (slots[n]) app.makePrimary(father(t, slots[n])?.id);
        return true;
      case 'm':
        if (2 * n + 1 < SLOTS) select(2 * n + 1);
        else if (slots[n]) app.makePrimary(mother(t, slots[n])?.id);
        return true;
      case 'c':
        if (n > 1) select(Math.floor(n / 2));
        else goChild();
        return true;
    }
    return false;
  }

  function goChild() {
    if (!p) return;
    const c = childForNavigation(t, p, app.lastChild);
    if (c) {
      app.lastChild.set(p.id, c.id);
      app.makePrimary(c.id);
    }
  }

  const canGoChild = $derived(!!p && childForNavigation(t, p, app.lastChild) !== undefined);
</script>

{#if p}
  <section class="pedigree" aria-label="Vista de pedigrí" style="--gens:{GENS}">
    <div class="child-nav">
      {#if canGoChild}
        <button class="arrow" onclick={goChild} aria-label="Ir a un hijo (C)" title="Ir a un hijo (C)">◂</button>
      {/if}
    </div>
    {#each numbers as n (n)}
      {@const g = gen(n)}
      <div
        class="slot g{g}"
        style="grid-column:{2 * g + 2}; grid-row:{rowStart(n)} / span {rowSpan(n)}"
      >
        {#if slots[n] || (n > 1 && slots[Math.floor(n / 2)])}
          <PersonBox person={slots[n]} placeholder={n % 2 === 0 ? 'Padre' : 'Madre'} compact={g >= 3} onadd={() => addParent(n)} />
        {/if}
      </div>
      {#if g < GENS - 1 && slots[n]}
        <div class="bracket" style="grid-column:{2 * g + 3}; grid-row:{rowStart(n)} / span {rowSpan(n)}" aria-hidden="true"></div>
      {/if}
      {#if g === GENS - 1 && slots[n] && hasAncestors(t, slots[n]!)}
        <div class="more" style="grid-column:{2 * g + 3}; grid-row:{rowStart(n)} / span {rowSpan(n)}">
          <button class="arrow" onclick={() => app.makePrimary(slots[n]!.id)} aria-label="Ver antepasados de esta persona">▸</button>
        </div>
      {/if}
    {/each}
  </section>
{/if}

<style>
  .pedigree {
    display: grid;
    grid-template-columns:
      2.4em
      minmax(0, 1.25fr) 1.2em
      minmax(0, 1.2fr) 1.2em
      minmax(0, 1.1fr) 1.2em
      minmax(0, 1fr) 1.2em
      minmax(0, 1fr) 2.4em;
    grid-template-rows: repeat(16, minmax(2.3em, 1fr));
    padding: 1em 0.5em;
    height: 100%;
    min-height: 0;
    overflow: auto;
  }
  .child-nav {
    grid-column: 1;
    grid-row: 1 / span 16;
    display: flex;
    align-items: center;
  }
  .slot {
    display: flex;
    align-items: center;
    padding: 0.15em 0;
    min-width: 0;
  }
  .bracket {
    position: relative;
  }
  .bracket::before {
    content: '';
    position: absolute;
    left: 0;
    width: 50%;
    top: 50%;
    border-top: 1px solid var(--line);
  }
  .bracket::after {
    content: '';
    position: absolute;
    left: 50%;
    right: 0;
    top: 25%;
    bottom: 25%;
    border: 1px solid var(--line);
    border-right: none;
  }
  .more {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .arrow {
    width: 1.8em;
    height: 1.8em;
    border: 1px solid var(--line);
    background: var(--btn);
    color: var(--ink);
    font: inherit;
    font-size: 0.8em;
    cursor: pointer;
    padding: 0;
  }
  @media (max-width: 760px) {
    /* En pantallas angostas se muestran 3 generaciones. */
    .pedigree {
      grid-template-columns: 2em minmax(0, 1fr) 0.8em minmax(0, 1fr) 0.8em minmax(0, 1fr) 0 0 0 0 0;
    }
    .g3, .g4, .more { display: none; }
  }
</style>
