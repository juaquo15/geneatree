<script lang="ts">
  import { describeDate, parseDate } from '../gedcom/dates';

  interface Props {
    value: string;
    label: string;
    id: string;
  }
  let { value = $bindable(), label, id }: Props = $props();

  // Interpretación en vivo: el usuario ve cómo entiende la app lo que escribe.
  const meaning = $derived(value.trim() ? describeDate(parseDate(value)) : '');
</script>

<div class="date">
  <input {id} bind:value aria-label={label} aria-describedby="{id}-hint" autocomplete="off" spellcheck="false" placeholder="ej.: 4 Ago 1924" />
  <small id="{id}-hint" class:bad={value.trim() && meaning === null}>
    {#if !value.trim()}
      &nbsp;
    {:else if meaning}
      ✓ {meaning}
    {:else}
      ⚠ No se entiende como fecha; se guardará tal cual
    {/if}
  </small>
</div>

<style>
  .date { display: flex; flex-direction: column; min-width: 0; }
  small { font-size: 0.75em; color: var(--muted); min-height: 1.3em; }
  small.bad { color: var(--warn-ink); background: var(--warn-bg); padding: 0 0.3em; }
</style>
