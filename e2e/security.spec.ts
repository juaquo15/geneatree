import { expect, test } from '@playwright/test';
import { loadTree, primary } from './helpers';

declare global {
  interface Window {
    __xss?: number;
    __inline?: number;
  }
}

test('S-04 contenido malicioso en el GEDCOM se muestra como texto', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await loadTree(page, 'xss.ged');

  await expect(primary(page)).toContainText('<img src=x onerror="window.__xss=1">');
  await primary(page).dblclick();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText('<script>window.__xss=4</script>');
  await expect(sheet).toContainText('javascript:window.__xss=3');
  // Nada del contenido se convirtió en elementos HTML
  await expect(sheet.locator('img, script, svg, a[href^="javascript"], b')).toHaveCount(0);
  await page.getByText('<b onmouseover').hover();
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(dialogs).toEqual([]);
});

test('S-05 la CSP bloquea scripts inline y conexiones externas', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await page.goto('/');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toContain("'unsafe-eval'");

  await page.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__inline = 1';
    document.body.appendChild(s);
  });
  expect(await page.evaluate(() => window.__inline)).toBeUndefined();

  const external = await page.evaluate(() =>
    fetch('https://example.com/').then(
      () => 'permitido',
      () => 'bloqueado',
    ),
  );
  expect(external).toBe('bloqueado');
  expect(violations.length).toBeGreaterThan(0);
});
