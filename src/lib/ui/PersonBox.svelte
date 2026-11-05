<script lang="ts">
  import type { Person } from '../model/types';
  import { birthSummary, deathSummary, fullName, lifeYears } from '../model/format';
  import { app } from '../store/app.svelte';

  interface Props {
    person: Person | undefined;
    /** Texto si no hay persona (p.ej. "Padre"). */
    placeholder?: string;
    compact?: boolean;
    /** Si el lugar está vacío, muestra un botón para agregar a alguien. */
    onadd?: () => void;
  }
  let { person, placeholder = '', compact = false, onadd }: Props = $props();

  const birth = $derived(person ? birthSummary(person) : undefined);
  const death = $derived(person ? deathSummary(person) : undefined);
  const flagged = $derived(!!person && (person.notes.trim() !== '' || person.media.length > 0));
</script>

{#if person}
  <button
    type="button"
    class="box"
    class:compact
    class:selected={app.selectedId === person.id}
    data-person={person.id}
    onclick={(e) => (e.ctrlKey ? app.makePrimary(person.id) : (app.selectedId = person.id))}
    ondblclick={(e) => (e.ctrlKey ? app.makePrimary(person.id) : (app.dialog = { type: 'edit-person', personId: person.id }))}
    title="Doble clic o Enter: editar · Ctrl+clic: llevar a posición principal"
  >
    {#if flagged}<span class="flag" aria-label="Tiene notas o fotos"></span>{/if}
    <span class="name">{fullName(person)}</span>
    {#if compact}
      {#if lifeYears(person)}<span class="line">{lifeYears(person)}</span>{/if}
    {:else}
      {#if birth?.text}<span class="line">{birth.text}{birth.fromAlt ? ' *' : ''}</span>{/if}
      {#if death?.text}<span class="line">{death.text}{death.fromAlt ? ' *' : ''}</span>{/if}
    {/if}
  </button>
{:else if onadd}
  <button type="button" class="box empty add" class:compact onclick={onadd}>＋ Agregar {placeholder.toLowerCase()}</button>
{:else}
  <div class="box empty" class:compact>{placeholder}</div>
{/if}

<style>
  .box {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15em;
    width: 100%;
    min-height: 4.3em;
    padding: 0.35em 0.6em;
    border: 1px solid var(--line);
    background: var(--box);
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
  }
  .box.compact {
    min-height: 0;
    font-size: 0.8em;
    gap: 0;
    padding: 0.1em 0.4em;
    line-height: 1.2;
  }
  .box.empty {
    color: var(--muted);
    cursor: default;
  }
  .box.add {
    cursor: pointer;
    border-style: dashed;
    justify-content: center;
  }
  .box.add:hover {
    color: var(--ink);
  }
  .box.selected {
    background: var(--sel);
    color: var(--sel-ink);
  }
  .box:focus-visible {
    outline: 3px solid var(--focus);
    outline-offset: 1px;
  }
  .name,
  .line {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .flag {
    position: absolute;
    top: 0;
    right: 0;
    border-style: solid;
    border-width: 0 0.7em 0.7em 0;
    border-color: transparent var(--ink) transparent transparent;
  }
  .selected .flag {
    border-right-color: var(--sel-ink);
  }
</style>
