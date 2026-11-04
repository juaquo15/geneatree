<script lang="ts">
  import { app } from '../store/app.svelte';
  import type { TrashEntry } from '../store/persist';
  import Modal from './Modal.svelte';

  // raw: las entradas deben seguir siendo objetos planos (se copian al restaurar).
  let entries = $state.raw<TrashEntry[] | undefined>();
  let error = $state('');

  async function load() {
    try {
      entries = await app.trash();
    } catch (e) {
      error = String(e);
    }
  }
  void load();

  async function restore(e: TrashEntry) {
    await app.restoreFromTrash(e);
    app.dialog = undefined;
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' });
</script>

<Modal title="Papelera" onclose={() => (app.dialog = undefined)}>
  <p class="intro">Las personas eliminadas se pueden recuperar durante 30 días, con sus vínculos familiares.</p>
  {#if error}<p class="problem">{error}</p>{/if}
  {#if !entries}
    <p>Cargando…</p>
  {:else}
    <ul>
      {#each entries as e (e.id)}
        <li>
          <span>{e.label.replace(/^Eliminar:\s*/, '')} <small>eliminada el {fmt(e.at)}</small></span>
          <button type="button" class="btn" onclick={() => restore(e)}>Restaurar</button>
        </li>
      {:else}
        <li class="none">La papelera está vacía.</li>
      {/each}
    </ul>
  {/if}
</Modal>

<style>
  .intro { margin-top: 0; color: var(--muted); }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; justify-content: space-between; align-items: center; gap: 1em; padding: 0.3em 0; border-bottom: 1px solid var(--line-soft); }
  small { color: var(--muted); }
  .none { color: var(--muted); }
  .problem { color: var(--warn-ink); background: var(--warn-bg); }
</style>
