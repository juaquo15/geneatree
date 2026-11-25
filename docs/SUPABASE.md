# Supabase: puesta en marcha y migración

Pasos manuales que necesitan una cuenta de Supabase. Todo lo que se puede
probar sin ella ya está cubierto por los tests (`tests/db/`, PGlite).

## 1. Proyectos

Crear dos proyectos gratuitos: `geneatree-test` (solo datos ficticios) y
`geneatree-prod` (datos reales). En ambos:

- **Authentication → Sign In / Providers → Email**: activar correo + contraseña y
  **desactivar "Allow new users to sign up"** (registro solo por invitación).

## 2. Esquema

Aplicar en orden los archivos de `supabase/migrations/`, en el SQL Editor del
panel o con la CLI de Supabase (`supabase link` + `supabase db push`).

## 3. Secretos para el ping (`.github/workflows/keepalive.yml`)

En GitHub → Settings → Secrets and variables → Actions, del proyecto `prod`:

- `SUPABASE_URL`: `https://<ref>.supabase.co`
- `SUPABASE_ANON_KEY`: la clave pública *anon* (**nunca** la `service_role`)

Probarlo con *Actions → Supabase despierto → Run workflow*. GitHub desactiva
las acciones programadas tras 60 días sin commits en el repo: si eso pasa,
reactivarla desde la misma pantalla.

## 4. Migrar el GEDCOM

La cadena de conexión está en *Project Settings → Database → Connection string*
(conexión directa o *session pooler*, puerto 5432). Salta RLS: tratarla como una
contraseña y pasarla solo por entorno.

```sh
# Una sola vez: invitar al dueño desde Authentication → Users → Invite.
read -rs DATABASE_URL && export DATABASE_URL

# Primera carga: crea el árbol, deja al dueño y muestra el id del árbol.
npm run migrate -- --file export.ged --new-tree "Familia" --owner correo@ejemplo.com --dry-run
npm run migrate -- --file export.ged --new-tree "Familia" --owner correo@ejemplo.com

# Con un export más nuevo de PAF (solo escribe lo que cambió):
npm run migrate -- --file export-nuevo.ged --tree <id> [--prune]
```

- Todo va en una transacción: si algo falla o los conteos (personas, familias,
  hijos, eventos, fotos, notas) no coinciden con el GEDCOM, no se guarda nada.
- Si en la base hay personas que ya no están en el GEDCOM, avisa y no guarda;
  `--prune` las manda a la papelera (`deleted_at`), de donde vuelven solas si
  reaparecen en un export posterior.
- La importación no queda en `change_log` (use `--keep-log` para conservarla).
- Comparar los conteos con el diálogo de exportación de PAF (aceptación A-04).
