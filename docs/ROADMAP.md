# Plan de desarrollo: GeneaTree

**Meta:** entregar a un usuario de PAF 5 (regalo de Navidad, **25 dic 2026**) una app web
que se sienta como PAF, con sus ~32.500 personas en la nube, usable sin conexión y
con respaldo automático.

**Restricción clave:** el usuario final no podrá validar antes de la entrega. Por eso
cada fase tiene criterios de aceptación verificables por test o comparando contra PAF 5
(instalado en el equipo de desarrollo), en vez de depender de su opinión.

Estado: ✅ hecho · 🔜 siguiente · ⬜ pendiente

---

## Calendario

| Semana | Fechas | Hito |
|---|---|---|
| 1 | 3–9 nov | **H0** Fundaciones: CI, tests e2e, publicación |
| 2–3 | 10–23 nov | **H1** Edición completa (local) |
| 3–4 | 17–30 nov | **H2** Backend Supabase: esquema, RLS, login, migración |
| 5 | 1–7 dic | **H3** Sincronización offline + app instalable |
| 6 | 8–14 dic | **H4** Fotos, reportes imprimibles, exportar GEDCOM |
| 7 | 15–21 dic | **H5** Endurecimiento: seguridad, rendimiento, aceptación |
| 8 | 22–25 dic | **H6** Entrega |
| — | 2027 | **H7** Después de Navidad |

Si algo se atrasa, se recorta en este orden: H4 reportes → H4 fotos → H3 instalable.
**Nunca** se recorta: RLS, respaldos, ni la importación final de datos.

---

## H0 · Fundaciones (3–9 nov)

- ✅ Importador GEDCOM con prueba contra el archivo real (32.497 / 12.431)
- ✅ Vistas Familia, Pedigrí, Individuos; ficha de persona; IndexedDB
- ✅ CI en GitHub Actions: tipos, tests, build, auditoría, secretos, guardia de datos
- ✅ Dependabot y `SECURITY.md`
- ✅ Repo público y demo en https://juaquo15.github.io/geneatree/ (**sin datos**: cada visitante carga su propio GEDCOM)
- ✅ Tests e2e con Playwright sobre `tests/fixtures` (F-04..F-08, S-04, S-05), también en CI
- ⬜ Fijar acciones de GitHub por SHA (Dependabot las mantiene)

**Aceptación:** CI verde en `main`; la demo pública abre y carga el GEDCOM ficticio.

## H1 · Edición (10–23 nov)

Todo local primero (IndexedDB); la nube llega en H2/H3 sin cambiar la UI.

- ⬜ Pantalla "Editar individuo" al estilo PAF: nombres, apellido paterno/materno,
  título, sexo, eventos (nacimiento, bautizo, defunción, sepultación + otros)
- ⬜ Campo fecha con interpretación en vivo ("4 Ago 1924 → 4 de agosto de 1924 ✓")
  y aviso si no se entiende (se guarda igual, como hoy)
- ⬜ Editor de notas grande, con búsqueda dentro de la nota
- ⬜ Agregar: padre, madre, cónyuge, hijo; persona sin vínculos
- ⬜ Vincular/desvincular existentes (con búsqueda), ordenar hijos
- ⬜ Eliminar persona/familia con confirmación y papelera (recuperable 30 días)
- ⬜ Deshacer (Ctrl+Z) de la última acción
- ⬜ Registro de cambios local (quién, qué, cuándo, valor anterior)
- ⬜ Lista "Fechas por revisar" (hoy 79) con salto a la persona
- ⬜ Búsqueda que incluya notas (Ctrl+F) con resultados resaltados

**Aceptación:** catálogo F-10 a F-19 verde; se puede reproducir en la app, sin mouse,
la creación de una familia de 3 generaciones hecha en PAF y el resultado coincide.

## H2 · Backend Supabase (17–30 nov)

Dos proyectos gratuitos: **`geneatree-prod`** (datos reales) y **`geneatree-test`**
(solo datos ficticios, para CI). Las claves `service_role` nunca salen del equipo
local ni de los secretos de GitHub.

- ⬜ Esquema SQL versionado en `supabase/migrations/`:
  `trees`, `tree_members (tree_id, user_id, role: owner|editor|viewer)`,
  `persons`, `families`, `family_children`, `events`, `media`, `change_log`
- ⬜ RLS en **todas** las tablas; ninguna tabla accesible a `anon`
- ⬜ Privacidad de vivos: los `viewer` ven a una persona viva solo como
  "Persona viva" + vínculos (sin fechas, lugares ni notas). Regla: sin defunción y
  nacida hace < 110 años, o sin fechas pero con descendientes/padres recientes
