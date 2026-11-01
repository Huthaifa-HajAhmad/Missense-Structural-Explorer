import { readFileSync } from 'node:fs';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from '../support.js';

// A committed, redacted snapshot of the live GATA4 provider result. Keeping it in source control
// makes this proof runnable on a clean checkout; the live capture itself stays under `.e2e/` as
// regenerable evidence, not as the test's only input.
const result = JSON.parse(readFileSync('tests/fixtures/predictor-gata4.json', 'utf8'));

test('GATA4 provider scores remain visible and inspectable across predictor views', { tags: ['predictors'], timeout: 120_000 }, async ({ app, screen, browser }) => {
  await skipTour(browser);
  await browser.addInitScript((payload) => {
    if (location.protocol === 'http:' || location.protocol === 'https:') sessionStorage.setItem('predictor-proof-result', JSON.stringify(payload));
  }, result);
  await app.open('/tools/predictor-proof/index.html');
  const selected = screen.getByRole('region', 'Selected evidence reading');
  const outside = browser.locator('.prd-unplotted-groups');
  await expect(outside).toContainText('MetaRNN');
  await expect(outside).toContainText('0.732');
  await expect(outside).toContainText('-3.376');
  await expect(outside).toContainText('4.82');
  await browser.locator('.prd-unplotted-groups button').filter({ hasText: 'MetaRNN' }).tap();
  await expect(selected).toContainText('0.732');
  await screen.getByRole('tab', 'Native score scales').tap();
  for (const button of await browser.locator('.prd-group__toggle').all()) await button.tap();
  for (const [key, score] of [['metarnn', '0.732'], ['popeve', '-3.376'], ['esm', '-5.60'], ['eigen', '4.82']]) {
    const row = screen.getByTestId(`predictor-${key}`);
    await expect(row).toContainText(score);
    await browser.locator(`[data-testid="predictor-${key}"] .evw-reading-button`).tap();
    await expect(selected).toContainText(score);
  }
  await screen.getByRole('tab', 'Strength bands').tap();
  await expect(screen.getByTestId('ladder-popeve')).toContainText('popEVE');
  await expect(selected).toContainText('Eigen');
  await screen.getByRole('tab', 'Comparison').tap();
  for (const width of [1440, 800]) {
    await browser.setViewport({ width, height: 1000 });
    for (const theme of ['light', 'dark']) {
      const dark = await browser.evaluate(() => document.documentElement.classList.contains('dark'));
      if (dark !== (theme === 'dark')) await screen.getByRole('button', 'Switch theme').tap();
      expect(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await browser.locator('[data-testid="predictor-local-agreement"]').scrollIntoView();
      await app.screenshot(`gata4-comparison-${width}-${theme}`);
      await screen.getByRole('tab', 'Native score scales').tap();
      await browser.locator('[data-testid="predictor-informational"]').scrollIntoView();
      await app.screenshot(`gata4-models-${width}-${theme}`);
      await screen.getByRole('tab', 'Comparison').tap();
    }
  }
});
