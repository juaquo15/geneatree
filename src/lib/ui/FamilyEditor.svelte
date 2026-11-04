<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '../store/app.svelte';
  import { EVENT_LABELS, birthDate, fullName } from '../model/format';
  import { getPerson } from '../model/tree';
  import { moveChild, setEvent, sortChildren, unlinkChild, unlinkSpouse } from '../model/edit';
  import Modal from './Modal.svelte';
  import DateField from './DateField.svelte';

  interface Props {
    familyId: string;
  }
  let { familyId }: Props = $props();

  // La familia puede cambiar mientras el diálogo está abierto (ordenar hijos).
  const fam = $derived(app.tree!.families.get(familyId));
  const t = $derived(app.tree!);
  const initial = untrack(() => app.tree!.families.get(familyId)!);
  const ev = (type: string) => initial.events.find((e) => e.type === type);

  let marr = $state({ date: ev('MARR')?.date?.text ?? '', place: ev('MARR')?.place ?? '' });
  let div = $state({ date: ev('DIV')?.date?.text ?? '', place: ev('DIV')?.place ?? '' });
  let notes = $state(initial.notes);

  const husband = $derived(getPerson(t, fam?.husbandId));
  const wife = $derived(getPerson(t, fam?.wifeId));
  const close = () => (app.dialog = undefined);
  const names = $derived([husband, wife].filter(Boolean).map((p) => fullName(p)).join(' y '));

  function save() {
    app.edit(`Editar familia: ${names || 'MRIN ' + initial.mrin}`, (tx) => {
      const f = tx.family(familyId);
      setEvent(f.events, 'MARR', marr.date, marr.place);
      setEvent(f.events, 'DIV', div.date, div.place);
      f.notes = notes;
    });
    close();
  }

  function removeSpouse(id: string) {
    const name = fullName(getPerson(t, id));
    app.edit(`Quitar a ${name} de la familia`, (tx) => unlinkSpouse(tx, familyId, id));
    if (!app.tree!.families.has(familyId)) close();
  }

  function removeChild(id: string) {
    const name = fullName(getPerson(t, id));
    app.edit(`Quitar a ${name} de los hijos`, (tx) => unlinkChild(tx, familyId, id));
    if (!app.tree!.families.has(familyId)) close();
  }

  function addChild() {
    const parent = fam?.husbandId ?? fam?.wifeId;
    if (parent) app.dialog = { type: 'add-person', relation: { kind: 'child', parentId: parent, familyId } };
  }
</script>

{#if fam}
  <Modal title="Familia · MRIN {fam.mrin}" onclose={close} wide>
    <p class="who">{names || 'Sin cónyuges registrados'}</p>

    <div class="grid">
      <span></span><span class="colhead">Fecha</span><span class="colhead">Lugar</span>
      <label for="fe-marr">{EVENT_LABELS.MARR}</label>
      <DateField id="fe-marr" label="Fecha de matrimonio" bind:value={marr.date} />
      <input aria-label="Lugar de matrimonio" bind:value={marr.place} list="places" />
      <label for="fe-div">{EVENT_LABELS.DIV}</label>
      <DateField id="fe-div" label="Fecha de divorcio" bind:value={div.date} />
      <input aria-label="Lugar de divorcio" bind:value={div.place} list="places" />
    </div>

    <h3><label for="fe-notes">Notas de la familia</label></h3>
    <textarea id="fe-notes" bind:value={notes} rows="4"></textarea>

    <h3>Cónyuges</h3>
    <ul class="list">
      {#each [husband, wife] as s}
        {#if s}
          <li>
            <span>{fullName(s)}</span>
            <button type="button" class="btn" onclick={() => removeSpouse(s.id)}>Quitar de esta familia</button>
          </li>
        {/if}
      {/each}
    </ul>

    <h3>
      Hijos
      {#if fam.childIds.length > 1}
        <button type="button" class="linkbtn small" onclick={() => app.edit('Ordenar hijos por nacimiento', (tx) => sortChildren(tx, familyId))}>Ordenar por nacimiento</button>
      {/if}
    </h3>
    <ol class="list">
      {#each fam.childIds as id, i (id)}
        {@const c = getPerson(t, id)}
        <li>
          <span>{i + 1}. {fullName(c)} <small>{c ? birthDate(c) : ''}</small></span>
          <span class="actions">
            <button type="button" class="btn" disabled={i === 0} aria-label="Subir" onclick={() => app.edit('Mover hijo', (tx) => moveChild(tx, familyId, id, -1))}>↑</button>
            <button type="button" class="btn" disabled={i === fam.childIds.length - 1} aria-label="Bajar" onclick={() => app.edit('Mover hijo', (tx) => moveChild(tx, familyId, id, 1))}>↓</button>
            <button type="button" class="btn" onclick={() => removeChild(id)}>Quitar</button>
          </span>
        </li>
      {:else}
        <li class="none">Sin hijos</li>
      {/each}
    </ol>
    <button type="button" class="linkbtn" onclick={addChild}>＋ Agregar hijo/a</button>
    <p class="hint">Quitar desvincula a la persona de esta familia; no la elimina del archivo.</p>

    {#snippet footer()}
      <button type="button" class="btn" onclick={close}>Cancelar</button>
      <button type="button" class="btn primary" onclick={save}>Guardar</button>
    {/snippet}
  </Modal>
{/if}

<style>
  .who { margin: 0 0 0.6em; font-weight: 600; }
  .grid { display: grid; grid-template-columns: max-content minmax(0, 1fr) minmax(0, 1.3fr); gap: 0.3em 0.6em; align-items: start; }
  .grid > label { padding-top: 0.2em; }
  .colhead { font-size: 0.8em; color: var(--muted); }
  h3 { font-size: 1em; margin: 1em 0 0.4em; border-bottom: 1px solid var(--line-soft); display: flex; gap: 1em; align-items: baseline; }
  .small { font-size: 0.8em; }
  textarea { width: 100%; resize: vertical; }
  .list { list-style: none; margin: 0 0 0.4em; padding: 0; }
  .list li { display: flex; justify-content: space-between; align-items: center; gap: 0.6em; padding: 0.15em 0; flex-wrap: wrap; }
  .list small { color: var(--muted); }
  .actions { display: flex; gap: 0.3em; }
  .none { color: var(--muted); }
  .hint { font-size: 0.8em; color: var(--muted); }
</style>
