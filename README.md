# GeneaTree

Árbol genealógico web, liviano y que funciona sin conexión, inspirado en
**Personal Ancestral File (PAF 5)**, el programa de FamilySearch descontinuado en 2013.

El objetivo es que quien usó PAF por años encuentre las mismas pantallas y atajos
(vistas Familia, Pedigrí e Individuos; teclas F, M, C, Ctrl+S, Ctrl+Inicio),
pero en el navegador, con respaldo en la nube y acceso de lectura para la familia.

## Estado

Fase 1 (prototipo local):

- [x] Importador GEDCOM 5.5 probado con un archivo real de 32.497 personas
- [x] Fechas escritas a mano en español ("4 Ago 1924", "Por 1792", "20-VII-1716"…);
      el texto original siempre se conserva
- [x] Apellido materno guardado por PAF como sufijo (`NSFX`) → campo propio
- [x] Vistas Familia, Pedigrí (5 generaciones) e Individuos (lista virtual + búsqueda)
- [x] Copia local en IndexedDB: abre sin conexión y sin reimportar
- [x] Edición: personas, familias, notas, papelera, deshacer, búsqueda en notas
- [ ] Sincronización con Supabase (roles dueño / editor / lector, RLS)
- [ ] Fotos, reportes imprimibles, exportar GEDCOM, detección de duplicados

## Uso local

```sh
npm install
npm run dev
```

Demo: https://geneatree.pages.dev · Local: abra http://localhost:5173 y cargue un archivo `.ged`
(en PAF: *File → Export → GEDCOM 5.5*). Los datos se procesan y guardan
**solo en su navegador**.

## Pruebas

```sh
npm test
# opcional, contra un archivo real que NUNCA se sube al repo:
GED_PATH=/ruta/a/archivo.ged npm test
```

## Privacidad y seguridad

- Los archivos `.paf`, `.ged` y las fotos están en `.gitignore`. Las pruebas usan
  solo datos inventados (`tests/fixtures`).
- Los árboles contienen datos de personas vivas. Cuando exista la versión en la nube,
  los lectores no verán fechas ni lugares de personas vivas, y los permisos se
  aplicarán en la base de datos (Row Level Security), no solo en la interfaz.
- Política de seguridad de contenido (CSP) estricta: sin scripts externos.

## Licencia

[GNU AGPL-3.0](LICENSE). Si alguien publica una versión modificada como servicio web,
debe compartir su código.
