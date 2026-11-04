<script lang="ts">
  import { onMount } from 'svelte';
  import { app, type View } from './lib/store/app.svelte';
  import { clearTree } from './lib/store/persist';
  import { spouseFamilies, parentFamily } from './lib/model/tree';
  import FamilyView from './lib/ui/FamilyView.svelte';
  import PedigreeView from './lib/ui/PedigreeView.svelte';
  import IndividualView from './lib/ui/IndividualView.svelte';
  import PersonSheet from './lib/ui/PersonSheet.svelte';

  let familyView: FamilyView | undefined = $state();
  let pedigreeView: PedigreeView | undefined = $state();
  let individualView: IndividualView | undefined = $state();
  let fileInput: HTMLInputElement | undefined = $state();

  onMount(() => app.init());

  const TABS: { id: View; label: string }[] = [
    { id: 'family', label: 'Familia' },
    { id: 'pedigree', label: 'Pedigrí' },
    { id: 'individual', label: 'Individuos' },
  ];

  function onKey(e: KeyboardEvent) {
    if (app.status !== 'ready' || app.sheetId) return;
    // Atajos globales de PAF 5
    if (e.ctrlKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      app.nextView();
      return;
    }
    if (e.ctrlKey && e.key === 'Home') {
      e.preventDefault();
      app.goHome();
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      app.view = 'individual';
      return;
    }
    if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      app.back();
      return;
    }
    const target = e.target as HTMLElement;
    const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
    if (typing && app.view !== 'individual') return;
    if (e.key === 'Enter' && !e.ctrlKey && app.view !== 'individual' && app.selectedId) {
      e.preventDefault();
      app.sheetId = app.selectedId;
      return;
    }
    const view = app.view === 'family' ? familyView : app.view === 'pedigree' ? pedigreeView : individualView;
    if (view?.onKey(e)) {
      e.preventDefault();
      // Mantener visible el elemento seleccionado
      queueMicrotask(() =>
        document.querySelector<HTMLElement>(`[data-person="${app.selectedId}"]`)?.focus({ preventScroll: false }),
      );
    }
  }

  function onFile(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (f) app.importFile(f);
  }

  async function forget() {
    if (!confirm('¿Borrar la copia del árbol guardada en este navegador? El archivo GEDCOM original no se toca.')) return;
    await clearTree();
    location.reload();
  }

  const status = $derived.by(() => {
    const t = app.tree;
    const s = app.selected;
    if (!t || !s) return null;
    const fams = spouseFamilies(t, s);
    const pf = parentFamily(t, s);
    return {
      rin: s.rin,
      mrin: fams[0]?.mrin ?? pf?.mrin,
      marriages: fams.length,
      children: fams.reduce((n, f) => n + f.childIds.length, 0),
    };
  });
</script>

<svelte:window onkeydown={onKey} />

