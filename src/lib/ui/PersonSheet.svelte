<script lang="ts">
  import { app } from '../store/app.svelte';
  import { EVENT_LABELS, fullName } from '../model/format';
  import { father, getPerson, mother, spouseFamilies, spouseIn } from '../model/tree';

  const t = $derived(app.tree!);
  const p = $derived(getPerson(t, app.sheetId));
  let dialog: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (p && dialog && !dialog.open) dialog.showModal();
  });

  function close() {
    dialog?.close();
    app.sheetId = undefined;
  }

  function go(id: string | undefined) {
    close();
    app.makePrimary(id);
    if (app.view === 'individual') app.view = 'family';
  }

  const SEX = { M: 'Masculino', F: 'Femenino', U: 'Desconocido' };
</script>

{#if p}
  <dialog bind:this={dialog} onclose={close} aria-labelledby="sheet-title">
    <header>
      <h2 id="sheet-title">{fullName(p)}</h2>
      <button class="close" onclick={close} aria-label="Cerrar (Esc)">✕</button>
    </header>

    <div class="body">
      <dl class="facts">
        <dt>RIN</dt><dd>{p.rin}</dd>
        <dt>Sexo</dt><dd>{SEX[p.sex]}</dd>
        {#if p.title}<dt>Título</dt><dd>{p.title}</dd>{/if}
        <dt>Nombres</dt><dd>{p.givenNames || '—'}</dd>
        <dt>Apellido paterno</dt><dd>{p.surname || '—'}</dd>
        <dt>Apellido materno</dt><dd>{p.surname2 || '—'}</dd>
        {#if p.nickname}<dt>Apodo</dt><dd>{p.nickname}</dd>{/if}
        {#each p.altNames as a}<dt>Otro nombre</dt><dd>{a.value}</dd>{/each}
      </dl>

      {#if p.events.length}
        <h3>Eventos</h3>
        <table>
          <tbody>
            {#each p.events as e}
              <tr>
                <th scope="row">{EVENT_LABELS[e.type] ?? e.type}</th>
                <td>
                  {e.date?.text ?? ''}
                  {#if e.date && !e.date.ok}<span class="warn" title="La app no pudo interpretar esta fecha; se conserva tal cual">por revisar</span>{/if}
                </td>
                <td>{e.place ?? ''}{e.cause ? ` (causa: ${e.cause})` : ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}

      <h3>Familia</h3>
      <ul class="links">
        {#if father(t, p)}<li>Padre: <button onclick={() => go(father(t, p)?.id)}>{fullName(father(t, p))}</button></li>{/if}
        {#if mother(t, p)}<li>Madre: <button onclick={() => go(mother(t, p)?.id)}>{fullName(mother(t, p))}</button></li>{/if}
        {#each spouseFamilies(t, p) as f}
          {@const s = spouseIn(t, f, p)}
          {#if s}<li>Cónyuge: <button onclick={() => go(s.id)}>{fullName(s)}</button> · {f.childIds.length} hijos</li>{/if}
        {/each}
      </ul>

      {#if p.notes.trim()}
        <h3>Notas</h3>
        <div class="notes">{p.notes}</div>
      {/if}

      {#if p.media.length}
        <h3>Fotos y documentos</h3>
        <ul class="media">
          {#each p.media as m}
            <li>{m.title || m.file} <small>({m.file}) — archivo aún no cargado</small></li>
          {/each}
        </ul>
      {/if}
    </div>

    <footer>
      <button onclick={() => go(p.id)}>Ver en vista Familia</button>
      <button onclick={() => { app.setHome(p.id); }}>Fijar como persona inicial</button>
      <button onclick={close}>Cerrar</button>
    </footer>
  </dialog>
{/if}

<style>
  dialog {
    width: min(52em, calc(100vw - 2em));
    max-height: calc(100vh - 2em);
    padding: 0;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--ink);
    font-size: inherit;
    display: flex;
    flex-direction: column;
  }
  dialog::backdrop { background: rgb(0 0 0 / 0.35); }
  header, footer {
    display: flex;
    align-items: center;
    gap: 0.6em;
    padding: 0.6em 1em;
    background: var(--chrome);
  }
  header h2 { margin: 0; font-size: 1.15em; flex: 1; }
  footer { justify-content: flex-end; flex-wrap: wrap; }
  .body { overflow: auto; padding: 0.4em 1em 1em; }
  h3 { font-size: 1em; margin: 1em 0 0.3em; border-bottom: 1px solid var(--line); }
  .facts { display: grid; grid-template-columns: max-content 1fr; gap: 0.15em 1em; margin: 0.6em 0 0; }
  dt { color: var(--muted); }
  dd { margin: 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 0.15em 0.6em 0.15em 0; vertical-align: top; }
  th { font-weight: 600; white-space: nowrap; }
  .warn { font-size: 0.8em; background: var(--warn-bg); color: var(--warn-ink); padding: 0 0.3em; margin-left: 0.3em; }
  .notes { white-space: pre-wrap; line-height: 1.5; background: var(--box); border: 1px solid var(--line); padding: 0.6em; }
  .links { list-style: none; padding: 0; margin: 0; }
  .links button { font: inherit; background: none; border: none; color: var(--link); text-decoration: underline; cursor: pointer; padding: 0; }
  .media small { color: var(--muted); }
  footer button, .close { font: inherit; padding: 0.25em 0.8em; border: 1px solid var(--line); background: var(--btn); color: var(--ink); cursor: pointer; }
</style>
