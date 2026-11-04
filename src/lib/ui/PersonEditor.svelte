<script lang="ts">
  import { untrack } from 'svelte';
  import { app, type Relation } from '../store/app.svelte';
  import type { LifeEvent, Person, Sex } from '../model/types';
  import { EVENT_LABELS, fullName } from '../model/format';
  import { parseDate } from '../gedcom/dates';
  import { addPerson, deletePerson, linkChild, linkParent, linkSpouse, setEvent, type EditTx } from '../model/edit';
  import { getPerson, spouseFamilies, spouseIn } from '../model/tree';
  import Modal from './Modal.svelte';
  import DateField from './DateField.svelte';
  import PersonPicker from './PersonPicker.svelte';

  interface Props {
    personId?: string;
    relation?: Relation;
  }
  let { personId, relation = { kind: 'none' } }: Props = $props();

  const t = app.tree!;
  // El formulario parte de una copia; el diálogo se recrea si cambia la persona.
  const original = untrack(() => (personId ? t.people.get(personId) : undefined));
  const isNew = !original;

  const STANDARD = ['BIRT', 'CHR', 'DEAT', 'BURI'] as const;
  const OTHER_TYPES = Object.keys(EVENT_LABELS).filter(
    (k) => !(STANDARD as readonly string[]).includes(k) && !['MARR', 'DIV', 'ENGA'].includes(k),
  );

  // --- Valores iniciales ---
  function defaults(): Partial<Person> {
    const d: Partial<Person> = {};
    if (relation.kind === 'father' || relation.kind === 'mother') {
      const child = t.people.get(relation.childId);
      d.sex = relation.kind === 'father' ? 'M' : 'F';
      // Costumbre hispana: el padre aporta el 1.er apellido, la madre el 2.º
      d.surname = relation.kind === 'father' ? child?.surname : child?.surname2;
    } else if (relation.kind === 'spouse') {
      const p = t.people.get(relation.personId);
      d.sex = p?.sex === 'M' ? 'F' : p?.sex === 'F' ? 'M' : 'U';
    } else if (relation.kind === 'child') {
      const fam = relation.familyId ? t.families.get(relation.familyId) : undefined;
      const parent = t.people.get(relation.parentId);
      const dad = fam ? getPerson(t, fam.husbandId) : parent?.sex === 'M' ? parent : undefined;
      const mom = fam ? getPerson(t, fam.wifeId) : parent?.sex === 'F' ? parent : undefined;
      d.surname = dad?.surname ?? '';
      d.surname2 = mom?.surname ?? '';
    }
    return d;
  }
  const init = original ?? defaults();
  const ev = (type: string) => original?.events.find((e) => e.type === type);

  let sex = $state<Sex>(init.sex ?? 'U');
  let title = $state(init.title ?? '');
  let givenNames = $state(init.givenNames ?? '');
  let surname = $state(init.surname ?? '');
  let surname2 = $state(init.surname2 ?? '');
  let suffix = $state(init.suffix ?? '');
  let nickname = $state(init.nickname ?? '');
  let notes = $state(init.notes ?? '');
  let std = $state(
    Object.fromEntries(STANDARD.map((k) => [k, { date: ev(k)?.date?.text ?? '', place: ev(k)?.place ?? '' }])) as Record<
      (typeof STANDARD)[number],
      { date: string; place: string }
    >,
  );
  let others = $state(
    (original?.events ?? [])
      .filter((e) => !(STANDARD as readonly string[]).includes(e.type))
      .map((e) => ({ orig: e as LifeEvent | undefined, type: e.type, date: e.date?.text ?? '', place: e.place ?? '' })),
  );

  let mode = $state<'form' | 'pick' | 'pick-family'>('form');
  let picked = $state<Person | undefined>();
  let confirmDelete = $state(false);
  let problem = $state('');

  const anchorName = $derived.by(() => {
    switch (relation.kind) {
      case 'father':
      case 'mother':
        return fullName(t.people.get(relation.childId));
      case 'spouse':
        return fullName(t.people.get(relation.personId));
      case 'child':
        return fullName(t.people.get(relation.parentId));
      default:
        return '';
    }
  });

  const heading = $derived(
    !isNew
      ? `Editar persona · RIN ${original!.rin}`
      : relation.kind === 'father'
        ? `Agregar padre de ${anchorName}`
        : relation.kind === 'mother'
          ? `Agregar madre de ${anchorName}`
          : relation.kind === 'spouse'
            ? `Agregar cónyuge de ${anchorName}`
            : relation.kind === 'child'
              ? `Agregar hijo/a de ${anchorName}`
              : 'Agregar persona sin vínculos',
  );

  const close = () => (app.dialog = undefined);

  function applyForm(tx: EditTx, id: string) {
    const p = tx.person(id);
    Object.assign(p, {
      sex,
      title: title.trim(),
      givenNames: givenNames.trim(),
      surname: surname.trim(),
      surname2: surname2.trim(),
      suffix: suffix.trim(),
      nickname: nickname.trim(),
      notes,
    });
    for (const k of STANDARD) setEvent(p.events, k, std[k].date, std[k].place);
    const kept = p.events.filter((e) => (STANDARD as readonly string[]).includes(e.type));
    for (const o of others) {
      const date = o.date.trim();
      const place = o.place.trim();
      const base: LifeEvent = o.orig ? structuredClone($state.snapshot(o.orig)) : { type: o.type };
      if (!date && !place && !base.note && !base.cause) continue;
      base.type = o.type;
      if (date) base.date = base.date?.text === o.date ? base.date : parseDate(o.date);
      else delete base.date;
      if (place) base.place = place;
      else delete base.place;
      kept.push(base);
    }
    p.events = kept;
  }

  function label(name: string) {
    return name || 'persona sin nombre';
  }

  function link(tx: EditTx, id: string, familyId?: string) {
    switch (relation.kind) {
      case 'father':
      case 'mother':
        linkParent(tx, relation.childId, id, relation.kind, familyId);
        break;
      case 'spouse':
        linkSpouse(tx, relation.personId, id, relation.familyId);
        break;
      case 'child':
        linkChild(tx, id, relation.parentId, relation.familyId);
        break;
    }
  }

  function save() {
    problem = '';
    if (!givenNames.trim() && !surname.trim() && !surname2.trim()) {
      problem = 'Escriba al menos un nombre o un apellido.';
      return;
    }
    const name = [title, givenNames, surname, surname2].filter((s) => s.trim()).join(' ');
    try {
      if (original) {
        app.edit(`Editar: ${label(name)}`, (tx) => applyForm(tx, original.id));
      } else {
        const newId = app.edit(`Agregar: ${label(name)}`, (tx) => {
          const id = addPerson(tx, { sex });
          applyForm(tx, id);
          link(tx, id);
          return id;
        });
        if (relation.kind === 'none') app.makePrimary(newId);
        else app.selectedId = newId;
      }
      close();
    } catch (e) {
      problem = String(e instanceof Error ? e.message : e);
    }
  }

  // --- Elegir persona existente ---
  const excludeIds = $derived.by(() => {
    switch (relation.kind) {
      case 'father':
      case 'mother':
        return [relation.childId];
      case 'spouse':
        return [relation.personId];
      case 'child':
        return [relation.parentId];
      default:
        return [];
    }
  });

  /** Matrimonios del padre/madre elegido donde podría encajar el hijo. */
  const familyOptions = $derived.by(() => {
    if (!picked || (relation.kind !== 'father' && relation.kind !== 'mother')) return [];
    const childId = relation.childId;
    const key = relation.kind === 'father' ? 'husbandId' : 'wifeId';
    return spouseFamilies(t, picked).filter((f) => f[key] === picked!.id && !f.childIds.includes(childId));
  });

  function pick(p: Person) {
    picked = p;
    if (familyOptions.length > 0) mode = 'pick-family';
    else linkExisting();
  }

  function linkExisting(familyId?: string) {
    problem = '';
    const p = picked!;
    try {
      app.edit(`Vincular: ${fullName(p)} como ${relationWord()} de ${anchorName}`, (tx) => link(tx, p.id, familyId));
      app.selectedId = p.id;
      close();
    } catch (e) {
      problem = String(e instanceof Error ? e.message : e);
      mode = 'form';
    }
  }

  function relationWord() {
    return { father: 'padre', mother: 'madre', spouse: 'cónyuge', child: 'hijo/a', none: '' }[relation.kind];
  }

  function remove() {
    if (!original) return;
    const name = fullName(original);
    app.edit(`Eliminar: ${label(name)}`, (tx) => deletePerson(tx, original.id), { trashPersonId: original.id });
    close();
  }

  function onkey(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.ctrlKey && mode === 'form') {
      e.preventDefault();
      save();
    }
  }
