import { expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export const fixture = (name: string) =>
  fileURLToPath(new URL(`../tests/fixtures/${name}`, import.meta.url));

/** Abre la app vacía y carga un GEDCOM ficticio por el selector de archivo. */
export async function loadTree(page: Page, file = 'familia-ficticia.ged') {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Abrir archivo GEDCOM…' })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles(fixture(file));
  await expect(page.getByRole('navigation', { name: 'Vistas' })).toBeVisible();
}

export const primary = (page: Page) => page.locator('.primary [data-person]');
