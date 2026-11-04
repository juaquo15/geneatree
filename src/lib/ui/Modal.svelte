<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';

  interface Props {
    title: string;
    onclose: () => void;
    wide?: boolean;
    children: Snippet;
    footer?: Snippet;
  }
  let { title, onclose, wide = false, children, footer }: Props = $props();
  let dialog: HTMLDialogElement;

  onMount(() => {
    dialog.showModal();
    // Enfocar el primer campo, como los diálogos de PAF.
    // querySelector respeta el orden del documento, no el de los selectores: dos pasos.
    const target =
      dialog.querySelector<HTMLElement>('[data-autofocus]') ??
      dialog.querySelector<HTMLElement>('.body :is(input, textarea, select)');
    target?.focus();
  });
</script>

<dialog
  bind:this={dialog}
  class:wide
  aria-label={title}
  oncancel={(e) => {
    e.preventDefault();
    onclose();
  }}
>
  <header>
    <h2>{title}</h2>
    <button type="button" class="close" onclick={onclose} aria-label="Cerrar (Esc)">✕</button>
  </header>
  <div class="body">{@render children()}</div>
  {#if footer}<footer>{@render footer()}</footer>{/if}
</dialog>

<style>
  dialog {
    width: min(46em, calc(100vw - 1em));
    max-height: calc(100dvh - 1em);
    padding: 0;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--ink);
    font-size: inherit;
    display: flex;
    flex-direction: column;
  }
  dialog.wide { width: min(60em, calc(100vw - 1em)); }
  dialog::backdrop { background: rgb(0 0 0 / 0.35); }
  header, footer {
    display: flex;
    align-items: center;
    gap: 0.6em;
    padding: 0.5em 1em;
    background: var(--chrome);
  }
  header h2 { margin: 0; font-size: 1.1em; flex: 1; }
  footer { flex-wrap: wrap; justify-content: flex-end; border-top: 1px solid var(--line-soft); }
  .body { overflow: auto; padding: 0.6em 1em 1em; }
  .close { font: inherit; padding: 0.1em 0.6em; border: 1px solid var(--line-soft); background: var(--btn); color: var(--ink); cursor: pointer; }
  :global(dialog .btn) {
    font: inherit;
    padding: 0.25em 0.9em;
    border: 1px solid var(--line);
    background: var(--btn);
    color: var(--ink);
    cursor: pointer;
  }
  :global(dialog .btn.primary) { background: var(--sel); color: var(--sel-ink); border-color: var(--sel); }
  :global(dialog .btn.danger) { color: var(--danger); border-color: var(--danger); }
  :global(dialog .linkbtn) {
    font: inherit; background: none; border: none; padding: 0;
    color: var(--link); text-decoration: underline; cursor: pointer; text-align: left;
  }
  :global(dialog input, dialog textarea, dialog select) {
    font: inherit;
    padding: 0.2em 0.4em;
    border: 1px solid var(--line-soft);
    background: var(--box);
    color: var(--ink);
    min-width: 0;
  }
  :global(dialog :is(input, textarea, select, button):focus-visible) {
    outline: 3px solid var(--focus);
    outline-offset: 1px;
  }
</style>