</script>

<Modal title={heading} onclose={close} wide>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div onkeydown={onkey}>
    {#if isNew && relation.kind !== 'none'}
      <p class="choice">
        {#if mode === 'form'}
          ¿Ya está en el archivo? <button type="button" class="linkbtn" onclick={() => (mode = 'pick')}>Elegir una persona existente…</button>
        {:else}
          <button type="button" class="linkbtn" onclick={() => (mode = 'form')}>← Volver a crear una persona nueva</button>
        {/if}
      </p>
    {/if}

    {#if mode === 'pick'}
      <PersonPicker onpick={pick} exclude={excludeIds} label="Buscar" />
    {:else if mode === 'pick-family' && picked}
      <p>{fullName(picked)} tiene {familyOptions.length === 1 ? 'un matrimonio' : 'varios matrimonios'}. ¿De cuál es hijo/a {anchorName}?</p>
      <div class="options">
        {#each familyOptions as f (f.id)}
          <button type="button" class="btn" onclick={() => linkExisting(f.id)}>
            Con {fullName(spouseIn(t, f, picked)) || 'cónyuge desconocido'}
          </button>
        {/each}
        <button type="button" class="btn" onclick={() => linkExisting()}>Otro / no se sabe</button>
      </div>
    {:else}
      <div class="grid names">
        <label for="pe-sex">Sexo</label>
        <select id="pe-sex" bind:value={sex}>
          <option value="M">Masculino</option>
          <option value="F">Femenino</option>
          <option value="U">Desconocido</option>
        </select>
        <label for="pe-title">Título</label>
        <input id="pe-title" bind:value={title} placeholder="Capitán, Fray, Doctor…" list="titles" />
        <label for="pe-given">Nombres</label>
        <input id="pe-given" bind:value={givenNames} data-autofocus />
        <label for="pe-sur">Apellido paterno</label>
        <input id="pe-sur" bind:value={surname} />
        <label for="pe-sur2">Apellido materno</label>
        <input id="pe-sur2" bind:value={surname2} />
        <label for="pe-nick">Apodo</label>
        <input id="pe-nick" bind:value={nickname} />
        <label for="pe-suffix">Sufijo</label>
        <input id="pe-suffix" bind:value={suffix} placeholder="Jr., hijo…" />
      </div>
      <datalist id="titles">
        {#each ['Capitán', 'Maestre de Campo', 'Doctor', 'General', 'Fray', 'Teniente', 'Alférez', 'Presbítero', 'Sargento Mayor', 'Coronel', 'Licenciado', 'Don', 'Doña'] as v}<option value={v}></option>{/each}
      </datalist>

      <h3>Eventos</h3>
      <div class="grid events">
        <span></span><span class="colhead">Fecha</span><span class="colhead">Lugar</span><span></span>
        {#each STANDARD as k}
          <label for="pe-{k}-date">{EVENT_LABELS[k]}</label>
          <DateField id="pe-{k}-date" label="Fecha de {EVENT_LABELS[k]}" bind:value={std[k].date} />
          <input aria-label="Lugar de {EVENT_LABELS[k]}" bind:value={std[k].place} list="places" />
          <span></span>
        {/each}
        {#each others as o, i}
          <select aria-label="Tipo de evento" bind:value={o.type}>
            {#if !OTHER_TYPES.includes(o.type)}<option value={o.type}>{EVENT_LABELS[o.type] ?? o.type}</option>{/if}
            {#each OTHER_TYPES as k}<option value={k}>{EVENT_LABELS[k]}</option>{/each}
          </select>
          <DateField id="pe-o{i}-date" label="Fecha" bind:value={o.date} />
          <input aria-label="Lugar o descripción" bind:value={o.place} list="places" />
          <button type="button" class="btn" aria-label="Quitar evento" onclick={() => others.splice(i, 1)}>✕</button>
        {/each}
      </div>
      <button type="button" class="linkbtn" onclick={() => others.push({ orig: undefined, type: 'OCCU', date: '', place: '' })}>＋ Otro evento</button>

      <h3><label for="pe-notes">Notas</label></h3>
      <textarea id="pe-notes" bind:value={notes} rows="9"></textarea>

      {#if original?.media.length}
        <h3>Fotos y documentos</h3>
        <ul class="media">
          {#each original.media as m}<li>{m.title || m.file} <small>({m.file}) — archivo aún no cargado</small></li>{/each}
        </ul>
      {/if}
    {/if}
    {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
  </div>

  {#snippet footer()}
    {#if confirmDelete}
      <span class="confirm">¿Eliminar a {fullName(original)}? Podrá recuperarla desde la Papelera durante 30 días.</span>
      <button type="button" class="btn danger" onclick={remove}>Sí, eliminar</button>
      <button type="button" class="btn" onclick={() => (confirmDelete = false)}>No</button>
    {:else}
      {#if original}
        <button type="button" class="btn danger left" onclick={() => (confirmDelete = true)}>Eliminar…</button>
      {/if}
      <button type="button" class="btn" onclick={close}>Cancelar</button>
      {#if mode === 'form'}
        <button type="button" class="btn primary" onclick={save} title="Ctrl+Enter">Guardar</button>
      {/if}
    {/if}
  {/snippet}
</Modal>

<style>
  .grid { display: grid; gap: 0.3em 0.6em; align-items: start; }
  .names { grid-template-columns: max-content minmax(0, 1fr) max-content minmax(0, 1fr); align-items: center; }
  .events { grid-template-columns: max-content minmax(0, 1fr) minmax(0, 1.3fr) 2.2em; }
  .events > label, .events > select { padding-top: 0.2em; }
  .colhead { font-size: 0.8em; color: var(--muted); }
  h3 { font-size: 1em; margin: 1em 0 0.4em; border-bottom: 1px solid var(--line-soft); }
  textarea { width: 100%; line-height: 1.5; resize: vertical; }
  .choice { margin: 0 0 0.8em; padding: 0.4em 0.6em; background: var(--info-bg); }
  .options { display: flex; flex-direction: column; gap: 0.4em; align-items: flex-start; }
  .problem { color: var(--warn-ink); background: var(--warn-bg); padding: 0.3em 0.6em; }
  .left { margin-right: auto; }
  .confirm { margin-right: auto; }
  .media small { color: var(--muted); }
  @media (max-width: 760px) {
    .names { grid-template-columns: max-content minmax(0, 1fr); }
    .events { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 2.2em; }
    .events > label, .events > select, .events > span:first-child { grid-column: 1 / -1; }
    .colhead { display: none; }
  }
</style>
