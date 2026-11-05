<script lang="ts">
  import { app } from '../store/app.svelte';
  import {
    children,
    childForNavigation,
    father,
    hasDescendants,
    mother,
    parentFamily,
    spouseFamilies,
    spouseIn,
  } from '../model/tree';
  import { birthDate, eventText, fullName, PEDIGREE_LABELS } from '../model/format';
  import { moveChild } from '../model/edit';
  import PersonBox from './PersonBox.svelte';

  const t = $derived(app.tree!);
  const p = $derived(app.primary);
  const fams = $derived(spouseFamilies(t, p));
  const famIdx = $derived(p ? Math.min(app.spouseIndex[p.id] ?? 0, Math.max(0, fams.length - 1)) : 0);
  const fam = $derived(fams[famIdx]);
  const spouse = $derived(p ? spouseIn(t, fam, p) : undefined);
  const dad = $derived(father(t, p));
  const mom = $derived(mother(t, p));
  const kids = $derived(children(t, fam));
  const marriage = $derived(fam?.events.find((e) => e.type === 'MARR'));

  function nextSpouse() {
    if (!p || fams.length < 2) return;
    app.spouseIndex = { ...app.spouseIndex, [p.id]: (famIdx + 1) % fams.length };
  }

  function toChild(id: string) {
    if (p) app.lastChild.set(p.id, id);
    app.makePrimary(id);
  }

  const add = {
    father: () => p && (app.dialog = { type: 'add-person', relation: { kind: 'father', childId: p.id } }),
    mother: () => p && (app.dialog = { type: 'add-person', relation: { kind: 'mother', childId: p.id } }),
    // Si la familia mostrada no tiene cónyuge, se completa esa misma familia.
    spouse: () =>
      p && (app.dialog = { type: 'add-person', relation: { kind: 'spouse', personId: p.id, familyId: fam && !spouse ? fam.id : undefined } }),
    otherSpouse: () => p && (app.dialog = { type: 'add-person', relation: { kind: 'spouse', personId: p.id } }),
    child: () => p && (app.dialog = { type: 'add-person', relation: { kind: 'child', parentId: p.id, familyId: fam?.id } }),
  };

  function pedigreeOf(childId: string): string {
    const c = t.people.get(childId);
    const link = c?.parents.find((l) => l.familyId === fam?.id);
    return link?.pedigree ? (PEDIGREE_LABELS[link.pedigree] ?? link.pedigree) : '';
  }

  // Navegación con teclado (PAF 5): flechas, Inicio/Fin, F, M, C, Enter.
  const leftCol = $derived([p?.id, spouse?.id, ...kids.map((k) => k.id)].filter(Boolean) as string[]);
  const rightCol = $derived([dad?.id, mom?.id].filter(Boolean) as string[]);

  export function onKey(e: KeyboardEvent): boolean {
    if (!p) return false;
    const sel = app.selectedId ?? p.id;
    const inLeft = leftCol.indexOf(sel);
    const inRight = rightCol.indexOf(sel);
    const move = (id: string | undefined) => id && (app.selectedId = id);
    // Alt+↑/↓ reordena al hijo seleccionado
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && fam && fam.childIds.includes(sel)) {
      const famId = fam.id;
      app.edit('Mover hijo', (tx) => moveChild(tx, famId, sel, e.key === 'ArrowUp' ? -1 : 1));
      return true;
    }
    switch (e.key) {
      case 'ArrowDown':
        if (inLeft >= 0) move(leftCol[Math.min(inLeft + 1, leftCol.length - 1)]);
        else if (inRight >= 0) move(rightCol[Math.min(inRight + 1, rightCol.length - 1)]);
        else move(p.id);
        return true;
      case 'ArrowUp':
        if (inLeft >= 0) move(leftCol[Math.max(inLeft - 1, 0)]);
        else if (inRight >= 0) move(rightCol[Math.max(inRight - 1, 0)]);
        else move(p.id);
        return true;
      case 'ArrowRight':
        if (inLeft >= 0 && inLeft < 2) move(rightCol[Math.min(inLeft, rightCol.length - 1)]);
        return true;
      case 'ArrowLeft':
        if (inRight >= 0) move(p.id);
        return true;
      case 'Home':
        move(p.id);
        return true;
      case 'End':
        move(leftCol[leftCol.length - 1]);
        return true;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return false;
    switch (e.key.toLowerCase()) {
      case 'f':
        app.makePrimary(dad?.id);
        return true;
      case 'm':
        app.makePrimary(mom?.id);
        return true;
      case 'c': {
        const c = childForNavigation(t, p, app.lastChild);
        if (c) toChild(c.id);
        return true;
      }
    }
    return false;
  }
