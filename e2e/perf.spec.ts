import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';

// P-01: rendimiento con el árbol real en un "computador lento" (CPU ×6 más lenta).
// Solo corre localmente:  GED_PATH=/ruta/archivo.ged npm run test:e2e -- perf
const GED = process.env.GED_PATH;
test.skip(!GED || !existsSync(GED), 'requiere GED_PATH con un archivo real');
test.setTimeout(180_000);

const BUDGET = {
  openFromCache: 3000,
  navigate: 150,
  searchNotes: 1500,
  saveEdit: 500,
};

test('P-01 metas de rendimiento con CPU ×6', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const results: Record<string, number> = {};
  const primary = page.locator('.primary [data-person]');

  await page.goto('/');
  let t0 = Date.now();
  await page.locator('input[type=file]').setInputFiles(GED!);
  await expect(primary).toBeVisible({ timeout: 60_000 });
  results.importFast = Date.now() - t0;
  await expect(page.getByText('Guardando…')).toBeHidden({ timeout: 120_000 });
  results.importAndSaveFast = Date.now() - t0;
  page.on('console', (m) => m.text().startsWith('[GeneaTree]') && console.log(m.text()));

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });

  t0 = Date.now();
  await page.reload();
  await expect(primary).toBeVisible({ timeout: 30_000 });
  results.openFromCache = Date.now() - t0;

  // Navegación medida dentro de la página: tecla → pantalla redibujada.
  const before = await primary.innerText();
  results.navigate = await page.evaluate(async () => {
    const t = performance.now();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Math.round(performance.now() - t);
  });
  await expect(primary).not.toHaveText(before);

  await page.keyboard.press('Control+f');
  const q = page.getByLabel('Buscar', { exact: true });
  await q.fill('angamos');
  t0 = Date.now();
  await expect(page.getByRole('dialog').locator('mark').first()).toBeVisible({ timeout: 30_000 });
  results.searchNotes = Date.now() - t0 - 200; // menos la espera intencional al teclear
  await page.keyboard.press('Escape');

  await page.keyboard.press('Enter');
  const notes = page.getByLabel('Notas', { exact: true });
  await notes.fill((await notes.inputValue()) + ' ');
  t0 = Date.now();
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Guardado ✓')).toBeVisible({ timeout: 30_000 });
  results.saveEdit = Date.now() - t0;
  // dejar el árbol como estaba
  await page.keyboard.press('Control+z');

  console.log('P-01 (ms):', JSON.stringify(results));
  for (const [k, max] of Object.entries(BUDGET)) {
    expect.soft(results[k], `${k} ≤ ${max} ms`).toBeLessThanOrEqual(max);
  }
});