<div class="app" style="font-size: calc(var(--base) * {app.fontScale})">
  <header class="toolbar">
    <strong class="brand">GeneaTree</strong>
    {#if app.status === 'ready'}
      <button onclick={() => app.goHome()} title="Ir a la persona inicial (Ctrl+Inicio)">⌂ Inicio</button>
      <button onclick={() => app.back()} title="Volver (Alt+←)">← Volver</button>
      <button onclick={() => (app.view = 'individual')} title="Buscar persona (Ctrl+F)">Buscar</button>
    {/if}
    <span class="spacer"></span>
    <button onclick={() => app.zoom(-0.1)} aria-label="Letra más chica">A−</button>
    <button onclick={() => app.zoom(0.1)} aria-label="Letra más grande">A+</button>
    {#if app.status === 'ready'}
      <button onclick={() => fileInput?.click()} title="Reemplazar con otro archivo GEDCOM">Importar…</button>
      <button onclick={forget} title="Borra la copia guardada en este navegador">Borrar copia local</button>
    {/if}
  </header>

  {#if app.status === 'ready'}
    <nav class="tabs" aria-label="Vistas">
      {#each TABS as tab}
        <button class:active={app.view === tab.id} aria-current={app.view === tab.id} onclick={() => app.setView(tab.id)}>
          {tab.label}
        </button>
      {/each}
      <span class="tabs-hint">Ctrl+S cambia de vista</span>
    </nav>
    {#if app.importReport}
      <p class="banner">{app.importReport} <button onclick={() => (app.importReport = '')}>Entendido</button></p>
    {/if}
    {#if app.error}<p class="banner error">{app.error}</p>{/if}
    <main>
      {#if app.view === 'family'}
        <FamilyView bind:this={familyView} />
      {:else if app.view === 'pedigree'}
        <PedigreeView bind:this={pedigreeView} />
      {:else}
        <IndividualView bind:this={individualView} />
      {/if}
    </main>
    <footer class="statusbar">
      <span>Doble clic: ver ficha · F padre · M madre · C hijo · Ctrl+Inicio persona inicial</span>
      <span class="spacer"></span>
      {#if status}
        <span>RIN: {status.rin}</span>
        <span>MRIN: {status.mrin ?? '—'}</span>
        <span>M: {status.marriages}</span>
        <span>H: {status.children}</span>
      {/if}
    </footer>
    <PersonSheet />
  {:else}
    <main class="welcome">
      {#if app.status === 'loading'}
        <p>Abriendo…</p>
      {:else if app.status === 'importing'}
        <p>Importando el archivo… esto puede tardar unos segundos en computadores lentos.</p>
      {:else}
        <h1>Bienvenido a GeneaTree</h1>
        <p>Para empezar, abra el archivo GEDCOM (<code>.ged</code>) exportado desde Personal Ancestral File
          (Archivo → Exportar → GEDCOM 5.5).</p>
        <p class="privacy">Los datos se leen y guardan <strong>solo en este navegador</strong>. No se envían a ningún servidor.</p>
        <button class="big" onclick={() => fileInput?.click()}>Abrir archivo GEDCOM…</button>
        {#if app.error}<p class="error">{app.error}</p>{/if}
      {/if}
    </main>
  {/if}
  <input bind:this={fileInput} type="file" accept=".ged,.GED" hidden onchange={onFile} />
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    position: relative;
  }
  .toolbar, .tabs, .statusbar {
    display: flex;
    align-items: center;
    gap: 0.5em;
    padding: 0.3em 0.8em;
    background: var(--chrome);
    flex-wrap: wrap;
  }
  .toolbar { border-bottom: 1px solid var(--line-soft); font-size: 0.8em; }
  .brand { margin-right: 1em; }
  .spacer { flex: 1; }
  button { font: inherit; }
  .toolbar button {
    padding: 0.15em 0.6em;
    border: 1px solid var(--line-soft);
    background: var(--btn);
    color: var(--ink);
    cursor: pointer;
  }
  .tabs { padding-bottom: 0; background: var(--bg); border-bottom: 1px solid var(--line); gap: 0; }
  .tabs button {
    padding: 0.2em 1.2em;
    border: 1px solid transparent;
    border-bottom: none;
    background: none;
    color: var(--ink);
    font-weight: 600;
    cursor: pointer;
    margin-bottom: -1px;
  }
  .tabs button.active { border-color: var(--line); background: var(--bg); border-bottom: 1px solid var(--bg); }
  .tabs-hint { margin-left: auto; color: var(--muted); font-size: 0.7em; }
  main { flex: 1; min-height: 0; overflow: auto; }
  .statusbar { font-size: 0.7em; border-top: 1px solid var(--line-soft); }
  .statusbar span:not(.spacer):not(:first-child) { border: 1px inset var(--line-soft); padding: 0 0.5em; min-width: 4em; }
  .banner { margin: 0; padding: 0.3em 1em; background: var(--info-bg); font-size: 0.85em; }
  .banner button { margin-left: 0.5em; }
  .error { background: var(--warn-bg); color: var(--warn-ink); }
  .welcome { max-width: 40em; margin: 0 auto; padding: 3em 1em; }
  .welcome h1 { font-size: 1.5em; }
  .privacy { background: var(--info-bg); padding: 0.6em 0.8em; }
  .big { font-size: 1.1em; padding: 0.5em 1.4em; cursor: pointer; border: 1px solid var(--line); background: var(--btn); }
  @media (max-width: 760px) {
    .tabs-hint, .statusbar > span:first-child { display: none; }
  }
</style>