</script>

{#if p}
  <section class="family" aria-label="Vista de familia">
    <div class="primary">
      <PersonBox person={p} />
    </div>

    {#if fam}
      <button type="button" class="marriage" onclick={() => (app.dialog = { type: 'edit-family', familyId: fam.id })} title="Editar matrimonio e hijos">
        Matrimonio: {marriage?.date?.text ?? ''}
      </button>
    {:else}
      <div class="marriage">Sin cónyuge registrado</div>
    {/if}

    <div class="spouse-label">
      <h2>Cónyuge {#if fams.length > 1}<small>({famIdx + 1} de {fams.length})</small>{/if}</h2>
      <span class="spouse-tools">
        {#if spouse}
          <button class="mini" onclick={add.otherSpouse} title="Agregar otro cónyuge">＋ Otro</button>
        {/if}
        <button class="mini" onclick={nextSpouse} disabled={fams.length < 2} title="Mostrar otro cónyuge" aria-label="Mostrar otro cónyuge">⇕</button>
      </span>
    </div>
    <div class="spouse">
      <PersonBox person={spouse} placeholder="Cónyuge" onadd={add.spouse} />
    </div>
    {#if spouse}
      <button class="arrow spouse-arrow" onclick={() => app.makePrimary(spouse.id)} aria-label="Llevar cónyuge a posición principal">◂</button>
    {/if}

    <h2 class="parents-label">Padres</h2>
    <div class="connector" aria-hidden="true"></div>
    <div class="dad"><PersonBox person={dad} placeholder="Padre" onadd={add.father} /></div>
    <div class="mom"><PersonBox person={mom} placeholder="Madre" onadd={add.mother} /></div>
    {#if dad}
      <button class="arrow dad-arrow" onclick={() => app.makePrimary(dad.id)} aria-label="Llevar padre a posición principal (F)">▸</button>
    {/if}
    {#if mom}
      <button class="arrow mom-arrow" onclick={() => app.makePrimary(mom.id)} aria-label="Llevar madre a posición principal (M)">▸</button>
    {/if}

    <div class="children">
      <div class="children-head">
        <h2>Hijos</h2>
        <h2 class="born">Nacimiento</h2>
        <h2 class="link">Filiación</h2>
      </div>
      <ol class="children-list">
        {#each kids as k, i (k.id)}
          <li class:selected={app.selectedId === k.id}>
            <button
              class="arrow child-arrow"
              class:hollow={!hasDescendants(t, k)}
              onclick={() => toChild(k.id)}
              aria-label="Llevar a {fullName(k)} a posición principal"
            >◂</button>
            <button
              class="row"
              data-person={k.id}
              onclick={(e) => (e.ctrlKey ? toChild(k.id) : (app.selectedId = k.id))}
              ondblclick={(e) => (e.ctrlKey ? toChild(k.id) : (app.dialog = { type: 'edit-person', personId: k.id }))}
            >
              <span class="num">{i + 1}</span>
              {#if k.notes.trim() || k.media.length}<span class="flag" aria-label="Tiene notas o fotos"></span>{/if}
              <span class="kname">{fullName(k)}</span>
              <span class="born">{birthDate(k)}</span>
              <span class="link">{pedigreeOf(k.id)}</span>
            </button>
          </li>
        {/each}
        <li class="add-row">
          <button type="button" class="row add" onclick={add.child}>
            <span class="num"></span><span>＋ Agregar hijo/a</span>
          </button>
        </li>
      </ol>
    </div>
  </section>
{/if}

<style>
  .family {
    display: grid;
    grid-template-columns: 2.2em minmax(0, 46fr) 3em 2em minmax(0, 42fr) 2.4em;
    grid-template-rows: auto auto auto auto auto auto minmax(0, 1fr);
    grid-template-areas:
      '.    .        .  .    plabel .'
      '.    primary  c  c    dad    dada'
      '.    marriage c  c    mom    moma'
      '.    slabel   .  .    mom    moma'
      'spa  spouse   .  .    .      .'
      '.    .        .  .    .      .'
      'kids kids     kids kids kids kids';
    column-gap: 0;
    row-gap: 0.5em;
    padding: 1.5em 1em 1em;
    height: 100%;
    min-height: 0;
  }
  h2 {
    margin: 0;
    font-size: 1em;
    font-weight: 600;
  }
  .primary { grid-area: primary; }
  .marriage {
    grid-area: marriage;
    margin-left: 1em;
    margin-right: 4em;
    border: 1px solid var(--line);
    background: var(--box);
    padding: 0.3em 0.6em;
    align-self: start;
  }
  .spouse-label {
    grid-area: slabel;
    display: flex;
    justify-content: space-between;
    align-items: end;
    padding-left: 0.4em;
  }
  .spouse-label small { font-weight: 400; color: var(--muted); }
  .spouse-tools { display: flex; gap: 0.3em; }
  button.marriage { font: inherit; color: inherit; text-align: left; cursor: pointer; }
  button.marriage:hover { border-style: dashed; }
  .row.add { color: var(--muted); }
  .row.add:hover { color: var(--ink); }
  .spouse { grid-area: spouse; }
  .spouse-arrow { grid-area: spa; }
  .parents-label { grid-area: plabel; padding-left: 0.4em; align-self: end; }
  /* Corchete que une a la persona principal con sus padres. */
  .connector {
    grid-area: c;
    position: relative;
  }
  .connector::before {
    content: '';
    position: absolute;
    left: 0;
    width: 50%;
    top: 1.8em;
    border-top: 1px solid var(--line);
  }
  .connector::after {
    content: '';
    position: absolute;
    left: 50%;
    right: 0;
    top: 1.8em;
    bottom: 1.8em;
    border: 1px solid var(--line);
    border-right: none;
  }
  .dad { grid-area: dad; }
  .mom { grid-area: mom; align-self: start; }
  .dad-arrow { grid-area: dada; }
  .mom-arrow { grid-area: moma; align-self: start; }
  .arrow {
    width: 1.8em;
    height: 1.8em;
    margin: auto 0.3em;
    border: 1px solid var(--line);
    background: var(--btn);
    color: var(--ink);
    font: inherit;
    font-size: 0.8em;
    cursor: pointer;
    padding: 0;
  }
  .arrow.hollow { color: var(--muted); }
  .mini {
    font: inherit;
    border: 1px solid var(--line);
    background: var(--btn);
    cursor: pointer;
    padding: 0 0.4em;
  }
  .children {
    grid-area: kids;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .children-head,
  .row {
    display: grid;
    grid-template-columns: 2em minmax(0, 1fr) 9em 9em;
    gap: 0.5em;
  }
  .children-head {
    padding: 0.4em 0.4em 0.2em 2.2em;
  }
  .children-head h2:first-child { grid-column: 1 / 3; padding-left: 0.4em; }
  /* Las flechas viven en una franja sin fondo a la izquierda de la lista,
     dentro del área con scroll para que no se recorten. */
  .children-list {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1;
    overflow: auto;
    min-height: 6em;
    background: linear-gradient(var(--box), var(--box)) 2.2em 0 / calc(100% - 2.2em) 100% no-repeat;
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    border-top: 1px solid var(--line);
    box-shadow: inset 2.2em 0 0 var(--bg), inset calc(2.2em + 1px) 0 0 var(--line);
  }
  .children-list li {
    display: flex;
    align-items: center;
    position: relative;
  }
  .child-arrow {
    flex: none;
    margin: 0 0.25em;
    position: relative;
  }
  .row {
    flex: 1;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 0.2em 0.4em;
    cursor: pointer;
  }
  li.selected .row { background: var(--sel); color: var(--sel-ink); }
  .row:focus-visible { outline: 3px solid var(--focus); outline-offset: -3px; }
  .kname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row { position: relative; padding-top: 0.3em; padding-bottom: 0.3em; }
  .flag {
    position: absolute;
    top: 0;
    right: 0;
    border-style: solid;
    border-width: 0 0.7em 0.7em 0;
    border-color: transparent var(--ink) transparent transparent;
  }
  li.selected .flag { border-right-color: var(--sel-ink); }
  .mini:disabled { color: var(--muted); cursor: default; }

  @media (max-width: 760px) {
    .family {
      grid-template-columns: 2em minmax(0, 1fr) 2.2em;
      grid-template-areas:
        'plabel plabel plabel'
        '. dad dada'
        '. mom moma'
        '. primary .'
        '. marriage .'
        '. slabel .'
        'spa spouse .'
        'kids kids kids';
      grid-template-rows: auto;
    }
    .connector { display: none; }
    .marriage { margin: 0; }
    .children-head, .row { grid-template-columns: 1.6em minmax(0, 1fr) 6.5em; }
    .children-head .link, .row .link { display: none; }
  }
</style>
