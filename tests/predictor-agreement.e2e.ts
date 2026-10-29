import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

test('informational agreement retains contributors and missingness across layouts', { tags: ['predictors'], timeout: 120_000 }, async ({ app, screen, browser }) => {
  await skipTour(browser);
  await app.open('/tools/evidence-preview/index.html');
  await screen.getByRole('combobox', 'Evidence').selectOption('Predictors');
  const row = screen.getByTestId('predictor-local-agreement');
  await expect(row).toContainText('never change PP3 / BP4');
  await expect(row).toContainText('Not scored');
  for (const width of [1440, 800]) {
    await browser.setViewport({ width, height: 1000 });
    for (const theme of ['light', 'dark']) {
      const dark = await browser.evaluate(() => document.documentElement.classList.contains('dark'));
      if (dark !== (theme === 'dark')) await screen.getByRole('button', 'Switch theme').tap();
      await expect(row).toContainText('No sequence-preference reading');
      expect(await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await browser.evaluate(() => { document.querySelector('[data-testid="predictor-local-agreement"]')?.scrollIntoView({ block: 'center' }); return null; });
      await app.screenshot(`predictor-agreement-${width}-${theme}`);
    }
  }
  await screen.getByRole('combobox', 'Example').selectOption('Missing');
  await expect(row).toContainText('0 of');
  await expect(row).toContainText('No uncalibrated sequence-preference scores returned');
});

