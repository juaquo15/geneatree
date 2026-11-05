import { expect, test, type Page } from '@playwright/test';
import { loadTree, primary } from './helpers';

const dialog = (page: Page) => page.getByRole('dialog');
const save = (page: Page) => dialog(page).getByRole('button', { name: 'Guardar' }).click();

test.beforeEach(async ({ page }) => {
  await loadTree(page);
  await page.getByRole('button', { name: 'Entendido' }).click();
});

test('F-10 editar nombre de una persona', async ({ page }) => {
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toContainText('Editar persona · RIN 1');
  await expect(page.getByLabel('Nombres', { exact: true })).toBeFocused();
  await page.getByLabel('Nombres', { exact: true }).fill('Juan Pedro');
  await save(page);
  await expect(dialog(page)).toBeHidden();
  await expect(primary(page)).toContainText('Juan Pedro Ficticio Inventado');
  await expect(page.getByText('Guardado ✓')).toBeVisible();
});

test('F-11 la fecha se interpreta en vivo y lo no entendido se avisa', async ({ page }) => {
  await page.keyboard.press('Enter');
  const death = page.getByLabel('Fecha de Defunción', { exact: true });
  await death.fill('Por 1990');
  await expect(dialog(page)).toContainText('✓ aproximadamente 1990');
  await death.fill('20-VII-1990');
  await expect(dialog(page)).toContainText('✓ 20 de julio de 1990');
  await death.fill('en invierno');
  await expect(dialog(page)).toContainText('No se entiende como fecha; se guardará tal cual');
  await save(page);
  // Se guardó tal cual y aparece en "Fechas por revisar"
  await expect(page.getByRole('button', { name: 'Fechas por revisar (2)' })).toBeVisible();
});

test('F-12 agregar madre nueva con apellido sugerido', async ({ page }) => {
  await page.getByRole('button', { name: '＋ Agregar madre' }).click();
  await expect(dialog(page)).toContainText('Agregar madre de Juan Pablo Ficticio Inventado');
  // Costumbre hispana: el apellido de la madre es el materno del hijo
  await expect(page.getByLabel('Apellido paterno', { exact: true })).toHaveValue('Inventado');
  await expect(page.getByLabel('Sexo', { exact: true })).toHaveValue('F');
  await page.getByLabel('Nombres', { exact: true }).fill('Rosa');
  await save(page);
  await expect(page.locator('.mom')).toContainText('Rosa Inventado');
  // Completa la familia existente (con el padre), no crea otra
  await page.keyboard.press('m');
  await expect(page.locator('.spouse')).toContainText('Capitán Diego Antiguo');
});

test('F-13 agregar hijo nuevo y reordenar hijos', async ({ page }) => {
  await page.getByRole('button', { name: '＋ Agregar hijo/a' }).click();
  await expect(page.getByLabel('Apellido paterno', { exact: true })).toHaveValue('Ficticio');
  await expect(page.getByLabel('Apellido materno', { exact: true })).toHaveValue('Ejemplo');
  await page.getByLabel('Nombres', { exact: true }).fill('Ana');
  await save(page);
  const kids = page.locator('.children-list .kname');
  await expect(kids).toHaveText(['Pedro Ficticio Ejemplo', 'Ana Ficticio Ejemplo']);
  await page.locator('.children-list').getByText('Pedro Ficticio Ejemplo').click();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(kids).toHaveText(['Ana Ficticio Ejemplo', 'Pedro Ficticio Ejemplo']);
});

test('F-14 vincular persona existente como padre, eligiendo el matrimonio', async ({ page }) => {
  await page.keyboard.press('Control+f');
  await page.getByLabel('Buscar', { exact: true }).fill('jose hijo');
  await expect(dialog(page)).toContainText('José Hijo Jr.');
  await page.keyboard.press('Enter');
  await expect(primary(page)).toContainText('José Hijo Jr.');

  await page.getByRole('button', { name: '＋ Agregar padre' }).click();
  await dialog(page).getByRole('button', { name: 'Elegir una persona existente…' }).click();
  await page.getByLabel('Buscar', { exact: true }).fill('antiguo');
  await dialog(page).getByRole('button', { name: /Capitán Diego Antiguo/ }).click();
  await expect(dialog(page)).toContainText('¿De cuál es hijo/a José Hijo Jr.?');
  await dialog(page).getByRole('button', { name: 'Con cónyuge desconocido' }).click();

  await expect(page.locator('.dad')).toContainText('Capitán Diego Antiguo');
  await page.keyboard.press('f');
  await expect(page.locator('.children-list')).toContainText('Juan Pablo Ficticio Inventado');
  await expect(page.locator('.children-list')).toContainText('José Hijo Jr.');
});