- ⬜ Login con correo + contraseña, sesión larga ("recordarme"); **registro
  cerrado** (solo por invitación del dueño)
- ⬜ Script local `scripts/migrate.ts`: GEDCOM → Supabase, idempotente por `_UID`
  (se puede repetir sin duplicar)
- ⬜ Acción programada (GitHub Actions, cada 3 días) que hace una consulta liviana
  para que el proyecto gratuito no se pause
- ⬜ Respaldo semanal: exportar a GEDCOM y guardar en un bucket privado (y copia
  descargable por el dueño desde la app)

**Aceptación:** catálogo S-01 a S-12 verde contra `geneatree-test`; migración del
archivo real a `prod` con conteos idénticos (personas, familias, eventos, notas).

## H3 · Sincronización offline (1–7 dic)

- ⬜ Cola de cambios en IndexedDB; envío al reconectar; reintentos con espera
- ⬜ Descarga incremental por `updated_at`
- ⬜ Conflictos: último en escribir gana **por campo**, con el valor perdido
  guardado en `change_log` (un solo editor real ⇒ conflictos raros)
- ⬜ Indicador visible: "Guardado", "Sin conexión — 3 cambios pendientes"
- ⬜ PWA: manifest, service worker, icono; instalable desde Chrome/Edge
- ⬜ Arranque rápido: abrir desde IndexedDB primero, sincronizar después

**Aceptación:** F-30 a F-35 verde (incluye editar sin red, cerrar, reabrir y sincronizar).

## H4 · Fotos, reportes, exportación (8–14 dic)

