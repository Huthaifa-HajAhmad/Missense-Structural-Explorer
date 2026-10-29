import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

test('splicing presents channels once and exposes junction context', async ({ app, screen, browser }) => {
  await skipTour(browser);
  await app.open('/tools/evidence-preview/index.html');
  await screen.getByRole('combobox', 'Evidence').selectOption('RNA splicing');
  await screen.getByRole('combobox', 'Example').selectOption('Zero');
  await expect(screen.getByTestId('predicted-sites')).toBeVisible();
  expect(await browser.evaluate(() => document.querySelectorAll('.spl-channels, .spl-map__quiet').length)).toBe(0);
  await expect(screen.getByRole('region', 'dbscSNV context')).toContainText('dbscSNV');
  expect(await browser.evaluate(() => {
    const card = document.querySelector('.spl-inspection')!;
    const head = card.querySelector('.spl-inspection__head')!;
    const c = card.getBoundingClientRect(), h = head.getBoundingClientRect();
    return Math.abs(h.left - c.left) <= 1 && Math.abs(h.right - c.right) <= 1 && Math.abs(h.top - c.top) <= 1;
  })).toBe(true);
  for (const width of [1440, 800]) {
    await browser.setViewport({ width, height: 1000 });
    for (const theme of ['light', 'dark']) {
      const dark = await browser.evaluate(() => document.documentElement.classList.contains('dark'));
      if (dark !== (theme === 'dark')) await screen.getByRole('button', 'Switch theme').tap();
      expect(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await app.screenshot(`splicing-${width}-${theme}`);
    }
  }
});