test('F-15 eliminar persona y restaurarla desde la papelera', async ({ page }) => {
  await page.locator('.children-list').getByText('Pedro Ficticio Ejemplo').dblclick();
  await dialog(page).getByRole('button', { name: 'Eliminar…' }).click();
  await expect(dialog(page)).toContainText('Podrá recuperarla desde la Papelera');
  await dialog(page).getByRole('button', { name: 'Sí, eliminar' }).click();
  await expect(page.locator('.children-list')).not.toContainText('Pedro');

  await page.getByRole('button', { name: 'Papelera' }).click();
  await expect(dialog(page)).toContainText('Pedro Ficticio Ejemplo');
  await dialog(page).getByRole('button', { name: 'Restaurar' }).click();
  await expect(primary(page)).toContainText('Pedro Ficticio Ejemplo');
  await expect(page.locator('.dad')).toContainText('Juan Pablo');
  await expect(page.locator('.mom')).toContainText('María Ejemplo Prueba');
});

test('F-16 deshacer con Ctrl+Z', async ({ page }) => {
  await page.keyboard.press('Enter');
  await page.getByLabel('Nombres', { exact: true }).fill('Otro Nombre');
  await save(page);
  await expect(primary(page)).toContainText('Otro Nombre');
  await page.keyboard.press('Control+z');
  await expect(primary(page)).toContainText('Juan Pablo Ficticio Inventado');
  await expect(page.getByText('Se deshizo: Editar: Otro Nombre Ficticio Inventado')).toBeVisible();
  await expect(page.getByRole('button', { name: '↶ Deshacer' })).toBeDisabled();
});

test('F-17 los cambios sobreviven a recargar la página', async ({ page }) => {
  await page.getByRole('button', { name: '＋ Agregar hijo/a' }).click();
  await page.getByLabel('Nombres', { exact: true }).fill('Persistente');
  await save(page);
  // La selección queda en el hijo nuevo; Inicio vuelve a la persona principal.
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await page.getByLabel('Notas', { exact: true }).fill('Nota editada.');
  await save(page);
  await expect(page.getByText('Guardado ✓')).toBeVisible();
  await page.reload();
  await expect(page.locator('.children-list')).toContainText('Persistente Ficticio Ejemplo');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Notas', { exact: true })).toHaveValue('Nota editada.');
});

test('F-18 buscar dentro de las notas', async ({ page }) => {
  await page.keyboard.press('c');
  await page.keyboard.press('Control+f');
  await page.getByLabel('Buscar', { exact: true }).fill('no existe');
  const hit = dialog(page).getByRole('button', { name: /Juan Pablo Ficticio Inventado/ });
  await expect(hit).toContainText('Nota:');
  await expect(hit.locator('mark')).toHaveText('no existe');
  await page.keyboard.press('Enter');
  await expect(primary(page)).toContainText('Juan Pablo Ficticio Inventado');
});

test('F-19 corregir una fecha por revisar', async ({ page }) => {
  await page.getByRole('button', { name: 'Fechas por revisar (1)' }).click();
  await expect(dialog(page)).toContainText('La Serena');
  await dialog(page).getByRole('button', { name: /Capitán Diego Antiguo/ }).click();
  await expect(page.getByLabel('Fecha de Defunción', { exact: true })).toHaveValue('La Serena');
  await page.getByLabel('Fecha de Defunción', { exact: true }).fill('1950');
  await page.getByLabel('Lugar de Defunción', { exact: true }).fill('La Serena');
  await save(page);
  await expect(page.getByRole('button', { name: /Fechas por revisar/ })).toBeHidden();
});

test('editar matrimonio desde la vista Familia', async ({ page }) => {
  await page.locator('button.marriage').click();
  await expect(dialog(page)).toContainText('Familia · MRIN 1');
  await page.getByLabel('Fecha de matrimonio', { exact: true }).fill('12 Feb 1951');
  await save(page);
  await expect(page.locator('.marriage')).toContainText('12 Feb 1951');
});