- ⬜ Cargador masivo: elegir la carpeta `genes\` y emparejar con las 286 rutas
  `OBJE` del GEDCOM; reducir tamaño en el navegador antes de subir
- ⬜ Bucket privado; URLs firmadas de corta duración; foto principal en la ficha
- ⬜ Reportes con CSS de impresión: hoja de grupo familiar, árbol de antepasados
  (4–5 gen.), descendientes, ficha individual con notas
- ⬜ Exportar GEDCOM 5.5 (vuelve a poner el materno en `NSFX` para compatibilidad)

**Aceptación:** prueba de ida y vuelta (F-40): importar → exportar → importar da los
mismos datos; el GEDCOM exportado abre en PAF 5 sin errores.

## H5 · Endurecimiento (15–21 dic)

- ⬜ Revisión de seguridad completa (catálogo S-*), incluida revisión manual de políticas RLS
- ⬜ Rendimiento en "computador lento": Chrome con CPU ×6 más lenta.
  Metas: abrir < 3 s desde caché, cambiar de persona < 100 ms, buscar < 200 ms
- ⬜ Accesibilidad: todo usable con teclado, contraste AA, letra 20 px por defecto
- ⬜ Prueba de aceptación completa contra PAF (A-*), con capturas lado a lado
- ⬜ Guía de una página en español, letra grande, imprimible (va con el regalo)

## H6 · Entrega (22–25 dic)

1. Pedir al usuario un **último export GEDCOM** de PAF (él sigue editando hasta entonces)
2. `scripts/migrate.ts` a `prod`; verificar conteos contra el diálogo de PAF
3. Crear su cuenta (rol `owner`); instalar la app en su Chrome/Edge; dejar sesión iniciada
4. Mantener PAF instalado como respaldo durante enero
5. Entregar la guía impresa

## H7 · Después de Navidad

Invitar lectores · detección y fusión de duplicados · unificar lugares repetidos ·
vista de descendencia · búsqueda fonética (Soundex) · reportes adicionales.

---

## Catálogo de tests

### Funcionales (Vitest = unidad, Playwright = e2e con datos ficticios)

| ID | Qué se prueba | Tipo | Estado |
|---|---|---|---|
| F-01 | Fechas: 47 formatos reales en español se interpretan; los inválidos no inventan fecha | unidad | ✅ |
| F-02 | Importador: conteos, NSFX→materno, NPFX→título, CONC/CONT, `_UID`, tags conservados | unidad | ✅ |
| F-03 | Importador contra archivo real (solo local, `GED_PATH`) sin referencias rotas | unidad | ✅ |
| F-04 | Vista Familia muestra padres, cónyuge, hijos y matrimonio del fixture | e2e | ✅ |
| F-05 | Teclas F, M, C, Inicio, Ctrl+Inicio, Ctrl+S navegan como PAF | e2e | ✅ |
| F-06 | Pedigrí: 5 generaciones, flechas de continuación, RePág/AvPág | e2e | ✅ |
| F-07 | Individuos: orden por nombre/RIN, búsqueda por apellido y RIN | e2e | ✅ |
| F-08 | Recargar la página conserva el árbol (IndexedDB) | e2e | ✅ |
| F-10–19 | Edición: crear, editar, vincular, eliminar, deshacer, papelera | e2e | ⬜ |
| F-30–35 | Offline: editar sin red, reabrir, sincronizar, resolver conflicto | e2e | ⬜ |
| F-40 | Ida y vuelta GEDCOM sin pérdida | unidad | ⬜ |
| F-41 | Migración idempotente: correrla dos veces no duplica | integración | ⬜ |
| P-01 | Rendimiento con 32k personas sintéticas y CPU ×6 dentro de metas | e2e | ⬜ |

### Seguridad

| ID | Qué se prueba | Cómo | Estado |
|---|---|---|---|
| S-01 | Ningún `.ged`/`.paf`/foto real entra al repo | CI (guardia de rutas) | ✅ |
| S-02 | Sin secretos en el historial | CI (gitleaks) | ✅ |
| S-03 | Dependencias sin vulnerabilidades altas/críticas | CI (`npm audit`) + Dependabot | ✅ |
| S-04 | XSS: una nota GEDCOM con `<script>`, `<img onerror>` o `javascript:` se muestra como texto | e2e | ✅ |
| S-05 | CSP activa: sin scripts inline ni externos; `connect-src` solo a Supabase | e2e | ✅ (falta agregar Supabase en H2) |
| S-06 | Usuario anónimo no lee ninguna tabla | integración (`geneatree-test`) | ⬜ |
| S-07 | Usuario de otro árbol no lee ni escribe este árbol | integración | ⬜ |
| S-08 | `viewer` no puede escribir; no ve fechas/lugares/notas de vivos | integración | ⬜ |
| S-09 | `editor` no puede cambiar roles ni borrar el árbol | integración | ⬜ |
| S-10 | Registro público deshabilitado; invitación expira | integración | ⬜ |
| S-11 | Fotos: bucket privado, URL firmada expira, sin listado público | integración | ⬜ |
| S-12 | `change_log` no editable por usuarios (solo inserción vía trigger) | integración | ⬜ |
| S-13 | Archivo GEDCOM malicioso (enorme, niveles absurdos, refs circulares) no cuelga la app | unidad | ⬜ |
| S-14 | La clave `service_role` no aparece en el bundle publicado | CI (busca en `dist/`) | ⬜ |
| S-15 | Revisión manual de RLS + `/security-review` antes de entregar | manual | ⬜ |

### Aceptación contra PAF (sustituye la validación del usuario)

| ID | Escenario | Estado |
|---|---|---|
| A-01 | 10 personas al azar: nombre, fechas, lugares y notas idénticos a PAF | ⬜ |
| A-02 | Misma navegación F/M/C desde RIN 1 lleva a las mismas personas que en PAF | ⬜ |
| A-03 | Personas con 2+ cónyuges y adoptados se muestran como en PAF | ⬜ |
| A-04 | Conteo final en la nube = diálogo de exportación de PAF | ⬜ |
| A-05 | Uso completo solo con teclado de una sesión típica (buscar, ver, editar nota) | ⬜ |

---

## Decisiones tomadas

- **Svelte 5 + Vite + TypeScript**: el bundle más liviano (~30 KB gzip hoy).
- **Supabase gratis + ping programado**; frontend en **GitHub Pages** (gratis, sin dominio).
- **AGPL-3.0**.
- Nunca se pierde lo escrito: fechas como texto original + interpretación; tags
  desconocidos guardados en `extra`.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El usuario sigue editando PAF hasta Navidad | Migración idempotente; se reimporta el último export el 22–24 dic |
| Proyecto Supabase gratuito se pausa | Ping cada 3 días + alerta si falla |
| Computador lento | Presupuesto de rendimiento P-01 en CI; listas virtuales; Web Worker |
| Correo de login no llega (SMTP gratuito limitado) | Contraseña en vez de enlace mágico; sesión larga |
| Pérdida de datos | Respaldo semanal GEDCOM + IndexedDB local + PAF conservado en enero |
| Fotos no disponibles a tiempo | H4 fotos es recortable; las rutas quedan guardadas para después |
