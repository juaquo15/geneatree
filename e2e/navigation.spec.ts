import { expect, test } from '@playwright/test';
import { loadTree, primary } from './helpers';

test.beforeEach(async ({ page }) => {
  await loadTree(page);
});

test('F-04 vista Familia muestra padres, cónyuge, hijos y matrimonio', async ({ page }) => {
  await expect(primary(page)).toContainText('Juan Pablo Ficticio Inventado');
  await expect(primary(page)).toContainText('4 Ago 1924 - Pueblo Imaginario');
  await expect(page.locator('.dad')).toContainText('Capitán Diego Antiguo');
  await expect(page.locator('.mom')).toContainText('＋ Agregar madre');
  await expect(page.locator('.spouse')).toContainText('María Ejemplo Prueba');
  await expect(page.locator('.marriage')).toContainText('Entre 1950 y 1952');
  await expect(page.locator('.children-list')).toContainText('Pedro Ficticio Ejemplo');
  await expect(page.locator('.statusbar')).toContainText('RIN: 1');
});

test('F-05 teclas de PAF: F, C, Ctrl+Inicio, Ctrl+S', async ({ page }) => {
  await page.keyboard.press('f');
  await expect(primary(page)).toContainText('Capitán Diego Antiguo');
  await page.keyboard.press('Control+Home');
  await expect(primary(page)).toContainText('Juan Pablo');
  await page.keyboard.press('c');
  await expect(primary(page)).toContainText('Pedro Ficticio Ejemplo');
  // C desde el padre vuelve al último hijo visitado
  await page.keyboard.press('f');
  await page.keyboard.press('c');
  await expect(primary(page)).toContainText('Pedro');
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('button', { name: 'Pedigrí' })).toHaveAttribute('aria-current', 'true');
});

test('F-06 Pedigrí muestra antepasados y navega con flechas', async ({ page }) => {
  await page.getByRole('button', { name: 'Pedigrí' }).click();
  const tree = page.getByRole('region', { name: 'Vista de pedigrí' });
  await expect(tree).toContainText('Juan Pablo Ficticio Inventado');
  await expect(tree).toContainText('Capitán Diego Antiguo');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.statusbar')).toContainText('RIN: 4');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.statusbar')).toContainText('RIN: 1');
});

test('F-07 Individuos: búsqueda por apellido y por RIN', async ({ page }) => {
  await page.getByRole('button', { name: 'Individuos' }).click();
  await expect(page.getByText('5 personas', { exact: true })).toBeVisible();
  const search = page.getByLabel('Buscar');
  await search.fill('ejemplo');
  await expect(page.locator('.statusbar')).toContainText('RIN: 2');
  await page.getByRole('button', { name: 'RIN', exact: true }).click();
  await search.fill('3');
  await expect(page.locator('.statusbar')).toContainText('RIN: 3');
  await search.press('Enter');
  await expect(primary(page)).toContainText('Pedro Ficticio Ejemplo');
});

test('F-08 recargar conserva el árbol (IndexedDB)', async ({ page }) => {
  await page.reload();
  await expect(primary(page)).toContainText('Juan Pablo Ficticio Inventado');
});

test('Enter abre el editor con las notas; Esc lo cierra', async ({ page }) => {
  await page.keyboard.press('Enter');
  const dlg = page.getByRole('dialog');
  await expect(page.getByLabel('Notas', { exact: true })).toHaveValue('Nació en un pueblo que no existe.\nSegunda línea de la nota.');
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
});
