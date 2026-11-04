# Seguridad

GeneaTree guarda datos de familias reales, incluidas personas vivas.

## Reportar una vulnerabilidad

No abra un issue público. Use **Security → Report a vulnerability** en este
repositorio (aviso privado de GitHub). Respondemos dentro de 7 días.

## Principios

- Los permisos se aplican en la base de datos (Row Level Security), no solo en la interfaz.
- Los lectores no ven fechas, lugares ni notas de personas vivas.
- Registro cerrado: solo por invitación del dueño del árbol.
- Ningún dato real se sube a este repositorio; las pruebas usan datos inventados.
- Claves con privilegios (`service_role`) solo en el equipo local o en secretos de GitHub.
