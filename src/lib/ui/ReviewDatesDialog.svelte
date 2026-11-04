<script lang="ts">
  import { app } from '../store/app.svelte';
  import { unparsedDates, type UnparsedDate } from '../model/review';
  import Modal from './Modal.svelte';

  const items = $derived(unparsedDates(app.tree!));

  function open(it: UnparsedDate) {
    app.dialog = it.kind === 'person' ? { type: 'edit-person', personId: it.id } : { type: 'edit-family', familyId: it.id };
  }
</script>

<Modal title="Fechas por revisar ({items.length})" onclose={() => (app.dialog = undefined)} wide>
  <p class="intro">
    Estas fechas se guardaron tal como se escribieron, pero la app no las entiende,
    así que no sirven para ordenar ni calcular edades. Haga clic para corregirlas.
  </p>
  <table>
    <thead><tr><th>Persona o familia</th><th>Evento</th><th>Texto escrito</th></tr></thead>
    <tbody>
      {#each items as it, i (i)}
        <tr>
          <td><button type="button" class="linkbtn" onclick={() => open(it)}>{it.who}</button></td>
          <td>{it.event}</td>
          <td><code>{it.text}</code></td>
        </tr>
      {:else}
        <tr><td colspan="3">No hay fechas por revisar.</td></tr>
      {/each}
    </tbody>
  </table>
</Modal>

<style>
  .intro { margin-top: 0; color: var(--muted); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.2em 0.5em 0.2em 0; border-bottom: 1px solid var(--line-soft); vertical-align: top; }
  th { font-size: 0.85em; color: var(--muted); }
  code { font: inherit; background: var(--warn-bg); color: var(--warn-ink); padding: 0 0.3em; }
</style>
